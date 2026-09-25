import { TranslationServiceClient } from "@google-cloud/translate";
import type { ServerConfig } from "@drake/contracts";

export interface TranslationProvider {
  readonly name: string;
  readonly model: string;
  translate(text: string, sourceLanguage: string, targetLanguage: string): Promise<string>;
}

export class GoogleCloudTranslationProvider implements TranslationProvider {
  readonly name = "google-cloud-translation";
  readonly model = "general/nmt";
  private readonly client = new TranslationServiceClient();

  constructor(private readonly config: ServerConfig) {}

  async translate(text: string, sourceLanguage: string, targetLanguage: string): Promise<string> {
    const result = await this.client.translateText({
      parent: `projects/${this.config.GOOGLE_CLOUD_PROJECT}/locations/${this.config.GOOGLE_CLOUD_LOCATION}`,
      contents: [text],
      mimeType: "text/plain",
      sourceLanguageCode: sourceLanguage.split("-")[0] ?? sourceLanguage,
      targetLanguageCode: targetLanguage.split("-")[0] ?? targetLanguage,
    }) as unknown as [{ translations?: Array<{ translatedText?: string | null }> }];
    const response = result[0];
    const translated = response.translations?.[0]?.translatedText;
    if (!translated) throw new Error("Cloud Translation returned no text");
    return translated;
  }
}
