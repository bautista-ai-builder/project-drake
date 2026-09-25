# Troubleshooting

## Microphone does not start

- Use `localhost`/`127.0.0.1` or HTTPS; browsers block microphone capture on insecure remote origins.
- Confirm microphone permission for the exact origin and select a real input device in the OS.
- Close another application holding the device exclusively, then reload `/ingest/{stage}`.
- If the UI says `Stage unavailable`, run the migration and seed steps first.

## Ingest connects but no captions appear

- Check `/api/health` and `/ops`.
- Confirm the talk source language matches the speaker.
- Verify Application Default Credentials and the configured Gemini project/location/model.
- Check that the stage talk is `live`, audio level moves and STT health is `healthy`.
- Provider reconnects are visible as `stt_reconnecting` and `stt_recovered` status events.

## Translation stays on “Traduciendo…”

Original captions should continue. Confirm the Translation API is enabled and the runtime identity can call it. The scheduler performs two bounded attempts; after that, translation health becomes `degraded` until a later segment succeeds.

## Database is unavailable

`/api/health` returns `degraded` and includes the pending durable-event count. Live clients still receive events from memory. Restore PostgreSQL before restarting the process so the retry queue can drain.

## OBS shows a blank or opaque source

Follow [OBS Browser Source setup](./OBS_BROWSER_SOURCE.md). Use the public HTTPS URL, set the canvas dimensions, and verify `lang`/`mode` query parameters. The overlay intentionally renders nothing before the first caption.

## Local port appears to show an older application

A stale service worker from another localhost project may own the origin. Use an incognito profile, clear site data, or use `http://127.0.0.2:3000` for a clean local origin.
