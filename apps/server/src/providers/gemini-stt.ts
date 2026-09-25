import { GoogleGenAI, Modality, type LiveServerMessage } from "@google/genai";
import type { ServerConfig } from "@drake/contracts";
import type { SttCallbacks, SttProvider, SttSession } from "./stt.js";

type ExtendedServerContent = NonNullable<LiveServerMessage["serverContent"]> & {
  interimInputTranscription?: { text?: string };
};

export class GeminiSttProvider implements SttProvider {
  readonly name = "google-gemini";
  readonly model: string;
  private readonly client: GoogleGenAI;

  constructor(config: ServerConfig) {
    this.model = config.GEMINI_STT_MODEL;
    this.client = config.GEMINI_AUTH_MODE === "enterprise"
      ? new GoogleGenAI({ enterprise: true, project: config.GOOGLE_CLOUD_PROJECT, location: config.GOOGLE_CLOUD_LOCATION })
      : new GoogleGenAI({ apiKey: config.GEMINI_API_KEY! });
  }

  async connect(input: { languageCode: string; vocabulary?: string[] }, callbacks: SttCallbacks): Promise<SttSession> {
    const session = await this.client.live.connect({
      model: this.model,
      config: {
        responseModalities: [Modality.TEXT],
        inputAudioTranscription: {
          languageCodes: input.languageCode === "auto" ? [] : [input.languageCode],
          ...(input.vocabulary?.length ? { customVocabulary: input.vocabulary.slice(0, 100) } : {}),
        } as never,
      },
      callbacks: {
        onmessage: (message) => {
          const content = message.serverContent as ExtendedServerContent | undefined;
          const partial = content?.interimInputTranscription?.text?.trim();
          const final = content?.inputTranscription?.text?.trim();
          if (partial) callbacks.onPartial(partial);
          if (final) callbacks.onFinal(final);
        },
        onerror: (event) => callbacks.onError(event.error instanceof Error ? event.error : new Error(event.message)),
        onclose: (event) => callbacks.onClose(event.reason),
      },
    });

    return {
      sendAudio: (pcm) => session.sendRealtimeInput({
        audio: { data: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString("base64"), mimeType: "audio/pcm;rate=16000" },
      }),
      finish: () => session.sendRealtimeInput({ audioStreamEnd: true }),
      close: () => session.close(),
    };
  }
}
