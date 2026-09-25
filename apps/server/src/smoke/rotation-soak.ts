import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { encodeAudioFrame } from "@drake/contracts";
import WebSocket, { type RawData } from "ws";

const baseUrl = process.env.PUBLIC_BASE_URL ?? "http://127.0.0.1:3000";
const durationSeconds = Number(process.env.SOAK_SECONDS ?? 630);
const stageId = "main";
const talkId = `rotation-soak-${Date.now()}`;
const captureSessionId = crypto.randomUUID();
const opsKey = process.env.OPS_API_KEY!;

const configured = await fetch(`${baseUrl}/api/ops/stages/${stageId}/talks`, {
  method: "POST", headers: { "content-type": "application/json", "x-ops-key": opsKey },
  body: JSON.stringify({ conferenceId: "nerdearla-2026", talkId, title: "Provider rotation soak", speaker: "Fixture Feeder", sourceLanguage: "en-US", targetLanguages: ["es"] }),
});
if (!configured.ok) throw new Error(`Configure failed (${configured.status})`);
const tokenResponse = await fetch(`${baseUrl}/api/ingest-token`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ conferenceId: "nerdearla-2026", stageId, talkId }),
});
const { token } = await tokenResponse.json() as { token: string };

let rotations = 0;
let finals = 0;
let translations = 0;
const sseAbort = new AbortController();
const observer = (async () => {
  const response = await fetch(`${baseUrl}/api/events/${talkId}`, { signal: sseAbort.signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const item = await reader.read();
    if (item.done) return;
    pending += decoder.decode(item.value, { stream: true }).replace(/\r/g, "");
    const blocks = pending.split("\n\n"); pending = blocks.pop() ?? "";
    for (const block of blocks) {
      const line = block.split("\n").find((part) => part.startsWith("data: "));
      if (!line) continue;
      const event = JSON.parse(line.slice(6)) as { type: string; reasonCode?: string };
      if (event.type === "transcript.final") finals += 1;
      if (event.type === "translation.final") translations += 1;
      if (event.type === "stage.status" && event.reasonCode === "provider_rotated") rotations += 1;
    }
  }
})();

const wav = await readFile(resolve("../../fixtures/audio/window1-en.wav"));
const dataOffset = wav.indexOf(Buffer.from("data"));
const size = wav.readUInt32LE(dataOffset + 4);
const bytes = wav.subarray(dataOffset + 8, dataOffset + 8 + size);
const fixture = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

const socket = new WebSocket(baseUrl.replace(/^http/, "ws") + `/api/ingest/${stageId}?token=${encodeURIComponent(token)}`);
await new Promise<void>((open, reject) => { socket.once("open", open); socket.once("error", reject); });
socket.send(JSON.stringify({ type: "ingest.hello", protocolVersion: 1, talkId, sourceLanguage: "en-US", codec: "pcm_s16le", sampleRate: 16_000, channels: 1, captureSessionId, startingSampleOffset: 0 }));
await new Promise<void>((ready, reject) => {
  socket.on("message", (raw: RawData, binary: boolean) => {
    if (binary) return;
    const message = JSON.parse(raw.toString()) as { type: string; detail?: string };
    if (message.type === "ingest.ready") socket.send(JSON.stringify({ type: "ingest.resume", captureSessionId, availableFromSample: 0, availableToSample: 0, lastServerAck: 0 }));
    if (message.type === "ingest.resume_from") ready();
    if (message.type === "ingest.error") reject(new Error(message.detail));
  });
});

const started = performance.now();
let sampleOffset = 0;
let frameSequence = 0;
while ((performance.now() - started) / 1_000 < durationSeconds) {
  for (let fixtureOffset = 0; fixtureOffset < fixture.length; fixtureOffset += 1_600) {
    if ((performance.now() - started) / 1_000 >= durationSeconds) break;
    const chunk = fixture.subarray(fixtureOffset, Math.min(fixtureOffset + 1_600, fixture.length));
    socket.send(encodeAudioFrame({ protocolVersion: 1, frameSequence: frameSequence++, startSample: sampleOffset, sampleCount: chunk.length }, chunk));
    sampleOffset += chunk.length;
    await new Promise((done) => setTimeout(done, chunk.length / 16));
  }
}
socket.send(JSON.stringify({ type: "ingest.stop", reason: "rotation_soak_complete", finalSampleOffset: sampleOffset }));
await new Promise((done) => setTimeout(done, 2_000));
socket.close();
sseAbort.abort();
await observer.catch((error) => { if (!sseAbort.signal.aborted) throw error; });
if (rotations < 1) throw new Error(`Expected at least one provider rotation; got ${rotations}`);
if (finals < 2 || translations < 2) throw new Error(`Insufficient caption output: ${finals} finals, ${translations} translations`);
console.log(JSON.stringify({ talkId, durationSeconds, rotations, finals, translations, samples: sampleOffset }));
console.log("Rotation soak succeeded");
