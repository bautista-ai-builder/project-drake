import { cp, mkdir } from "node:fs/promises";

await mkdir(new URL("../dist/database/migrations/", import.meta.url), { recursive: true });
await cp(
  new URL("../src/database/migrations/", import.meta.url),
  new URL("../dist/database/migrations/", import.meta.url),
  { recursive: true },
);
