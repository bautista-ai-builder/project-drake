import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import staticPlugin from "@fastify/static";
import websocket from "@fastify/websocket";
import { decodeAudioFrame, ingestClientMessageSchema, normalizeLanguageCode, talkLanguageConfigurationSchema, type CanonicalEvent, type ServerConfig } from "@drake/contracts";
import { z } from "zod";
import { issueIngestToken, verifyIngestToken } from "./auth/ingest-token.js";
import { createPool } from "./database/pool.js";
import { ConferenceStore } from "./database/conference-store.js";
import { TalkStore } from "./database/talk-store.js";
import { EventHub } from "./events/event-hub.js";
import { renderText, renderVtt, selectCaptions } from "./exports/captions.js";
import { CaptionStore } from "./persistence/caption-store.js";
import { GeminiSttProvider } from "./providers/gemini-stt.js";
import { GoogleCloudTranslationProvider } from "./providers/translation.js";
import { StageRegistry } from "./stages/registry.js";
import { TranslationScheduler } from "./translation/scheduler.js";

const tokenRequestSchema = z.object({
  conferenceId: z.string().min(1), stageId: z.string().min(1), talkId: z.string().min(1),
});

const slugSchema = z.string().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const inputLanguageSchema = z.string().transform((value, context) => {
  const normalized = normalizeLanguageCode(value);
  if (!normalized) {
    context.addIssue({ code: "custom", message: `Unsupported language: ${value}` });
    return z.NEVER;
  }
  return normalized;
});
const talkConfigurationSchema = z.object({
  conferenceId: z.string().min(1).default("nerdearla-2026"),
  talkId: slugSchema,
  title: z.string().min(1),
  speaker: z.string().min(1),
  sourceLanguage: inputLanguageSchema,
  targetLanguages: z.array(inputLanguageSchema).min(1).max(2),
}).superRefine((value, context) => {
  const validated = talkLanguageConfigurationSchema.safeParse(value);
  if (!validated.success) for (const issue of validated.error.issues) {
    context.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
});

const sse = (event: CanonicalEvent) => `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

export const buildApp = async (config: ServerConfig) => {
  const app = Fastify({ logger: true });
  const hub = new EventHub();
  const pool = createPool(config.DATABASE_URL);
  const captions = new CaptionStore(pool);
  captions.attach(hub);
  const talks = new TalkStore(pool);
  const conferences = new ConferenceStore(pool);
  hub.subscribe(async (event) => {
    if (event.type === "stage.status" && event.stageStatus === "completed") {
      await talks.transition(event.stageId, event.talkId, "completed");
    }
  });
  const stt = new GeminiSttProvider(config);
  const translator = config.TRANSLATION_PROVIDER === "google"
    ? new TranslationScheduler(new GoogleCloudTranslationProvider(config), hub)
    : undefined;
  const stages = new StageRegistry(stt, hub, translator, config.STT_ROTATION_SECONDS * 1_000);
  const requireOpsKey = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers["x-ops-key"] !== config.OPS_API_KEY) return reply.code(401).send({ error: "invalid_ops_key" });
  };

  await app.register(websocket);

  app.addHook("onClose", async () => pool.end());
  app.get("/api/health", async () => ({
    status: captions.status().status === "healthy" ? "ok" : "degraded",
    service: "project-drake",
    persistence: captions.status(),
    timestamp: new Date().toISOString(),
  }));

  app.get("/api/conferences", async () => conferences.list());

  app.post("/api/conferences", async (request, reply) => {
    const input = z.object({ conferenceId: slugSchema, name: z.string().trim().min(2).max(120) }).parse(request.body);
    try {
      return await conferences.create(input);
    } catch (error) {
      if (String(error).includes("duplicate key")) return reply.code(409).send({ error: "conference_slug_in_use" });
      throw error;
    }
  });

  app.get("/api/conferences/:conferenceId", async (request, reply) => {
    const { conferenceId } = request.params as { conferenceId: string };
    return await conferences.get(conferenceId) ?? reply.code(404).send({ error: "conference_not_found" });
  });

  app.post("/api/conferences/:conferenceId/stages", async (request, reply) => {
    const { conferenceId } = request.params as { conferenceId: string };
    const input = z.object({ stageId: slugSchema, stageName: z.string().trim().min(2).max(120) }).parse(request.body);
    try {
      return await conferences.createStage({ conferenceId, ...input });
    } catch (error) {
      const reason = String(error);
      if (reason.includes("stage_slug_in_use")) return reply.code(409).send({ error: "stage_slug_in_use" });
      if (reason.includes("conference_not_found")) return reply.code(404).send({ error: "conference_not_found" });
      throw error;
    }
  });

  app.get("/api/conferences/:conferenceId/stages/:stageId", async (request, reply) => {
    const { conferenceId, stageId } = request.params as { conferenceId: string; stageId: string };
    const workspace = await conferences.get(conferenceId);
    if (!workspace) return reply.code(404).send({ error: "conference_not_found" });
    const stage = workspace?.stages.find((item) => item.stageId === stageId);
    if (!stage) return reply.code(404).send({ error: "stage_not_found" });
    return { conference: workspace.conference, stage, talks: await talks.history(conferenceId, stageId) };
  });

  app.post("/api/conferences/:conferenceId/stages/:stageId/talks", async (request, reply) => {
    const { conferenceId, stageId } = request.params as { conferenceId: string; stageId: string };
    const body = talkConfigurationSchema.parse({ ...(request.body as object), conferenceId });
    try {
      return await talks.configure({ ...body, conferenceId, stageId });
    } catch (error) {
      if (String(error).includes("talk_slug_in_use")) return reply.code(409).send({ error: "talk_slug_in_use" });
      if (String(error).includes("Unknown stage")) return reply.code(404).send({ error: "stage_not_found" });
      throw error;
    }
  });

  app.get("/api/conferences/:conferenceId/stages/:stageId/talks/:talkId", async (request, reply) => {
    const { conferenceId, stageId, talkId } = request.params as { conferenceId: string; stageId: string; talkId: string };
    const talk = await talks.getScoped(conferenceId, stageId, talkId);
    if (!talk) return reply.code(404).send({ error: "talk_not_found" });
    const events = await captions.replay(talkId);
    const original = events.filter((event) => event.type === "transcript.final");
    const translations = events.filter((event) => event.type === "translation.final");
    return { talk, original, translations };
  });

  app.get("/api/stages/:stageId", async (request, reply) => {
    const { stageId } = request.params as { stageId: string };
    const talk = await talks.current(stageId);
    if (!talk) return reply.code(404).send({ error: "stage_not_found" });
    return { ...talk, runtime: stages.activeForStage(stageId)?.snapshot() };
  });

  app.get("/api/ops/stages", async (request) => {
    const { conferenceId } = z.object({ conferenceId: slugSchema.optional() }).parse(request.query);
    const records = await talks.list(conferenceId);
    const runtimeByTalk = new Map(stages.snapshots().map((item) => [`${item.stageId}:${item.talkId}`, item]));
    return records.map((talk) => ({ ...talk, runtime: runtimeByTalk.get(`${talk.stageId}:${talk.talkId}`) }));
  });

  app.post("/api/ops/stages/:stageId/talks", { preHandler: requireOpsKey }, async (request) => {
    const { stageId } = request.params as { stageId: string };
    const body = talkConfigurationSchema.parse(request.body);
    return talks.configure({ ...body, stageId });
  });

  app.post("/api/ops/stages/:stageId/start", { preHandler: requireOpsKey }, async (request, reply) => {
    const { stageId } = request.params as { stageId: string };
    const { talkId } = z.object({ talkId: z.string().min(1) }).parse(request.body);
    const talk = await talks.get(stageId, talkId);
    if (!talk) return reply.code(404).send({ error: "talk_not_found" });
    await talks.transition(stageId, talkId, "starting");
    return { status: "starting", talk };
  });

  app.post("/api/ops/stages/:stageId/stop", { preHandler: requireOpsKey }, async (request, reply) => {
    const { stageId } = request.params as { stageId: string };
    const { talkId } = z.object({ talkId: z.string().min(1) }).parse(request.body);
    const talk = await talks.get(stageId, talkId);
    if (!talk) return reply.code(404).send({ error: "talk_not_found" });
    stages.stop(stageId, talkId);
    await talks.transition(stageId, talkId, "completed");
    return { status: "completed", talkId };
  });

  app.post("/api/ops/stages/:stageId/rotate", { preHandler: requireOpsKey }, async (request, reply) => {
    const { stageId } = request.params as { stageId: string };
    const supervisor = stages.activeForStage(stageId);
    if (!supervisor) return reply.code(404).send({ error: "active_stage_not_found" });
    await supervisor.rotateNow();
    return supervisor.snapshot();
  });

  app.post("/api/ingest-token", async (request, reply) => {
    const claims = tokenRequestSchema.parse(request.body);
    const talk = await talks.get(claims.stageId, claims.talkId);
    if (!talk || talk.conferenceId !== claims.conferenceId) return reply.code(404).send({ error: "talk_not_found" });
    return {
      token: await issueIngestToken({ ...claims, scope: "ingest" }, config.INGEST_JWT_SECRET, config.INGEST_TOKEN_TTL_SECONDS),
      expiresIn: config.INGEST_TOKEN_TTL_SECONDS,
    };
  });

  app.get("/api/events/:talkId", async (request, reply) => {
    const { talkId } = request.params as { talkId: string };
    const after = Number(request.headers["last-event-id"] ?? 0);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(": connected\n\n");
    let replaying = true;
    const pending: CanonicalEvent[] = [];
    const unsubscribe = hub.subscribe((event) => {
      if (event.talkId !== talkId || event.sequence <= after) return;
      if (replaying) pending.push(event);
      else reply.raw.write(sse(event));
    });
    let highWater = after;
    for (const event of await captions.replay(talkId, after)) {
      reply.raw.write(sse(event));
      highWater = Math.max(highWater, event.sequence);
    }
    for (const event of hub.snapshot(talkId)) {
      if (event.sequence > highWater) {
        reply.raw.write(sse(event));
        highWater = event.sequence;
      }
    }
    replaying = false;
    for (const event of pending) if (event.sequence > highWater) reply.raw.write(sse(event));
    const keepalive = setInterval(() => reply.raw.write(": keepalive\n\n"), 15_000);
    request.raw.on("close", () => { clearInterval(keepalive); unsubscribe(); });
  });

  app.get("/api/talks/:talkId/export.:format", async (request, reply) => {
    const { talkId, format } = request.params as { talkId: string; format: string };
    const { language } = z.object({ language: z.string().min(2).default("original") }).parse(request.query);
    if (format !== "vtt" && format !== "txt") return reply.code(404).send({ error: "unsupported_export_format" });
    const selected = selectCaptions(await captions.replay(talkId), language);
    if (selected.length === 0) return reply.code(404).send({ error: "captions_not_found" });
    const body = format === "vtt" ? renderVtt(selected) : renderText(selected);
    return reply
      .type(format === "vtt" ? "text/vtt; charset=utf-8" : "text/plain; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${talkId}-${language}.${format}"`)
      .send(body);
  });

  app.get("/api/ingest/:stageId", { websocket: true }, (socket, request) => {
    const { stageId } = request.params as { stageId: string };
    const { token } = request.query as { token?: string };
    let supervisor: ReturnType<StageRegistry["getOrCreate"]> | undefined;
    const authorization = token
      ? verifyIngestToken(token, config.INGEST_JWT_SECRET, stageId)
      : Promise.reject(new Error("Missing ingest token"));

    socket.on("close", () => supervisor?.detachIngest());
    socket.on("message", (data: Buffer | ArrayBuffer, isBinary: boolean) => {
      void (async () => {
        try {
          const claims = await authorization;
          const talkId = claims.talkId;
          if (!isBinary) {
            const message = ingestClientMessageSchema.parse(JSON.parse(data.toString()));
            if (message.type === "ingest.hello") {
              if (message.talkId !== talkId) throw new Error("Token talk does not match ingest hello");
              const talk = await talks.get(stageId, talkId);
              if (!talk) throw new Error("Talk configuration not found");
              const cursor = await captions.runtimeCursor(talkId);
              supervisor = stages.getOrCreate({
                conferenceId: talk.conferenceId, stageId, talkId, sourceLanguage: talk.sourceLanguage,
                targetLanguages: talk.targetLanguages, vocabulary: ["Nerdearla", "Gemini", "Gemma", "Kubernetes", "TypeScript", "PostgreSQL", "MCP", "Vertex AI"],
                initialSequence: cursor.sequence,
                initialExpectedSample: cursor.audioEndSample,
                initialStreamEpoch: cursor.streamEpoch,
              });
              await supervisor.start();
              const expectedSampleOffset = supervisor.attachIngest(message.captureSessionId);
              await talks.transition(stageId, talkId, "live");
              socket.send(JSON.stringify({ type: "ingest.ready", expectedSampleOffset }));
            } else if (message.type === "ingest.resume") {
              if (!supervisor) throw new Error("Send ingest.hello before resume");
              const sampleOffset = supervisor.resumeFrom(message.availableFromSample);
              socket.send(JSON.stringify({ type: "ingest.resume_from", sampleOffset }));
            } else if (message.type === "ingest.stop") {
              supervisor?.finish();
              await talks.transition(stageId, talkId, "finalizing");
              socket.send(JSON.stringify({ type: "talk.stopped", talkId }));
            }
            return;
          }

          if (!supervisor) throw new Error("Send ingest.hello before audio frames");
          const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          const frameBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
          const { header, pcm } = decodeAudioFrame(frameBuffer);
          if (header.protocolVersion !== 1) throw new Error("Unsupported audio frame protocol");
          const accepted = supervisor.acceptAudio(header.startSample, pcm);
          socket.send(JSON.stringify({ type: "ingest.ack", frameSequence: header.frameSequence, acceptedThroughSample: accepted.acceptedThroughSample }));
        } catch (error) {
          socket.send(JSON.stringify({ type: "ingest.error", code: "invalid_ingest_message", detail: String(error), retryable: true }));
          if (String(error).includes("token") || String(error).includes("JWT")) socket.close(1008, "unauthorized");
        }
      })();
    });
  });

  const webRoot = fileURLToPath(new URL("../../web/dist", import.meta.url));
  if (existsSync(webRoot)) {
    await app.register(staticPlugin, { root: webRoot });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "not_found" });
      return reply.sendFile("index.html");
    });
  }

  return app;
};
