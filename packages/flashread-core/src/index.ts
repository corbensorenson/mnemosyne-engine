import type { FlashReadAsset } from "@mnemosyne/schema";
import { clamp, createId, nowIso, round } from "@mnemosyne/shared-utils";

export type FlashReadDisplayUnit = "word" | "phrase" | "clause" | "concept";

export type FlashReadSessionPlan = {
  id: string;
  asset_id: string;
  chunks: string[];
  display_unit: FlashReadDisplayUnit;
  raw_wpm: number;
  estimated_effective_wpm: number;
  comprehension_gate: string;
  created_at: string;
};

export function buildFlashReadSession(
  asset: FlashReadAsset,
  displayUnit: FlashReadDisplayUnit = "phrase",
  requestedWpm = asset.recommended_wpm
): FlashReadSessionPlan {
  const chunks = chunkFlashReadText(asset.raw_text, displayUnit);
  const rawWpm = Math.max(120, requestedWpm);
  const comprehensionPrior = clamp(1 - asset.cognitive_load_score * 0.38);
  return {
    id: createId("flashread_session", `${asset.id}:${displayUnit}:${rawWpm}`),
    asset_id: asset.id,
    chunks,
    display_unit: displayUnit,
    raw_wpm: rawWpm,
    estimated_effective_wpm: effectiveWpm(rawWpm, comprehensionPrior, 0.72),
    comprehension_gate: asset.comprehension_gate,
    created_at: nowIso()
  };
}

export function chunkFlashReadText(text: string, displayUnit: FlashReadDisplayUnit): string[] {
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

export function effectiveWpm(
  rawWpm: number,
  comprehensionScore: number,
  retentionScore: number
): number {
  return Math.round(rawWpm * clamp(comprehensionScore) * clamp(retentionScore));
}

export function scoreFlashReadCompletion(input: {
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
