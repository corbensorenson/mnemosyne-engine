import {
  buildPacedReadFocusFrame,
  buildPacedReadSession,
  chunkPacedReadText,
  scorePacedReadCompletion
} from "@mnemosyne/paced-reader-core";
import type { PacedReadAsset } from "@mnemosyne/schema";
import { describe, expect, it } from "vitest";

const asset: PacedReadAsset = {
  id: "paced_read_attention_test",
  title: "Attention recap",
  source_id: "source_attention",
  concept_ids: ["attention_qkv"],
  mode: "learn",
  raw_text:
    "Queries compare against keys before values mix. Cross-attention routes context without copying answers.",
  recommended_wpm: 420,
  cognitive_load_score: 0.42,
  comprehension_gate: "Explain query, key, and value roles from memory."
};

describe("paced-reader-core", () => {
  it("builds graph-aligned sessions and scores effective WPM", () => {
    const plan = buildPacedReadSession(asset, "phrase", 480);
    const score = scorePacedReadCompletion({
      rawWpm: plan.raw_wpm,
      comprehensionScore: 0.82,
      retentionScore: 0.74,
      strainRating: 0.2
    });

    expect(plan.chunks).toEqual(chunkPacedReadText(asset.raw_text, "phrase"));
    expect(plan.estimated_effective_wpm).toBeLessThan(plan.raw_wpm);
    expect(score.advanceAllowed).toBe(true);
    expect(score.effectiveWpm).toBeLessThan(plan.raw_wpm);
  });

  it("builds ORP focus frames without a hosted reading API", () => {
    const frame = buildPacedReadFocusFrame("Cross-attention routes context.", "orp");
    const crossAttention = frame.tokens[0];

    expect(frame.mode).toBe("orp");
    expect(frame.plain_text).toBe("Cross-attention routes context.");
    expect(frame.focused_token_index).toBe(1);
    expect(crossAttention).toEqual(
      expect.objectContaining({
        text: "Cross-attention",
        lead: "Cros",
        focus: "s",
        tail: "-attention",
        focus_index: 4
      })
    );
    expect(frame.tokens.some((token) => token.highlight)).toBe(true);
  });

  it("highlights dense local terms while preserving readable text", () => {
    const frame = buildPacedReadFocusFrame(
      "The transformer attention mechanism compares query-key geometry before value mixing.",
      "highlight"
    );
    const highlighted = frame.tokens.filter((token) => token.highlight).map((token) => token.text);

    expect(frame.plain_text).toContain("transformer attention mechanism");
    expect(highlighted).toEqual(
      expect.arrayContaining(["transformer", "attention", "mechanism", "query-key"])
    );
    expect(highlighted).not.toContain("The");
  });
});
