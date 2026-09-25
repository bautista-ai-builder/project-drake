import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { encodeAudioFrame } from "@drake/contracts";
import WebSocket, { type RawData } from "ws";

const baseUrl = process.env.PUBLIC_BASE_URL ?? "http://127.0.0.1:3000";
const stageId = "main";
const talkId = `reconnect-${Date.now()}`;
const captureSessionId = crypto.randomUUID();
const opsKey = process.env.OPS_API_KEY!;

await fetch(`${baseUrl}/api/ops/stages/${stageId}/talks`, {
  method: "POST", headers: { "content-type": "application/json", "x-ops-key": opsKey },
  body: JSON.stringify({ conferenceId: "nerdearla-2026", talkId, title: "Reconnect gate", speaker: "Fixture Feeder", sourceLanguage: "en-US", targetLanguages: ["es"] }),
});
const tokenResponse = await fetch(`${baseUrl}/api/ingest-token`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ conferenceId: "nerdearla-2026", stageId, talkId }),
});
const { token } = await tokenResponse.json() as { token: string };

const wav = await readFile(resolve("../../fixtures/audio/window1-en.wav"));
const dataOffset = wav.indexOf(Buffer.from("data"));
const size = wav.readUInt32LE(dataOffset + 4);
const bytes = wav.subarray(dataOffset + 8, dataOffset + 8 + size);
const pcm = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const frames = Array.from({ length: Math.ceil(pcm.length / 1_600) }, (_, sequence) => {
  const startSample = sequence * 1_600;
  const chunk = pcm.subarray(startSample, Math.min(startSample + 1_600, pcm.length));
  return { startSample, frame: encodeAudioFrame({ protocolVersion: 1, frameSequence: sequence, startSample, sampleCount: chunk.length }, chunk) };
});

const connect = async (availableToSample: number) => {
  const socket = new WebSocket(baseUrl.replace(/^http/, "ws") + `/api/ingest/${stageId}?token=${encodeURIComponent(token)}`);
  await new Promise<void>((open, reject) => { socket.once("open", open); socket.once("error", reject); });
  socket.send(JSON.stringify({ type: "ingest.hello", protocolVersion: 1, talkId, sourceLanguage: "en-US", codec: "pcm_s16le", sampleRate: 16_000, channels: 1, captureSessionId, startingSampleOffset: availableToSample }));
  const resumeFrom = await new Promise<number>((ready, reject) => {
    socket.on("message", (raw: RawData, binary: boolean) => {
      if (binary) return;
      const message = JSON.parse(raw.toString()) as { type: string; expectedSampleOffset?: number; sampleOffset?: number; detail?: string };
      if (message.type === "ingest.ready") socket.send(JSON.stringify({ type: "ingest.resume", captureSessionId, availableFromSample: 0, availableToSample, lastServerAck: 0 }));
      if (message.type === "ingest.resume_from") ready(message.sampleOffset!);
      if (message.type === "ingest.error") reject(new Error(message.detail));
    });
  });
  return { socket, resumeFrom };
};

const completion = (async () => {
  const response = await fetch(`${baseUrl}/api/events/${talkId}`);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const item = await reader.read();
    pending += decoder.decode(item.value, { stream: true }).replace(/\r/g, "");
    const blocks = pending.split("\n\n"); pending = blocks.pop() ?? "";
    for (const block of blocks) {
      const line = block.split("\n").find((part) => part.startsWith("data: "));
      if (!line) continue;
      const event = JSON.parse(line.slice(6)) as { type: string; targetLanguage?: string };
      if (event.type === "translation.final" && event.targetLanguage === "es") { await reader.cancel(); return; }
    }
  }
})();

const first = await connect(0);
for (const item of frames.slice(0, 30)) { first.socket.send(item.frame); await new Promise((done) => setTimeout(done, 100)); }
first.socket.close(1012, "reconnect_gate");
await new Promise((done) => setTimeout(done, 1_000));
const bufferedThrough = frames[39]!.startSample + 1_600;
const second = await connect(bufferedThrough);
if (second.resumeFrom !== frames[30]!.startSample) throw new Error(`Expected resume at ${frames[30]!.startSample}, got ${second.resumeFrom}`);
for (const item of frames.slice(30)) { second.socket.send(item.frame); await new Promise((done) => setTimeout(done, 100)); }
second.socket.send(JSON.stringify({ type: "ingest.stop", reason: "reconnect_gate_complete", finalSampleOffset: pcm.length }));
await completion;
second.socket.close();
console.log(JSON.stringify({ talkId, resumeFrom: second.resumeFrom, replayedSamples: bufferedThrough - second.resumeFrom }));
console.log("Reconnect gate succeeded");
