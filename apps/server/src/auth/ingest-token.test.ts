import { describe, expect, it } from "vitest";
import { issueIngestToken, verifyIngestToken } from "./ingest-token.js";

const secret = "a-secret-that-is-long-enough-for-tests";
const claims = { conferenceId: "conf", stageId: "main", talkId: "talk", scope: "ingest" as const };

describe("ingest token", () => {
  it("round-trips scoped claims", async () => {
    const token = await issueIngestToken(claims, secret, 60);
    await expect(verifyIngestToken(token, secret, "main")).resolves.toMatchObject(claims);
  });

  it("rejects a token for another stage", async () => {
    const token = await issueIngestToken(claims, secret, 60);
    await expect(verifyIngestToken(token, secret, "side")).rejects.toThrow(/stage/);
  });

  it("rejects an expired token", async () => {
    const token = await issueIngestToken(claims, secret, -1);
    await expect(verifyIngestToken(token, secret)).rejects.toThrow();
  });
});
