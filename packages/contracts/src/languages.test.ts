import { describe, expect, it } from "vitest";
import { languageLabel, normalizeLanguageCode, talkLanguageConfigurationSchema } from "./languages.js";

describe("supported language configuration", () => {
  it.each(["es", "en", "pt"])("accepts %s as a source language", (sourceLanguage) => {
    const targetLanguages = ["es", "en", "pt"].filter((code) => code !== sourceLanguage);
    expect(talkLanguageConfigurationSchema.safeParse({ sourceLanguage, targetLanguages }).success).toBe(true);
  });

  it("rejects translating a language to itself and duplicate targets", () => {
    expect(talkLanguageConfigurationSchema.safeParse({ sourceLanguage: "es", targetLanguages: ["es"] }).success).toBe(false);
    expect(talkLanguageConfigurationSchema.safeParse({ sourceLanguage: "es", targetLanguages: ["en", "en"] }).success).toBe(false);
  });

  it("normalizes existing regional codes for product labels", () => {
    expect(normalizeLanguageCode("pt-BR")).toBe("pt");
    expect(languageLabel("en-US")).toBe("English");
  });
});
