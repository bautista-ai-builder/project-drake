import { supportedLanguages, talkLanguageConfigurationSchema } from "@drake/contracts";
import { describe, expect, it } from "vitest";

describe("web workspace", () => {
  it("is wired into the test runner", () => expect(true).toBe(true));
  it("offers every non-source language and never the source as a target", () => {
    for (const source of supportedLanguages.map((language) => language.code)) {
      const targets = supportedLanguages.filter((language) => language.code !== source).map((language) => language.code);
      expect(targets).not.toContain(source);
      expect(talkLanguageConfigurationSchema.safeParse({ sourceLanguage: source, targetLanguages: targets }).success).toBe(true);
    }
  });
});
