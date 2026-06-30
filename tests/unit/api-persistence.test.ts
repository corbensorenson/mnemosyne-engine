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
  it("validates request bodies before generating persistent state", async () => {
    const store = await createSeededStore();
    const handlers = createApiHandlers(store);

    await expect(handlers.generateDailyPacket({ userId: "" })).rejects.toThrow();
  });

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

  it("supports video packet, sleep packet, audio render, wearable, and governance API flows", async () => {
    const store = await createSeededStore();
    const handlers = createApiHandlers(store);

    const recommendations = unwrap(await handlers.recommendVideos({ userId: demoUser.id, limit: 3 }));
    expect(recommendations.length).toBeGreaterThan(0);

    const watch = unwrap(
      await handlers.generateWatchPacket({
        userId: demoUser.id,
        timeBudgetMinutes: 30,
        purpose: "deepen"
      })
    );
    expect(watch.packet.required_post_watch_recall).toBe(true);
    expect(watch.packet.video_ids.length).toBeGreaterThan(0);

    const completedWatch = unwrap(
      await handlers.completeWatchPacket({
        userId: demoUser.id,
        watchPacketId: watch.packet.id,
        videoIds: watch.packet.video_ids,
        recallPassed: true,
        screenMinutes: 24
      })
    );
    expect(completedWatch.event_type).toBe("video_watched");

    const sleep = unwrap(await handlers.generateSleepPacket({ userId: demoUser.id, conservative: true }));
    expect(sleep.summary.controls).toBeGreaterThan(0);

    const tonight = unwrap(await handlers.getTonightSleepPacket(demoUser.id, sleep.packet.night_date));
    expect(tonight.packet.id).toBe(sleep.packet.id);

    const render = unwrap(
      await handlers.renderSleepAudio({
        userId: demoUser.id,
        audioPlanId: sleep.packet.audio_plan_id,
        outputFormat: "mp3"
      })
    );
    expect(render.output_format).toBe("mp3");
    expect(render.chapters.length).toBeGreaterThan(0);

    const wearable = unwrap(
      await handlers.syncWearableSleep({
        userId: demoUser.id,
        provider: "oura",
        sleepSession: {
          sleep_quality: 0.82,
          fatigue: 0.18,
          stages: [{ stage: "deep", minutes: 74 }]
        }
      })
    );
    expect(wearable.readiness.sleep_quality).toBe(0.82);

    const created = unwrap(
      await handlers.createProposal({
        proposerId: demoUser.id,
        proposalType: "modify_definition",
        affectedObjectIds: ["attention_qkv"],
        diff: { before: "attention weights values", after: "queries compare with keys to weight values" },
        rationale: "Improve precision for a common attention misconception.",
        evidenceFor: [
          {
            id: "src_attention_reference",
            title: "Attention reference",
            source_type: "paper",
            quality_score: 0.86
          }
        ],
        riskLevel: "low"
      })
    );
    expect(created.proposal.status).toBe("open");

    const reviewed = unwrap(
      await handlers.reviewProposal({ proposalId: created.proposal.id, actorId: "ai_agent" })
    );
    expect(reviewed.verdict.confidence).toBeGreaterThan(0);

    const overridden = unwrap(
      await handlers.humanOverrideProposal({
        proposalId: created.proposal.id,
        moderatorId: "mod_demo",
        status: "accepted",
        reason: "Accepted for seed graph after review."
      })
    );
    expect(overridden.status).toBe("accepted");
  });

  it("persists creator ingestion as audited content court proposals", async () => {
    const store = await createSeededStore();
    const handlers = createApiHandlers(store);
    const seedVideo = demoMasterGraph.videos[0];
    if (!seedVideo) throw new Error("missing seed video");

    await expect(
      handlers.submitCreatorIngestion({
        creatorId: demoUser.id,
        title: "Empty creator draft",
        draft: {}
      })
    ).rejects.toThrow();

    const submitted = unwrap(
      await handlers.submitCreatorIngestion({
        creatorId: demoUser.id,
        title: "Attention walkthrough creator submission",
        license: "CC-BY-4.0",
        notes: "Mapped to the existing attention concepts and includes transcript/chapter metadata.",
        source: {
          id: "src_creator_attention_walkthrough",
          title: "Creator transcript and source packet",
          source_type: "expert",
          quality_score: 0.84
        },
        draft: {
          videos: [
            {
              ...seedVideo,
              id: "video_creator_attention_walkthrough",
              source_platform: "creator_upload",
              external_url: "https://example.com/creator-attention-walkthrough",
              embed_url: "https://example.com/embed/creator-attention-walkthrough",
              title: "Attention walkthrough from queries to values",
              creator: demoUser.handle,
              status: "submitted"
            }
          ]
        }
      })
    );

    expect(submitted.submission.status).toBe("proposal_created");
    expect(submitted.submission.content.videos).toHaveLength(1);
    expect(submitted.risk_flags).toHaveLength(0);
    expect(submitted.proposals).toHaveLength(1);
    expect(submitted.proposals[0]?.proposal_type).toBe("add_video");
    expect(submitted.proposals[0]?.affected_object_ids).toContain("video_creator_attention_walkthrough");

    const listed = unwrap(await handlers.listCreatorIngestions(demoUser.id));
    expect(listed.map((submission) => submission.id)).toContain(submitted.submission.id);

    const fetched = unwrap(await handlers.getCreatorIngestion(demoUser.id, submitted.submission.id));
    expect(fetched.proposal_ids).toEqual(submitted.submission.proposal_ids);

    const events = await store.listLearningEvents(demoUser.id);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "proposal_submitted",
          payload: expect.objectContaining({ creator_ingestion_id: submitted.submission.id })
        })
      ])
    );

    const audits = await store.listAuditEvents(demoUser.id);
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "creator_ingestion_submitted",
          object_id: submitted.submission.id
        })
      ])
    );
  });
});

function unwrap<T>(envelope: Envelope<T>): T {
  if (!envelope.ok) throw new Error("Expected successful API envelope");
  return envelope.data;
}
