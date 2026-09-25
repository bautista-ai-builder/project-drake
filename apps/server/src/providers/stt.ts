export interface SttCallbacks {
  onPartial(text: string): void;
  onFinal(text: string): void;
  onError(error: Error): void;
  onClose(reason?: string): void;
}

export interface SttSession {
  sendAudio(pcm: Int16Array): void;
  finish(): void;
  close(): void;
}

export interface SttProvider {
  readonly name: string;
  readonly model: string;
  connect(input: { languageCode: string; vocabulary?: string[] }, callbacks: SttCallbacks): Promise<SttSession>;
}
