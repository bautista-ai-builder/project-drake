import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decodeAudioFrame, encodeAudioFrame, ingestServerMessageSchema, type TranslationFinal } from "@drake/contracts";
import WebSocket, { type RawData } from "ws";

const baseUrl = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
const talkId = process.env.SMOKE_TALK_ID ?? "window-1-demo";
const stageId = process.env.SMOKE_STAGE_ID ?? "main";
const sourceLanguage = process.env.SMOKE_SOURCE_LANGUAGE ?? "en-US";

type TimingResult = {
  translation: TranslationFinal;
  firstPartialAt: number | null;
  finalAt: number | null;
  translationAt: number;
};

const readPcm16Wav = async (path: string): Promise<Int16Array> => {
  const wav = await readFile(path);
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error("Not a WAV file");
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let data: Buffer | undefined;
  while (offset + 8 <= wav.length) {
    const name = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (name === "fmt ") {
      channels = wav.readUInt16LE(body + 2);
      sampleRate = wav.readUInt32LE(body + 4);
      bits = wav.readUInt16LE(body + 14);
    }
    if (name === "data") data = wav.subarray(body, body + size);
    offset = body + size + (size % 2);
  }
  if (!data || sampleRate !== 16_000 || channels !== 1 || bits !== 16) {
    throw new Error(`Fixture must be PCM16 mono 16kHz; got ${sampleRate}Hz/${channels}ch/${bits}bit`);
  }
  return new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
};

const waitForTranslation = async (signal: AbortSignal): Promise<TimingResult> => {
  const response = await fetch(`${baseUrl}/api/events/${talkId}`, { signal });
  if (!response.ok || !response.body) throw new Error(`SSE failed (${response.status})`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let firstPartialAt: number | null = null;
  let finalAt: number | null = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error("SSE ended before translation");
    pending += decoder.decode(value, { stream: true }).replace(/\r/g, "");
    const blocks = pending.split("\n\n");
    pending = blocks.pop() ?? "";
    for (const block of blocks) {
      const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      const event = JSON.parse(dataLine.slice(6)) as { type: string; text?: string };
      if (event.type === "transcript.partial") {
        firstPartialAt ??= performance.now();
        console.log("partial:", event.text);
      }
      if (event.type === "transcript.final") {
        finalAt ??= performance.now();
        console.log("final:", event.text);
      }
      if (event.type === "translation.final") {
        return {
          translation: event as TranslationFinal,
          firstPartialAt,
          finalAt,
          translationAt: performance.now(),
        };
      }
    }
  }
};

const tokenResponse = await fetch(`${baseUrl}/api/ingest-token`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ conferenceId: "nerdearla-2026", stageId, talkId }),
});
const { token } = await tokenResponse.json() as { token: string };
const pcm = await readPcm16Wav(resolve("../../fixtures/audio/window1-en.wav"));
const abort = new AbortController();
const timeout = setTimeout(() => abort.abort(new Error("E2E translation timeout")), 45_000);
const translationPromise = waitForTranslation(abort.signal);
const wsUrl = baseUrl.replace(/^http/, "ws") + `/api/ingest/${stageId}?token=${encodeURIComponent(token)}`;
const socket = new WebSocket(wsUrl);

await new Promise<void>((resolveOpen, reject) => {
  socket.once("open", resolveOpen);
  socket.once("error", reject);
});
socket.send(JSON.stringify({
  type: "ingest.hello", protocolVersion: 1, talkId, sourceLanguage, codec: "pcm_s16le",
  sampleRate: 16_000, channels: 1, captureSessionId: crypto.randomUUID(), startingSampleOffset: 0,
}));

await new Promise<void>((resolveReady, reject) => {
  const onMessage = (raw: RawData, isBinary: boolean) => {
    if (isBinary) return;
    try {
      const message = ingestServerMessageSchema.parse(JSON.parse(raw.toString()));
      if (message.type === "ingest.ready") { socket.off("message", onMessage); resolveReady(); }
      if (message.type === "ingest.error") reject(new Error(message.detail));
    } catch (error) { reject(error); }
  };
  socket.on("message", onMessage);
});

let frameSequence = 0;
const audioStartedAt = performance.now();
for (let startSample = 0; startSample < pcm.length; startSample += 1_600) {
  const chunk = pcm.subarray(startSample, Math.min(startSample + 1_600, pcm.length));
  const frame = encodeAudioFrame({ protocolVersion: 1, frameSequence: frameSequence++, startSample, sampleCount: chunk.length }, chunk);
  decodeAudioFrame(frame);
  socket.send(frame);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
}
socket.send(JSON.stringify({ type: "ingest.stop", reason: "fixture_complete", finalSampleOffset: pcm.length }));
const timing = await translationPromise;
clearTimeout(timeout);
abort.abort();
socket.close();
const round = (value: number | null): number | null => value === null ? null : Math.round(value);
console.log("translation:", timing.translation.text);
console.log("metrics_ms:", JSON.stringify({
  ttFirstPartial: round(timing.firstPartialAt === null ? null : timing.firstPartialAt - audioStartedAt),
  ttFinalTranscript: round(timing.finalAt === null ? null : timing.finalAt - audioStartedAt),
  ttTranslationFromFinal: round(timing.finalAt === null ? null : timing.translationAt - timing.finalAt),
  e2eTranslation: round(timing.translationAt - audioStartedAt),
}));
console.log("E2E fixture succeeded");
