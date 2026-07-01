import type { PacedReadAsset } from "@mnemosyne/schema";
import { clamp, createId, nowIso, round } from "@mnemosyne/shared-utils";

export type PacedReadDisplayUnit = "word" | "phrase" | "clause" | "concept";
export type PacedReadFocusMode = "plain" | "orp" | "highlight";

export type PacedReadFocusToken = {
  text: string;
  lead: string;
  focus: string;
  tail: string;
  focus_index: number;
  highlight: boolean;
};

export type PacedReadFocusFrame = {
  mode: PacedReadFocusMode;
  plain_text: string;
  tokens: PacedReadFocusToken[];
  focused_token_index: number;
};

export type PacedReadSessionPlan = {
  id: string;
  asset_id: string;
  chunks: string[];
  display_unit: PacedReadDisplayUnit;
  raw_wpm: number;
  estimated_effective_wpm: number;
  comprehension_gate: string;
  created_at: string;
};

export function buildPacedReadSession(
  asset: PacedReadAsset,
  displayUnit: PacedReadDisplayUnit = "phrase",
  requestedWpm = asset.recommended_wpm
): PacedReadSessionPlan {
  const chunks = chunkPacedReadText(asset.raw_text, displayUnit);
  const rawWpm = Math.max(120, requestedWpm);
  const comprehensionPrior = clamp(1 - asset.cognitive_load_score * 0.38);
  return {
    id: createId("paced_read_session", `${asset.id}:${displayUnit}:${rawWpm}`),
    asset_id: asset.id,
    chunks,
    display_unit: displayUnit,
    raw_wpm: rawWpm,
    estimated_effective_wpm: effectiveWpm(rawWpm, comprehensionPrior, 0.72),
    comprehension_gate: asset.comprehension_gate,
    created_at: nowIso()
  };
}

export function chunkPacedReadText(text: string, displayUnit: PacedReadDisplayUnit): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (displayUnit === "word") return clean.split(" ");
  if (displayUnit === "clause") {
    return clean.split(/(?<=[,;:])\s+|(?<=\.)\s+/).filter(Boolean);
  }
  if (displayUnit === "concept") {
    return clean
      .split(/(?<=\.)\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
  }
  const words = clean.split(" ");
  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += 4) {
    chunks.push(words.slice(index, index + 4).join(" "));
  }
  return chunks;
}

export function buildPacedReadFocusFrame(
  chunk: string,
  mode: PacedReadFocusMode = "plain"
): PacedReadFocusFrame {
  const clean = chunk.replace(/\s+/g, " ").trim();
  const words = clean ? clean.split(" ") : [];
  const denseIndexes = mode === "highlight" ? denseTokenIndexes(words) : new Set<number>();
  const focusedTokenIndex =
    mode === "highlight" && denseIndexes.size > 0
      ? [...denseIndexes][0]
      : words.length > 0
        ? Math.floor((words.length - 1) / 2)
        : -1;

  return {
    mode,
    plain_text: clean,
    tokens: words.map((word, index) => {
      const split = splitOrpToken(word);
      return {
        text: word,
        ...split,
        highlight:
          mode === "highlight" ? denseIndexes.has(index) : mode === "orp" && index === focusedTokenIndex
      };
    }),
    focused_token_index: focusedTokenIndex
  };
}

export function effectiveWpm(rawWpm: number, comprehensionScore: number, retentionScore: number): number {
  return Math.round(rawWpm * clamp(comprehensionScore) * clamp(retentionScore));
}

export function scorePacedReadCompletion(input: {
  rawWpm: number;
  comprehensionScore: number;
  retentionScore: number;
  strainRating: number;
}): {
  effectiveWpm: number;
  screenLoadScore: number;
  advanceAllowed: boolean;
} {
  const effective = effectiveWpm(input.rawWpm, input.comprehensionScore, input.retentionScore);
  return {
    effectiveWpm: effective,
    screenLoadScore: round(clamp(0.6 - input.comprehensionScore * 0.28 + input.strainRating * 0.22), 2),
    advanceAllowed: input.comprehensionScore >= 0.72 && input.strainRating <= 0.55
  };
}

function splitOrpToken(word: string): Omit<PacedReadFocusToken, "text" | "highlight"> {
  const firstAlnum = word.search(/[A-Za-z0-9]/);
  if (firstAlnum < 0) {
    return { lead: "", focus: word, tail: "", focus_index: 0 };
  }
  let lastAlnum = firstAlnum;
  for (let index = word.length - 1; index >= firstAlnum; index -= 1) {
    if (/[A-Za-z0-9]/.test(word[index] ?? "")) {
      lastAlnum = index;
      break;
    }
  }

  const body = word.slice(firstAlnum, lastAlnum + 1);
  const targetAlnumIndex = orpIndexForLength(alnumLength(body));
  let seen = -1;
  let bodyFocusOffset = 0;
  for (let index = 0; index < body.length; index += 1) {
    if (!/[A-Za-z0-9]/.test(body[index] ?? "")) continue;
    seen += 1;
    if (seen === targetAlnumIndex) {
      bodyFocusOffset = index;
      break;
    }
  }

  const focusIndex = firstAlnum + bodyFocusOffset;
  return {
    lead: word.slice(0, focusIndex),
    focus: word[focusIndex] ?? word,
    tail: word.slice(focusIndex + 1),
    focus_index: focusIndex
  };
}

function orpIndexForLength(length: number): number {
  if (length <= 1) return 0;
  if (length <= 5) return 1;
  if (length <= 9) return 2;
  if (length <= 13) return 3;
  return 4;
}

function denseTokenIndexes(words: string[]): Set<number> {
  const candidates = words
    .map((word, index) => ({ word, index, normalized: normalizeToken(word) }))
    .filter(({ normalized }) => normalized.length >= 5 && !pacedReadStopwords.has(normalized))
    .sort((left, right) => {
      const densityDelta =
        tokenDensityScore(right.word, right.normalized) - tokenDensityScore(left.word, left.normalized);
      return densityDelta === 0 ? left.index - right.index : densityDelta;
    })
    .slice(0, 4);
  return new Set(candidates.map((candidate) => candidate.index));
}

function tokenDensityScore(word: string, normalized: string): number {
  return normalized.length + (/[/-]/.test(word) ? 3 : 0) + (/[A-Z]{2,}/.test(word) ? 2 : 0);
}

function normalizeToken(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function alnumLength(word: string): number {
  return word.replace(/[^A-Za-z0-9]/g, "").length;
}

const pacedReadStopwords = new Set([
  "about",
  "after",
  "again",
  "against",
  "before",
  "being",
  "between",
  "could",
  "every",
  "from",
  "into",
  "more",
  "should",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "through",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would"
]);
