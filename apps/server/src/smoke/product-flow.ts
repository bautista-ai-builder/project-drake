import { randomUUID } from "node:crypto";
import { loadConfig } from "../config.js";
import { createPool } from "../database/pool.js";

const config = loadConfig();
const baseUrl = process.env.PUBLIC_BASE_URL ?? "http://127.0.0.1:3000";
const suffix = randomUUID().slice(0, 8);
const conferenceId = `qa-event-${suffix}`;
const stageId = `qa-stage-${suffix}`;
const talkId = `qa-talk-${suffix}`;
const headers = { "content-type": "application/json", "x-ops-key": config.OPS_API_KEY };
const pool = createPool(config.DATABASE_URL);

const post = async (path: string, body: unknown, protectedOperation = true) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: protectedOperation ? headers : { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} failed (${response.status}): ${await response.text()}`);
  return response.json();
};

try {
  await post("/api/conferences", { conferenceId, name: "Window 4 QA Event" }, false);
  await post(`/api/conferences/${conferenceId}/stages`, { stageId, stageName: "QA Stage" }, false);
  await post(`/api/conferences/${conferenceId}/stages/${stageId}/talks`, {
    talkId, title: "Matriz de idiomas", speaker: "Drake QA", sourceLanguage: "es", targetLanguages: ["en", "pt"],
  }, false);
  const eventResponse = await fetch(`${baseUrl}/api/conferences/${conferenceId}`);
  const stageResponse = await fetch(`${baseUrl}/api/conferences/${conferenceId}/stages/${stageId}`);
  const operationsResponse = await fetch(`${baseUrl}/api/ops/stages?conferenceId=${conferenceId}`);
  const event = await eventResponse.json() as { stages: Array<{ stageId: string; currentTalk?: { talkId: string; sourceLanguage: string; targetLanguages: string[] } }> };
  const stage = await stageResponse.json() as { talks: Array<{ talkId: string; sourceLanguage: string; targetLanguages: string[] }> };
  const operations = await operationsResponse.json() as Array<{ conferenceId: string; stageId: string; talkId: string }>;
  const configured = stage.talks.find((talk) => talk.talkId === talkId);
  if (!eventResponse.ok || !stageResponse.ok || !operationsResponse.ok || event.stages[0]?.currentTalk?.talkId !== talkId || !configured) throw new Error("Product workspace did not expose the configured talk");
  if (operations.length !== 1 || operations[0]?.conferenceId !== conferenceId || operations[0]?.stageId !== stageId || operations[0]?.talkId !== talkId) throw new Error("Event operations did not stay scoped to the requested conference");
  if (configured.sourceLanguage !== "es" || configured.targetLanguages.join(",") !== "en,pt") throw new Error("Language configuration did not propagate");
  console.log(JSON.stringify({ conferenceId, stageId, talkId, source: configured.sourceLanguage, targets: configured.targetLanguages }));
  console.log("Product flow smoke succeeded");
} finally {
  await pool.query("DELETE FROM conferences WHERE slug=$1", [conferenceId]);
  await pool.end();
}
