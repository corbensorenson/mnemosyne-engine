import {
  applyAssessmentToUserState,
  generateAssessmentForConcept,
  scoreAssessmentResponse
} from "@mnemosyne/assessment-core";
import { buildRenderManifest } from "@mnemosyne/audio-renderer-service";
import type { RenderManifest } from "@mnemosyne/audio-renderer-service";
import {
  arbitrateProposal,
  castVote,
  computeBridgingPriority,
  createProposal as createCourtProposal,
  type VoteType
} from "@mnemosyne/content-court";
import {
  buildFlashReadSession,
  scoreFlashReadCompletion,
  type FlashReadDisplayUnit,
  type FlashReadSessionPlan
} from "@mnemosyne/flashread-core";
import {
  computeGoalGap,
  selectFrontierConcepts,
  selectHorizonConcepts,
  selectKnownDueForReview
} from "@mnemosyne/graph-core";
import type {
  CreatorSubmissionRecord,
  CreatorSubmissionStatus,
  MnemosyneStore,
  SessionRecord
} from "@mnemosyne/persistence-core";
import type {
  AssessmentItem,
  AssessmentResponse,
  AudioPlan,
  ArbiterVerdict,
  ConceptNode,
  DailyLearningPacket,
  DeviceCapabilityProfile,
  Experiment,
  FlashReadAsset,
  Goal,
  LearningEvent,
  MasterGraph,
  Proposal,
  ReadinessProfile,
  SleepCuePacket,
  SleepCueTemplate,
  SourceRef,
  User,
  UserConceptState,
  VideoAsset
} from "@mnemosyne/schema";
import { buildDailyLearningPacket } from "@mnemosyne/scheduler-core";
import { clamp, createId, nowIso, todayIsoDate, unique } from "@mnemosyne/shared-utils";
import { buildSleepCuePacket } from "@mnemosyne/sleep-core";
import {
  buildSocialDashboard,
  createChallenge as createSocialChallenge,
  evaluateBadges,
  outcomeBadgeTemplates,
  scoreChallenge,
  type AwardedBadge,
  type ChallengeType,
  type SocialChallenge,
  type SocialDashboard,
  type SocialEvidence
} from "@mnemosyne/social-core";
import {
  buildOuraAuthorizationRequest,
  buildWearableCapabilityDashboard,
  createWearableConnection,
  normalizeWearableSleepSession,
  providerRevokeEndpoint,
  readinessFromWearableSleep,
  revokeWearableConnection,
  type NormalizedWearableSleepSession,
  type RawWearableSleepSession,
  type WearableCapabilityDashboard,
  type WearableConnection,
  type WearableProvider
} from "@mnemosyne/wearables-core";
import {
  assignExperiments,
  buildPersonalizationProfile,
  createDefaultExperimentSuite,
  personalizeSessionConstraints,
  rollupExperimentOutcomes,
  type ExperimentAssignment,
  type ExperimentOutcomeRollup,
  type PersonalizationProfile
} from "@mnemosyne/technique-lab";
import { buildWatchPackets, rankVideosForUser } from "@mnemosyne/video-core";
import {
  assessmentSubmitRequestSchema,
  challengeCreateRequestSchema,
  completeOnboardingRequestSchema,
  completeWatchPacketRequestSchema,
  createGoalRequestSchema,
  creatorIngestionRequestSchema,
  eveningLockInCompleteRequestSchema,
  experimentAssignmentRequestSchema,
  flashReadCompleteRequestSchema,
  flashReadGenerateRequestSchema,
  generateDailyPacketRequestSchema,
  humanOverrideRequestSchema,
  morningForgeCompleteRequestSchema,
  proposalCreateRequestSchema,
  proposalCommentRequestSchema,
  proposalReleaseRequestSchema,
  proposalReviewRequestSchema,
  proposalVoteRequestSchema,
  renderSleepAudioRequestSchema,
  sessionEventRequestSchema,
  sleepPlaybackEventRequestSchema,
  sleepPacketRequestSchema,
  sleepRecallCompleteRequestSchema,
  startSessionRequestSchema,
  updatePreferencesRequestSchema,
  validateRequest,
  videoRecommendationRequestSchema,
  walkModeCompleteRequestSchema,
  watchPacketRequestSchema,
  wearableOuraConnectRequestSchema,
  wearableRevokeRequestSchema,
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

type ExperimentAssignmentRequest = {
  userId: string;
  maxPairsPerExperiment?: number;
};

type ExperimentDashboardResponse = {
  experiments: Experiment[];
  assignments: ExperimentAssignment[];
  rollups: ExperimentOutcomeRollup[];
  profile: PersonalizationProfile;
};

type ChallengeCreateRequest = {
  userId: string;
  title: string;
  challengeType: ChallengeType;
  participantIds: string[];
  shareLevel: "badges_only" | "friends" | "public";
  endsAt?: string;
};

type SocialDashboardResponse = SocialDashboard;

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

type MorningForgeResponseInput = {
  item: AssessmentItem;
  rawResponse: string;
  confidence?: number;
  latencyMs: number;
  hintCount?: number;
  retries?: number;
  entryMode: "text" | "voice";
  transcript?: string;
};

type MorningForgeCompleteRequest = {
  userId: string;
  dailyPacketId: string;
  packetDate?: string;
  sessionId?: string;
  responses: MorningForgeResponseInput[];
  screenMinutes: number;
  voiceUsed: boolean;
  completedAt?: string;
};

type EveningLockInCompleteRequest = {
  userId: string;
  dailyPacketId: string;
  packetDate?: string;
  sessionId?: string;
  recallResponses: MorningForgeResponseInput[];
  transferResponses: MorningForgeResponseInput[];
  boundCueIds: string[];
  phoneDownChecklist: {
    notificationsSilenced: boolean;
    screenDimmingEnabled: boolean;
    chargerReady: boolean;
    alarmSet: boolean;
  };
  screenMinutes: number;
  voiceUsed: boolean;
  completedAt?: string;
};

type WalkModeCompleteRequest = {
  userId: string;
  dailyPacketId: string;
  packetDate?: string;
  sessionId?: string;
  walkPacketId: string;
  responses: MorningForgeResponseInput[];
  skippedPromptIds: string[];
  confusingPromptIds: string[];
  commandLog: string[];
  screenLocked: boolean;
  voiceUsed: boolean;
  transcriptRetention: "deleted" | "transcript_only" | "retained";
  completedAt?: string;
};

type SleepCueBucket = "reactivate" | "stabilize" | "prime" | "control";

type SleepPlaybackEventRequest = {
  userId: string;
  sleepPacketId: string;
  nightDate?: string;
  audioPlanId?: string;
  sessionId?: string;
  playbackStartedAt?: string;
  playbackEndedAt?: string;
  cueEvents: Array<{
    cueId?: string;
    conceptId: string;
    bucket: SleepCueBucket;
    playedAt?: string;
    volume?: number;
    completed: boolean;
    wearableStage?: string;
  }>;
  stopCondition:
    "none" | "movement_detected" | "user_wake_report" | "wearable_wake_signal" | "time_limit" | "manual_stop";
  sleepDisruptionReported: boolean;
};

type SleepRecallCompleteRequest = {
  userId: string;
  sleepPacketId: string;
  nightDate?: string;
  sessionId?: string;
  cuedResponses: MorningForgeResponseInput[];
  controlResponses: MorningForgeResponseInput[];
  screenMinutes: number;
  voiceUsed: boolean;
  completedAt?: string;
};

type WearableSyncRequest = {
  userId: string;
  provider: WearableProvider;
  connectionId?: string;
  sleepSession?: RawWearableSleepSession;
};

type WearableConnectRequest = {
  userId: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  accessToken?: string;
  refreshToken?: string;
  encryptionSecret?: string;
};

type WearableRevokeRequest = {
  userId: string;
  connectionId: string;
};

type WearableConnectResponse = {
  connection: WearableConnection;
  dashboard: WearableCapabilityDashboard;
};

type WearableSyncResponse = {
  provider: WearableProvider;
  normalized_sleep?: NormalizedWearableSleepSession;
  readiness: ReadinessProfile;
  dashboard: WearableCapabilityDashboard;
};

type FlashReadGenerateRequest = {
  userId: string;
  assetId?: string;
  conceptIds: string[];
  displayUnit: FlashReadDisplayUnit;
  requestedWpm?: number;
};

type FlashReadCompleteRequest = {
  userId: string;
  sessionId?: string;
  flashReadSessionId: string;
  assetId: string;
  rawWpm: number;
  comprehensionScore: number;
  retentionScore: number;
  strainRating: number;
  screenMinutes: number;
  completedAt?: string;
};

type GoalDraftRequest = {
  title: string;
  description: string;
  goalType: Goal["goal_type"];
  targetConceptIds: string[];
  targetDomainIds: string[];
  priority: number;
  deadline?: string;
  intensity: Goal["intensity"];
  desiredModalities: Goal["desired_modalities"];
  avoidModalities: Goal["avoid_modalities"];
};

type CreateGoalRequest = GoalDraftRequest & {
  userId: string;
};

type UpdatePreferencesRequest = {
  userId: string;
  privacySettings?: Record<string, unknown>;
  socialSettings?: Record<string, unknown>;
  notificationSettings?: Record<string, unknown>;
  defaultSessionPreferences?: Record<string, unknown>;
  accessibilityPreferences?: Record<string, unknown>;
  modalityPreferences?: Record<string, unknown>;
};

type CompleteOnboardingRequest = {
  userId?: string;
  displayName: string;
  handle: string;
  timezone: string;
  goal: GoalDraftRequest;
  packIds: string[];
  readiness?: ReadinessProfile;
  deviceCapabilities?: DeviceCapabilityProfile;
  privacy: {
    privateDefault: boolean;
    shareLevel: "private" | "badges_only" | "friends" | "public";
    productAnalyticsConsent: boolean;
    researchConsent: boolean;
    voiceRetention: "none" | "transcript_only" | "audio_until_processed";
    healthDataRetention: "none" | "derived_only" | "raw_until_processed";
  };
  preferences: {
    morningMinutes: number;
    eveningMinutes: number;
    voiceFirst: boolean;
    walking: boolean;
    flashread: boolean;
    highContrast: boolean;
    reducedMotion: boolean;
    duskQuiet: boolean;
    morningPrompt: boolean;
  };
  baselineDiagnosticLimit: number;
};

type CreatorIngestionRequest = {
  creatorId: string;
  title: string;
  license: string;
  notes?: string;
  source?: SourceRef;
  evidence: SourceRef[];
  draft: {
    concepts: ConceptNode[];
    videos: VideoAsset[];
    assessments: AssessmentItem[];
    sleepCues: SleepCueTemplate[];
    flashreadAssets: FlashReadAsset[];
  };
};

type DailyPacketResponse = {
  packet: DailyLearningPacket;
  summary: ReturnType<typeof packetSummary>;
};

type SleepPacketResponse = {
  packet: SleepCuePacket;
  summary: ReturnType<typeof sleepPacketSummary>;
};

type SleepPlaybackResponse = {
  session: SessionRecord;
  event: LearningEvent;
  summary: ReturnType<typeof sleepPlaybackSummary>;
};

type SleepCueRecallCompletionResponse = {
  session: SessionRecord;
  cued_responses: AssessmentResponse[];
  control_responses: AssessmentResponse[];
  updated_states: UserConceptState[];
  repair_recommendations: string[];
  summary: ReturnType<typeof sleepCueRecallSummary>;
};

type FlashReadGenerateResponse = {
  session: SessionRecord;
  asset: FlashReadAsset;
  plan: FlashReadSessionPlan;
  summary: ReturnType<typeof flashReadPlanSummary>;
};

type FlashReadCompletionResponse = {
  session: SessionRecord;
  asset: FlashReadAsset;
  result: ReturnType<typeof scoreFlashReadCompletion>;
  updated_states: UserConceptState[];
  summary: ReturnType<typeof flashReadCompletionSummary>;
};

type CreatorIngestionResponse = {
  submission: CreatorSubmissionRecord;
  proposals: Proposal[];
  risk_flags: string[];
};

type GraphReleaseArtifact = {
  id: string;
  graph_version: string;
  proposal_id: string;
  released_by: string;
  affected_object_ids: string[];
  release_notes: string;
  diff: Record<string, unknown>;
  created_at: string;
};

type OnboardingResponse = {
  user: User;
  goal: Goal;
  installed_packs: Awaited<ReturnType<MnemosyneStore["installPack"]>>[];
  baseline_states: UserConceptState[];
  diagnostic_items: AssessmentItem[];
  first_packet: DailyLearningPacket;
  summary: ReturnType<typeof packetSummary>;
};

type MorningForgeCompletionResponse = {
  session: SessionRecord;
  responses: AssessmentResponse[];
  updated_states: UserConceptState[];
  repair_recommendations: string[];
  summary: {
    answered: number;
    average_correctness: number;
    average_confidence: number;
    screen_minutes: number;
    voice_used: boolean;
  };
};

type EveningLockInCompletionResponse = {
  session: SessionRecord;
  responses: AssessmentResponse[];
  updated_states: UserConceptState[];
  bound_cues: SleepCueTemplate[];
  sleep_packet: SleepCuePacket;
  audio_plan: AudioPlan;
  repair_recommendations: string[];
  summary: {
    recall_answered: number;
    transfer_answered: number;
    average_correctness: number;
    average_confidence: number;
    screen_minutes: number;
    phone_down_ready: boolean;
    bound_cues: number;
    voice_used: boolean;
    audio_plan_duration_seconds: number;
  };
};

type WalkModeCompletionResponse = {
  session: SessionRecord;
  responses: AssessmentResponse[];
  updated_states: UserConceptState[];
  repair_recommendations: string[];
  summary: {
    answered: number;
    skipped: number;
    marked_confusing: number;
    average_correctness: number;
    average_confidence: number;
    voice_used: boolean;
    text_used: boolean;
    screen_locked: boolean;
    commands_processed: number;
    transcript_retention: WalkModeCompleteRequest["transcriptRetention"];
    compatible_assessment_events: boolean;
  };
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

    async createGoal(input: unknown): Promise<HandlerEnvelope<Goal>> {
      const request = validateRequest(createGoalRequestSchema, input) as CreateGoalRequest;
      await requireUser(store, request.userId);
      const goal = await store.saveGoal(buildGoal(request.userId, request));
      const audit = await store.appendAuditEvent({
        actor_id: request.userId,
        action: "goal_created",
        object_type: "goal",
        object_id: goal.id,
        payload: {
          goal_type: goal.goal_type,
          target_concept_ids: goal.target_concept_ids,
          target_domain_ids: goal.target_domain_ids
        }
      });
      await store.appendLearningEvent({
        user_id: request.userId,
        event_type: "graph_updated",
        payload: { goal_id: goal.id, action: "goal_created" }
      });
      return envelope(goal, audit.id);
    },

    async updatePreferences(input: unknown): Promise<HandlerEnvelope<User>> {
      const request = validateRequest(updatePreferencesRequestSchema, input) as UpdatePreferencesRequest;
      const user = await requireUser(store, request.userId);
      const updated = await store.saveUser({
        ...user,
        privacy_settings: {
          ...user.privacy_settings,
          ...request.privacySettings,
          private_default:
            request.privacySettings?.private_default ?? user.privacy_settings.private_default ?? true
        },
        social_settings: { ...user.social_settings, ...request.socialSettings },
        notification_settings: { ...user.notification_settings, ...request.notificationSettings },
        default_session_preferences: {
          ...user.default_session_preferences,
          ...request.defaultSessionPreferences
        },
        accessibility_preferences: { ...user.accessibility_preferences, ...request.accessibilityPreferences },
        modality_preferences: { ...user.modality_preferences, ...request.modalityPreferences },
        updated_at: nowIso()
      });
      const audit = await store.appendAuditEvent({
        actor_id: request.userId,
        action: "preferences_updated",
        object_type: "user",
        object_id: user.id,
        payload: {
          privacy_updated: Boolean(request.privacySettings),
          modality_updated: Boolean(request.modalityPreferences),
          accessibility_updated: Boolean(request.accessibilityPreferences)
        }
      });
      return envelope(updated, audit.id);
    },

    async completeOnboarding(input: unknown): Promise<HandlerEnvelope<OnboardingResponse>> {
      const request = validateRequest(completeOnboardingRequestSchema, input) as CompleteOnboardingRequest;
      const now = nowIso();
      const user: User = {
        id: request.userId ?? createId("user", request.handle),
        display_name: request.displayName,
        handle: request.handle,
        timezone: request.timezone,
        privacy_settings: {
          private_default: request.privacy.privateDefault,
          product_analytics_consent: request.privacy.productAnalyticsConsent,
          research_consent: request.privacy.researchConsent,
          voice_retention: request.privacy.voiceRetention,
          health_data_retention: request.privacy.healthDataRetention
        },
        social_settings: { share_level: request.privacy.shareLevel },
        notification_settings: {
          dusk_quiet: request.preferences.duskQuiet,
          morning_prompt: request.preferences.morningPrompt
        },
        default_session_preferences: {
          morning_minutes: request.preferences.morningMinutes,
          evening_minutes: request.preferences.eveningMinutes
        },
        accessibility_preferences: {
          high_contrast: request.preferences.highContrast,
          reduced_motion: request.preferences.reducedMotion
        },
        modality_preferences: {
          voice_first: request.preferences.voiceFirst,
          walking: request.preferences.walking,
          flashread: request.preferences.flashread
        },
        created_at: now,
        updated_at: now
      };
      await store.saveUser(user);

      const readiness = request.readiness ?? readinessFromOnboarding(request);
      await store.saveReadiness(user.id, readiness);

      const installedPacks: OnboardingResponse["installed_packs"] = [];
      for (const packId of request.packIds) installedPacks.push(await store.installPack(user.id, packId));

      const masterGraph = await store.getMasterGraph();
      const goal = await store.saveGoal(buildGoal(user.id, request.goal));
      const baselineStates = buildBaselineStates(user.id, goal, masterGraph);
      await store.saveUserConceptStates(user.id, baselineStates);
      const diagnostics = buildBaselineDiagnostics(
        baselineStates,
        masterGraph,
        request.baselineDiagnosticLimit
      );
      const scheduled = await generateAndPersistDailyPacket(
        store,
        user.id,
        readiness,
        "onboarding_completed"
      );
      await store.appendLearningEvent({
        user_id: user.id,
        event_type: "graph_updated",
        payload: {
          action: "onboarding_completed",
          goal_id: goal.id,
          baseline_state_count: baselineStates.length,
          diagnostic_item_ids: diagnostics.map((item) => item.id)
        }
      });
      const audit = await store.appendAuditEvent({
        actor_id: user.id,
        action: "onboarding_completed",
        object_type: "user",
        object_id: user.id,
        payload: {
          goal_id: goal.id,
          installed_pack_ids: installedPacks.map((pack) => pack.id),
          diagnostic_item_ids: diagnostics.map((item) => item.id),
          private_default: user.privacy_settings.private_default,
          share_level: user.social_settings.share_level,
          first_packet_id: scheduled.packet.id,
          device_capabilities: request.deviceCapabilities
        }
      });
      return envelope(
        {
          user,
          goal,
          installed_packs: installedPacks,
          baseline_states: baselineStates,
          diagnostic_items: diagnostics,
          first_packet: scheduled.packet,
          summary: packetSummary(scheduled.packet)
        },
        audit.id
      );
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
      const readiness =
        request.readiness ?? (await store.getReadiness(request.userId)) ?? defaultReadinessFallback();
      if (request.readiness) await store.saveReadiness(request.userId, request.readiness);
      const scheduled = await generateAndPersistDailyPacket(store, request.userId, readiness);
      return envelope(scheduled, scheduled.audit.id);
    },

    async assignExperiments(input: unknown): Promise<HandlerEnvelope<ExperimentDashboardResponse>> {
      const request = validateRequest(
        experimentAssignmentRequestSchema,
        input
      ) as ExperimentAssignmentRequest;
      const dashboard = await buildExperimentDashboard(store, request.userId, request.maxPairsPerExperiment);
      const audit = await store.appendAuditEvent({
        actor_id: request.userId,
        action: "experiments_assigned",
        object_type: "personalization_profile",
        object_id: request.userId,
        payload: {
          experiment_ids: dashboard.experiments.map((experiment) => experiment.id),
          assignment_count: dashboard.assignments.length,
          recommended_technique_ids: dashboard.profile.recommended_technique_ids,
          scheduler_adjustments: dashboard.profile.scheduler_adjustments
        }
      });
      return envelope(dashboard, audit.id);
    },

    async getPersonalizationProfile(userId: string): Promise<HandlerEnvelope<ExperimentDashboardResponse>> {
      const dashboard = await buildExperimentDashboard(store, userId);
      return envelope(dashboard);
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

    async completeMorningForge(input: unknown): Promise<HandlerEnvelope<MorningForgeCompletionResponse>> {
      const request = validateRequest(
        morningForgeCompleteRequestSchema,
        input
      ) as MorningForgeCompleteRequest;
      await requireUser(store, request.userId);
      const packet = await store.getDailyPacket(request.userId, request.packetDate ?? todayIsoDate());
      if (!packet || packet.id !== request.dailyPacketId) {
        return notFound<MorningForgeCompletionResponse>("daily_packet_not_found");
      }

      let session = request.sessionId ? await store.getSession(request.sessionId) : undefined;
      if (request.sessionId && (!session || session.user_id !== request.userId)) {
        return notFound<MorningForgeCompletionResponse>("session_not_found");
      }
      const eventIds = session?.event_ids ? [...session.event_ids] : [];
      if (!session) {
        session = {
          id: createId("session"),
          user_id: request.userId,
          daily_packet_id: request.dailyPacketId,
          session_type: "morning_forge",
          status: "running",
          started_at: nowIso(),
          event_ids: []
        };
        await store.saveSession(session);
        const startEvent = await store.appendLearningEvent({
          user_id: request.userId,
          event_type: "session_started",
          payload: {
            session_id: session.id,
            daily_packet_id: request.dailyPacketId,
            session_type: "morning_forge",
            source: "morning_forge_completion"
          }
        });
        eventIds.push(startEvent.id);
      }

      let states = (await store.getUserGraph(request.userId)).states;
      const responses: AssessmentResponse[] = [];
      for (const responseInput of request.responses) {
        const response = scoreAssessmentResponse({
          userId: request.userId,
          item: responseInput.item,
          rawResponse: responseInput.rawResponse,
          confidence: responseInput.confidence,
          latencyMs: responseInput.latencyMs,
          hintCount: responseInput.hintCount,
          retries: responseInput.retries
        });
        responses.push(await store.saveAssessmentResponse(response));
        states = applyResponseToStates(states, response, request.userId);
        const event = await store.appendLearningEvent({
          user_id: request.userId,
          event_type: "assessment_answered",
          payload: {
            session_id: session.id,
            daily_packet_id: request.dailyPacketId,
            assessment_item_id: responseInput.item.id,
            response_id: response.id,
            correctness_score: response.correctness_score,
            confidence_reported: response.confidence_reported,
            latency_ms: response.latency_ms,
            entry_mode: responseInput.entryMode,
            voice_used: responseInput.entryMode === "voice" || request.voiceUsed,
            transcript_stored: Boolean(responseInput.transcript),
            detected_failure_modes: response.detected_failure_modes
          }
        });
        eventIds.push(event.id);
      }

      const updatedGraph = await store.saveUserConceptStates(request.userId, states);
      const touchedConceptIds = new Set(
        responses
          .flatMap((response) => response.graph_updates.map((update) => update.concept_id))
          .filter((conceptId): conceptId is string => typeof conceptId === "string")
      );
      const updatedStates = updatedGraph.states.filter((state) => touchedConceptIds.has(state.concept_id));
      const summary = morningForgeSummary(responses, request);
      const completionEvent = await store.appendLearningEvent({
        user_id: request.userId,
        event_type: "graph_updated",
        payload: {
          session_id: session.id,
          daily_packet_id: request.dailyPacketId,
          action: "morning_forge_completed",
          ...summary,
          updated_concept_ids: [...touchedConceptIds]
        }
      });
      eventIds.push(completionEvent.id);

      const completedSession = await store.saveSession({
        ...session,
        status: "completed",
        completed_at: request.completedAt ?? nowIso(),
        event_ids: Array.from(new Set(eventIds))
      });
      const repairRecommendations = repairRecommendationsFor(responses);
      const audit = await store.appendAuditEvent({
        actor_id: request.userId,
        action: "morning_forge_completed",
        object_type: "session",
        object_id: completedSession.id,
        payload: {
          daily_packet_id: request.dailyPacketId,
          response_ids: responses.map((response) => response.id),
          repair_recommendations: repairRecommendations,
          ...summary
        }
      });

      return envelope(
        {
          session: completedSession,
          responses,
          updated_states: updatedStates,
          repair_recommendations: repairRecommendations,
          summary
        },
        audit.id
      );
    },

    async completeWalkMode(input: unknown): Promise<HandlerEnvelope<WalkModeCompletionResponse>> {
      const request = validateRequest(walkModeCompleteRequestSchema, input) as WalkModeCompleteRequest;
      await requireUser(store, request.userId);
      const packet = await store.getDailyPacket(request.userId, request.packetDate ?? todayIsoDate());
      if (!packet || packet.id !== request.dailyPacketId) {
        return notFound<WalkModeCompletionResponse>("daily_packet_not_found");
      }
      const walkPacket = packet.walk_packets.find((candidate) => candidate.id === request.walkPacketId);
      if (!walkPacket) return notFound<WalkModeCompletionResponse>("walk_packet_not_found");

      let session = request.sessionId ? await store.getSession(request.sessionId) : undefined;
      if (
        request.sessionId &&
        (!session || session.user_id !== request.userId || session.session_type !== "walk_mode")
      ) {
        return notFound<WalkModeCompletionResponse>("session_not_found");
      }
      const eventIds = session?.event_ids ? [...session.event_ids] : [];
      if (!session) {
        session = {
          id: createId("session"),
          user_id: request.userId,
          daily_packet_id: request.dailyPacketId,
          session_type: "walk_mode",
          status: "running",
          started_at: nowIso(),
          event_ids: []
        };
        await store.saveSession(session);
        const startEvent = await store.appendLearningEvent({
          user_id: request.userId,
          event_type: "session_started",
          payload: {
            session_id: session.id,
            daily_packet_id: request.dailyPacketId,
            walk_packet_id: walkPacket.id,
            session_type: "walk_mode",
            source: "walk_mode_completion"
          }
        });
        eventIds.push(startEvent.id);
      }

      let states = (await store.getUserGraph(request.userId)).states;
      const responses: AssessmentResponse[] = [];
      for (const responseInput of request.responses) {
        const response = scoreAssessmentResponse({
          userId: request.userId,
          item: responseInput.item,
          rawResponse: responseInput.rawResponse,
          confidence: responseInput.confidence,
          latencyMs: responseInput.latencyMs,
          hintCount: responseInput.hintCount,
          retries: responseInput.retries
        });
        const savedResponse = await store.saveAssessmentResponse(response);
        responses.push(savedResponse);
        states = applyResponseToStates(states, savedResponse, request.userId);
        const event = await store.appendLearningEvent({
          user_id: request.userId,
          event_type: "assessment_answered",
          payload: {
            session_id: session.id,
            daily_packet_id: request.dailyPacketId,
            walk_packet_id: walkPacket.id,
            assessment_item_id: responseInput.item.id,
            response_id: savedResponse.id,
            correctness_score: savedResponse.correctness_score,
            confidence_reported: savedResponse.confidence_reported,
            latency_ms: savedResponse.latency_ms,
            entry_mode: responseInput.entryMode,
            voice_used: responseInput.entryMode === "voice" || request.voiceUsed,
            transcript_stored: request.transcriptRetention !== "deleted" && Boolean(responseInput.transcript),
            detected_failure_modes: savedResponse.detected_failure_modes
          }
        });
        eventIds.push(event.id);
      }

      const confusingSet = new Set(request.confusingPromptIds);
      states = markWalkConfusion(states, walkPacket.prompts, confusingSet, request.completedAt ?? nowIso());
      const updatedGraph = await store.saveUserConceptStates(request.userId, states);
      const touchedConceptIds = new Set(
        responses
          .flatMap((response) => response.graph_updates.map((update) => update.concept_id))
          .filter((conceptId): conceptId is string => typeof conceptId === "string")
      );
      for (const prompt of walkPacket.prompts) {
        if (confusingSet.has(prompt.id)) {
          prompt.concept_ids.forEach((conceptId) => touchedConceptIds.add(conceptId));
        }
      }
      const updatedStates = updatedGraph.states.filter((state) => touchedConceptIds.has(state.concept_id));
      const summary = walkModeSummary(responses, request);
      const completionEvent = await store.appendLearningEvent({
        user_id: request.userId,
        event_type: "walk_recall_completed",
        payload: {
          session_id: session.id,
          daily_packet_id: request.dailyPacketId,
          walk_packet_id: walkPacket.id,
          updated_concept_ids: [...touchedConceptIds],
          command_log: request.commandLog,
          skipped_prompt_ids: request.skippedPromptIds,
          confusing_prompt_ids: request.confusingPromptIds,
          ...summary
        }
      });
      eventIds.push(completionEvent.id);

      const completedSession = await store.saveSession({
        ...session,
        status: "completed",
        completed_at: request.completedAt ?? nowIso(),
        event_ids: Array.from(new Set(eventIds))
      });
      const repairRecommendations = repairRecommendationsFor(responses);
      const audit = await store.appendAuditEvent({
        actor_id: request.userId,
        action: "walk_mode_completed",
        object_type: "session",
        object_id: completedSession.id,
        payload: {
          daily_packet_id: request.dailyPacketId,
          walk_packet_id: walkPacket.id,
          response_ids: responses.map((response) => response.id),
          repair_recommendations: repairRecommendations,
          ...summary
        }
      });

      return envelope(
        {
          session: completedSession,
          responses,
          updated_states: updatedStates,
          repair_recommendations: repairRecommendations,
          summary
        },
        audit.id
      );
    },

    async completeEveningLockIn(input: unknown): Promise<HandlerEnvelope<EveningLockInCompletionResponse>> {
      const request = validateRequest(
        eveningLockInCompleteRequestSchema,
        input
      ) as EveningLockInCompleteRequest;
      await requireUser(store, request.userId);
      const packet = await store.getDailyPacket(request.userId, request.packetDate ?? todayIsoDate());
      if (!packet || packet.id !== request.dailyPacketId) {
        return notFound<EveningLockInCompletionResponse>("daily_packet_not_found");
      }

      let session = request.sessionId ? await store.getSession(request.sessionId) : undefined;
      if (
        request.sessionId &&
        (!session ||
          session.user_id !== request.userId ||
          session.session_type !== "evening_lock_in" ||
          session.daily_packet_id !== request.dailyPacketId)
      ) {
        return notFound<EveningLockInCompletionResponse>("session_not_found");
      }

      const eventIds = session?.event_ids ? [...session.event_ids] : [];
      if (!session) {
        session = {
          id: createId("session"),
          user_id: request.userId,
          daily_packet_id: request.dailyPacketId,
          session_type: "evening_lock_in",
          status: "running",
          started_at: nowIso(),
          event_ids: []
        };
        await store.saveSession(session);
        const startEvent = await store.appendLearningEvent({
          user_id: request.userId,
          event_type: "session_started",
          payload: {
            session_id: session.id,
            daily_packet_id: request.dailyPacketId,
            session_type: "evening_lock_in",
            source: "evening_lock_in_completion"
          }
        });
        eventIds.push(startEvent.id);
      }

      let states = (await store.getUserGraph(request.userId)).states;
      const responses: AssessmentResponse[] = [];
      const responseGroups: Array<{
        phase: "recall" | "transfer";
        items: MorningForgeResponseInput[];
      }> = [
        { phase: "recall", items: request.recallResponses },
        { phase: "transfer", items: request.transferResponses }
      ];

      for (const group of responseGroups) {
        for (const responseInput of group.items) {
          const response = scoreAssessmentResponse({
            userId: request.userId,
            item: responseInput.item,
            rawResponse: responseInput.rawResponse,
            confidence: responseInput.confidence,
            latencyMs: responseInput.latencyMs,
            hintCount: responseInput.hintCount,
            retries: responseInput.retries
          });
          const savedResponse = await store.saveAssessmentResponse(response);
          responses.push(savedResponse);
          states = applyResponseToStates(states, savedResponse, request.userId);
          const event = await store.appendLearningEvent({
            user_id: request.userId,
            event_type: "assessment_answered",
            payload: {
              session_id: session.id,
              daily_packet_id: request.dailyPacketId,
              assessment_phase: group.phase,
              assessment_item_id: responseInput.item.id,
              response_id: savedResponse.id,
              correctness_score: savedResponse.correctness_score,
              confidence_reported: savedResponse.confidence_reported,
              latency_ms: savedResponse.latency_ms,
              entry_mode: responseInput.entryMode,
              voice_used: responseInput.entryMode === "voice" || request.voiceUsed,
              transcript_stored: Boolean(responseInput.transcript),
              detected_failure_modes: savedResponse.detected_failure_modes
            }
          });
          eventIds.push(event.id);
        }
      }

      const updatedGraph = await store.saveUserConceptStates(request.userId, states);
      const touchedConceptIds = new Set(conceptIdsFromResponses(responses));
      const updatedStates = updatedGraph.states.filter((state) => touchedConceptIds.has(state.concept_id));
      const boundCues = resolveBoundCues(packet, request.boundCueIds);
      const boundConceptIds = uniqueStrings(boundCues.map((cue) => cue.concept_id));
      const planningContext = await buildPlanningContext(store, request.userId);
      const sleepResult = buildSleepCuePacket({
        user: planningContext.user,
        concepts: planningContext.masterGraph.concepts,
        states: updatedGraph.states,
        knownIds: uniqueStrings([
          ...planningContext.knownIds,
          ...conceptIdsFromInputs(request.recallResponses)
        ]),
        frontierIds: uniqueStrings([
          ...planningContext.frontierIds,
          ...conceptIdsFromInputs(request.transferResponses),
          ...boundConceptIds
        ]),
        horizonIds: planningContext.horizonIds,
        readiness: planningContext.readiness,
        conservative:
          packet.evening.screen_policy === "audio_only" ||
          planningContext.readiness.dusk_mode ||
          planningContext.readiness.fatigue > 0.7
      });
      await store.saveSleepCuePacket(sleepResult.packet);
      await store.saveAudioPlan(sleepResult.audioPlan);

      const summary = eveningLockInSummary(responses, request, boundCues, sleepResult.audioPlan);
      const cueEvent = await store.appendLearningEvent({
        user_id: request.userId,
        event_type: "cue_bound",
        payload: {
          session_id: session.id,
          daily_packet_id: request.dailyPacketId,
          sleep_packet_id: sleepResult.packet.id,
          audio_plan_id: sleepResult.audioPlan.id,
          bound_cue_ids: boundCues.map((cue) => cue.id),
          bound_concept_ids: boundConceptIds,
          phone_down_ready: summary.phone_down_ready,
          ...sleepPacketSummary(sleepResult.packet)
        }
      });
      eventIds.push(cueEvent.id);

      const completionEvent = await store.appendLearningEvent({
        user_id: request.userId,
        event_type: "graph_updated",
        payload: {
          session_id: session.id,
          daily_packet_id: request.dailyPacketId,
          action: "evening_lock_in_completed",
          updated_concept_ids: [...touchedConceptIds],
          sleep_packet_id: sleepResult.packet.id,
          audio_plan_id: sleepResult.audioPlan.id,
          ...summary
        }
      });
      eventIds.push(completionEvent.id);

      const completedSession = await store.saveSession({
        ...session,
        status: "completed",
        completed_at: request.completedAt ?? nowIso(),
        event_ids: Array.from(new Set(eventIds))
      });
      const repairRecommendations = repairRecommendationsFor(responses);
      const audit = await store.appendAuditEvent({
        actor_id: request.userId,
        action: "evening_lock_in_completed",
        object_type: "session",
        object_id: completedSession.id,
        payload: {
          daily_packet_id: request.dailyPacketId,
          response_ids: responses.map((response) => response.id),
          bound_cue_ids: boundCues.map((cue) => cue.id),
          sleep_packet_id: sleepResult.packet.id,
          audio_plan_id: sleepResult.audioPlan.id,
          repair_recommendations: repairRecommendations,
          ...summary
        }
      });

      return envelope(
        {
          session: completedSession,
          responses,
          updated_states: updatedStates,
          bound_cues: boundCues,
          sleep_packet: sleepResult.packet,
          audio_plan: sleepResult.audioPlan,
          repair_recommendations: repairRecommendations,
          summary
        },
        audit.id
      );
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
      const completedAt = nowIso();
      const masterGraph = await store.getMasterGraph();
      const watchedVideos = masterGraph.videos.filter((video) => request.videoIds.includes(video.id));
      const awardedConceptIds = request.recallPassed
        ? unique(watchedVideos.flatMap((video) => video.concept_ids))
        : [];
      if (request.recallPassed && watchedVideos.length > 0) {
        await store.saveUserConceptStates(
          request.userId,
          applyWatchPacketRecallToStates(
            (await store.getUserGraph(request.userId)).states,
            watchedVideos,
            request.screenMinutes,
            completedAt,
            request.userId
          )
        );
      }
      const event = await store.appendLearningEvent({
        user_id: request.userId,
        event_type: "video_watched",
        payload: {
          watch_packet_id: request.watchPacketId,
          video_ids: request.videoIds,
          recall_passed: request.recallPassed,
          screen_minutes: request.screenMinutes,
          screen_load_multiplier: request.recallPassed ? 0.42 : 0.8,
          graph_progress_awarded: request.recallPassed,
          awarded_concept_ids: awardedConceptIds
        }
      });
      return envelope(event);
    },

    async generateFlashRead(input: unknown): Promise<HandlerEnvelope<FlashReadGenerateResponse>> {
      const request = validateRequest(flashReadGenerateRequestSchema, input) as FlashReadGenerateRequest;
      const context = await buildPlanningContext(store, request.userId);
      const asset = selectFlashReadAsset(context.masterGraph, request, [
        ...context.frontierIds,
        ...context.knownIds,
        ...context.horizonIds
      ]);
      if (!asset) return notFound<FlashReadGenerateResponse>("flashread_asset_not_found");

      const plan = buildFlashReadSession(asset, request.displayUnit, request.requestedWpm);
      const session: SessionRecord = {
        id: createId("session"),
        user_id: request.userId,
        session_type: "flashread",
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
          session_type: "flashread",
          flashread_session_id: plan.id,
          flashread_asset_id: asset.id,
          concept_ids: asset.concept_ids,
          raw_wpm: plan.raw_wpm,
          estimated_effective_wpm: plan.estimated_effective_wpm,
          display_unit: plan.display_unit
        }
      });
      const storedSession = await store.saveSession({ ...session, event_ids: [event.id] });
      const summary = flashReadPlanSummary(asset, plan);
      const audit = await store.appendAuditEvent({
        actor_id: request.userId,
        action: "flashread_session_generated",
        object_type: "flashread_asset",
        object_id: asset.id,
        payload: {
          session_id: storedSession.id,
          ...summary
        }
      });
      return envelope({ session: storedSession, asset, plan, summary }, audit.id);
    },

    async completeFlashRead(input: unknown): Promise<HandlerEnvelope<FlashReadCompletionResponse>> {
      const request = validateRequest(flashReadCompleteRequestSchema, input) as FlashReadCompleteRequest;
      await requireUser(store, request.userId);
      const masterGraph = await store.getMasterGraph();
      const asset = allFlashReadAssets(masterGraph).find((candidate) => candidate.id === request.assetId);
      if (!asset) return notFound<FlashReadCompletionResponse>("flashread_asset_not_found");
      let session = request.sessionId ? await store.getSession(request.sessionId) : undefined;
      if (
        request.sessionId &&
        (!session || session.user_id !== request.userId || session.session_type !== "flashread")
      ) {
        return notFound<FlashReadCompletionResponse>("session_not_found");
      }
      const eventIds = session?.event_ids ? [...session.event_ids] : [];
      if (!session) {
        session = {
          id: createId("session"),
          user_id: request.userId,
          session_type: "flashread",
          status: "running",
          started_at: nowIso(),
          event_ids: []
        };
        await store.saveSession(session);
      }

      const result = scoreFlashReadCompletion({
        rawWpm: request.rawWpm,
        comprehensionScore: request.comprehensionScore,
        retentionScore: request.retentionScore,
        strainRating: request.strainRating
      });
      const updatedGraph = await store.saveUserConceptStates(
        request.userId,
        applyFlashReadCompletionToStates(
          (await store.getUserGraph(request.userId)).states,
          asset,
          result,
          request.completedAt ?? nowIso(),
          request.userId
        )
      );
      const updatedStates = updatedGraph.states.filter((state) =>
        asset.concept_ids.includes(state.concept_id)
      );
      const summary = flashReadCompletionSummary(asset, request, result);
      const event = await store.appendLearningEvent({
        user_id: request.userId,
        event_type: "flashread_completed",
        payload: {
          session_id: session.id,
          ...summary
        }
      });
      eventIds.push(event.id);
      const completedSession = await store.saveSession({
        ...session,
        status: "completed",
        completed_at: request.completedAt ?? nowIso(),
        event_ids: Array.from(new Set(eventIds))
      });
      const audit = await store.appendAuditEvent({
        actor_id: request.userId,
        action: "flashread_completed",
        object_type: "flashread_asset",
        object_id: asset.id,
        payload: {
          session_id: completedSession.id,
          event_id: event.id,
          ...summary
        }
      });

      return envelope(
        {
          session: completedSession,
          asset,
          result,
          updated_states: updatedStates,
          summary
        },
        audit.id
      );
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

    async recordSleepPlayback(input: unknown): Promise<HandlerEnvelope<SleepPlaybackResponse>> {
      const request = validateRequest(sleepPlaybackEventRequestSchema, input) as SleepPlaybackEventRequest;
      await requireUser(store, request.userId);
      const packet = await store.getSleepCuePacket(request.userId, request.nightDate ?? todayIsoDate());
      if (!packet || packet.id !== request.sleepPacketId) {
        return notFound<SleepPlaybackResponse>("sleep_packet_not_found");
      }
      const invalidCue = request.cueEvents.find(
        (cue) => !conceptIdsForSleepBucket(packet, cue.bucket).includes(cue.conceptId)
      );
      if (invalidCue) return notFound<SleepPlaybackResponse>("sleep_cue_not_found");
      if (request.audioPlanId) {
        const plan = await store.getAudioPlan(request.audioPlanId);
        if (!plan || plan.user_id !== request.userId) {
          return notFound<SleepPlaybackResponse>("audio_plan_not_found");
        }
      }

      let session = request.sessionId ? await store.getSession(request.sessionId) : undefined;
      if (
        request.sessionId &&
        (!session || session.user_id !== request.userId || session.session_type !== "sleep")
      ) {
        return notFound<SleepPlaybackResponse>("session_not_found");
      }
      const eventIds = session?.event_ids ? [...session.event_ids] : [];
      if (!session) {
        session = {
          id: createId("session"),
          user_id: request.userId,
          session_type: "sleep",
          status: "running",
          started_at: request.playbackStartedAt ?? nowIso(),
          event_ids: []
        };
        await store.saveSession(session);
      }

      const summary = sleepPlaybackSummary(packet, request);
      const event = await store.appendLearningEvent({
        user_id: request.userId,
        event_type: "sleep_cue_played",
        payload: {
          session_id: session.id,
          audio_plan_id: request.audioPlanId ?? packet.audio_plan_id,
          cue_events: request.cueEvents,
          ...summary
        }
      });
      eventIds.push(event.id);
      const completedSession = await store.saveSession({
        ...session,
        status: "completed",
        completed_at: request.playbackEndedAt ?? nowIso(),
        event_ids: Array.from(new Set(eventIds))
      });
      const audit = await store.appendAuditEvent({
        actor_id: request.userId,
        action: "sleep_playback_logged",
        object_type: "sleep_cue_packet",
        object_id: packet.id,
        payload: {
          session_id: completedSession.id,
          event_id: event.id,
          ...summary
        }
      });

      return envelope({ session: completedSession, event, summary }, audit.id);
    },

    async completeSleepCueRecall(input: unknown): Promise<HandlerEnvelope<SleepCueRecallCompletionResponse>> {
      const request = validateRequest(sleepRecallCompleteRequestSchema, input) as SleepRecallCompleteRequest;
      await requireUser(store, request.userId);
      const packet = await store.getSleepCuePacket(request.userId, request.nightDate ?? todayIsoDate());
      if (!packet || packet.id !== request.sleepPacketId) {
        return notFound<SleepCueRecallCompletionResponse>("sleep_packet_not_found");
      }
      const cuedConceptSet = new Set(sleepCuedConceptIds(packet));
      const controlConceptSet = new Set(packet.control_concept_ids);
      const invalidCued = conceptIdsFromInputs(request.cuedResponses).find(
        (conceptId) => !cuedConceptSet.has(conceptId)
      );
      const invalidControl = conceptIdsFromInputs(request.controlResponses).find(
        (conceptId) => !controlConceptSet.has(conceptId)
      );
      if (invalidCued || invalidControl) {
        return notFound<SleepCueRecallCompletionResponse>("sleep_recall_assignment_not_found");
      }

      let session = request.sessionId ? await store.getSession(request.sessionId) : undefined;
      if (
        request.sessionId &&
        (!session || session.user_id !== request.userId || session.session_type !== "sleep")
      ) {
        return notFound<SleepCueRecallCompletionResponse>("session_not_found");
      }
      const eventIds = session?.event_ids ? [...session.event_ids] : [];
      if (!session) {
        session = {
          id: createId("session"),
          user_id: request.userId,
          session_type: "sleep",
          status: "running",
          started_at: nowIso(),
          event_ids: []
        };
        await store.saveSession(session);
      }

      let states = (await store.getUserGraph(request.userId)).states;
      const cuedResponses: AssessmentResponse[] = [];
      const controlResponses: AssessmentResponse[] = [];
      const responseGroups: Array<{
        assignment: "cued" | "control";
        items: MorningForgeResponseInput[];
        target: AssessmentResponse[];
      }> = [
        { assignment: "cued", items: request.cuedResponses, target: cuedResponses },
        { assignment: "control", items: request.controlResponses, target: controlResponses }
      ];

      for (const group of responseGroups) {
        for (const responseInput of group.items) {
          const response = scoreAssessmentResponse({
            userId: request.userId,
            item: responseInput.item,
            rawResponse: responseInput.rawResponse,
            confidence: responseInput.confidence,
            latencyMs: responseInput.latencyMs,
            hintCount: responseInput.hintCount,
            retries: responseInput.retries
          });
          const savedResponse = await store.saveAssessmentResponse(response);
          group.target.push(savedResponse);
          states = applyResponseToStates(states, savedResponse, request.userId);
          const event = await store.appendLearningEvent({
            user_id: request.userId,
            event_type: "assessment_answered",
            payload: {
              session_id: session.id,
              sleep_packet_id: packet.id,
              sleep_assignment: group.assignment,
              assessment_item_id: responseInput.item.id,
              response_id: savedResponse.id,
              correctness_score: savedResponse.correctness_score,
              confidence_reported: savedResponse.confidence_reported,
              latency_ms: savedResponse.latency_ms,
              entry_mode: responseInput.entryMode,
              voice_used: responseInput.entryMode === "voice" || request.voiceUsed,
              transcript_stored: Boolean(responseInput.transcript),
              detected_failure_modes: savedResponse.detected_failure_modes
            }
          });
          eventIds.push(event.id);
        }
      }

      const summary = sleepCueRecallSummary(cuedResponses, controlResponses, request, packet);
      states = applySleepCueGainToStates(states, summary, request.completedAt ?? nowIso());
      const updatedGraph = await store.saveUserConceptStates(request.userId, states);
      const touchedConceptIds = new Set(
        uniqueStrings([
          ...conceptIdsFromResponses([...cuedResponses, ...controlResponses]),
          ...summary.cued_concept_ids,
          ...summary.control_concept_ids
        ])
      );
      const updatedStates = updatedGraph.states.filter((state) => touchedConceptIds.has(state.concept_id));
      const completionEvent = await store.appendLearningEvent({
        user_id: request.userId,
        event_type: "graph_updated",
        payload: {
          session_id: session.id,
          action: "sleep_cue_recall_completed",
          updated_concept_ids: [...touchedConceptIds],
          ...summary
        }
      });
      eventIds.push(completionEvent.id);

      const completedSession = await store.saveSession({
        ...session,
        status: "completed",
        completed_at: request.completedAt ?? nowIso(),
        event_ids: Array.from(new Set(eventIds))
      });
      const repairRecommendations = repairRecommendationsFor([...cuedResponses, ...controlResponses]);
      const audit = await store.appendAuditEvent({
        actor_id: request.userId,
        action: "sleep_cue_recall_completed",
        object_type: "sleep_cue_packet",
        object_id: packet.id,
        payload: {
          session_id: completedSession.id,
          response_ids: [...cuedResponses, ...controlResponses].map((response) => response.id),
          repair_recommendations: repairRecommendations,
          ...summary
        }
      });

      return envelope(
        {
          session: completedSession,
          cued_responses: cuedResponses,
          control_responses: controlResponses,
          updated_states: updatedStates,
          repair_recommendations: repairRecommendations,
          summary
        },
        audit.id
      );
    },

    async getWearableStatus(userId: string): Promise<HandlerEnvelope<WearableCapabilityDashboard>> {
      await requireUser(store, userId);
      return envelope(await wearableDashboardFor(store, userId));
    },

    async connectOuraWearable(input: unknown): Promise<HandlerEnvelope<WearableConnectResponse>> {
      const request = validateRequest(wearableOuraConnectRequestSchema, input) as WearableConnectRequest;
      await requireUser(store, request.userId);
      const authorization = buildOuraAuthorizationRequest({
        userId: request.userId,
        clientId: request.clientId,
        redirectUri: request.redirectUri,
        scopes: request.scopes
      });
      const connection = await createWearableConnection({
        userId: request.userId,
        provider: "oura",
        scopes: request.scopes,
        accessToken: request.accessToken,
        refreshToken: request.refreshToken,
        authorization,
        encryptionSecret: request.encryptionSecret
      });
      const saved = await store.saveWearableConnection(connection);
      const audit = await store.appendAuditEvent({
        actor_id: request.userId,
        action: saved.status === "connected" ? "oura_wearable_connected" : "oura_authorization_started",
        object_type: "wearable_connection",
        object_id: saved.id,
        payload: {
          provider: saved.provider,
          status: saved.status,
          scopes: saved.scopes,
          token_encrypted: Boolean(saved.token_envelope),
          authorization_url: saved.authorization_url
        }
      });
      return envelope(
        { connection: saved, dashboard: await wearableDashboardFor(store, request.userId) },
        audit.id
      );
    },

    async revokeWearable(input: unknown): Promise<HandlerEnvelope<WearableConnectResponse>> {
      const request = validateRequest(wearableRevokeRequestSchema, input) as WearableRevokeRequest;
      await requireUser(store, request.userId);
      const connection = await store.getWearableConnection(request.connectionId);
      if (!connection || connection.user_id !== request.userId) {
        return notFound<WearableConnectResponse>("wearable_connection_not_found");
      }
      const revoked = await store.saveWearableConnection(revokeWearableConnection(connection));
      const audit = await store.appendAuditEvent({
        actor_id: request.userId,
        action: "wearable_connection_revoked",
        object_type: "wearable_connection",
        object_id: revoked.id,
        payload: {
          provider: revoked.provider,
          provider_revoke_endpoint: providerRevokeEndpoint(revoked.provider),
          local_tokens_deleted: !revoked.token_envelope && !revoked.refresh_token_envelope
        }
      });
      return envelope(
        { connection: revoked, dashboard: await wearableDashboardFor(store, request.userId) },
        audit.id
      );
    },

    async syncWearableSleep(input: unknown): Promise<HandlerEnvelope<WearableSyncResponse>> {
      const request = validateRequest(wearableSyncRequestSchema, input) as WearableSyncRequest;
      await requireUser(store, request.userId);
      if (request.connectionId) {
        const connection = await store.getWearableConnection(request.connectionId);
        if (!connection || connection.user_id !== request.userId || connection.status !== "connected") {
          return notFound<WearableSyncResponse>("wearable_connection_not_found");
        }
      }
      const existingReadiness = (await store.getReadiness(request.userId)) ?? defaultReadinessFallback();
      const normalized = request.sleepSession
        ? await store.saveWearableSleepSession(
            normalizeWearableSleepSession({
              userId: request.userId,
              provider: request.provider,
              raw: request.sleepSession
            })
          )
        : undefined;
      const readiness = normalized
        ? await store.saveReadiness(request.userId, readinessFromWearableSleep(normalized, existingReadiness))
        : existingReadiness;
      const dashboard = await wearableDashboardFor(store, request.userId, readiness);
      const audit = await store.appendAuditEvent({
        actor_id: request.userId,
        action: "wearable_sleep_synced",
        object_type: "wearable_sleep_session",
        object_id: normalized?.id,
        payload: {
          provider: request.provider,
          connection_id: request.connectionId,
          normalized: Boolean(normalized),
          stages: normalized?.stages.length ?? 0,
          sleep_quality: normalized?.sleep_quality,
          fatigue: normalized?.fatigue
        }
      });
      return envelope(
        { provider: request.provider, normalized_sleep: normalized, readiness, dashboard },
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

    async voteOnProposal(input: unknown): Promise<HandlerEnvelope<Proposal>> {
      const request = validateRequest(proposalVoteRequestSchema, input) as {
        proposalId: string;
        voterId: string;
        perspectiveId: string;
        voteType: VoteType;
      };
      const proposal = await store.getProposal(request.proposalId);
      if (!proposal) return notFound<Proposal>("proposal_not_found");
      const updated = await store.saveProposal(castVote(proposal, request.voteType, request.perspectiveId));
      const audit = await store.appendAuditEvent({
        actor_id: request.voterId,
        action: "proposal_vote_cast",
        object_type: "proposal",
        object_id: proposal.id,
        payload: {
          vote_type: request.voteType,
          perspective_id: request.perspectiveId,
          bridging_priority: computeBridgingPriority(updated)
        }
      });
      return envelope(updated, audit.id);
    },

    async commentOnProposal(input: unknown): Promise<HandlerEnvelope<Proposal>> {
      const request = validateRequest(proposalCommentRequestSchema, input) as {
        proposalId: string;
        authorId: string;
        text: string;
        commentType: "expert" | "learner" | "moderator" | "appeal";
      };
      const proposal = await store.getProposal(request.proposalId);
      if (!proposal) return notFound<Proposal>("proposal_not_found");
      const updated = await store.saveProposal({
        ...proposal,
        expert_comments: [
          ...proposal.expert_comments,
          {
            author_id: request.authorId,
            text: request.text,
            comment_type: request.commentType,
            created_at: nowIso()
          }
        ],
        updated_at: nowIso()
      });
      const audit = await store.appendAuditEvent({
        actor_id: request.authorId,
        action: "proposal_comment_added",
        object_type: "proposal",
        object_id: proposal.id,
        payload: {
          comment_type: request.commentType,
          comment_count: updated.expert_comments.length
        }
      });
      return envelope(updated, audit.id);
    },

    async releaseProposal(
      input: unknown
    ): Promise<HandlerEnvelope<{ proposal: Proposal; release: GraphReleaseArtifact }>> {
      const request = validateRequest(proposalReleaseRequestSchema, input) as {
        proposalId: string;
        releaserId: string;
        graphVersion?: string;
        notes?: string;
      };
      const proposal = await store.getProposal(request.proposalId);
      if (!proposal) {
        return notFound<{ proposal: Proposal; release: GraphReleaseArtifact }>("proposal_not_found");
      }
      if (!["accepted", "accepted_with_modifications"].includes(proposal.status)) {
        return invalidRequest<{ proposal: Proposal; release: GraphReleaseArtifact }>(
          "proposal_not_accepted_for_release"
        );
      }

      const releasedAt = nowIso();
      const graphVersion = request.graphVersion ?? `graph-${todayIsoDate()}-${proposal.id.slice(-6)}`;
      const release = buildGraphReleaseArtifact(
        proposal,
        request.releaserId,
        graphVersion,
        releasedAt,
        request.notes
      );
      await applyProposalToMasterGraph(store, proposal, graphVersion, releasedAt);
      const updated = await store.saveProposal({
        ...proposal,
        status: "merged",
        expert_comments: [
          ...proposal.expert_comments,
          {
            author_id: request.releaserId,
            text: release.release_notes,
            comment_type: "release_note",
            graph_version: graphVersion,
            created_at: releasedAt
          }
        ],
        updated_at: releasedAt
      });
      const audit = await store.appendAuditEvent({
        actor_id: request.releaserId,
        action: "proposal_released",
        object_type: "graph_release",
        object_id: release.id,
        payload: {
          proposal_id: proposal.id,
          graph_version: graphVersion,
          affected_object_ids: proposal.affected_object_ids,
          release_notes: release.release_notes,
          diff: proposal.diff
        }
      });
      return envelope({ proposal: updated, release }, audit.id);
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

    async submitCreatorIngestion(input: unknown): Promise<HandlerEnvelope<CreatorIngestionResponse>> {
      const request = validateRequest(creatorIngestionRequestSchema, input) as CreatorIngestionRequest;
      const creator = await requireUser(store, request.creatorId);
      const submissionId = createId("creator_ingestion");
      const evidence = mergeSourceRefs(request.source, request.evidence);
      const riskFlags = triageCreatorDraft(request, evidence);
      const riskLevel = riskLevelForCreatorSubmission(riskFlags);
      const proposalDrafts = buildCreatorProposalDrafts(request, submissionId);
      const proposals: Proposal[] = [];

      for (const proposalDraft of proposalDrafts) {
        const proposal = createCourtProposal({
          proposerId: creator.id,
          proposalType: proposalDraft.proposalType,
          affectedObjectIds: proposalDraft.affectedObjectIds,
          diff: proposalDraft.diff,
          rationale: proposalDraft.rationale,
          evidenceFor: evidence,
          riskLevel
        });
        proposals.push(await store.saveProposal(proposal));
        await store.appendLearningEvent({
          user_id: creator.id,
          event_type: "proposal_submitted",
          payload: {
            proposal_id: proposal.id,
            creator_ingestion_id: submissionId,
            proposal_type: proposal.proposal_type,
            risk_level: proposal.risk_level
          }
        });
      }

      const createdAt = nowIso();
      const submission = await store.saveCreatorSubmission({
        id: submissionId,
        creator_id: creator.id,
        title: request.title,
        status: statusForCreatorSubmission(riskFlags, proposals.length),
        license: request.license,
        notes: request.notes,
        source: evidence[0],
        evidence,
        content: {
          concepts: request.draft.concepts,
          videos: request.draft.videos,
          assessments: request.draft.assessments,
          sleep_cues: request.draft.sleepCues,
          flashread_assets: request.draft.flashreadAssets
        },
        risk_flags: riskFlags,
        proposal_ids: proposals.map((proposal) => proposal.id),
        created_at: createdAt,
        updated_at: createdAt
      });
      const audit = await store.appendAuditEvent({
        actor_id: creator.id,
        action: "creator_ingestion_submitted",
        object_type: "creator_ingestion",
        object_id: submission.id,
        payload: {
          status: submission.status,
          risk_flags: riskFlags,
          proposal_ids: submission.proposal_ids,
          content_counts: creatorContentCounts(request)
        }
      });
      return envelope({ submission, proposals, risk_flags: riskFlags }, audit.id);
    },

    async listCreatorIngestions(creatorId: string): Promise<HandlerEnvelope<CreatorSubmissionRecord[]>> {
      await requireUser(store, creatorId);
      return envelope(await store.listCreatorSubmissions(creatorId));
    },

    async getCreatorIngestion(
      creatorId: string,
      submissionId: string
    ): Promise<HandlerEnvelope<CreatorSubmissionRecord>> {
      await requireUser(store, creatorId);
      const submission = await store.getCreatorSubmission(submissionId);
      if (!submission || submission.creator_id !== creatorId) {
        return notFound<CreatorSubmissionRecord>("creator_ingestion_not_found");
      }
      return envelope(submission);
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

    async getSocialDashboard(userId: string): Promise<HandlerEnvelope<SocialDashboardResponse>> {
      const dashboard = await buildSocialDashboardFor(store, userId);
      return envelope(dashboard);
    },

    async listBadges(userId: string): Promise<HandlerEnvelope<AwardedBadge[]>> {
      const evidence = await buildSocialEvidenceFor(store, userId);
      const badges = await refreshAwardedBadges(store, userId, evidence);
      return envelope(badges);
    },

    async listChallenges(userId: string): Promise<HandlerEnvelope<SocialChallenge[]>> {
      const evidence = await buildSocialEvidenceFor(store, userId);
      const evidenceByUser = new Map([[userId, evidence]]);
      const challenges = await Promise.all(
        (await store.listSocialChallenges(userId)).map((challenge) =>
          store.saveSocialChallenge(scoreChallenge(challenge as SocialChallenge, evidenceByUser))
        )
      );
      return envelope(challenges as SocialChallenge[]);
    },

    async createChallenge(input: unknown): Promise<HandlerEnvelope<SocialChallenge>> {
      const request = validateRequest(challengeCreateRequestSchema, input) as ChallengeCreateRequest;
      const creator = await requireUser(store, request.userId);
      const participantIds = Array.from(new Set([request.userId, ...request.participantIds]));
      const evidenceEntries: Array<[string, SocialEvidence]> = [];
      for (const participantId of participantIds) {
        const participant = await store.getUser(participantId);
        if (!participant) continue;
        evidenceEntries.push([participantId, await buildSocialEvidenceFor(store, participantId)]);
      }
      const challenge = createSocialChallenge({
        creator,
        title: request.title,
        challengeType: request.challengeType,
        participantIds,
        shareLevel: request.shareLevel,
        endsAt: request.endsAt,
        evidenceByUser: new Map(evidenceEntries)
      });
      const saved = await store.saveSocialChallenge(challenge);
      await store.appendLearningEvent({
        user_id: request.userId,
        event_type: "content_reviewed",
        payload: {
          action: "challenge_created",
          challenge_id: saved.id,
          challenge_type: saved.challenge_type,
          scoring_metric: saved.scoring_metric,
          raw_time_rewards_blocked: true
        }
      });
      const audit = await store.appendAuditEvent({
        actor_id: request.userId,
        action: "challenge_created",
        object_type: "social_challenge",
        object_id: saved.id,
        payload: {
          challenge_type: saved.challenge_type,
          participant_ids: saved.participant_ids,
          scoring_metric: saved.scoring_metric,
          anti_gaming_policy: saved.anti_gaming_policy
        }
      });
      return envelope(saved as SocialChallenge, audit.id);
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

async function buildSocialDashboardFor(
  store: MnemosyneStore,
  userId: string
): Promise<SocialDashboardResponse> {
  const evidence = await buildSocialEvidenceFor(store, userId);
  await refreshAwardedBadges(store, userId, evidence);
  const evidenceByUser = new Map([[userId, evidence]]);
  const challenges = await Promise.all(
    (await store.listSocialChallenges(userId)).map((challenge) =>
      store.saveSocialChallenge(scoreChallenge(challenge as SocialChallenge, evidenceByUser))
    )
  );
  return buildSocialDashboard({
    evidence,
    badgeTemplates: outcomeBadgeTemplates,
    challenges: challenges as SocialChallenge[]
  });
}

async function buildSocialEvidenceFor(store: MnemosyneStore, userId: string): Promise<SocialEvidence> {
  const user = await requireUser(store, userId);
  const [userGraph, events, proposals, submissions] = await Promise.all([
    store.getUserGraph(userId),
    store.listLearningEvents(userId),
    store.listProposals(),
    store.listCreatorSubmissions(userId)
  ]);
  return {
    user,
    states: userGraph.states,
    events,
    proposals,
    creatorSubmissionCount: submissions.length
  };
}

async function refreshAwardedBadges(
  store: MnemosyneStore,
  userId: string,
  evidence: SocialEvidence
): Promise<AwardedBadge[]> {
  const existing = new Map((await store.listAwardedBadges(userId)).map((badge) => [badge.badge_id, badge]));
  const earned = evaluateBadges({ userId, templates: outcomeBadgeTemplates, evidence });
  for (const badge of earned) {
    if (!existing.has(badge.badge_id)) await store.saveAwardedBadge(badge);
  }
  return earned;
}

async function wearableDashboardFor(
  store: MnemosyneStore,
  userId: string,
  readinessOverride?: ReadinessProfile
): Promise<WearableCapabilityDashboard> {
  const [connections, sessions, readiness] = await Promise.all([
    store.listWearableConnections(userId),
    store.listWearableSleepSessions(userId),
    readinessOverride ? Promise.resolve(readinessOverride) : store.getReadiness(userId)
  ]);
  const latestSleep = sessions.sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
  return buildWearableCapabilityDashboard({
    userId,
    device: deviceCapabilities(connections),
    connections,
    latestSleep,
    readiness: readiness ?? undefined
  });
}

function applyResponseToStates(
  states: UserConceptState[],
  response: AssessmentResponse,
  userId: string
): UserConceptState[] {
  const next = [...states];
  for (const update of response.graph_updates) {
    const conceptId = typeof update.concept_id === "string" ? update.concept_id : undefined;
    if (!conceptId) continue;
    const index = next.findIndex((state) => state.concept_id === conceptId);
    const current = index >= 0 ? next[index] : initialConceptState(userId, conceptId);
    const updated = applyAssessmentToUserState(current, response);
    if (index >= 0) next[index] = updated;
    else next.push(updated);
  }
  return next;
}

function initialConceptState(userId: string, conceptId: string): UserConceptState {
  const now = nowIso();
  return {
    user_id: userId,
    concept_id: conceptId,
    mastery: 0.08,
    recall_strength: 0.05,
    recall_stability: 0.04,
    transfer_score: 0.04,
    answer_latency_ms: null,
    confidence_calibration: 0.5,
    false_confidence_risk: 0.18,
    prerequisite_health: 0.5,
    failure_modes: [],
    misconception_ids: [],
    next_due_at: now,
    times_seen: 0,
    times_recalled: 0,
    times_failed: 0,
    hints_used: 0,
    sleep_replays: 0,
    cue_gain_estimate: 0,
    modality_response_profile: {},
    status: "unknown",
    updated_at: now
  };
}

function markWalkConfusion(
  states: UserConceptState[],
  prompts: AssessmentItem[],
  confusingPromptIds: Set<string>,
  updatedAt: string
): UserConceptState[] {
  if (confusingPromptIds.size === 0) return states;
  const conceptIds = new Set(
    prompts.filter((prompt) => confusingPromptIds.has(prompt.id)).flatMap((prompt) => prompt.concept_ids)
  );
  return states.map((state) =>
    conceptIds.has(state.concept_id)
      ? {
          ...state,
          failure_modes: Array.from(new Set([...state.failure_modes, "walk_marked_confusing"])).slice(-6),
          false_confidence_risk: clamp(state.false_confidence_risk + 0.04),
          updated_at: updatedAt
        }
      : state
  );
}

function morningForgeSummary(
  responses: AssessmentResponse[],
  request: MorningForgeCompleteRequest
): MorningForgeCompletionResponse["summary"] {
  return {
    answered: responses.length,
    average_correctness: average(responses.map((response) => response.correctness_score)),
    average_confidence: average(responses.map((response) => response.confidence_reported ?? 0.5)),
    screen_minutes: request.screenMinutes,
    voice_used: request.voiceUsed || request.responses.some((response) => response.entryMode === "voice")
  };
}

function walkModeSummary(
  responses: AssessmentResponse[],
  request: WalkModeCompleteRequest
): WalkModeCompletionResponse["summary"] {
  return {
    answered: responses.length,
    skipped: request.skippedPromptIds.length,
    marked_confusing: request.confusingPromptIds.length,
    average_correctness: average(responses.map((response) => response.correctness_score)),
    average_confidence: average(responses.map((response) => response.confidence_reported ?? 0.5)),
    voice_used: request.voiceUsed || request.responses.some((response) => response.entryMode === "voice"),
    text_used: request.responses.some((response) => response.entryMode === "text"),
    screen_locked: request.screenLocked,
    commands_processed: request.commandLog.length,
    transcript_retention: request.transcriptRetention,
    compatible_assessment_events: true
  };
}

function eveningLockInSummary(
  responses: AssessmentResponse[],
  request: EveningLockInCompleteRequest,
  boundCues: SleepCueTemplate[],
  audioPlan: AudioPlan
): EveningLockInCompletionResponse["summary"] {
  const responseInputs = [...request.recallResponses, ...request.transferResponses];
  return {
    recall_answered: request.recallResponses.length,
    transfer_answered: request.transferResponses.length,
    average_correctness: average(responses.map((response) => response.correctness_score)),
    average_confidence: average(responses.map((response) => response.confidence_reported ?? 0.5)),
    screen_minutes: request.screenMinutes,
    phone_down_ready: phoneDownReady(request.phoneDownChecklist),
    bound_cues: boundCues.length,
    voice_used: request.voiceUsed || responseInputs.some((response) => response.entryMode === "voice"),
    audio_plan_duration_seconds: audioPlan.duration_seconds
  };
}

function phoneDownReady(checklist: EveningLockInCompleteRequest["phoneDownChecklist"]): boolean {
  return (
    checklist.notificationsSilenced &&
    checklist.screenDimmingEnabled &&
    checklist.chargerReady &&
    checklist.alarmSet
  );
}

function resolveBoundCues(packet: DailyLearningPacket, requestedCueIds: string[]): SleepCueTemplate[] {
  const requested = new Set(requestedCueIds);
  const candidates = packet.evening.sleep_cue_binding_items;
  if (requested.size === 0) return candidates.slice(0, 4);
  const matched = candidates.filter((cue) => requested.has(cue.id));
  return matched.length > 0 ? matched : candidates.slice(0, 4);
}

function conceptIdsFromInputs(inputs: MorningForgeResponseInput[]): string[] {
  return uniqueStrings(inputs.flatMap((input) => input.item.concept_ids));
}

function conceptIdsFromResponses(responses: AssessmentResponse[]): string[] {
  return uniqueStrings(
    responses.flatMap((response) =>
      response.graph_updates.map((update) =>
        typeof update.concept_id === "string" ? update.concept_id : undefined
      )
    )
  );
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))
  );
}

function repairRecommendationsFor(responses: AssessmentResponse[]): string[] {
  const failures = new Set(responses.flatMap((response) => response.detected_failure_modes));
  const recommendations: string[] = [];
  if (failures.has("false_confidence") || failures.has("dangerous_misconception")) {
    recommendations.push("Run prerequisite repair before advancing the concept window.");
  }
  if (failures.has("missing_core_claim")) {
    recommendations.push("Schedule one worked example, then repeat cold retrieval.");
  }
  if (failures.has("slow_fragile_recall")) {
    recommendations.push("Repeat the prompt tomorrow with a lower latency target.");
  }
  if (failures.has("hint_dependent")) {
    recommendations.push("Remove hints on the next attempt and require a complete recall pass.");
  }
  if (failures.has("shallow_transfer")) {
    recommendations.push("Add a transfer drill in a different context before marking stable.");
  }
  return recommendations.length > 0
    ? recommendations
    : ["Advance one frontier item and keep normal review cadence."];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

function buildGoal(userId: string, request: GoalDraftRequest): Goal {
  const now = nowIso();
  return {
    id: createId("goal", `${userId}:${request.title}`),
    user_id: userId,
    title: request.title,
    description: request.description,
    goal_type: request.goalType,
    target_concept_ids: request.targetConceptIds,
    target_domain_ids: request.targetDomainIds,
    priority: request.priority,
    deadline: request.deadline,
    intensity: request.intensity,
    desired_modalities: request.desiredModalities,
    avoid_modalities: request.avoidModalities,
    created_at: now,
    updated_at: now
  };
}

function readinessFromOnboarding(request: CompleteOnboardingRequest): ReadinessProfile {
  return {
    sleep_quality: 0.62,
    fatigue: 0.32,
    stress: 0.34,
    available_minutes_morning: request.preferences.morningMinutes,
    available_minutes_evening: request.preferences.eveningMinutes,
    screen_budget_minutes: request.preferences.voiceFirst ? 28 : 42,
    voice_ok: request.preferences.voiceFirst,
    dusk_mode: request.preferences.duskQuiet,
    notes: "Initialized during onboarding."
  };
}

function buildBaselineStates(userId: string, goal: Goal, masterGraph: MasterGraph): UserConceptState[] {
  const targetIds = new Set(goal.target_concept_ids);
  for (const concept of masterGraph.concepts) {
    if (goal.target_domain_ids.includes(concept.domain)) targetIds.add(concept.id);
  }
  const conceptIds =
    targetIds.size > 0 ? [...targetIds] : masterGraph.concepts.slice(0, 6).map((item) => item.id);
  for (const conceptId of [...conceptIds]) {
    const concept = masterGraph.concepts.find((candidate) => candidate.id === conceptId);
    for (const edge of concept?.prerequisites ?? []) targetIds.add(edge.from_id);
  }
  const orderedIds = [...new Set([...conceptIds, ...targetIds])].slice(0, 24);
  return orderedIds.flatMap((conceptId) => {
    const concept = masterGraph.concepts.find((candidate) => candidate.id === conceptId);
    const isDirectTarget =
      concept &&
      (goal.target_concept_ids.includes(concept.id) || goal.target_domain_ids.includes(concept.domain));
    return concept ? [baselineState(userId, concept, Boolean(isDirectTarget))] : [];
  });
}

function baselineState(userId: string, concept: ConceptNode, isDirectTarget: boolean): UserConceptState {
  const mastery = isDirectTarget ? 0.18 : 0.1;
  const now = nowIso();
  return {
    user_id: userId,
    concept_id: concept.id,
    mastery,
    recall_strength: mastery * 0.72,
    recall_stability: mastery * 0.58,
    transfer_score: mastery * 0.52,
    answer_latency_ms: null,
    confidence_calibration: 0.5,
    false_confidence_risk: 0.18,
    prerequisite_health: concept.prerequisites.length === 0 ? 0.72 : 0.38,
    failure_modes: ["baseline_unmeasured"],
    misconception_ids: [],
    next_due_at: now,
    times_seen: 0,
    times_recalled: 0,
    times_failed: 0,
    hints_used: 0,
    sleep_replays: 0,
    cue_gain_estimate: 0,
    modality_response_profile: {},
    status: "previewed",
    updated_at: now
  };
}

function buildBaselineDiagnostics(
  states: UserConceptState[],
  masterGraph: MasterGraph,
  limit: number
): AssessmentItem[] {
  return states
    .map((state) => masterGraph.concepts.find((concept) => concept.id === state.concept_id))
    .filter((concept): concept is ConceptNode => Boolean(concept))
    .sort((left, right) => right.importance - left.importance || left.difficulty - right.difficulty)
    .slice(0, limit)
    .map((concept, index) =>
      generateAssessmentForConcept(concept, index % 3 === 2 ? "transfer" : "free_recall")
    );
}

async function generateAndPersistDailyPacket(
  store: MnemosyneStore,
  userId: string,
  readiness: ReadinessProfile,
  source = "manual"
) {
  const user = await requireUser(store, userId);
  const [userGraph, masterGraph, goals] = await Promise.all([
    store.getUserGraph(userId),
    store.getMasterGraph(),
    store.listGoals(userId)
  ]);
  const profile = (await store.getPersonalizationProfile(userId)) as PersonalizationProfile | undefined;
  const constraints = personalizeSessionConstraints(readiness, profile);
  const scheduled = buildDailyLearningPacket({
    user,
    userGraph,
    masterGraph,
    goals,
    readiness,
    constraints
  });

  await store.saveDailyPacket(scheduled.packet);
  await store.saveAudioPlan(scheduled.audioPlan);
  const learningEvent = await store.appendLearningEvent({
    user_id: user.id,
    event_type: "session_started",
    payload: {
      daily_packet_id: scheduled.packet.id,
      date: scheduled.packet.date,
      generated: true,
      source,
      scheduler_adjustments: profile?.scheduler_adjustments
    }
  });
  const audit = await store.appendAuditEvent({
    actor_id: user.id,
    action: "daily_packet_generated",
    object_type: "daily_packet",
    object_id: scheduled.packet.id,
    payload: {
      ...packetSummary(scheduled.packet),
      source,
      personalized_constraints: constraints,
      personalization_profile_generated_at: profile?.generated_at
    }
  });

  return { ...scheduled, summary: packetSummary(scheduled.packet), learningEvent, audit };
}

async function buildExperimentDashboard(
  store: MnemosyneStore,
  userId: string,
  maxPairsPerExperiment?: number
): Promise<ExperimentDashboardResponse> {
  await requireUser(store, userId);
  const experiments = await ensureDefaultExperiments(store);
  const [userGraph, responses, events, packet, existingAssignments] = await Promise.all([
    store.getUserGraph(userId),
    store.listAssessmentResponses(userId),
    store.listLearningEvents(userId),
    store.getDailyPacket(userId),
    store.listExperimentAssignments(userId)
  ]);
  const assignments = assignExperiments({
    userId,
    states: userGraph.states,
    experiments,
    sleepPacket: packet?.sleep,
    existingAssignments: existingAssignments as ExperimentAssignment[],
    maxPairsPerExperiment
  });
  for (const assignment of assignments) await store.saveExperimentAssignment(assignment);
  const rollups = rollupExperimentOutcomes({
    experiments,
    assignments,
    responses,
    events,
    states: userGraph.states
  });
  const profile = buildPersonalizationProfile({
    userId,
    experiments,
    assignments,
    responses,
    events,
    states: userGraph.states,
    rollups
  });
  await store.savePersonalizationProfile(profile);
  return { experiments, assignments, rollups, profile };
}

async function ensureDefaultExperiments(store: MnemosyneStore): Promise<Experiment[]> {
  const existing = await store.listExperiments();
  const byId = new Map(existing.map((experiment) => [experiment.id, experiment]));
  for (const experiment of createDefaultExperimentSuite()) {
    if (!byId.has(experiment.id)) {
      const saved = await store.saveExperiment(experiment);
      byId.set(saved.id, saved);
    }
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
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

function invalidRequest<T = never>(code: string): HandlerEnvelope<T> {
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

function mergeSourceRefs(source: SourceRef | undefined, evidence: SourceRef[]): SourceRef[] {
  const refs = normalizeSourceRefs([...(source ? [source] : []), ...evidence]);
  return [...new Map(refs.map((ref) => [ref.id, ref])).values()];
}

type CreatorProposalDraft = {
  proposalType: Proposal["proposal_type"];
  affectedObjectIds: string[];
  diff: Record<string, unknown>;
  rationale: string;
};

function buildCreatorProposalDrafts(
  request: CreatorIngestionRequest,
  submissionId: string
): CreatorProposalDraft[] {
  const drafts: CreatorProposalDraft[] = [];
  const base = {
    creator_ingestion_id: submissionId,
    title: request.title,
    license: request.license
  };
  if (request.draft.concepts.length > 0) {
    drafts.push({
      proposalType: "add_concept",
      affectedObjectIds: request.draft.concepts.map((concept) => concept.id),
      diff: { ...base, add_concepts: request.draft.concepts },
      rationale: creatorRationale(
        request,
        `Creator submitted ${request.draft.concepts.length} concept node(s) for graph review.`
      )
    });
  }
  if (request.draft.videos.length > 0) {
    drafts.push({
      proposalType: "add_video",
      affectedObjectIds: request.draft.videos.map((video) => video.id),
      diff: { ...base, add_videos: request.draft.videos },
      rationale: creatorRationale(
        request,
        `Creator submitted ${request.draft.videos.length} video asset(s) for learning outcome review.`
      )
    });
  }
  if (request.draft.assessments.length > 0) {
    drafts.push({
      proposalType: "add_assessment",
      affectedObjectIds: request.draft.assessments.map((assessment) => assessment.id),
      diff: { ...base, add_assessments: request.draft.assessments },
      rationale: creatorRationale(
        request,
        `Creator submitted ${request.draft.assessments.length} assessment item(s) for calibration review.`
      )
    });
  }
  if (request.draft.sleepCues.length > 0) {
    drafts.push({
      proposalType: "modify_sleep_cue",
      affectedObjectIds: request.draft.sleepCues.map((cue) => cue.id),
      diff: { ...base, add_sleep_cues: request.draft.sleepCues },
      rationale: creatorRationale(
        request,
        `Creator submitted ${request.draft.sleepCues.length} sleep cue(s) requiring safety review.`
      )
    });
  }
  if (request.draft.flashreadAssets.length > 0) {
    drafts.push({
      proposalType: "change_learning_path",
      affectedObjectIds: Array.from(
        new Set(request.draft.flashreadAssets.flatMap((asset) => asset.concept_ids))
      ),
      diff: { ...base, add_flashread_assets: request.draft.flashreadAssets },
      rationale: creatorRationale(
        request,
        `Creator submitted ${request.draft.flashreadAssets.length} FlashRead asset(s) for path review.`
      )
    });
  }
  return drafts;
}

function triageCreatorDraft(request: CreatorIngestionRequest, evidence: SourceRef[]): string[] {
  const flags = new Set<string>();
  if (evidence.length === 0) flags.add("missing_supporting_evidence");
  if (evidence.length > 0 && averageSourceQuality(evidence) < 0.55) flags.add("weak_evidence_quality");
  if (request.license.toLowerCase().includes("unknown")) flags.add("unclear_license");

  for (const video of request.draft.videos) {
    if (!video.transcript_id) flags.add(`missing_transcript:${video.id}`);
    if (video.misinformation_risk >= 0.5) flags.add(`high_misinformation_risk:${video.id}`);
    if (video.source_quality_score < 0.45) flags.add(`low_source_quality:${video.id}`);
    if (video.duration_seconds > 5_400) flags.add(`long_video_needs_chapter_review:${video.id}`);
  }
  for (const cue of request.draft.sleepCues) {
    if (cue.sleep_safety_score < 0.65) flags.add(`sleep_safety_review:${cue.id}`);
    if (cue.emotional_activation_score > 0.45) flags.add(`sleep_emotional_activation:${cue.id}`);
  }
  for (const concept of request.draft.concepts) {
    if (concept.definitions.length === 0) flags.add(`missing_definition:${concept.id}`);
    if (concept.assessments.length === 0) flags.add(`missing_assessment:${concept.id}`);
  }
  return [...flags];
}

function riskLevelForCreatorSubmission(riskFlags: string[]): Proposal["risk_level"] {
  if (
    riskFlags.some(
      (flag) =>
        flag.startsWith("high_misinformation_risk") ||
        flag.startsWith("sleep_safety_review") ||
        flag.startsWith("sleep_emotional_activation") ||
        flag === "unclear_license"
    )
  ) {
    return "high";
  }
  return riskFlags.length > 0 ? "medium" : "low";
}

function statusForCreatorSubmission(riskFlags: string[], proposalCount: number): CreatorSubmissionStatus {
  if (proposalCount === 0) return "rejected";
  if (riskFlags.includes("missing_supporting_evidence")) return "needs_evidence";
  if (riskFlags.length > 0) return "queued_for_review";
  return "proposal_created";
}

function buildGraphReleaseArtifact(
  proposal: Proposal,
  releasedBy: string,
  graphVersion: string,
  releasedAt: string,
  notes?: string
): GraphReleaseArtifact {
  const releaseNotes =
    notes ??
    `Released ${proposal.proposal_type.replaceAll("_", " ")} for ${proposal.affected_object_ids.join(", ")}.`;
  return {
    id: createId("graph_release", `${proposal.id}:${graphVersion}`),
    graph_version: graphVersion,
    proposal_id: proposal.id,
    released_by: releasedBy,
    affected_object_ids: proposal.affected_object_ids,
    release_notes: releaseNotes,
    diff: proposal.diff,
    created_at: releasedAt
  };
}

async function applyProposalToMasterGraph(
  store: MnemosyneStore,
  proposal: Proposal,
  graphVersion: string,
  releasedAt: string
): Promise<void> {
  if (proposal.proposal_type !== "modify_definition") return;
  const after = typeof proposal.diff.after === "string" ? proposal.diff.after : undefined;
  if (!after) return;
  const masterGraph = await store.getMasterGraph();
  const affectedIds = new Set(proposal.affected_object_ids);
  const updatedConcepts = masterGraph.concepts.map((concept) => {
    if (!affectedIds.has(concept.id)) return concept;
    const [primaryDefinition = {}, ...restDefinitions] = concept.definitions;
    return {
      ...concept,
      definitions: [
        {
          ...primaryDefinition,
          text: after,
          source: "content_court_release",
          proposal_id: proposal.id
        },
        ...restDefinitions
      ],
      status: "active" as const,
      updated_at: releasedAt,
      version: graphVersion
    };
  });
  await store.saveMasterGraph({ ...masterGraph, concepts: updatedConcepts });
}

function creatorRationale(request: CreatorIngestionRequest, summary: string): string {
  return request.notes ? `${summary} Creator notes: ${request.notes}` : summary;
}

function creatorContentCounts(request: CreatorIngestionRequest) {
  return {
    concepts: request.draft.concepts.length,
    videos: request.draft.videos.length,
    assessments: request.draft.assessments.length,
    sleep_cues: request.draft.sleepCues.length,
    flashread_assets: request.draft.flashreadAssets.length
  };
}

function averageSourceQuality(sources: SourceRef[]): number {
  return sources.reduce((sum, source) => sum + source.quality_score, 0) / sources.length;
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

function conceptIdsForSleepBucket(packet: SleepCuePacket, bucket: SleepCueBucket): string[] {
  if (bucket === "reactivate") return packet.reactivate_concept_ids;
  if (bucket === "stabilize") return packet.stabilize_concept_ids;
  if (bucket === "prime") return packet.prime_concept_ids;
  return packet.control_concept_ids;
}

function sleepCuedConceptIds(packet: SleepCuePacket): string[] {
  return uniqueStrings([
    ...packet.reactivate_concept_ids,
    ...packet.stabilize_concept_ids,
    ...packet.prime_concept_ids
  ]);
}

function sleepPlaybackSummary(packet: SleepCuePacket, request: SleepPlaybackEventRequest) {
  const bucketCounts = {
    reactivate: request.cueEvents.filter((event) => event.bucket === "reactivate").length,
    stabilize: request.cueEvents.filter((event) => event.bucket === "stabilize").length,
    prime: request.cueEvents.filter((event) => event.bucket === "prime").length,
    control: request.cueEvents.filter((event) => event.bucket === "control").length
  };
  return {
    sleep_packet_id: packet.id,
    night_date: packet.night_date,
    cues_played: request.cueEvents.length,
    completed_cues: request.cueEvents.filter((event) => event.completed).length,
    skipped_cues: request.cueEvents.filter((event) => !event.completed).length,
    stop_condition: request.stopCondition,
    sleep_disruption_reported: request.sleepDisruptionReported,
    playback_minutes: playbackMinutes(request.playbackStartedAt, request.playbackEndedAt),
    ...bucketCounts
  };
}

function sleepCueRecallSummary(
  cuedResponses: AssessmentResponse[],
  controlResponses: AssessmentResponse[],
  request: SleepRecallCompleteRequest,
  packet: SleepCuePacket
) {
  const averageCuedCorrectness = average(cuedResponses.map((response) => response.correctness_score));
  const averageControlCorrectness = average(controlResponses.map((response) => response.correctness_score));
  return {
    sleep_packet_id: packet.id,
    night_date: packet.night_date,
    cued_answered: cuedResponses.length,
    control_answered: controlResponses.length,
    average_cued_correctness: averageCuedCorrectness,
    average_control_correctness: averageControlCorrectness,
    cue_gain_delta: Number((averageCuedCorrectness - averageControlCorrectness).toFixed(3)),
    cued_concept_ids: conceptIdsFromResponses(cuedResponses),
    control_concept_ids: conceptIdsFromResponses(controlResponses),
    controls_revealed: true,
    screen_minutes: request.screenMinutes,
    voice_used:
      request.voiceUsed ||
      [...request.cuedResponses, ...request.controlResponses].some(
        (response) => response.entryMode === "voice"
      )
  };
}

function applySleepCueGainToStates(
  states: UserConceptState[],
  summary: ReturnType<typeof sleepCueRecallSummary>,
  updatedAt: string
): UserConceptState[] {
  const cuedConceptIds = new Set(summary.cued_concept_ids);
  return states.map((state) => {
    if (!cuedConceptIds.has(state.concept_id)) return state;
    return {
      ...state,
      sleep_replays: state.sleep_replays + 1,
      cue_gain_estimate: clamp(state.cue_gain_estimate * 0.72 + summary.cue_gain_delta * 0.28, -1, 1),
      best_cue_type: summary.cue_gain_delta > 0 ? "sleep_reactivation" : state.best_cue_type,
      updated_at: updatedAt
    };
  });
}

function playbackMinutes(startedAt: string | undefined, endedAt: string | undefined): number {
  if (!startedAt || !endedAt) return 0;
  const started = Date.parse(startedAt);
  const ended = Date.parse(endedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended <= started) return 0;
  return Number(((ended - started) / 60_000).toFixed(1));
}

function allFlashReadAssets(masterGraph: MasterGraph): FlashReadAsset[] {
  return [
    ...masterGraph.flashReads,
    ...masterGraph.concepts.flatMap((concept) => concept.flashread_assets)
  ].filter((asset, index, assets) => assets.findIndex((candidate) => candidate.id === asset.id) === index);
}

function selectFlashReadAsset(
  masterGraph: MasterGraph,
  request: FlashReadGenerateRequest,
  planningConceptIds: string[]
): FlashReadAsset | undefined {
  const assets = allFlashReadAssets(masterGraph);
  if (request.assetId) return assets.find((asset) => asset.id === request.assetId);
  const requestedConceptIds = new Set(request.conceptIds);
  const planningIds = new Set(planningConceptIds);
  const candidates =
    request.conceptIds.length > 0
      ? assets.filter((asset) => asset.concept_ids.some((conceptId) => requestedConceptIds.has(conceptId)))
      : assets;
  return candidates
    .map((asset) => ({
      asset,
      score:
        asset.concept_ids.filter((conceptId) => requestedConceptIds.has(conceptId)).length * 3 +
        asset.concept_ids.filter((conceptId) => planningIds.has(conceptId)).length * 1.5 +
        (asset.mode === "review" ? 0.4 : 0) -
        asset.cognitive_load_score
    }))
    .sort((left, right) => right.score - left.score)[0]?.asset;
}

function flashReadPlanSummary(asset: FlashReadAsset, plan: FlashReadSessionPlan) {
  return {
    flashread_asset_id: asset.id,
    flashread_session_id: plan.id,
    concept_ids: asset.concept_ids,
    chunks: plan.chunks.length,
    display_unit: plan.display_unit,
    raw_wpm: plan.raw_wpm,
    estimated_effective_wpm: plan.estimated_effective_wpm,
    comprehension_gate: plan.comprehension_gate,
    cognitive_load_score: asset.cognitive_load_score
  };
}

function flashReadCompletionSummary(
  asset: FlashReadAsset,
  request: FlashReadCompleteRequest,
  result: ReturnType<typeof scoreFlashReadCompletion>
) {
  return {
    flashread_asset_id: asset.id,
    flashread_session_id: request.flashReadSessionId,
    concept_ids: asset.concept_ids,
    raw_wpm: request.rawWpm,
    effective_wpm: result.effectiveWpm,
    comprehension_score: request.comprehensionScore,
    retention_score: request.retentionScore,
    strain_rating: request.strainRating,
    screen_load_score: result.screenLoadScore,
    advance_allowed: result.advanceAllowed,
    screen_minutes: request.screenMinutes
  };
}

function applyWatchPacketRecallToStates(
  states: UserConceptState[],
  videos: VideoAsset[],
  screenMinutes: number,
  updatedAt: string,
  userId: string
): UserConceptState[] {
  const conceptIds = unique(videos.flatMap((video) => video.concept_ids));
  const averageRetentionLift = avg(videos.map((video) => video.retention_lift_score));
  const averageTransferLift = avg(videos.map((video) => video.transfer_lift_score));
  const averageScreenEfficiency = avg(videos.map((video) => video.screen_efficiency_score));
  const screenLoad = clamp(screenMinutes / 60);
  const next = [...states];
  for (const conceptId of conceptIds) {
    const index = next.findIndex((state) => state.concept_id === conceptId);
    const state = index >= 0 ? next[index] : initialConceptState(userId, conceptId);
    const failures = new Set(state.failure_modes.filter((mode) => mode !== "none"));
    failures.delete("video_recall_missing");
    const updated: UserConceptState = {
      ...state,
      mastery: clamp(state.mastery + 0.025 + averageRetentionLift * 0.03),
      recall_strength: clamp(state.recall_strength + 0.035 + averageRetentionLift * 0.025),
      recall_stability: clamp(state.recall_stability + averageRetentionLift * 0.018),
      transfer_score: clamp(state.transfer_score + averageTransferLift * 0.025),
      failure_modes: failures.size > 0 ? Array.from(failures).slice(-6) : ["none"],
      last_seen_at: updatedAt,
      last_correct_at: updatedAt,
      times_seen: state.times_seen + 1,
      times_recalled: state.times_recalled + 1,
      modality_response_profile: {
        ...state.modality_response_profile,
        video_recall_gate_passed: true,
        video_screen_minutes: screenMinutes,
        video_screen_load: screenLoad,
        video_screen_efficiency: averageScreenEfficiency
      },
      status: videoStatusFor(state),
      updated_at: updatedAt
    };
    if (index >= 0) next[index] = updated;
    else next.push(updated);
  }
  return next;
}

function videoStatusFor(state: UserConceptState): UserConceptState["status"] {
  const strength = state.mastery * 0.5 + state.recall_strength * 0.3 + state.transfer_score * 0.2;
  if (strength >= 0.78) return "fluent";
  if (strength >= 0.62) return "known";
  if (strength >= 0.42) return "learning";
  return "fragile";
}

function avg(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function applyFlashReadCompletionToStates(
  states: UserConceptState[],
  asset: FlashReadAsset,
  result: ReturnType<typeof scoreFlashReadCompletion>,
  updatedAt: string,
  userId: string
): UserConceptState[] {
  const conceptIds = new Set(asset.concept_ids);
  const next = [...states];
  for (const conceptId of conceptIds) {
    const index = next.findIndex((state) => state.concept_id === conceptId);
    const state = index >= 0 ? next[index] : initialConceptState(userId, conceptId);
    const masteryDelta = result.advanceAllowed ? 0.045 : -0.015;
    const recallDelta = result.advanceAllowed ? 0.05 : 0.005;
    const strainFailure = result.screenLoadScore > 0.58 ? ["flashread_strain"] : [];
    const gateFailure = result.advanceAllowed ? [] : ["comprehension_gate_missed"];
    const updated: UserConceptState = {
      ...state,
      mastery: clamp(state.mastery + masteryDelta),
      recall_strength: clamp(state.recall_strength + recallDelta),
      recall_stability: clamp(state.recall_stability + (result.advanceAllowed ? 0.025 : 0)),
      failure_modes: Array.from(new Set([...state.failure_modes, ...strainFailure, ...gateFailure])).slice(
        -6
      ),
      last_seen_at: updatedAt,
      times_seen: state.times_seen + 1,
      times_recalled: result.advanceAllowed ? state.times_recalled + 1 : state.times_recalled,
      times_failed: result.advanceAllowed ? state.times_failed : state.times_failed + 1,
      modality_response_profile: {
        ...state.modality_response_profile,
        flashread_effective_wpm: result.effectiveWpm,
        flashread_screen_load: result.screenLoadScore
      },
      updated_at: updatedAt
    };
    if (index >= 0) next[index] = updated;
    else next.push(updated);
  }
  return next;
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

function deviceCapabilities(connections: WearableConnection[] = []): DeviceCapabilityProfile {
  const ouraConnected = connections.some(
    (connection) => connection.provider === "oura" && connection.status === "connected"
  );
  return {
    platform: "desktop",
    pwa_installed: false,
    web_push_supported: true,
    background_audio_supported: true,
    microphone_supported: true,
    notifications_permission: "prompt",
    healthkit_available: false,
    health_connect_available: false,
    oura_connected: ouraConnected,
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
