import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { createPool } from "./pool.js";

const migrationsUrl = new URL("./migrations/", import.meta.url);
const config = loadConfig();
const pool = createPool(config.DATABASE_URL);

try {
  const directory = fileURLToPath(migrationsUrl);
  const migrations = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  for (const migration of migrations) {
    await pool.query(await readFile(`${directory}/${migration}`, "utf8"));
    console.log(`Applied ${migration}`);
  }
  console.log(`Database migration complete (${migrations.length} files)`);
} finally {
  await pool.end();
}
