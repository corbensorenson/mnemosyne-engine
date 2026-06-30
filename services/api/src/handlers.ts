import { applyAssessmentToUserState, scoreAssessmentResponse } from "@mnemosyne/assessment-core";
import { buildRenderManifest } from "@mnemosyne/audio-renderer-service";
import type { RenderManifest } from "@mnemosyne/audio-renderer-service";
import { arbitrateProposal, createProposal as createCourtProposal } from "@mnemosyne/content-court";
import {
  computeGoalGap,
  selectFrontierConcepts,
  selectHorizonConcepts,
  selectKnownDueForReview
} from "@mnemosyne/graph-core";
import type { MnemosyneStore, SessionRecord } from "@mnemosyne/persistence-core";
import type {
  AssessmentItem,
  ArbiterVerdict,
  DailyLearningPacket,
  DeviceCapabilityProfile,
  LearningEvent,
  Proposal,
  ReadinessProfile,
  SleepCuePacket,
  SourceRef
} from "@mnemosyne/schema";
import { buildDailyLearningPacket } from "@mnemosyne/scheduler-core";
import { createId, nowIso, todayIsoDate } from "@mnemosyne/shared-utils";
import { buildSleepCuePacket } from "@mnemosyne/sleep-core";
import { buildWatchPackets, rankVideosForUser } from "@mnemosyne/video-core";
import {
  assessmentSubmitRequestSchema,
  completeWatchPacketRequestSchema,
  generateDailyPacketRequestSchema,
  humanOverrideRequestSchema,
  proposalCreateRequestSchema,
  proposalReviewRequestSchema,
  renderSleepAudioRequestSchema,
  sessionEventRequestSchema,
  sleepPacketRequestSchema,
  startSessionRequestSchema,
  validateRequest,
  videoRecommendationRequestSchema,
  watchPacketRequestSchema,
  wearableSyncRequestSchema
} from "./validation";

export type HandlerEnvelope<T> =
  | {
      ok: true;
      data: T;
      audit_event_id?: string;
    }
  | {
      ok: false;
      error?: {
        code: string;
        message: string;
      };
    };

export type GenerateDailyPacketRequest = {
  userId: string;
  readiness?: ReadinessProfile;
};

export type SessionEventRequest = {
  userId: string;
  sessionId: string;
  eventType: LearningEvent["event_type"];
  payload: Record<string, unknown>;
};

export type AssessmentSubmitRequest = {
  userId: string;
  item: AssessmentItem;
  rawResponse: string;
  confidence?: number;
  latencyMs: number;
  hintCount?: number;
  retries?: number;
};

type DailyPacketResponse = {
  packet: DailyLearningPacket;
  summary: ReturnType<typeof packetSummary>;
};

type SleepPacketResponse = {
  packet: SleepCuePacket;
  summary: ReturnType<typeof sleepPacketSummary>;
};

