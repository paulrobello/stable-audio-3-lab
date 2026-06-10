import type { AudioAssessment } from "./audio-assessment";

const DEFAULT_NEGATIVE_PROMPT = "low quality, distorted, clipping, harsh noise";

export function buildGenerationPromptFromAssessment(assessment: AudioAssessment) {
  const attrs = assessment.attributes;
  const prompt = [
    "Instrumental music matching the analyzed reference track.",
    assessment.summary ? `Reference summary: ${withSentencePeriod(assessment.summary)}` : undefined,
    formatList("Genre", attrs.genre),
    formatTempoAndFeel(attrs.tempoBpm, attrs.rhythm),
    attrs.key ? `Key center: ${attrs.key}.` : undefined,
    formatList("Instrumentation", attrs.instruments),
    formatList("Mood", attrs.mood),
    formatList("Production traits", attrs.production),
    formatList("Preserve these strengths", attrs.positives),
  ].filter(Boolean).join("\n");

  return {
    prompt,
    negativePrompt: [attrs.negatives.join(", "), DEFAULT_NEGATIVE_PROMPT].filter(Boolean).join(", "),
  };
}

function formatList(label: string, values: string[]) {
  return values.length ? `${label}: ${values.join(", ")}.` : undefined;
}

function formatTempoAndFeel(tempoBpm?: number, rhythm?: string) {
  if (tempoBpm && rhythm) return `Tempo and feel: ${tempoBpm} BPM, ${rhythm}.`;
  if (tempoBpm) return `Tempo and feel: ${tempoBpm} BPM.`;
  if (rhythm) return `Tempo and feel: ${rhythm}.`;
  return undefined;
}

function withSentencePeriod(value: string) {
  return /[.!?]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`;
}
