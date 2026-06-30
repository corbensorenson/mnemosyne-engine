import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateAssessmentForConcept } from "@mnemosyne/assessment-core";
import { demoMasterGraph, demoUser } from "@mnemosyne/demo-fixtures";
import { createJob, failJob, startJob } from "@mnemosyne/ops-core";
import { createMemoryStore } from "@mnemosyne/persistence-core";
import { createApiHandlers, seedDemoStore } from "@mnemosyne/api";
import type { AssessmentResponse } from "@mnemosyne/schema";
import { createLocalObjectStorage } from "@mnemosyne/storage-core";
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

    const notifications = unwrap(
      await handlers.scheduleNotifications({
        userId: demoUser.id,
        date: generatedData.packet.date,
        generatedAt: "2026-06-30T06:00:00.000Z",
        idempotencyPrefix: "daily-notifications-test"
      })
    );
    expect(notifications.jobs).toHaveLength(4);
    expect(notifications.jobs.every((job) => job.queue === "notification")).toBe(true);
    expect(notifications.plan.items.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["morning_prompt", "evening_lock_in", "phone_down", "sleep_recall"])
    );
    expect(notifications.jobs.map((job) => job.run_after)).toEqual(
      notifications.plan.items.map((item) => item.scheduled_for)
    );

    const events = await store.listLearningEvents(demoUser.id);
    expect(events.some((event) => event.payload.daily_packet_id === generatedData.packet.id)).toBe(true);

    const audits = await store.listAuditEvents(demoUser.id);
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "daily_packet_generated",
          object_id: generatedData.packet.id
        }),
        expect.objectContaining({ action: "notifications_scheduled" })
      ])
    );
  });

  it("issues auth sessions and audits object-level authorization decisions", async () => {
    const store = await createSeededStore();
    const handlers = createApiHandlers(store);

    const issued = unwrap(
      await handlers.issueAuthSession({
        userId: demoUser.id,
        provider: "passkey",
        roles: ["learner"],
        ttlMinutes: 120,
        sessionSeed: "api-session",
        csrfSeed: "api-csrf",
        deviceBinding: "demo-device"
      })
    );
    expect(issued.session.user_id).toBe(demoUser.id);
    expect(issued.session.roles).toEqual(["learner"]);
    expect(issued.session.device_binding_hash).toHaveLength(64);
    expect(JSON.stringify(issued.session)).not.toContain(issued.session_token);
    expect(JSON.stringify(issued.session)).not.toContain(issued.csrf_token);

    const verified = unwrap(
      await handlers.verifyAuthSession({
        session: issued.session,
        sessionToken: issued.session_token,
        csrfToken: issued.csrf_token
      })
    );
    expect(verified).toEqual({
      session_active: true,
      session_token_valid: true,
      csrf_token_valid: true
    });

    const ownExport = unwrap(
      await handlers.checkAuthorization({
        session: issued.session,
        action: "export",
        resource: { kind: "privacy_export", owner_id: demoUser.id }
      })
    );
    expect(ownExport.decision.allowed).toBe(true);
    expect(ownExport.posture.private_default).toBe(true);

    const otherGraph = unwrap(
      await handlers.checkAuthorization({
        session: issued.session,
        action: "read",
        resource: { kind: "personal_graph", owner_id: "user_other" }
      })
    );
    expect(otherGraph.decision.allowed).toBe(false);
    expect(otherGraph.decision.reason).toContain("denied");

    const moderator = unwrap(
      await handlers.issueAuthSession({
        userId: demoUser.id,
        provider: "oauth",
        roles: ["moderator"],
        ttlMinutes: 120,
        sessionSeed: "moderator-session",
        csrfSeed: "moderator-csrf"
      })
    );
    const releaseDecision = unwrap(
      await handlers.checkAuthorization({
        session: moderator.session,
        action: "release",
        resource: { kind: "proposal", object_id: "proposal_demo" }
      })
    );
    expect(releaseDecision.decision.allowed).toBe(true);

    const audits = await store.listAuditEvents(demoUser.id);
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "auth_session_issued", object_id: issued.session.id }),
        expect.objectContaining({ action: "auth_session_verified", object_id: issued.session.id }),
        expect.objectContaining({
          action: "authorization_checked",
          payload: expect.objectContaining({ allowed: false, action: "read" })
        })
      ])
    );
  });

  it("refreshes persistent outcome dashboards across immediate and delayed windows", async () => {
    const store = await createSeededStore();
    const handlers = createApiHandlers(store);
    const generatedAt = "2026-06-30T12:00:00.000Z";

    for (const response of [
      outcomeResponse("outcome_immediate", "attention_qkv", "2026-06-30T10:30:00.000Z", 0.82, 0.76),
      outcomeResponse("outcome_24h", "ai_vectors", "2026-06-29T12:00:00.000Z", 0.74, 0.68),
      outcomeResponse("outcome_7d", "transformer_blocks", "2026-06-23T12:00:00.000Z", 0.69, 0.61),
      outcomeResponse("outcome_30d", "attention_qkv", "2026-05-31T12:00:00.000Z", 0.64, 0.57)
    ]) {
      await store.saveAssessmentResponse(response);
    }
    await store.appendLearningEvent({
      user_id: demoUser.id,
      event_type: "graph_updated",
      created_at: "2026-06-30T10:40:00.000Z",
      payload: {
        action: "morning_forge_completed",
        concept_id: "attention_qkv",
        screen_minutes: 4
      }
    });
    await store.appendLearningEvent({
      user_id: demoUser.id,
      event_type: "graph_updated",
      created_at: "2026-06-29T12:10:00.000Z",
      payload: {
        action: "sleep_cue_recall_completed",
        controls_revealed: true,
        cue_gain_delta: 0.16,
        concept_ids: ["ai_vectors"]
      }
    });

    const dashboard = unwrap(
      await handlers.refreshOutcomeDashboard({
        userId: demoUser.id,
        generatedAt
      })
    );
    expect(dashboard.windows.immediate.response_count).toBe(1);
    expect(dashboard.windows["24h"].response_count).toBe(1);
    expect(dashboard.windows["7d"].response_count).toBe(1);
    expect(dashboard.windows["30d"].response_count).toBe(1);
    expect(dashboard.quality_gates.recall_30d_measured).toBe(true);
    expect(dashboard.quality_gates.sleep_effect_measured_with_controls).toBe(true);
    expect(dashboard.windows.immediate.screen_minutes).toBe(4);

    const latest = unwrap(await handlers.getOutcomeDashboard(demoUser.id));
    expect(latest.generated_at).toBe(generatedAt);

    const queuedRefresh = unwrap(
      await handlers.queueOutcomeDashboardRefresh({
        userId: demoUser.id,
        generatedAt,
        idempotencyKey: "outcome_refresh_worker_test"
      })
    );
    expect(queuedRefresh.queue).toBe("analytics");
    expect(queuedRefresh.type).toBe("refresh_outcome_dashboard");
    expect(queuedRefresh.payload.user_id).toBe(demoUser.id);
    expect(queuedRefresh.payload.generated_at).toBe(generatedAt);

    const exported = unwrap(await handlers.exportUserData({ userId: demoUser.id }));
    expect(exported.outcome_dashboards).toHaveLength(1);

    const audits = await store.listAuditEvents(demoUser.id);
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "outcome_dashboard_refresh_queued" }),
        expect.objectContaining({
          action: "outcome_dashboard_refreshed",
          payload: expect.objectContaining({
            quality_gates: expect.objectContaining({ recall_30d_measured: true })
          })
        })
      ])
    );
  });

  it("persists ops jobs, object manifests, health gates, exports, and audits", async () => {
    const store = await createSeededStore();
    const handlers = createApiHandlers(store);

    const job = unwrap(
      await handlers.createJob({
        userId: demoUser.id,
        queue: "audio_render",
        type: "render_sleep_audio",
        payload: { audio_plan_id: "audio_demo" },
        priority: "high",
        idempotencyKey: "audio_demo",
        maxAttempts: 2
      })
    );
    expect(job.status).toBe("queued");
    expect(job.audit_subject_id).toBe(demoUser.id);
    expect(await store.getJob(job.id)).toEqual(job);

    const running = unwrap(
      await handlers.startJob({
        userId: demoUser.id,
        jobId: job.id,
        workerId: "worker_audio"
      })
    );
    expect(running.status).toBe("running");
    expect(running.attempts).toBe(1);

    const completed = unwrap(
      await handlers.completeJob({
        userId: demoUser.id,
        jobId: job.id,
        workerId: "worker_audio",
        result: { object_key: "audio/demo-sleep.m4a" }
      })
    );
    expect(completed.status).toBe("completed");

    const manifest = unwrap(
      await handlers.createObjectManifest({
        userId: demoUser.id,
        bucket: "audio",
        key: "audio/demo-sleep.m4a",
        contentType: "audio/mp4",
        sizeBytes: 2048,
        sha256: "b".repeat(64),
        metadata: { audio_plan_id: "audio_demo", job_id: job.id }
      })
    );
    expect(manifest.encryption.status).toBe("encrypted");

    const health = unwrap(await handlers.getOpsHealth(demoUser.id));
    expect(health.totals.jobs).toBe(1);
    expect(health.totals.objects).toBe(1);
    expect(health.queues.find((queue) => queue.queue === "audio_render")?.completed).toBe(1);
    expect(health.objects.find((object) => object.bucket === "audio")?.total_bytes).toBe(2048);
    expect(health.ready_for_release).toBe(true);

    const monitoring = unwrap(
      await handlers.getOpsMonitoring({
        userId: demoUser.id,
        environment: "production"
      })
    );
    expect(monitoring.release_gates.ops).toBe(true);
    expect(monitoring.release_gates.dependencies).toBe(false);
    expect(monitoring.alerts.map((alert) => alert.id)).toContain("ops.dependency.object_storage");

    const exported = unwrap(await handlers.exportUserData({ userId: demoUser.id }));
    expect(exported.jobs.map((exportedJob) => exportedJob.id)).toContain(job.id);
    expect(exported.object_manifests.map((object) => object.id)).toContain(manifest.id);

    const audits = await store.listAuditEvents(demoUser.id);
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "job_queued", object_id: job.id }),
        expect.objectContaining({ action: "job_started", object_id: job.id }),
        expect.objectContaining({ action: "job_completed", object_id: job.id }),
        expect.objectContaining({ action: "object_manifest_recorded", object_id: manifest.id })
      ])
    );
  });

  it("stores first-party incident response reports from monitoring alerts", async () => {
    const store = await createSeededStore();
    const objectStorageRoot = await mkdtemp(join(tmpdir(), "mnemosyne-incident-report-"));
    const objectStorage = createLocalObjectStorage(objectStorageRoot);
    const handlers = createApiHandlers(store, { objectStorage });

    try {
      const deadLetter = failJob(
        startJob(
          createJob({
            queue: "audio_render",
            type: "render_sleep_audio",
            payload: { audio_plan_id: "audio_incident" },
            maxAttempts: 1,
            idempotencyKey: "incident_audio",
            auditSubjectId: demoUser.id,
            createdAt: "2026-06-30T10:00:00.000Z"
          }),
          "worker-audio",
          "2026-06-30T10:01:00.000Z"
        ),
        "encoder crashed",
        "2026-06-30T10:02:00.000Z"
      );
      await store.saveJob(deadLetter);

      const response = unwrap(
        await handlers.createOpsIncidentReport({
          operatorId: demoUser.id,
          environment: "production",
          title: "Release incident test"
        })
      );

      expect(response.report.schema_version).toBe("mnemosyne-incident-response-v0.1");
      expect(response.report.severity).toBe("sev2");
      expect(response.report.status).toBe("active");
      expect(response.report.release_blockers).toContain("ops.release.dead_letters");
      expect(response.report.recommended_actions.map((action) => action.id)).toContain(
        "incident.action.queues"
      );
      expect(response.manifest.bucket).toBe("evidence");
      expect(response.manifest.retention_policy).toBe("legal_hold");

      const stored = await objectStorage.getObject({
        bucket: "evidence",
        key: response.manifest.key
      });
      const reportJson = JSON.parse(Buffer.from(stored?.body ?? []).toString("utf8")) as {
        id?: string;
        severity?: string;
      };
      expect(reportJson.id).toBe(response.report.id);
      expect(reportJson.severity).toBe("sev2");
      expect((await store.listAuditEvents(demoUser.id)).map((event) => event.action)).toContain(
        "ops_incident_report_stored"
      );
    } finally {
      await rm(objectStorageRoot, { recursive: true, force: true });
    }
  });

  it("labels high-stakes proposal content and exposes release gates", async () => {
    const store = await createSeededStore();
    const handlers = createApiHandlers(store);

    const security = unwrap(
      await handlers.getSecurityReleaseGate({
        userId: demoUser.id,
        environment: "production"
      })
    );
    expect(security.headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(security.release_gate.passed).toBe(true);
    expect(security.rate_limit_policy_count).toBeGreaterThan(0);

    const accessibility = unwrap(
      await handlers.getAccessibilityReleaseGate({
        userId: demoUser.id,
        environment: "production"
      })
    );
    expect(accessibility.passed).toBe(true);
    expect(accessibility.score).toBe(1);
    expect(accessibility.surface_count).toBeGreaterThanOrEqual(17);
    expect(accessibility.surfaces.map((surface) => surface.surface_id)).toContain("admin");

    const reliability = unwrap(
      await handlers.getReliabilityReleaseGate({
        userId: demoUser.id,
        environment: "production"
      })
    );
    expect(reliability.schema_version).toBe("mnemosyne-reliability-release-gate-v0.1");
    expect(reliability.passed).toBe(true);
    expect(reliability.score).toBe(1);
    expect(reliability.required_scenarios.map((scenario) => scenario.id)).toContain("worker_queue_drain");

    const submitted = unwrap(
      await handlers.createProposal({
        proposerId: demoUser.id,
        proposalType: "add_claim",
        affectedObjectIds: ["claim_medical_demo"],
        diff: {
          add_claim: {
            subject_id: "sleep",
            predicate_id: "improves",
            object_value: "medical diagnosis and dosage advice for insomnia symptoms"
          }
        },
        rationale: "Medical sleep content requires source labels, review dates, and expert oversight.",
        evidenceFor: [
          {
            id: "source_medical_demo",
            title: "Clinical guideline",
            citation: "medical dosage diagnosis",
            source_type: "expert",
            quality_score: 0.9
          }
        ],
        riskLevel: "low"
      })
    );

    expect(submitted.proposal.risk_level).toBe("high");
    expect(submitted.proposal.status).toBe("human_review_required");
    expect(submitted.high_stakes.detected).toBe(true);
    expect(submitted.proposal.diff.security_review).toEqual(
      expect.objectContaining({
        high_stakes_detected: true,
        requires_expert_review: true,
        canonical_blocked_without_review: true
      })
    );

    const moderationJob = unwrap(
      await handlers.queueProposalModeration({
        proposalId: submitted.proposal.id,
        moderatorId: demoUser.id,
        idempotencyKey: "high-stakes-moderation-test"
      })
    );
    expect(moderationJob.job.queue).toBe("moderation");
    expect(moderationJob.job.type).toBe("triage_proposal");
    expect(moderationJob.triage.required_action).toBe("send_to_human_moderation");
    expect(moderationJob.triage.next_status).toBe("human_review_required");

    const audits = await store.listAuditEvents(demoUser.id);
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "security_release_gate_checked",
          payload: expect.objectContaining({ csp_present: true })
        }),
        expect.objectContaining({
          action: "accessibility_release_gate_checked",
          payload: expect.objectContaining({ passed: true, score: 1 })
        }),
        expect.objectContaining({
          action: "reliability_release_gate_checked",
          payload: expect.objectContaining({ passed: true, scenario_count: reliability.scenario_count })
        }),
        expect.objectContaining({
          action: "proposal_submitted",
          object_id: submitted.proposal.id,
          payload: expect.objectContaining({
            high_stakes_detected: true,
            requires_expert_review: true
          })
        }),
        expect.objectContaining({
          action: "proposal_moderation_queued",
          object_id: moderationJob.job.id,
          payload: expect.objectContaining({
            proposal_id: submitted.proposal.id,
            required_action: "send_to_human_moderation"
          })
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

  it("scores tutor turns with first-party semantic guardrails and compatible graph updates", async () => {
    const store = await createSeededStore();
    const handlers = createApiHandlers(store);
    const concept = demoMasterGraph.concepts.find((item) => item.id === "ai_vectors");
    if (!concept) throw new Error("missing demo concept");
    const item = generateAssessmentForConcept(concept, "free_recall");
    const beforeState = (await store.getUserGraph(demoUser.id)).states.find(
      (state) => state.concept_id === concept.id
    );

    const result = unwrap(
      await handlers.scoreTutorTurn({
        userId: demoUser.id,
        mode: "socratic",
        item,
        rawResponse: [
          ...item.rubric.must_include,
          item.rubric.acceptable_aliases[0],
          "because boundary"
        ].join(" "),
        confidence: 0.82,
        latencyMs: 11_000,
        entryMode: "voice",
        transcript: "private tutor transcript",
        transcriptRetention: "transcript_only"
      })
    );

    expect(result.turn.mode).toBe("socratic");
    expect(result.turn.safety_evaluation.release_gate_passed).toBe(true);
    expect(result.release_gate.passed).toBe(true);
    expect(result.assessment_response.correctness_score).toBeGreaterThan(0.7);
    expect(result.updated_states.find((state) => state.concept_id === concept.id)?.times_seen).toBe(
      (beforeState?.times_seen ?? 0) + 1
    );

    const events = await store.listLearningEvents(demoUser.id);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "assessment_answered",
          payload: expect.objectContaining({
            tutor_turn_id: result.turn.id,
            tutor_mode: "socratic",
            voice_used: true,
            transcript_stored: true,
            graph_progress_awarded: true
          })
        })
      ])
    );

    const audits = await store.listAuditEvents(demoUser.id);
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "tutor_turn_scored",
          object_id: item.id,
          payload: expect.objectContaining({
            tutor_turn_id: result.turn.id,
            release_gate: expect.objectContaining({ passed: true })
          })
        })
      ])
    );
  });

  it("replays persisted learning evidence into personal graph state", async () => {
    const store = await createSeededStore();
    const handlers = createApiHandlers(store);
    const conceptId = "attention_qkv";
    const graph = await store.getUserGraph(demoUser.id);
    const staleStates = graph.states.map((state) =>
      state.concept_id === conceptId
        ? {
            ...state,
            mastery: 0,
            times_seen: 99,
            sleep_replays: 0,
            cue_gain_estimate: 0,
            updated_at: "2026-06-29T00:00:00.000Z"
          }
        : state
    );
    await store.saveUserConceptStates(demoUser.id, staleStates);
    await store.saveAssessmentResponse(
      outcomeResponse("replay_attention_response", conceptId, "2026-06-30T10:00:00.000Z", 0.82, 0.76)
    );
    await store.appendLearningEvent({
      user_id: demoUser.id,
      event_type: "graph_updated",
      created_at: "2026-07-01T07:00:00.000Z",
      payload: {
        action: "sleep_cue_recall_completed",
        cued_concept_ids: [conceptId],
        cue_gain_delta: 0.2
      }
    });

    const replayed = unwrap(
      await handlers.replayUserGraph({
        userId: demoUser.id
      })
    );

    const replayedState = replayed.graph.states.find((state) => state.concept_id === conceptId);
    expect(replayed.dry_run).toBe(false);
    expect(replayed.replay.applied.assessment_response).toBeGreaterThanOrEqual(1);
    expect(replayed.replay.applied.sleep_cue_event).toBe(1);
    expect(replayed.replay.touched_concept_ids).toContain(conceptId);
    expect(replayedState?.times_seen).toBeLessThan(99);
    expect(replayedState?.sleep_replays).toBe(1);
    expect(replayedState?.mastery).toBeGreaterThan(0);
    expect(
      (await store.getUserGraph(demoUser.id)).states.find((state) => state.concept_id === conceptId)
    ).toEqual(replayedState);
    expect(await store.listAuditEvents(demoUser.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "user_graph_replayed",
          object_id: demoUser.id,
          payload: expect.objectContaining({
            dry_run: false,
            touched_concept_count: expect.any(Number)
          })
        })
      ])
    );
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

    const pacedReadAsset = demoMasterGraph.pacedReads.find((asset) =>
      asset.concept_ids.includes("attention_qkv")
    );
    if (!pacedReadAsset) throw new Error("missing attention Paced Read asset");
    const pacedRead = unwrap(
      await handlers.generatePacedRead({
        userId: demoUser.id,
        assetId: pacedReadAsset.id,
        displayUnit: "phrase",
        requestedWpm: 420
      })
    );
    expect(pacedRead.session.session_type).toBe("paced_read");
    expect(pacedRead.plan.chunks.length).toBeGreaterThan(0);
    expect(pacedRead.plan.raw_wpm).toBe(420);
    expect(pacedRead.plan.estimated_effective_wpm).toBeLessThan(pacedRead.plan.raw_wpm);
    expect(pacedRead.summary.comprehension_gate).toBe(pacedReadAsset.comprehension_gate);

    const flashBeforeState = (await store.getUserGraph(demoUser.id)).states.find(
      (state) => state.concept_id === "attention_qkv"
    );
    const completedPacedRead = unwrap(
      await handlers.completePacedRead({
        userId: demoUser.id,
        sessionId: pacedRead.session.id,
        pacedReadSessionId: pacedRead.plan.id,
        assetId: pacedRead.asset.id,
        rawWpm: pacedRead.plan.raw_wpm,
        comprehensionScore: 0.86,
        retentionScore: 0.8,
        strainRating: 0.22,
        screenMinutes: 3
      })
    );
    expect(completedPacedRead.session.status).toBe("completed");
    expect(completedPacedRead.result.advanceAllowed).toBe(true);
    expect(completedPacedRead.summary.effective_wpm).toBeLessThan(completedPacedRead.summary.raw_wpm);
    expect(completedPacedRead.summary.screen_minutes).toBe(3);
    expect(completedPacedRead.updated_states.map((state) => state.concept_id)).toContain("attention_qkv");
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
          event_type: "paced_read_completed",
          payload: expect.objectContaining({ paced_read_asset_id: pacedRead.asset.id })
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

    const arbiterJob = unwrap(
      await handlers.queueProposalArbiterReview({
        proposalId: created.proposal.id,
        actorId: "local_arbiter",
        idempotencyKey: "proposal-local-arbiter-test"
      })
    );
    expect(arbiterJob.job.queue).toBe("local_ai");
    expect(arbiterJob.job.type).toBe("review_proposal");
    expect(arbiterJob.preview.proposal_id).toBe(created.proposal.id);

    const reviewed = unwrap(
      await handlers.reviewProposal({ proposalId: created.proposal.id, actorId: "local_arbiter" })
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
          action: "proposal_local_arbiter_queued",
          object_id: arbiterJob.job.id
        }),
        expect.objectContaining({
          action: "proposal_local_arbiter_reviewed",
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

  it("connects, normalizes, and revokes Oura wearable sleep data", async () => {
    const store = await createSeededStore();
    const handlers = createApiHandlers(store);

    const connected = unwrap(
      await handlers.connectOuraWearable({
        userId: demoUser.id,
        clientId: "oura_client_demo",
        redirectUri: "https://mnemosyne.local/oauth/oura/callback",
        scopes: ["daily"],
        accessToken: "oura_access_demo_token",
        refreshToken: "oura_refresh_demo_token",
        encryptionSecret: "test_secret_12345"
      })
    );
    expect(connected.connection.status).toBe("connected");
    expect(connected.connection.authorization_url).toContain("cloud.ouraring.com/oauth/authorize");
    expect(connected.connection.token_envelope?.ciphertext).toBeDefined();
    expect(JSON.stringify(connected.connection)).not.toContain("oura_access_demo_token");
    expect(JSON.stringify(connected.connection)).not.toContain("oura_refresh_demo_token");
    expect(connected.dashboard.provider_status.oura).toBe("connected");

    const synced = unwrap(
      await handlers.syncWearableSleep({
        userId: demoUser.id,
        provider: "oura",
        connectionId: connected.connection.id,
        sleepSession: {
          external_id: "sleep_oura_test",
          sleep_score: 0.82,
          readiness_score: 0.79,
          efficiency: 0.91,
          started_at: "2026-06-29T04:00:00.000Z",
          ended_at: "2026-06-29T12:00:00.000Z",
          stages: [
            { stage: "awake", duration_minutes: 20 },
            { stage: "light", duration_minutes: 240 },
            { stage: "deep", duration_minutes: 80 },
            { stage: "rapid-eye-movement", duration_minutes: 90 }
          ]
        }
      })
    );
    expect(synced.normalized_sleep?.stage_minutes.deep).toBe(80);
    expect(synced.normalized_sleep?.stage_minutes.rem).toBe(90);
    expect(synced.readiness.sleep_quality).toBe(0.82);
    expect(synced.readiness.fatigue).toBeLessThan(0.4);

    const sessions = await store.listWearableSleepSessions(demoUser.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.source_summary).toEqual(expect.arrayContaining(["80m deep", "90m REM"]));

    const revoked = unwrap(
      await handlers.revokeWearable({
        userId: demoUser.id,
        connectionId: connected.connection.id
      })
    );
    expect(revoked.connection.status).toBe("revoked");
    expect(revoked.connection.token_envelope).toBeUndefined();
    expect(revoked.connection.refresh_token_envelope).toBeUndefined();
    expect(revoked.dashboard.provider_status.oura).toBe("revoked");

    const audits = await store.listAuditEvents(demoUser.id);
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "oura_wearable_connected",
          object_id: connected.connection.id
        }),
        expect.objectContaining({
          action: "wearable_sleep_synced",
          object_id: synced.normalized_sleep?.id
        }),
        expect.objectContaining({
          action: "wearable_connection_revoked",
          object_id: connected.connection.id
        })
      ])
    );
  });

  it("exports and deletes private user data by scoped privacy request", async () => {
    const store = await createSeededStore();
    const handlers = createApiHandlers(store);

    await store.appendLearningEvent({
      user_id: demoUser.id,
      event_type: "assessment_answered",
      payload: {
        transcript: "private voice transcript",
        nested: { voice_audio_url: "s3://private/raw-voice.wav" }
      }
    });
    const connected = unwrap(
      await handlers.connectOuraWearable({
        userId: demoUser.id,
        clientId: "oura_client_demo",
        redirectUri: "https://mnemosyne.local/oauth/oura/callback",
        accessToken: "oura_access_demo_token",
        encryptionSecret: "test_secret_12345"
      })
    );
    unwrap(
      await handlers.syncWearableSleep({
        userId: demoUser.id,
        provider: "oura",
        connectionId: connected.connection.id,
        sleepSession: {
          external_id: "sleep_privacy_test",
          sleep_quality: 0.74,
          stages: [{ stage: "deep", duration_minutes: 64 }]
        }
      })
    );

    const exported = unwrap(await handlers.exportUserData({ userId: demoUser.id }));
    expect(exported.schema_version).toBe("mnemosyne-export-v0.1");
    expect(exported.user?.id).toBe(demoUser.id);
    expect(exported.user_graph.states.length).toBeGreaterThan(0);
    expect(exported.wearable_connections).toHaveLength(1);
    expect(exported.wearable_sleep_sessions).toHaveLength(1);
    expect(JSON.stringify(exported)).not.toContain("oura_access_demo_token");

    const queuedExport = unwrap(
      await handlers.queuePrivacyExport({
        userId: demoUser.id,
        idempotencyKey: "privacy_export_worker_test"
      })
    );
    expect(queuedExport.queue).toBe("export");
    expect(queuedExport.type).toBe("build_privacy_export");
    expect(queuedExport.payload.user_id).toBe(demoUser.id);
    expect((await store.listAuditEvents(demoUser.id)).map((event) => event.action)).toContain(
      "privacy_export_queued"
    );

    const queuedBackup = unwrap(
      await handlers.queueSystemBackup({
        operatorId: demoUser.id,
        idempotencyKey: "system_backup_worker_test"
      })
    );
    expect(queuedBackup.queue).toBe("export");
    expect(queuedBackup.type).toBe("build_system_backup");
    expect(queuedBackup.payload.operator_id).toBe(demoUser.id);
    expect((await store.listAuditEvents(demoUser.id)).map((event) => event.action)).toContain(
      "system_backup_queued"
    );

    const backupManifest = unwrap(
      await handlers.createObjectManifest({
        userId: demoUser.id,
        bucket: "backup",
        key: "backups/system/demo-backup.json",
        contentType: "application/json",
        sizeBytes: 4096,
        sha256: "c".repeat(64),
        retentionPolicy: "backup",
        metadata: { schema_version: "mnemosyne-system-backup-v0.1" }
      })
    );
    const queuedRestoreDrill = unwrap(
      await handlers.queueSystemBackupRestoreDrill({
        operatorId: demoUser.id,
        objectManifestId: backupManifest.id,
        idempotencyKey: "system_backup_restore_drill_test"
      })
    );
    expect(queuedRestoreDrill.queue).toBe("export");
    expect(queuedRestoreDrill.type).toBe("run_system_backup_restore_drill");
    expect(queuedRestoreDrill.payload.object_manifest_id).toBe(backupManifest.id);
    expect((await store.listAuditEvents(demoUser.id)).map((event) => event.action)).toContain(
      "system_backup_restore_drill_queued"
    );

    const voiceDeleted = unwrap(
      await handlers.deleteUserData({
        userId: demoUser.id,
        scope: "voice",
        confirmation: "DELETE"
      })
    );
    expect(voiceDeleted.counts.voice_payloads_scrubbed).toBe(1);
    expect(JSON.stringify(await store.listLearningEvents(demoUser.id))).not.toContain(
      "private voice transcript"
    );
    expect(JSON.stringify(await store.listLearningEvents(demoUser.id))).not.toContain(
      "s3://private/raw-voice.wav"
    );

    const healthDeleted = unwrap(
      await handlers.deleteUserData({
        userId: demoUser.id,
        scope: "health",
        confirmation: "DELETE"
      })
    );
    expect(healthDeleted.counts.wearable_connections).toBe(1);
    expect(healthDeleted.counts.wearable_sleep_sessions).toBe(1);
    const afterHealthExport = unwrap(await handlers.exportUserData({ userId: demoUser.id }));
    expect(afterHealthExport.wearable_connections).toHaveLength(0);
    expect(afterHealthExport.wearable_sleep_sessions).toHaveLength(0);

    const accountDeleted = unwrap(
      await handlers.deleteUserData({
        userId: demoUser.id,
        scope: "account",
        confirmation: "DELETE"
      })
    );
    expect(accountDeleted.user_id).toMatch(/^deleted_user:/);
    expect(accountDeleted.counts.users).toBe(1);
    expect(await store.getUser(demoUser.id)).toBeUndefined();
    await expect(handlers.exportUserData({ userId: demoUser.id })).rejects.toThrow("Unknown user");
    expect((await store.listAuditEvents()).some((event) => event.actor_id === demoUser.id)).toBe(false);
    expect((await store.listAuditEvents()).some((event) => event.action === "user_data_deleted")).toBe(true);
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

    const queued = unwrap(
      await handlers.queueCreatorIngestion({
        creatorId: demoUser.id,
        title: "Queued attention walkthrough creator submission",
        license: "CC-BY-4.0",
        source: {
          id: "src_creator_attention_queued",
          title: "Queued creator transcript packet",
          source_type: "expert",
          quality_score: 0.82
        },
        draft: {
          videos: [
            {
              ...seedVideo,
              id: "video_creator_attention_queued",
              source_platform: "creator_upload",
              external_url: "https://example.com/creator-attention-queued",
              embed_url: "https://example.com/embed/creator-attention-queued",
              title: "Queued attention walkthrough",
              creator: demoUser.handle,
              status: "submitted"
            }
          ]
        },
        idempotencyKey: "creator-ingestion-queued-test"
      })
    );
    expect(queued.job.queue).toBe("ingestion");
    expect(queued.job.type).toBe("process_creator_submission");
    expect(queued.job.payload.creator_id).toBe(demoUser.id);
    expect(queued.content_counts.videos).toBe(1);

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
        }),
        expect.objectContaining({
          action: "creator_ingestion_queued",
          object_id: queued.job.id
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

function outcomeResponse(
  id: string,
  conceptId: string,
  createdAt: string,
  correctness: number,
  confidence: number
): AssessmentResponse {
  return {
    id,
    user_id: demoUser.id,
    assessment_item_id: `item_${id}`,
    raw_response: "durable answer",
    correctness_score: correctness,
    semantic_score: correctness,
    latency_ms: 28_000,
    confidence_reported: confidence,
    hint_count: 0,
    retries: 0,
    detected_failure_modes: [],
    misconception_ids: [],
    model_feedback: "outcome scored",
    graph_updates: [{ concept_id: conceptId }],
    created_at: createdAt
  };
}
