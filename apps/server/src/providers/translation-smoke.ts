import { loadConfig } from "../config.js";
import { GoogleCloudTranslationProvider } from "./translation.js";

const provider = new GoogleCloudTranslationProvider(loadConfig());
const result = await provider.translate("We are building Project Drake for Nerdearla.", "en-US", "es");
console.log(result);
