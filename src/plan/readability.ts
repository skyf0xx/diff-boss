export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length === 0) return /\d/.test(word) ? 1 : 0;
  if (w.length <= 3) return 1;
  const trimmed = w
    .replace(/(?:[^laeiouy]es|[^tdaeiouy]ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 0);
}

export function countSentences(text: string): number {
  const parts = text.trim().split(/(?<=[.!?])\s+/).filter((s) => s.length > 0);
  return Math.max(1, parts.length);
}

/** Flesch-Kincaid grade level; undefined when the text has no words. */
export function fleschKincaidGrade(text: string): number | undefined {
  const tokens = text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  if (tokens.length === 0) return undefined;
  const syllables = tokens.reduce((sum, t) => sum + countSyllables(t), 0);
  const sentences = countSentences(text);
  return 0.39 * (tokens.length / sentences) + 11.8 * (syllables / tokens.length) - 15.59;
}
