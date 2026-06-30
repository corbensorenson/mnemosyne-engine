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

  it("completes Morning Forge sessions with scoring, graph updates, and audit trail", async () => {
    const store = await createSeededStore();
    const handlers = createApiHandlers(store);
    const generated = unwrap(await handlers.generateDailyPacket({ userId: demoUser.id }));
    const prompts = generated.packet.morning.cold_retrieval_items.slice(0, 2);
    expect(prompts.length).toBeGreaterThan(0);

    const started = unwrap(
      await handlers.startSession({
        userId: demoUser.id,
        dailyPacketId: generated.packet.id,
        sessionType: "morning_forge"
      })
    );
    const before = await store.getUserGraph(demoUser.id);
    const targetConceptId = prompts[0]?.concept_ids[0];
    if (!targetConceptId) throw new Error("missing morning target concept");
    const beforeState = before.states.find((state) => state.concept_id === targetConceptId);

    const completed = unwrap(
      await handlers.completeMorningForge({
        userId: demoUser.id,
        dailyPacketId: generated.packet.id,
        packetDate: generated.packet.date,
        sessionId: started.session.id,
        screenMinutes: 4,
        voiceUsed: false,
        responses: prompts.map((item, index) => ({
          item,
          rawResponse: index === 0 ? (item.expected_answer ?? item.prompt) : "not sure yet",
          confidence: index === 0 ? 0.72 : 0.41,
          latencyMs: index === 0 ? 18_000 : 52_000,
          entryMode: "text"
        }))
      })
    );

    expect(completed.session.status).toBe("completed");
    expect(completed.session.completed_at).toBeDefined();
    expect(completed.responses).toHaveLength(prompts.length);
    expect(completed.summary.answered).toBe(prompts.length);
    expect(completed.summary.screen_minutes).toBe(4);
    expect(completed.updated_states.map((state) => state.concept_id)).toContain(targetConceptId);

    const responses = await store.listAssessmentResponses(demoUser.id);
    expect(responses.length).toBeGreaterThanOrEqual(prompts.length);
    const after = await store.getUserGraph(demoUser.id);
    const afterState = after.states.find((state) => state.concept_id === targetConceptId);
    expect(afterState?.times_seen).toBeGreaterThan(beforeState?.times_seen ?? 0);

    const sessions = await store.listSessions(demoUser.id);
    expect(sessions.find((session) => session.id === started.session.id)?.status).toBe("completed");

    const events = await store.listLearningEvents(demoUser.id);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "graph_updated",
          payload: expect.objectContaining({ action: "morning_forge_completed" })
        })
      ])
    );

    const audits = await store.listAuditEvents(demoUser.id);
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "morning_forge_completed",
          object_id: started.session.id
        })
      ])
    );
  });

  it("completes WalkMode with compatible voice and text assessment events", async () => {
    const store = await createSeededStore();
    const handlers = createApiHandlers(store);
    const generated = unwrap(await handlers.generateDailyPacket({ userId: demoUser.id }));
    const walkPacket = generated.packet.walk_packets[0];
    if (!walkPacket) throw new Error("missing walk packet");
    const prompts = walkPacket.prompts.slice(0, 2);
    expect(prompts.length).toBeGreaterThan(0);

    const started = unwrap(
      await handlers.startSession({
        userId: demoUser.id,
        dailyPacketId: generated.packet.id,
        sessionType: "walk_mode"
      })
    );

    const completed = unwrap(
      await handlers.completeWalkMode({
        userId: demoUser.id,
        dailyPacketId: generated.packet.id,
        packetDate: generated.packet.date,
        sessionId: started.session.id,
        walkPacketId: walkPacket.id,
        screenLocked: true,
        voiceUsed: true,
        transcriptRetention: "deleted",
        commandLog: ["listen", "repeat that", "give hint", "mark confusing"],
        skippedPromptIds: [],
        confusingPromptIds: [prompts[1]?.id].filter((id): id is string => Boolean(id)),
        responses: prompts.map((item, index) => ({
          item,
          rawResponse: index === 0 ? (item.expected_answer ?? item.prompt) : "I can explain the gist.",
          confidence: index === 0 ? 0.7 : 0.46,
          latencyMs: index === 0 ? 14_000 : 36_000,
          hintCount: index === 0 ? 0 : 1,
          entryMode: index === 0 ? "voice" : "text",
          transcript: index === 0 ? "private walking transcript" : undefined
        }))
      })
    );

    expect(completed.session.status).toBe("completed");
    expect(completed.responses).toHaveLength(prompts.length);
    expect(completed.summary.voice_used).toBe(true);
    expect(completed.summary.text_used).toBe(true);
    expect(completed.summary.screen_locked).toBe(true);
    expect(completed.summary.transcript_retention).toBe("deleted");
    expect(completed.summary.compatible_assessment_events).toBe(true);
    expect(completed.updated_states.length).toBeGreaterThan(0);

    const events = await store.listLearningEvents(demoUser.id);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "walk_recall_completed",
          payload: expect.objectContaining({
            walk_packet_id: walkPacket.id,
            compatible_assessment_events: true,
            transcript_retention: "deleted"
          })
        }),
        expect.objectContaining({
          event_type: "assessment_answered",
          payload: expect.objectContaining({
            entry_mode: "voice",
            voice_used: true,
            transcript_stored: false
          })
        }),
        expect.objectContaining({
          event_type: "assessment_answered",
          payload: expect.objectContaining({
            entry_mode: "text"
          })
        })
      ])
    );
  });

  it("completes Evening Lock-In with recall scoring, cue binding, and sleep packet generation", async () => {
    const store = await createSeededStore();
    const handlers = createApiHandlers(store);
    const generated = unwrap(await handlers.generateDailyPacket({ userId: demoUser.id }));
    const recallItems = generated.packet.evening.recall_items.slice(0, 2);
    const transferItems = generated.packet.evening.transfer_drills.slice(0, 1);
    const cueItems = generated.packet.evening.sleep_cue_binding_items.slice(0, 3);
    expect(recallItems.length).toBeGreaterThan(0);
    expect(transferItems.length).toBeGreaterThan(0);
    expect(cueItems.length).toBeGreaterThan(0);

    const started = unwrap(
      await handlers.startSession({
        userId: demoUser.id,
        dailyPacketId: generated.packet.id,
        sessionType: "evening_lock_in"
      })
    );

    const completed = unwrap(
      await handlers.completeEveningLockIn({
        userId: demoUser.id,
        dailyPacketId: generated.packet.id,
        packetDate: generated.packet.date,
        sessionId: started.session.id,
        screenMinutes: 2,
        voiceUsed: true,
        recallResponses: recallItems.map((item, index) => ({
          item,
          rawResponse: index === 0 ? (item.expected_answer ?? item.prompt) : "I can recall the gist slowly.",
          confidence: index === 0 ? 0.74 : 0.48,
          latencyMs: index === 0 ? 16_000 : 44_000,
          entryMode: "voice",
          transcript: "I can explain the retrieval prompt aloud."
        })),
        transferResponses: transferItems.map((item) => ({
          item,
          rawResponse: item.expected_answer ?? "I would transfer this idea into a new example.",
          confidence: 0.66,
          latencyMs: 31_000,
          entryMode: "voice"
        })),
        boundCueIds: cueItems.map((cue) => cue.id),
        phoneDownChecklist: {
          notificationsSilenced: true,
          screenDimmingEnabled: true,
          chargerReady: true,
          alarmSet: true
        }
      })
    );

    expect(completed.session.status).toBe("completed");
    expect(completed.session.completed_at).toBeDefined();
    expect(completed.responses).toHaveLength(recallItems.length + transferItems.length);
    expect(completed.updated_states.length).toBeGreaterThan(0);
    expect(completed.bound_cues.map((cue) => cue.id)).toEqual(cueItems.map((cue) => cue.id));
    expect(completed.sleep_packet.audio_plan_id).toBe(completed.audio_plan.id);
    expect(completed.summary.recall_answered).toBe(recallItems.length);
    expect(completed.summary.transfer_answered).toBe(transferItems.length);
    expect(completed.summary.phone_down_ready).toBe(true);
    expect(completed.summary.voice_used).toBe(true);
    expect(completed.summary.bound_cues).toBe(cueItems.length);

    const tonight = unwrap(
      await handlers.getTonightSleepPacket(demoUser.id, completed.sleep_packet.night_date)
    );
    expect(tonight.packet.id).toBe(completed.sleep_packet.id);

    const render = unwrap(
      await handlers.renderSleepAudio({
        userId: demoUser.id,
        audioPlanId: completed.sleep_packet.audio_plan_id,
        outputFormat: "m4a"
      })
    );
    expect(render.chapters.length).toBeGreaterThan(0);

    const events = await store.listLearningEvents(demoUser.id);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "cue_bound",
          payload: expect.objectContaining({ sleep_packet_id: completed.sleep_packet.id })
        }),
        expect.objectContaining({
          event_type: "graph_updated",
          payload: expect.objectContaining({ action: "evening_lock_in_completed" })
        })
      ])
    );

    const audits = await store.listAuditEvents(demoUser.id);
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "evening_lock_in_completed",
          object_id: started.session.id
        })
      ])
    );
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

    const watchedVideo = demoMasterGraph.videos.find((video) => watch.packet.video_ids.includes(video.id));
    if (!watchedVideo) throw new Error("missing watched video");
    const watchedConceptId = watchedVideo.concept_ids[0];
    if (!watchedConceptId) throw new Error("missing watched concept");
    const watchBeforeState = (await store.getUserGraph(demoUser.id)).states.find(
      (state) => state.concept_id === watchedConceptId
    );
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
    expect(completedWatch.payload).toEqual(
      expect.objectContaining({
        graph_progress_awarded: true,
        awarded_concept_ids: expect.arrayContaining([watchedConceptId])
      })
    );
    const watchAfterPassedState = (await store.getUserGraph(demoUser.id)).states.find(
      (state) => state.concept_id === watchedConceptId
    );
    expect(watchAfterPassedState?.times_seen).toBeGreaterThan(watchBeforeState?.times_seen ?? 0);
    expect(watchAfterPassedState?.times_recalled).toBeGreaterThan(watchBeforeState?.times_recalled ?? 0);

    const heldWatch = unwrap(
      await handlers.completeWatchPacket({
        userId: demoUser.id,
        watchPacketId: `${watch.packet.id}:held`,
        videoIds: [watchedVideo.id],
        recallPassed: false,
        screenMinutes: 12
      })
    );
    expect(heldWatch.payload).toEqual(
      expect.objectContaining({
        graph_progress_awarded: false,
        awarded_concept_ids: []
      })
    );
    const watchAfterHeldState = (await store.getUserGraph(demoUser.id)).states.find(
      (state) => state.concept_id === watchedConceptId
    );
    expect(watchAfterHeldState?.times_seen).toBe(watchAfterPassedState?.times_seen);
    expect(watchAfterHeldState?.times_recalled).toBe(watchAfterPassedState?.times_recalled);

    const flashAsset = demoMasterGraph.flashReads.find((asset) =>
      asset.concept_ids.includes("attention_qkv")
    );
    if (!flashAsset) throw new Error("missing attention FlashRead asset");
    const flash = unwrap(
      await handlers.generateFlashRead({
        userId: demoUser.id,
        assetId: flashAsset.id,
        displayUnit: "phrase",
        requestedWpm: 420
      })
    );
    expect(flash.session.session_type).toBe("flashread");
    expect(flash.plan.chunks.length).toBeGreaterThan(0);
    expect(flash.plan.raw_wpm).toBe(420);
    expect(flash.plan.estimated_effective_wpm).toBeLessThan(flash.plan.raw_wpm);
    expect(flash.summary.comprehension_gate).toBe(flashAsset.comprehension_gate);

    const flashBeforeState = (await store.getUserGraph(demoUser.id)).states.find(
      (state) => state.concept_id === "attention_qkv"
    );
    const completedFlash = unwrap(
      await handlers.completeFlashRead({
        userId: demoUser.id,
        sessionId: flash.session.id,
        flashReadSessionId: flash.plan.id,
        assetId: flash.asset.id,
        rawWpm: flash.plan.raw_wpm,
        comprehensionScore: 0.86,
        retentionScore: 0.8,
        strainRating: 0.22,
        screenMinutes: 3
      })
    );
    expect(completedFlash.session.status).toBe("completed");
    expect(completedFlash.result.advanceAllowed).toBe(true);
    expect(completedFlash.summary.effective_wpm).toBeLessThan(completedFlash.summary.raw_wpm);
    expect(completedFlash.summary.screen_minutes).toBe(3);
    expect(completedFlash.updated_states.map((state) => state.concept_id)).toContain("attention_qkv");
    const flashAfterState = (await store.getUserGraph(demoUser.id)).states.find(
      (state) => state.concept_id === "attention_qkv"
    );
    expect(flashAfterState?.times_seen).toBeGreaterThan(flashBeforeState?.times_seen ?? 0);

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

    const playbackStartedAt = new Date(Date.now() - 42 * 60_000).toISOString();
    const playbackEndedAt = new Date().toISOString();
    const playbackCueEvents = [
      ...sleep.packet.reactivate_concept_ids.slice(0, 1).map((conceptId) => ({
        conceptId,
        bucket: "reactivate" as const,
        playedAt: playbackStartedAt,
        volume: 0.18,
        completed: true
      })),
      ...sleep.packet.stabilize_concept_ids.slice(0, 1).map((conceptId) => ({
        conceptId,
        bucket: "stabilize" as const,
        playedAt: playbackStartedAt,
        volume: 0.16,
        completed: true
      })),
      ...sleep.packet.control_concept_ids.slice(0, 1).map((conceptId) => ({
        conceptId,
        bucket: "control" as const,
        playedAt: playbackStartedAt,
        volume: 0.08,
        completed: true
      }))
    ];
    expect(playbackCueEvents.length).toBeGreaterThan(0);

    const playback = unwrap(
      await handlers.recordSleepPlayback({
        userId: demoUser.id,
        sleepPacketId: sleep.packet.id,
        nightDate: sleep.packet.night_date,
        audioPlanId: sleep.packet.audio_plan_id,
        playbackStartedAt,
        playbackEndedAt,
        cueEvents: playbackCueEvents,
        stopCondition: "none",
        sleepDisruptionReported: false
      })
    );
    expect(playback.session.status).toBe("completed");
    expect(playback.event.event_type).toBe("sleep_cue_played");
    expect(playback.summary.cues_played).toBe(playbackCueEvents.length);
    expect(playback.summary.sleep_disruption_reported).toBe(false);

    const cuedConceptIds = [
      ...sleep.packet.reactivate_concept_ids,
      ...sleep.packet.stabilize_concept_ids,
      ...sleep.packet.prime_concept_ids
    ].slice(0, 2);
    const controlConceptIds = sleep.packet.control_concept_ids.slice(0, 2);
    expect(cuedConceptIds.length).toBeGreaterThan(0);
    expect(controlConceptIds.length).toBeGreaterThan(0);
    const conceptById = new Map(demoMasterGraph.concepts.map((concept) => [concept.id, concept]));
    const cuedItems = cuedConceptIds.map((conceptId) => {
      const concept = conceptById.get(conceptId);
      if (!concept) throw new Error(`missing cued concept ${conceptId}`);
      return generateAssessmentForConcept(concept, "free_recall");
    });
    const controlItems = controlConceptIds.map((conceptId) => {
      const concept = conceptById.get(conceptId);
      if (!concept) throw new Error(`missing control concept ${conceptId}`);
      return generateAssessmentForConcept(concept, "free_recall");
    });
    const beforeCueState = (await store.getUserGraph(demoUser.id)).states.find(
      (state) => state.concept_id === cuedConceptIds[0]
    );

    const recalled = unwrap(
      await handlers.completeSleepCueRecall({
        userId: demoUser.id,
        sleepPacketId: sleep.packet.id,
        nightDate: sleep.packet.night_date,
        cuedResponses: cuedItems.map((item) => ({
          item,
          rawResponse: item.expected_answer ?? item.prompt,
          confidence: 0.78,
          latencyMs: 18_000,
          entryMode: "text"
        })),
        controlResponses: controlItems.map((item) => ({
          item,
          rawResponse: "not sure yet",
          confidence: 0.35,
          latencyMs: 38_000,
          entryMode: "text"
        })),
        screenMinutes: 4
      })
    );
    expect(recalled.session.status).toBe("completed");
    expect(recalled.cued_responses).toHaveLength(cuedItems.length);
    expect(recalled.control_responses).toHaveLength(controlItems.length);
    expect(recalled.summary.controls_revealed).toBe(true);
    expect(recalled.summary.cue_gain_delta).toBeGreaterThan(0);
    expect(recalled.updated_states.map((state) => state.concept_id)).toEqual(
      expect.arrayContaining([...cuedConceptIds, ...controlConceptIds])
    );
    const afterCueState = (await store.getUserGraph(demoUser.id)).states.find(
      (state) => state.concept_id === cuedConceptIds[0]
    );
    expect(afterCueState?.sleep_replays).toBeGreaterThan(beforeCueState?.sleep_replays ?? 0);
    expect(afterCueState?.cue_gain_estimate).toBeGreaterThan(beforeCueState?.cue_gain_estimate ?? -1);

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

    const sleepEvents = await store.listLearningEvents(demoUser.id);
    expect(sleepEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "flashread_completed",
          payload: expect.objectContaining({ flashread_asset_id: flash.asset.id })
        }),
        expect.objectContaining({
          event_type: "sleep_cue_played",
          payload: expect.objectContaining({ sleep_packet_id: sleep.packet.id })
        }),
        expect.objectContaining({
          event_type: "graph_updated",
          payload: expect.objectContaining({ action: "sleep_cue_recall_completed" })
        })
      ])
    );

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

    const voted = unwrap(
      await handlers.voteOnProposal({
        proposalId: created.proposal.id,
        voterId: demoUser.id,
        perspectiveId: "learner",
        voteType: "clear"
      })
    );
    expect(Object.keys(voted.community_votes)).toContain("clear:learner");

    const commented = unwrap(
      await handlers.commentOnProposal({
        proposalId: created.proposal.id,
        authorId: "expert_demo",
        text: "Definition is clearer and cites acceptable evidence.",
        commentType: "expert"
      })
    );
    expect(commented.expert_comments).toHaveLength(1);

    const overridden = unwrap(
      await handlers.humanOverrideProposal({
        proposalId: created.proposal.id,
        moderatorId: "mod_demo",
        status: "accepted",
        reason: "Accepted for seed graph after review."
      })
    );
    expect(overridden.status).toBe("accepted");

    const released = unwrap(
      await handlers.releaseProposal({
        proposalId: created.proposal.id,
        releaserId: "release_manager",
        graphVersion: "graph-v-test-release",
        notes: "Released attention definition precision update."
      })
    );
    expect(released.proposal.status).toBe("merged");
    expect(released.release.graph_version).toBe("graph-v-test-release");
    expect(released.release.release_notes).toContain("attention definition");

    const releasedConcept = (await store.getMasterGraph()).concepts.find(
      (concept) => concept.id === "attention_qkv"
    );
    expect((releasedConcept?.definitions[0] as { text?: string } | undefined)?.text).toBe(
      "queries compare with keys to weight values"
    );
    expect(releasedConcept?.version).toBe("graph-v-test-release");

    const audits = await store.listAuditEvents();
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "proposal_vote_cast",
          object_id: created.proposal.id
        }),
        expect.objectContaining({
          action: "proposal_comment_added",
          object_id: created.proposal.id
        }),
        expect.objectContaining({
          action: "proposal_released",
          object_type: "graph_release",
          payload: expect.objectContaining({
            proposal_id: created.proposal.id,
            graph_version: "graph-v-test-release"
          })
        })
      ])
    );
  });

  it("assigns matched experiments and personalizes scheduling from observed outcomes", async () => {
    const store = await createSeededStore();
    const handlers = createApiHandlers(store);
    const initialPacket = unwrap(await handlers.generateDailyPacket({ userId: demoUser.id }));

    const assigned = unwrap(
      await handlers.assignExperiments({
        userId: demoUser.id,
        maxPairsPerExperiment: 2
      })
    );

    expect(
      assigned.experiments.filter((experiment) => experiment.experiment_type === "technique")
    ).toHaveLength(3);
    expect(assigned.experiments.some((experiment) => experiment.experiment_type === "sleep_cue")).toBe(true);
    expect(assigned.assignments.some((assignment) => assignment.condition_id === "sparse_reactivation")).toBe(
      true
    );
    expect(assigned.assignments.some((assignment) => assignment.condition_id === "matched_control")).toBe(
      true
    );
    expect(await store.listExperimentAssignments(demoUser.id)).toHaveLength(assigned.assignments.length);

    const watchPacket = initialPacket.packet.optional_watch_packets.find(
      (packet) => packet.video_ids.length > 0
    );
    const videoId = watchPacket?.video_ids[0];
    if (!watchPacket || !videoId) throw new Error("missing watch packet for experiment outcome");

    unwrap(
      await handlers.completeWatchPacket({
        userId: demoUser.id,
        watchPacketId: watchPacket.id,
        videoIds: [videoId],
        recallPassed: false,
        screenMinutes: 72
      })
    );

    const dashboard = unwrap(await handlers.getPersonalizationProfile(demoUser.id));
    expect(dashboard.profile.modality_response.video_score).toBeLessThan(0.42);
    expect(dashboard.profile.scheduler_adjustments.optional_watch_budgets).toEqual([12, 8, 5]);
    expect(dashboard.profile.scheduler_adjustments.rationale).toContain(
      "bounded video underperformed recall controls"
    );

    const personalizedPacket = unwrap(await handlers.generateDailyPacket({ userId: demoUser.id }));
    expect(
      personalizedPacket.packet.optional_watch_packets.map((packet) => packet.total_time_budget_minutes)
    ).toEqual([12, 8, 5]);

    const audits = await store.listAuditEvents(demoUser.id);
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "experiments_assigned",
          payload: expect.objectContaining({
            assignment_count: assigned.assignments.length
          })
        }),
        expect.objectContaining({
          action: "daily_packet_generated",
          payload: expect.objectContaining({
            personalized_constraints: expect.objectContaining({
              optionalWatchBudgets: [12, 8, 5]
            })
          })
        })
      ])
    );
  });

  it("completes private-default onboarding from empty user state to first packet", async () => {
    const store = createMemoryStore();
    await seedDemoStore(store);
    const handlers = createApiHandlers(store);

    const onboarded = unwrap(
      await handlers.completeOnboarding({
        userId: "user_new",
        displayName: "Nova",
        handle: "nova",
        timezone: "America/Chicago",
        goal: {
          title: "AI systems interview readiness",
          description: "Build durable understanding of vectors, attention, and transformer blocks.",
          goalType: "career",
          targetConceptIds: ["ai_vectors", "attention_qkv"],
          targetDomainIds: ["ai", "math"],
          priority: 0.88,
          intensity: "sprint",
          desiredModalities: ["voice", "text", "walking"],
          avoidModalities: ["haptic"]
        },
        packIds: ["pack_ai_systems", "pack_linear_algebra"],
        baselineDiagnosticLimit: 5
      })
    );

    expect(onboarded.user.privacy_settings.private_default).toBe(true);
    expect(onboarded.user.social_settings.share_level).toBe("private");
    expect(onboarded.goal.user_id).toBe("user_new");
    expect(onboarded.installed_packs.map((pack) => pack.id)).toEqual([
      "pack_ai_systems",
      "pack_linear_algebra"
    ]);
    expect(onboarded.baseline_states.some((state) => state.concept_id === "attention_qkv")).toBe(true);
    expect(onboarded.diagnostic_items).toHaveLength(5);
    expect(onboarded.first_packet.user_id).toBe("user_new");
    expect(onboarded.summary.morning_items).toBeGreaterThan(0);

    const persistedGoals = await store.listGoals("user_new");
    expect(persistedGoals).toHaveLength(1);
    const persistedGraph = await store.getUserGraph("user_new");
    expect(persistedGraph.states.length).toBeGreaterThan(0);
    const today = unwrap(await handlers.getTodayPacket("user_new", onboarded.first_packet.date));
    expect(today.packet.id).toBe(onboarded.first_packet.id);

    const events = await store.listLearningEvents("user_new");
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "graph_updated",
          payload: expect.objectContaining({ action: "onboarding_completed" })
        }),
        expect.objectContaining({
          event_type: "session_started",
          payload: expect.objectContaining({ source: "onboarding_completed" })
        })
      ])
    );

    const audits = await store.listAuditEvents("user_new");
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "onboarding_completed",
          object_id: "user_new"
        })
      ])
    );
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

  it("scores social challenges and badges from durable outcomes instead of raw activity", async () => {
    const store = await createSeededStore();
    const handlers = createApiHandlers(store);
    const graph = await store.getUserGraph(demoUser.id);
    await store.saveUserConceptStates(
      demoUser.id,
      graph.states.map((state) => ({
        ...state,
        recall_strength: Math.max(state.recall_strength, 0.72),
        transfer_score: Math.max(state.transfer_score, 0.64),
        modality_response_profile: {
          ...state.modality_response_profile,
          video_screen_efficiency: 0.78
        }
      }))
    );
    await store.appendLearningEvent({
      user_id: demoUser.id,
      event_type: "video_watched",
      payload: {
        video_ids: ["video_attention_walkthrough"],
        recall_passed: true,
        screen_minutes: 5,
        screen_load_multiplier: 0.18
      }
    });
    await store.appendLearningEvent({
      user_id: demoUser.id,
      event_type: "walk_recall_completed",
      payload: { average_correctness: 0.86, screen_locked: true, voice_used: true }
    });
    await store.appendLearningEvent({
      user_id: demoUser.id,
      event_type: "graph_updated",
      payload: {
        action: "sleep_cue_recall_completed",
        cue_gain_delta: 0.08,
        average_cued_correctness: 0.84,
        average_control_correctness: 0.76
      }
    });

    const created = unwrap(
      await handlers.createProposal({
        proposerId: demoUser.id,
        proposalType: "modify_definition",
        affectedObjectIds: ["attention_qkv"],
        diff: {
          before: "queries compare with keys to weight values",
          after: "queries and keys score relevance before values are blended"
        },
        rationale: "Creator quality test contribution improves attention wording.",
        evidenceFor: [
          {
            id: "src_creator_quality",
            title: "Expert-reviewed creator packet",
            source_type: "expert",
            quality_score: 0.9
          }
        ],
        riskLevel: "low"
      })
    );
    unwrap(
      await handlers.humanOverrideProposal({
        proposalId: created.proposal.id,
        moderatorId: "moderator_social",
        status: "accepted",
        reason: "Evidence-backed wording improvement accepted for contributor reputation test."
      })
    );
    unwrap(
      await handlers.releaseProposal({
        proposalId: created.proposal.id,
        releaserId: "release_manager",
        graphVersion: "graph-v-social-test",
        notes: "Released contributor quality definition update."
      })
    );

    await expect(
      handlers.createChallenge({
        userId: demoUser.id,
        title: "Raw app time contest",
        challengeType: "raw_time_duel",
        participantIds: []
      } as unknown)
    ).rejects.toThrow();

    const challenge = unwrap(
      await handlers.createChallenge({
        userId: demoUser.id,
        title: "No-scroll recall duel",
        challengeType: "screen_efficiency",
        participantIds: [],
        shareLevel: "friends"
      })
    );
    expect(challenge.scoring_metric).toBe("screen_efficiency");
    expect(challenge.anti_gaming_policy.join(" ")).toContain("No rewards for raw app time");
    expect(challenge.scoreboard[0]?.score).toBeGreaterThan(70);

    const badges = unwrap(await handlers.listBadges(demoUser.id));
    expect(badges.map((badge) => badge.badge_id)).toEqual(
      expect.arrayContaining([
        "badge_retention_anchor",
        "badge_transfer_climber",
        "badge_screen_efficient",
        "badge_walk_recaller",
        "badge_sleep_guardian",
        "badge_creator_quality"
      ])
    );

    const dashboard = unwrap(await handlers.getSocialDashboard(demoUser.id));
    expect(dashboard.guardrails).toEqual(
      expect.arrayContaining(["No rewards for raw app time.", "No rewards for raw video minutes."])
    );
    expect(dashboard.challenges[0]?.scoreboard[0]?.user_id).toBe(demoUser.id);
    expect(dashboard.contributor_reputation.reputation_score).toBeGreaterThan(0.5);
    expect(dashboard.public_profile.visible_badge_count).toBeGreaterThanOrEqual(6);

    const audits = await store.listAuditEvents(demoUser.id);
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "challenge_created",
          payload: expect.objectContaining({
            scoring_metric: "screen_efficiency"
          })
        })
      ])
    );
  });
});

function unwrap<T>(envelope: Envelope<T>): T {
  if (!envelope.ok) throw new Error("Expected successful API envelope");
  return envelope.data;
}
