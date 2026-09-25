import { loadConfig } from "../config.js";
import { GeminiSttProvider } from "./gemini-stt.js";

const provider = new GeminiSttProvider(loadConfig());
const session = await provider.connect(
  { languageCode: "en-US", vocabulary: ["Nerdearla", "Project Drake"] },
  {
    onPartial: (text) => console.log("partial", text),
    onFinal: (text) => console.log("final", text),
    onError: (error) => console.error("provider-error", error.message),
    onClose: (reason) => console.log("provider-closed", reason ?? ""),
  },
);
session.sendAudio(new Int16Array(16_000));
session.finish();
await new Promise((resolve) => setTimeout(resolve, 2_000));
session.close();
console.log(`Gemini Live connection succeeded with ${provider.model}`);