export function createApiHandlers(store: MnemosyneStore) {
  return {
    async getMe(userId: string) {
      const user = await requireUser(store, userId);
      return envelope(user);
    },

    async listGoals(userId: string) {
      await requireUser(store, userId);
      return envelope(await store.listGoals(userId));
    },

    async getCapabilities(userId: string) {
      await requireUser(store, userId);
      return envelope(deviceCapabilities());
    },

    async getMasterGraph() {
      return envelope(await store.getMasterGraph());
    },

    async getUserGraph(userId: string) {
      await requireUser(store, userId);
      return envelope(await store.getUserGraph(userId));
    },

    async getTodayPacket(
      userId: string,
      date = todayIsoDate()
    ): Promise<HandlerEnvelope<DailyPacketResponse>> {
      await requireUser(store, userId);
      const packet = await store.getDailyPacket(userId, date);
      return packet
        ? envelope({ packet, summary: packetSummary(packet) })
        : notFound<DailyPacketResponse>("daily_packet_not_found");
    },

    async generateDailyPacket(input: unknown) {
      const request = validateRequest(generateDailyPacketRequestSchema, input);
      const user = await requireUser(store, request.userId);
      const readiness =
        request.readiness ?? (await store.getReadiness(request.userId)) ?? defaultReadinessFallback();
      if (request.readiness) await store.saveReadiness(request.userId, request.readiness);

      const [userGraph, masterGraph, goals] = await Promise.all([
        store.getUserGraph(request.userId),
        store.getMasterGraph(),
        store.listGoals(request.userId)
      ]);

      const scheduled = buildDailyLearningPacket({
        user,
        userGraph,
        masterGraph,
        goals,
        readiness,
        constraints: {
          morningScreenBudget: readiness.screen_budget_minutes > 20 ? 10 : 4,
          optionalWatchBudgets: [30, 18, 8],
          eveningScreenPolicy: readiness.dusk_mode ? "audio_only" : "minimal_visual",
          conservativeSleep: readiness.sleep_quality < 0.5 || readiness.fatigue > 0.7
        }
      });

      await store.saveDailyPacket(scheduled.packet);
      await store.saveAudioPlan(scheduled.audioPlan);
      const learningEvent = await store.appendLearningEvent({
        user_id: user.id,
        event_type: "session_started",
        payload: {
          daily_packet_id: scheduled.packet.id,
          date: scheduled.packet.date,
          generated: true
        }
      });
      const audit = await store.appendAuditEvent({
        actor_id: user.id,
        action: "daily_packet_generated",
        object_type: "daily_packet",
        object_id: scheduled.packet.id,
        payload: packetSummary(scheduled.packet)
      });

      return envelope({ ...scheduled, summary: packetSummary(scheduled.packet), learningEvent }, audit.id);
    },

    async startSession(input: unknown) {
      const request = validateRequest(startSessionRequestSchema, input);
      await requireUser(store, request.userId);
      const session: SessionRecord = {
        id: createId("session"),
        user_id: request.userId,
        daily_packet_id: request.dailyPacketId,
        session_type: request.sessionType,
        status: "running",
        started_at: nowIso(),
        event_ids: []
      };
      await store.saveSession(session);
      const event = await store.appendLearningEvent({
        user_id: request.userId,
        event_type: "session_started",
        payload: {
          session_id: session.id,
          daily_packet_id: request.dailyPacketId,
          session_type: request.sessionType
        }
      });
      const storedSession = await store.saveSession({ ...session, event_ids: [event.id] });
      return envelope({ session: storedSession, event });
    },

    async recordSessionEvent(input: unknown) {
      const request = validateRequest(sessionEventRequestSchema, input);
      await requireUser(store, request.userId);
      const session = await store.getSession(request.sessionId);
      if (!session) return notFound("session_not_found");
      const event = await store.appendLearningEvent({
        user_id: request.userId,
        event_type: request.eventType,
        payload: {
          ...request.payload,
          session_id: request.sessionId
        }
      });
      await store.saveSession({
        ...session,
        event_ids: Array.from(new Set([...session.event_ids, event.id]))
      });
      return envelope(event);
    },

    async submitAssessmentResponse(input: unknown) {
      const request = validateRequest(assessmentSubmitRequestSchema, input) as AssessmentSubmitRequest;
      await requireUser(store, request.userId);
      const response = scoreAssessmentResponse({
        userId: request.userId,
        item: request.item,
        rawResponse: request.rawResponse,
        confidence: request.confidence,
        latencyMs: request.latencyMs,
        hintCount: request.hintCount,
        retries: request.retries
      });
      await store.saveAssessmentResponse(response);

      const userGraph = await store.getUserGraph(request.userId);
      const updatedStates = userGraph.states.map((state) =>
        request.item.concept_ids.includes(state.concept_id)
          ? applyAssessmentToUserState(state, response)
          : state
      );
      await store.saveUserConceptStates(request.userId, updatedStates);

      const event = await store.appendLearningEvent({
        user_id: request.userId,
        event_type: "assessment_answered",
        payload: {
          assessment_item_id: request.item.id,
          response_id: response.id,
          correctness_score: response.correctness_score,
          detected_failure_modes: response.detected_failure_modes
        }
      });

      return envelope({ response, event });
    },

    async recommendVideos(input: unknown) {
      const request = validateRequest(videoRecommendationRequestSchema, input);
      const context = await buildPlanningContext(store, request.userId);
      const rankedVideos = rankVideosForUser({
        videos: context.masterGraph.videos,
        states: context.userGraph.states,
        goals: context.goals,
        frontierConceptIds: context.frontierIds,
        horizonConceptIds: context.horizonIds,
        readiness: context.readiness
      }).slice(0, request.limit);
      return envelope(rankedVideos);
    },

    async generateWatchPacket(input: unknown) {
      const request = validateRequest(watchPacketRequestSchema, input);
      const context = await buildPlanningContext(store, request.userId);
      const rankedVideos = rankVideosForUser({
        videos: context.masterGraph.videos,
        states: context.userGraph.states,
        goals: context.goals,
        frontierConceptIds: context.frontierIds,
        horizonConceptIds: context.horizonIds,
        readiness: context.readiness
      });
      const [packet] = buildWatchPackets({
        user: context.user,
        rankedVideos,
        timeBudgets: [request.timeBudgetMinutes],
        frontierConceptIds: context.frontierIds,
        horizonConceptIds: context.horizonIds
      });
      const resolvedPacket = request.purpose ? { ...packet, purpose: request.purpose } : packet;
      const audit = await store.appendAuditEvent({
        actor_id: request.userId,
        action: "watch_packet_generated",
        object_type: "watch_packet",
        object_id: resolvedPacket.id,
        payload: {
          time_budget_minutes: request.timeBudgetMinutes,
          video_ids: resolvedPacket.video_ids,
          required_post_watch_recall: resolvedPacket.required_post_watch_recall
        }
      });
      return envelope({ packet: resolvedPacket, rankedVideos: rankedVideos.slice(0, 5) }, audit.id);
    },

    async completeWatchPacket(input: unknown) {
      const request = validateRequest(completeWatchPacketRequestSchema, input);
      await requireUser(store, request.userId);
      const event = await store.appendLearningEvent({
        user_id: request.userId,
        event_type: "video_watched",
        payload: {
          watch_packet_id: request.watchPacketId,
          video_ids: request.videoIds,
          recall_passed: request.recallPassed,
          screen_minutes: request.screenMinutes,
          screen_load_multiplier: request.recallPassed ? 0.42 : 0.8
        }
      });
      return envelope(event);
    },

    async generateSleepPacket(input: unknown): Promise<HandlerEnvelope<SleepPacketResponse>> {
      const request = validateRequest(sleepPacketRequestSchema, input);
      const context = await buildPlanningContext(store, request.userId, request.readiness);
      const result = buildSleepCuePacket({
        user: context.user,
        concepts: context.masterGraph.concepts,
        states: context.userGraph.states,
        knownIds: context.knownIds,
        frontierIds: context.frontierIds,
        horizonIds: context.horizonIds,
        readiness: context.readiness,
        conservative:
          request.conservative ?? (context.readiness.sleep_quality < 0.5 || context.readiness.fatigue > 0.7)
      });
      await store.saveSleepCuePacket(result.packet);
      await store.saveAudioPlan(result.audioPlan);
      const learningEvent = await store.appendLearningEvent({
        user_id: request.userId,
        event_type: "cue_bound",
        payload: {
          sleep_packet_id: result.packet.id,
          audio_plan_id: result.audioPlan.id,
          ...sleepPacketSummary(result.packet)
        }
      });
      const audit = await store.appendAuditEvent({
        actor_id: request.userId,
        action: "sleep_packet_generated",
        object_type: "sleep_cue_packet",
        object_id: result.packet.id,
        payload: { ...sleepPacketSummary(result.packet), learning_event_id: learningEvent.id }
      });
      return envelope({ packet: result.packet, summary: sleepPacketSummary(result.packet) }, audit.id);
    },

    async getTonightSleepPacket(userId: string, nightDate = todayIsoDate()) {
      await requireUser(store, userId);
      const packet = await store.getSleepCuePacket(userId, nightDate);
      return packet
        ? envelope({ packet, summary: sleepPacketSummary(packet) })
        : notFound<SleepPacketResponse>("sleep_packet_not_found");
    },

    async renderSleepAudio(input: unknown): Promise<HandlerEnvelope<RenderManifest>> {
      const request = validateRequest(renderSleepAudioRequestSchema, input);
      await requireUser(store, request.userId);
      const plan = await store.getAudioPlan(request.audioPlanId);
      if (!plan || plan.user_id !== request.userId) return notFound<RenderManifest>("audio_plan_not_found");
      const manifest = buildRenderManifest(plan, request.outputFormat);
      const audit = await store.appendAuditEvent({
        actor_id: request.userId,
        action: "sleep_audio_render_manifest_created",
        object_type: "audio_plan",
        object_id: plan.id,
        payload: { output_format: request.outputFormat, duration_seconds: manifest.duration_seconds }
      });
      return envelope(manifest, audit.id);
    },

    async syncWearableSleep(input: unknown) {
      const request = validateRequest(wearableSyncRequestSchema, input);
      await requireUser(store, request.userId);
      const existingReadiness = (await store.getReadiness(request.userId)) ?? defaultReadinessFallback();
      const readiness =
        request.sleepSession?.sleep_quality || request.sleepSession?.fatigue
          ? await store.saveReadiness(request.userId, {
              ...existingReadiness,
              sleep_quality: request.sleepSession.sleep_quality ?? existingReadiness.sleep_quality,
              fatigue: request.sleepSession.fatigue ?? existingReadiness.fatigue,
              notes: `Synced from ${request.provider}`
            })
          : existingReadiness;
      const audit = await store.appendAuditEvent({
        actor_id: request.userId,
        action: "wearable_sleep_synced",
        object_type: "wearable_sleep_session",
        payload: {
          provider: request.provider,
          has_sleep_session: Boolean(request.sleepSession),
          stages: request.sleepSession?.stages?.length ?? 0
        }
      });
      return envelope(
        { provider: request.provider, readiness, capabilities: deviceCapabilities() },
        audit.id
      );
    },

    async createProposal(input: unknown) {
      const request = validateRequest(proposalCreateRequestSchema, input);
      const proposal = createCourtProposal({
        proposerId: request.proposerId,
        proposalType: request.proposalType,
        affectedObjectIds: request.affectedObjectIds,
        diff: request.diff,
        rationale: request.rationale,
        evidenceFor: normalizeSourceRefs(request.evidenceFor),
        evidenceAgainst: normalizeSourceRefs(request.evidenceAgainst),
        riskLevel: request.riskLevel
      });
      await store.saveProposal(proposal);
      const event = await store.appendLearningEvent({
        user_id: request.proposerId === "ai_agent" ? "system" : request.proposerId,
        event_type: "proposal_submitted",
        payload: {
          proposal_id: proposal.id,
          proposal_type: proposal.proposal_type,
          risk_level: proposal.risk_level
        }
      });
      return envelope({ proposal, event });
    },

    async reviewProposal(
      input: unknown
    ): Promise<HandlerEnvelope<{ proposal: Proposal; verdict: ArbiterVerdict }>> {
      const request = validateRequest(proposalReviewRequestSchema, input) as {
        proposalId: string;
        actorId: string | "ai_agent";
      };
      const proposal = await store.getProposal(request.proposalId);
      if (!proposal) return notFound<{ proposal: Proposal; verdict: ArbiterVerdict }>("proposal_not_found");
      const verdict = arbitrateProposal(proposal);
      const updated = {
        ...proposal,
        ai_review: verdict as unknown as Record<string, unknown>,
        status: statusForVerdict(verdict.decision),
        updated_at: nowIso()
      };
      await store.saveProposal(updated);
      const audit = await store.appendAuditEvent({
        actor_id: request.actorId,
        action: "proposal_ai_reviewed",
        object_type: "proposal",
        object_id: proposal.id,
        payload: {
          verdict_id: verdict.id,
          decision: verdict.decision,
          confidence: verdict.confidence
        }
      });
      return envelope({ proposal: updated, verdict }, audit.id);
    },

    async humanOverrideProposal(input: unknown): Promise<HandlerEnvelope<Proposal>> {
      const request = validateRequest(humanOverrideRequestSchema, input) as {
        proposalId: string;
        moderatorId: string;
        status: Proposal["status"];
        reason: string;
      };
      const proposal = await store.getProposal(request.proposalId);
      if (!proposal) return notFound<Proposal>("proposal_not_found");
      const updated = {
        ...proposal,
        status: request.status,
        expert_comments: [
          ...proposal.expert_comments,
          { author_id: request.moderatorId, text: request.reason, created_at: nowIso(), override: true }
        ],
        updated_at: nowIso()
      };
      await store.saveProposal(updated);
      const audit = await store.appendAuditEvent({
        actor_id: request.moderatorId,
        action: "proposal_human_override",
        object_type: "proposal",
        object_id: proposal.id,
        payload: { status: request.status, reason: request.reason }
      });
      return envelope(updated, audit.id);
    },

    async listPacks(userId: string) {
      await requireUser(store, userId);
      return envelope(await store.listPacks());
    },

    async installPack(userId: string, packId: string) {
      await requireUser(store, userId);
      const pack = await store.installPack(userId, packId);
      const audit = await store.appendAuditEvent({
        actor_id: userId,
        action: "pack_installed",
        object_type: "knowledge_pack",
        object_id: pack.id,
        payload: { slug: pack.slug, graph_version: pack.graph_version }
      });
      return envelope(pack, audit.id);
    },

    async listProposals() {
      return envelope(await store.listProposals());
    }
  };
}

