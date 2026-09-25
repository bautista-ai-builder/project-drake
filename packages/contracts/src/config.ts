import { z } from "zod";

export const serverConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  INGEST_JWT_SECRET: z.string().min(32),
  OPS_API_KEY: z.string().min(24),
  GEMINI_AUTH_MODE: z.enum(["enterprise", "gemini-api"]).default("enterprise"),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  GOOGLE_CLOUD_LOCATION: z.string().default("global"),
  GEMINI_STT_MODEL: z.string().default("gemini-3.5-transcribe-live-preview"),
  TRANSLATION_PROVIDER: z.enum(["google", "disabled"]).default("google"),
  INGEST_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  STT_ROTATION_SECONDS: z.coerce.number().int().min(1).max(540).default(480),
}).superRefine((config, context) => {
  if (config.GEMINI_AUTH_MODE === "gemini-api" && !config.GEMINI_API_KEY) {
    context.addIssue({ code: "custom", path: ["GEMINI_API_KEY"], message: "Required for gemini-api auth mode" });
  }
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;
