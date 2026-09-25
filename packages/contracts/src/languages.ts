import { z } from "zod";

export const supportedLanguages = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
  { code: "pt", label: "Português" },
] as const;

export const supportedLanguageCodeSchema = z.enum(["es", "en", "pt"]);
export type SupportedLanguageCode = z.infer<typeof supportedLanguageCodeSchema>;

export const normalizeLanguageCode = (code: string): SupportedLanguageCode | undefined => {
  const base = code.toLowerCase().split("-")[0];
  return supportedLanguageCodeSchema.safeParse(base).data;
};

export const languageLabel = (code: string): string => {
  const normalized = normalizeLanguageCode(code);
  return supportedLanguages.find((language) => language.code === normalized)?.label ?? code.toUpperCase();
};

export const talkLanguageConfigurationSchema = z.object({
  sourceLanguage: supportedLanguageCodeSchema,
  targetLanguages: z.array(supportedLanguageCodeSchema).min(1).max(2),
}).superRefine((value, context) => {
  if (new Set(value.targetLanguages).size !== value.targetLanguages.length) {
    context.addIssue({ code: "custom", path: ["targetLanguages"], message: "Translation languages must be unique" });
  }
  if (value.targetLanguages.includes(value.sourceLanguage)) {
    context.addIssue({ code: "custom", path: ["targetLanguages"], message: "Source language cannot also be a translation target" });
  }
});
