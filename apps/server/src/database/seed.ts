import { randomUUID } from "node:crypto";
import { loadConfig } from "../config.js";
import { createPool } from "./pool.js";

const pool = createPool(loadConfig().DATABASE_URL);
const conferenceId = randomUUID();
const stageDefinitions = [
  { slug: "main", name: "Main Stage", source: "en-US", targets: ["es", "pt"] },
  { slug: "ai", name: "AI Stage", source: "es-AR", targets: ["en", "pt"] },
  { slug: "dev", name: "Developer Stage", source: "pt-BR", targets: ["es", "en"] },
  { slug: "data", name: "Data Stage", source: "en-US", targets: ["es", "pt"] },
  { slug: "community", name: "Community Stage", source: "es-AR", targets: ["en", "pt"] },
];

try {
  await pool.query("BEGIN");
  const conference = await pool.query<{ id: string }>(
    `INSERT INTO conferences (id, slug, name) VALUES ($1, 'nerdearla-2026', 'Nerdearla 2026')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [conferenceId],
  );
  for (const definition of stageDefinitions) {
    const stage = await pool.query<{ id: string }>(
      `INSERT INTO stages (id, conference_id, slug, name) VALUES ($1, $2, $3, $4)
       ON CONFLICT (conference_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [randomUUID(), conference.rows[0]!.id, definition.slug, definition.name],
    );
    await pool.query(
      `INSERT INTO talks (id, stage_id, slug, title, speaker, source_language, enabled_targets, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'ready')
       ON CONFLICT (stage_id, slug) DO UPDATE SET title=EXCLUDED.title, speaker=EXCLUDED.speaker,
         source_language=EXCLUDED.source_language, enabled_targets=EXCLUDED.enabled_targets`,
      [randomUUID(), stage.rows[0]!.id, `${definition.slug}-demo`, `${definition.name} Live`, "Nerdearla",
        definition.source, definition.targets],
    );
  }
  await pool.query("COMMIT");
  console.log(`Seed complete: nerdearla-2026 with ${stageDefinitions.length} stages`);
} catch (error) {
  await pool.query("ROLLBACK");
  throw error;
} finally {
  await pool.end();
}