async function requireUser(store: MnemosyneStore, userId: string) {
  const user = await store.getUser(userId);
  if (!user) throw new Error(`Unknown user: ${userId}`);
  return user;
}

function notFound<T = never>(code: string): HandlerEnvelope<T> {
  return {
    ok: false,
    error: {
      code,
      message: code.replaceAll("_", " ")
    }
  };
}

function normalizeSourceRefs(sources: Array<Partial<SourceRef>> | undefined): SourceRef[] {
  return (sources ?? []).map((source) => ({
    id: source.id ?? createId("source"),
    title: source.title ?? "Untitled source",
    source_type: source.source_type ?? "unknown",
    quality_score: source.quality_score ?? 0.5,
    url: source.url,
    citation: source.citation
  }));
}

function envelope<T>(data: T, auditEventId?: string): HandlerEnvelope<T> {
  return { ok: true, data, audit_event_id: auditEventId };
}

function packetSummary(packet: DailyLearningPacket) {
  return {
    id: packet.id,
    date: packet.date,
    morning_items: packet.morning.cold_retrieval_items.length + packet.morning.frontier_items.length,
    watch_packets: packet.optional_watch_packets.length,
    walk_prompts: packet.walk_packets.reduce((sum, walk) => sum + walk.prompts.length, 0),
    sleep_cues:
      packet.sleep.reactivate_concept_ids.length +
      packet.sleep.stabilize_concept_ids.length +
      packet.sleep.prime_concept_ids.length
  };
}

