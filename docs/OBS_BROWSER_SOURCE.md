# OBS Browser Source

Project Drake does not require OBS for audio ingest. OBS consumes the same canonical caption stream as the Audience UI.

## Add the source

1. In OBS, add a **Browser** source.
2. Use the public Drake overlay URL:

   ```text
   https://YOUR_DRAKE_HOST/overlay/nerdearla-2026/main?lang=es&mode=both
   ```

3. Set width `1920` and height `1080` for a 1080p scene.
4. Keep the default transparent background. Do not add custom CSS unless the event wants different typography or placement.
5. Enable **Refresh browser when scene becomes active** if the production workflow changes scenes between talks.

## Query options

| Parameter | Values | Default |
|---|---|---|
| `lang` | `es`, `en`, `pt`, or another enabled target | First target configured for the talk |
| `mode` | `both`, `original`, `translation` | `both` |

Examples:

```text
/overlay/nerdearla-2026/main?lang=pt&mode=translation
/overlay/nerdearla-2026/ai?lang=en&mode=both
```

The overlay is read-only, has no controls or independent caption pipeline, and reconnects through browser-native SSE behavior.
