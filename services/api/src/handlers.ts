import { applyAssessmentToUserState, scoreAssessmentResponse } from "@mnemosyne/assessment-core";
import type { MnemosyneStore, SessionRecord } from "@mnemosyne/persistence-core";
import type { AssessmentItem, DailyLearningPacket, LearningEvent, ReadinessProfile } from "@mnemosyne/schema";
import { buildDailyLearningPacket } from "@mnemosyne/scheduler-core";
import { createId, nowIso, todayIsoDate } from "@mnemosyne/shared-utils";

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

    async generateDailyPacket(request: GenerateDailyPacketRequest) {
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

    async startSession(input: {
      userId: string;
      dailyPacketId: string;
      sessionType: SessionRecord["session_type"];
    }) {
      await requireUser(store, input.userId);
      const session: SessionRecord = {
        id: createId("session"),
        user_id: input.userId,
        daily_packet_id: input.dailyPacketId,
        session_type: input.sessionType,
        status: "running",
        started_at: nowIso(),
        event_ids: []
      };
      await store.saveSession(session);
      const event = await store.appendLearningEvent({
        user_id: input.userId,
        event_type: "session_started",
        payload: {
          session_id: session.id,
          daily_packet_id: input.dailyPacketId,
          session_type: input.sessionType
        }
      });
      const storedSession = await store.saveSession({ ...session, event_ids: [event.id] });
      return envelope({ session: storedSession, event });
    },

    async recordSessionEvent(request: SessionEventRequest) {
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

    async submitAssessmentResponse(request: AssessmentSubmitRequest) {
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

function notFound<T>(code: string): HandlerEnvelope<T> {
  return {
    ok: false,
    error: {
      code,
      message: code.replaceAll("_", " ")
    }
  };
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
