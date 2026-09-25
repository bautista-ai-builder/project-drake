import { loadConfig } from "../config.js";
import { GoogleCloudTranslationProvider } from "./translation.js";

const provider = new GoogleCloudTranslationProvider(loadConfig());
const cases = [
  { source: "es", target: "en", text: "Estamos construyendo subtítulos accesibles para conferencias." },
  { source: "en", target: "es", text: "We are building accessible captions for conferences." },
  { source: "pt", target: "en", text: "Estamos criando legendas acessíveis para conferências." },
  { source: "es", target: "pt", text: "Estamos desplegando Project Drake con Kubernetes y PostgreSQL." },
] as const;

for (const item of cases) {
  const translated = await provider.translate(item.text, item.source, item.target);
  if (!translated.trim() || translated === item.text) throw new Error(`Translation ${item.source}->${item.target} failed`);
  console.log(`${item.source}->${item.target}: ${translated}`);
}
console.log("Translation matrix smoke succeeded");