function sleepPacketSummary(packet: SleepCuePacket) {
  return {
    id: packet.id,
    night_date: packet.night_date,
    reactivate: packet.reactivate_concept_ids.length,
    stabilize: packet.stabilize_concept_ids.length,
    prime: packet.prime_concept_ids.length,
    controls: packet.control_concept_ids.length,
    cue_spacing_seconds: packet.cue_spacing_seconds,
    max_cues_per_hour: packet.max_cues_per_hour
  };
}

async function buildPlanningContext(
  store: MnemosyneStore,
  userId: string,
  readinessOverride?: ReadinessProfile
) {
  const user = await requireUser(store, userId);
  const readiness = readinessOverride ?? (await store.getReadiness(userId)) ?? defaultReadinessFallback();
  if (readinessOverride) await store.saveReadiness(userId, readinessOverride);
  const [userGraph, masterGraph, goals] = await Promise.all([
    store.getUserGraph(userId),
    store.getMasterGraph(),
    store.listGoals(userId)
  ]);
  const gap = computeGoalGap(userGraph, masterGraph, goals);
  const knownIds = selectKnownDueForReview(userGraph, gap, 8);
  const frontier = selectFrontierConcepts(userGraph, masterGraph, gap, 8);
  const horizon = selectHorizonConcepts(userGraph, masterGraph, frontier, goals, 5);
  return {
    user,
    readiness,
    userGraph,
    masterGraph,
    goals,
    knownIds,
    frontier,
    horizon,
    frontierIds: frontier.map((concept) => concept.id),
    horizonIds: horizon.map((concept) => concept.id)
  };
}

function deviceCapabilities(): DeviceCapabilityProfile {
  return {
    platform: "desktop",
    pwa_installed: false,
    web_push_supported: true,
    background_audio_supported: true,
    microphone_supported: true,
    notifications_permission: "prompt",
    healthkit_available: false,
    health_connect_available: false,
    oura_connected: false,
    bluetooth_supported: false,
    offline_cache_supported: true
  };
}

function statusForVerdict(decision: string): Proposal["status"] {
  if (decision === "accept") return "accepted";
  if (decision === "accept_with_modifications") return "accepted_with_modifications";
  if (decision === "reject") return "rejected";
  if (decision === "mark_as_disputed") return "disputed";
  if (decision === "send_to_human_moderation") return "human_review_required";
  if (decision === "needs_more_evidence") return "needs_evidence";
  return "ai_reviewing";
}

function defaultReadinessFallback(): ReadinessProfile {
  return {
    sleep_quality: 0.6,
    fatigue: 0.35,
    stress: 0.35,
    available_minutes_morning: 30,
    available_minutes_evening: 30,
    screen_budget_minutes: 30,
    voice_ok: true,
    dusk_mode: false
  };
}
