import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const validEnvironment = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: "3000",
  PUBLIC_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://drake:drake@localhost:5432/drake",
  INGEST_JWT_SECRET: "this-is-a-long-enough-test-secret-123",
  OPS_API_KEY: "this-is-a-long-enough-ops-key",
  GEMINI_AUTH_MODE: "enterprise",
  GOOGLE_CLOUD_PROJECT: "test-project",
  GOOGLE_CLOUD_LOCATION: "global",
};

describe("server config", () => {
  it("parses a valid environment", () => {
    expect(loadConfig(validEnvironment).PORT).toBe(3000);
  });

  it("fails when the ingest secret is weak", () => {
    expect(() => loadConfig({ ...validEnvironment, INGEST_JWT_SECRET: "short" })).toThrow();
  });

  it("requires an API key only in Gemini API mode", () => {
    expect(() => loadConfig({ ...validEnvironment, GEMINI_AUTH_MODE: "gemini-api" })).toThrow(/GEMINI_API_KEY/);
  });
});
