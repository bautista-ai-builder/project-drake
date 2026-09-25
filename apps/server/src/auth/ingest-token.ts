import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";

const claimsSchema = z.object({
  conferenceId: z.string().min(1),
  stageId: z.string().min(1),
  talkId: z.string().min(1),
  scope: z.literal("ingest"),
});

export type IngestClaims = z.infer<typeof claimsSchema>;

const key = (secret: string) => new TextEncoder().encode(secret);

export const issueIngestToken = async (claims: IngestClaims, secret: string, ttlSeconds: number) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .setSubject(claims.talkId)
    .sign(key(secret));

export const verifyIngestToken = async (token: string, secret: string, expectedStageId?: string) => {
  const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
  const claims = claimsSchema.parse(payload);
  if (expectedStageId && claims.stageId !== expectedStageId) throw new Error("Token is not valid for this stage");
  return claims;
};
