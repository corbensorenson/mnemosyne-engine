import { generateAssessmentForConcept } from "@mnemosyne/assessment-core";
import { demoMasterGraph, demoUser } from "@mnemosyne/demo-fixtures";
import { createMemoryStore } from "@mnemosyne/persistence-core";
import { createApiHandlers, seedDemoStore } from "@mnemosyne/api";
import { describe, expect, it } from "vitest";

type Envelope<T> = { ok: true; data: T; audit_event_id?: string } | { ok: false; error?: unknown };

async function createSeededStore() {
  const store = createMemoryStore();
  await seedDemoStore(store);
  return store;
}

describe("persistence-backed API handlers", () => {
  it("generates and persists a daily packet with learning and audit events", async () => {
    const store = await createSeededStore();
    const handlers = createApiHandlers(store);

    const missing = await handlers.getTodayPacket(demoUser.id);
    expect(missing.ok).toBe(false);

    const generated = await handlers.generateDailyPacket({ userId: demoUser.id });
    expect(generated.ok).toBe(true);
    const generatedData = unwrap(generated);

    const persisted = await handlers.getTodayPacket(demoUser.id, generatedData.packet.date);
    expect(persisted.ok).toBe(true);
    expect(unwrap(persisted).packet.id).toBe(generatedData.packet.id);
    expect(generatedData.summary.sleep_cues).toBeGreaterThan(0);

    const events = await store.listLearningEvents(demoUser.id);
    expect(events.some((event) => event.payload.daily_packet_id === generatedData.packet.id)).toBe(true);

    const audits = await store.listAuditEvents(demoUser.id);
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "daily_packet_generated",
          object_id: generatedData.packet.id
        })
      ])
    );
  });

  it("starts sessions, records events, and updates graph state from assessment responses", async () => {
    const store = await createSeededStore();
    const handlers = createApiHandlers(store);
    const generated = await handlers.generateDailyPacket({ userId: demoUser.id });
    const generatedData = unwrap(generated);

    const started = await handlers.startSession({
      userId: demoUser.id,
      dailyPacketId: generatedData.packet.id,
      sessionType: "morning_forge"
    });
    expect(started.ok).toBe(true);
    const startedData = unwrap(started);

    const recorded = await handlers.recordSessionEvent({
      userId: demoUser.id,
      sessionId: startedData.session.id,
      eventType: "concept_seen",
      payload: { concept_id: "attention_qkv" }
    });
    expect(recorded.ok).toBe(true);

    const concept = demoMasterGraph.concepts.find((item) => item.id === "attention_qkv");
    if (!concept) throw new Error("missing attention concept");
    const item = generateAssessmentForConcept(concept, "free_recall");
    const before = (await store.getUserGraph(demoUser.id)).states.find(
      (state) => state.concept_id === "attention_qkv"
    );

    const submitted = await handlers.submitAssessmentResponse({
      userId: demoUser.id,
      item,
      rawResponse: "attention means the model memorizes a direct answer",
      confidence: 0.95,
      latencyMs: 8_000
    });
    expect(submitted.ok).toBe(true);
    expect(unwrap(submitted).response.detected_failure_modes).toContain("false_confidence");

    const responses = await store.listAssessmentResponses(demoUser.id);
    expect(responses).toHaveLength(1);

    const after = (await store.getUserGraph(demoUser.id)).states.find(
      (state) => state.concept_id === "attention_qkv"
    );
    expect(after?.false_confidence_risk).toBeGreaterThan(before?.false_confidence_risk ?? 0);
  });
});

function unwrap<T>(envelope: Envelope<T>): T {
  if (!envelope.ok) throw new Error("Expected successful API envelope");
  return envelope.data;
}
