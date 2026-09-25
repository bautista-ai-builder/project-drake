import type { CanonicalEvent, TranscriptFinal, TranslationFinal } from "@drake/contracts";

type ExportCaption = TranscriptFinal | TranslationFinal;

const timestamp = (sample: number, sampleRate: number): string => {
  const totalMs = Math.round(sample * 1_000 / sampleRate);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor(totalMs % 3_600_000 / 60_000);
  const seconds = Math.floor(totalMs % 60_000 / 1_000);
  const milliseconds = totalMs % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
};

export const selectCaptions = (events: CanonicalEvent[], language: "original" | string): ExportCaption[] =>
  events
    .filter((event): event is ExportCaption => language === "original"
      ? event.type === "transcript.final"
      : event.type === "translation.final" && event.targetLanguage === language)
    .sort((a, b) => a.audioStartSample - b.audioStartSample || a.sequence - b.sequence);

export const renderVtt = (captions: ExportCaption[]): string => {
  const cues = captions.map((caption) =>
    `${timestamp(caption.audioStartSample, caption.sampleRate)} --> ${timestamp(caption.audioEndSample, caption.sampleRate)}\n${caption.text}`,
  );
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
};

export const renderText = (captions: ExportCaption[]): string =>
  captions.map((caption) => `[${timestamp(caption.audioStartSample, caption.sampleRate)}] ${caption.text}`).join("\n") + "\n";
