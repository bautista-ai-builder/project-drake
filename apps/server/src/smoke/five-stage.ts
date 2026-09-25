import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { encodeAudioFrame } from "@drake/contracts";
import WebSocket, { type RawData } from "ws";

const baseUrl = process.env.PUBLIC_BASE_URL ?? "http://127.0.0.1:3000";
const stageIds = ["main", "ai", "dev", "data", "community"];
const opsKey = process.env.OPS_API_KEY!;

const wav = await readFile(resolve("../../fixtures/audio/window1-en.wav"));
const dataOffset = wav.indexOf(Buffer.from("data"));
if (dataOffset < 0) throw new Error("Fixture WAV has no data chunk");
const dataSize = wav.readUInt32LE(dataOffset + 4);
const audio = wav.subarray(dataOffset + 8, dataOffset + 8 + dataSize);
const pcm = new Int16Array(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength));

const waitForFinals = async (talkId: string, signal: AbortSignal) => {
  const response = await fetch(`${baseUrl}/api/events/${talkId}`, { signal });
  if (!response.body) throw new Error(`No SSE body for ${talkId}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let final = false;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error(`SSE ended for ${talkId}`);
    pending += decoder.decode(chunk.value, { stream: true }).replace(/\r/g, "");
    const blocks = pending.split("\n\n");
    pending = blocks.pop() ?? "";
    for (const block of blocks) {
      const line = block.split("\n").find((item) => item.startsWith("data: "));
      if (!line) continue;
      const event = JSON.parse(line.slice(6)) as { type: string; targetLanguage?: string };
      if (event.type === "transcript.final") final = true;
      if (final && event.type === "translation.final" && event.targetLanguage === "es") {
        await reader.cancel();
        return;
      }
    }
  }
};

const runStage = async (stageId: string, signal: AbortSignal) => {
  const talkId = `load-${stageId}-${Date.now()}`;
  const configured = await fetch(`${baseUrl}/api/ops/stages/${stageId}/talks`, {
    method: "POST", headers: { "content-type": "application/json", "x-ops-key": opsKey },
    body: JSON.stringify({ conferenceId: "nerdearla-2026", talkId, title: `Five-stage gate: ${stageId}`, speaker: "Fixture Feeder", sourceLanguage: "en-US", targetLanguages: ["es", "pt"] }),
    signal,
  });
  if (!configured.ok) throw new Error(`Configure ${stageId} failed (${configured.status})`);
  const tokenResponse = await fetch(`${baseUrl}/api/ingest-token`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ conferenceId: "nerdearla-2026", stageId, talkId }), signal,
  });
  const { token } = await tokenResponse.json() as { token: string };
  const completion = waitForFinals(talkId, signal);
  const captureSessionId = crypto.randomUUID();
  const socket = new WebSocket(baseUrl.replace(/^http/, "ws") + `/api/ingest/${stageId}?token=${encodeURIComponent(token)}`);
  await new Promise<void>((open, reject) => { socket.once("open", open); socket.once("error", reject); });
  socket.send(JSON.stringify({ type: "ingest.hello", protocolVersion: 1, talkId, sourceLanguage: "en-US", codec: "pcm_s16le", sampleRate: 16_000, channels: 1, captureSessionId, startingSampleOffset: 0 }));
  await new Promise<void>((ready, reject) => {
    const listener = (raw: RawData, binary: boolean) => {
      if (binary) return;
      const message = JSON.parse(raw.toString()) as { type: string; expectedSampleOffset?: number; detail?: string };
      if (message.type === "ingest.ready") {
        socket.send(JSON.stringify({ type: "ingest.resume", captureSessionId, availableFromSample: 0, availableToSample: 0, lastServerAck: 0 }));
      }
      if (message.type === "ingest.resume_from") { socket.off("message", listener); ready(); }
      if (message.type === "ingest.error") reject(new Error(message.detail));
    };
    socket.on("message", listener);
  });
  let frameSequence = 0;
  for (let startSample = 0; startSample < pcm.length; startSample += 1_600) {
    const chunk = pcm.subarray(startSample, Math.min(startSample + 1_600, pcm.length));
    socket.send(encodeAudioFrame({ protocolVersion: 1, frameSequence: frameSequence++, startSample, sampleCount: chunk.length }, chunk));
    await new Promise((done) => setTimeout(done, 100));
  }
  socket.send(JSON.stringify({ type: "ingest.stop", reason: "five_stage_gate", finalSampleOffset: pcm.length }));
  await completion;
  socket.close();
  return { stageId, talkId };
};

const abort = new AbortController();
const timeout = setTimeout(() => abort.abort(new Error("Five-stage gate timed out")), 60_000);
const started = performance.now();
const results = await Promise.all(stageIds.map((stageId) => runStage(stageId, abort.signal)));
clearTimeout(timeout);
console.log(JSON.stringify({ stages: results, elapsedMs: Math.round(performance.now() - started) }, null, 2));
console.log("Five-stage gate succeeded");
