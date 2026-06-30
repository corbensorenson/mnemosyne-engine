import {
  assessmentItemSchema,
  conceptNodeSchema,
  deviceCapabilityProfileSchema,
  flashReadAssetSchema,
  modalitySchema,
  readinessProfileSchema,
  sleepCueTemplateSchema,
  sourceRefSchema,
  videoAssetSchema,
  type Goal,
  type LearningEvent,
  type Proposal
} from "@mnemosyne/schema";
import { z } from "zod";

const userIdSchema = z.string().min(1);

const learningEventTypeSchema = z.enum([
  "session_started",
  "concept_seen",
  "assessment_answered",
  "cue_bound",
  "sleep_cue_played",
  "video_watched",
  "flashread_completed",
  "walk_recall_completed",
  "graph_updated",
  "proposal_submitted",
  "content_reviewed"
] satisfies [LearningEvent["event_type"], ...LearningEvent["event_type"][]]);

export const generateDailyPacketRequestSchema = z
  .object({
    userId: userIdSchema,
    readiness: readinessProfileSchema.optional()
  })
  .strict();

const goalDraftSchema = z.object({
  title: z.string().min(3),
  description: z.string().min(8),
  goalType: z.enum([
    "trip",
    "exam",
    "career",
    "project",
    "curiosity",
    "skill",
    "certification",
    "custom"
  ] satisfies [Goal["goal_type"], ...Goal["goal_type"][]]),
  targetConceptIds: z.array(z.string().min(1)).default([]),
  targetDomainIds: z.array(z.string().min(1)).default([]),
  priority: z.number().min(0).max(1).default(0.8),
  deadline: z.string().optional(),
  intensity: z.enum(["maintenance", "normal", "sprint", "elite"]).default("normal"),
  desiredModalities: z.array(modalitySchema).default(["text", "voice"]),
  avoidModalities: z.array(modalitySchema).default([])
});

export const createGoalRequestSchema = goalDraftSchema
  .extend({
    userId: userIdSchema
  })
  .strict();

export const updatePreferencesRequestSchema = z
  .object({
    userId: userIdSchema,
    privacySettings: z.record(z.unknown()).optional(),
    socialSettings: z.record(z.unknown()).optional(),
    notificationSettings: z.record(z.unknown()).optional(),
    defaultSessionPreferences: z.record(z.unknown()).optional(),
    accessibilityPreferences: z.record(z.unknown()).optional(),
    modalityPreferences: z.record(z.unknown()).optional()
  })
  .strict();

export const completeOnboardingRequestSchema = z
  .object({
    userId: z.string().min(1).optional(),
    displayName: z.string().min(1),
    handle: z
      .string()
      .min(2)
      .max(32)
      .regex(/^[a-zA-Z0-9_]+$/),
    timezone: z.string().min(1),
    goal: goalDraftSchema,
    packIds: z.array(z.string().min(1)).default([]),
    readiness: readinessProfileSchema.optional(),
    deviceCapabilities: deviceCapabilityProfileSchema.optional(),
    privacy: z
      .object({
        privateDefault: z.boolean().default(true),
        shareLevel: z.enum(["private", "badges_only", "friends", "public"]).default("private"),
        productAnalyticsConsent: z.boolean().default(false),
        researchConsent: z.boolean().default(false),
        voiceRetention: z.enum(["none", "transcript_only", "audio_until_processed"]).default("none"),
        healthDataRetention: z.enum(["none", "derived_only", "raw_until_processed"]).default("none")
      })
      .default({}),
    preferences: z
      .object({
        morningMinutes: z.number().int().positive().max(180).default(30),
        eveningMinutes: z.number().int().positive().max(180).default(30),
        voiceFirst: z.boolean().default(true),
        walking: z.boolean().default(true),
        flashread: z.boolean().default(true),
        highContrast: z.boolean().default(false),
        reducedMotion: z.boolean().default(false),
        duskQuiet: z.boolean().default(true),
        morningPrompt: z.boolean().default(true)
      })
      .default({}),
    baselineDiagnosticLimit: z.number().int().positive().max(12).default(6)
  })
  .strict();

export const startSessionRequestSchema = z
  .object({
    userId: userIdSchema,
    dailyPacketId: z.string().min(1),
    sessionType: z.enum(["morning_forge", "graphfeed", "walk_mode", "evening_lock_in", "sleep", "flashread"])
  })
  .strict();

export const sessionEventRequestSchema = z
  .object({
    userId: userIdSchema,
    sessionId: z.string().min(1),
    eventType: learningEventTypeSchema,
    payload: z.record(z.unknown())
  })
  .strict();

export const assessmentSubmitRequestSchema = z
  .object({
    userId: userIdSchema,
    item: assessmentItemSchema,
    rawResponse: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
    latencyMs: z.number().int().nonnegative(),
    hintCount: z.number().int().nonnegative().optional(),
    retries: z.number().int().nonnegative().optional()
  })
  .strict();

const sessionAssessmentResponseSchema = z
  .object({
    item: assessmentItemSchema,
    rawResponse: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
    latencyMs: z.number().int().nonnegative(),
    hintCount: z.number().int().nonnegative().optional(),
    retries: z.number().int().nonnegative().optional(),
    entryMode: z.enum(["text", "voice"]).default("text"),
    transcript: z.string().optional()
  })
  .strict();

export const morningForgeCompleteRequestSchema = z
  .object({
    userId: userIdSchema,
    dailyPacketId: z.string().min(1),
    packetDate: z.string().optional(),
    sessionId: z.string().min(1).optional(),
    responses: z.array(sessionAssessmentResponseSchema).min(1).max(12),
    screenMinutes: z.number().nonnegative().default(0),
    voiceUsed: z.boolean().default(false),
    completedAt: z.string().optional()
  })
  .strict();

export const eveningLockInCompleteRequestSchema = z
  .object({
    userId: userIdSchema,
    dailyPacketId: z.string().min(1),
    packetDate: z.string().optional(),
    sessionId: z.string().min(1).optional(),
    recallResponses: z.array(sessionAssessmentResponseSchema).max(12).default([]),
    transferResponses: z.array(sessionAssessmentResponseSchema).max(12).default([]),
    boundCueIds: z.array(z.string().min(1)).default([]),
    phoneDownChecklist: z
      .object({
        notificationsSilenced: z.boolean().default(true),
        screenDimmingEnabled: z.boolean().default(true),
        chargerReady: z.boolean().default(true),
        alarmSet: z.boolean().default(true)
      })
      .strict()
      .default({}),
    screenMinutes: z.number().nonnegative().default(0),
    voiceUsed: z.boolean().default(false),
    completedAt: z.string().optional()
  })
  .strict();

export const videoRecommendationRequestSchema = z
  .object({
    userId: userIdSchema,
    limit: z.number().int().positive().max(20).default(8)
  })
  .strict();

export const watchPacketRequestSchema = z
  .object({
    userId: userIdSchema,
    timeBudgetMinutes: z.number().int().positive().max(120),
    purpose: z.enum(["relax", "review", "deepen", "preview", "boss_prep", "rabbit_hole"]).optional()
  })
  .strict();

export const completeWatchPacketRequestSchema = z
  .object({
    userId: userIdSchema,
    watchPacketId: z.string().min(1),
    videoIds: z.array(z.string().min(1)).min(1),
    recallPassed: z.boolean(),
    screenMinutes: z.number().nonnegative()
  })
  .strict();

const flashReadDisplayUnitSchema = z.enum(["word", "phrase", "clause", "concept"]);

export const flashReadGenerateRequestSchema = z
  .object({
    userId: userIdSchema,
    assetId: z.string().min(1).optional(),
    conceptIds: z.array(z.string().min(1)).default([]),
    displayUnit: flashReadDisplayUnitSchema.default("phrase"),
    requestedWpm: z.number().int().min(120).max(1200).optional()
  })
  .strict();

export const flashReadCompleteRequestSchema = z
  .object({
    userId: userIdSchema,
    sessionId: z.string().min(1).optional(),
    flashReadSessionId: z.string().min(1),
    assetId: z.string().min(1),
    rawWpm: z.number().int().min(120).max(1200),
    comprehensionScore: z.number().min(0).max(1),
    retentionScore: z.number().min(0).max(1),
    strainRating: z.number().min(0).max(1),
    screenMinutes: z.number().nonnegative().default(0),
    completedAt: z.string().optional()
  })
  .strict();

export const walkModeCompleteRequestSchema = z
  .object({
    userId: userIdSchema,
    dailyPacketId: z.string().min(1),
    packetDate: z.string().optional(),
    sessionId: z.string().min(1).optional(),
    walkPacketId: z.string().min(1),
    responses: z.array(sessionAssessmentResponseSchema).min(1).max(16),
    skippedPromptIds: z.array(z.string().min(1)).default([]),
    confusingPromptIds: z.array(z.string().min(1)).default([]),
    commandLog: z.array(z.string().min(1)).max(64).default([]),
    screenLocked: z.boolean().default(true),
    voiceUsed: z.boolean().default(false),
    transcriptRetention: z.enum(["deleted", "transcript_only", "retained"]).default("deleted"),
    completedAt: z.string().optional()
  })
  .strict();

export const sleepPacketRequestSchema = z
  .object({
    userId: userIdSchema,
    readiness: readinessProfileSchema.optional(),
    conservative: z.boolean().optional()
  })
  .strict();

export const renderSleepAudioRequestSchema = z
  .object({
    userId: userIdSchema,
    audioPlanId: z.string().min(1),
    outputFormat: z.enum(["m4a", "mp3", "wav"]).default("m4a")
  })
  .strict();

const sleepCueBucketSchema = z.enum(["reactivate", "stabilize", "prime", "control"]);
const sleepStopConditionSchema = z.enum([
  "none",
  "movement_detected",
  "user_wake_report",
  "wearable_wake_signal",
  "time_limit",
  "manual_stop"
]);

export const sleepPlaybackEventRequestSchema = z
  .object({
    userId: userIdSchema,
    sleepPacketId: z.string().min(1),
    nightDate: z.string().optional(),
    audioPlanId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    playbackStartedAt: z.string().optional(),
    playbackEndedAt: z.string().optional(),
    cueEvents: z
      .array(
        z
          .object({
            cueId: z.string().min(1).optional(),
            conceptId: z.string().min(1),
            bucket: sleepCueBucketSchema,
            playedAt: z.string().optional(),
            volume: z.number().min(0).max(1).optional(),
            completed: z.boolean().default(true),
            wearableStage: z.string().optional()
          })
          .strict()
      )
      .min(1)
      .max(160),
    stopCondition: sleepStopConditionSchema.default("none"),
    sleepDisruptionReported: z.boolean().default(false)
  })
  .strict();

export const sleepRecallCompleteRequestSchema = z
  .object({
    userId: userIdSchema,
    sleepPacketId: z.string().min(1),
    nightDate: z.string().optional(),
    sessionId: z.string().min(1).optional(),
    cuedResponses: z.array(sessionAssessmentResponseSchema).min(1).max(24),
    controlResponses: z.array(sessionAssessmentResponseSchema).min(1).max(24),
    screenMinutes: z.number().nonnegative().default(0),
    voiceUsed: z.boolean().default(false),
    completedAt: z.string().optional()
  })
  .strict();

export const wearableSyncRequestSchema = z
  .object({
    userId: userIdSchema,
    provider: z.enum(["oura", "healthkit", "health_connect", "manual"]),
    sleepSession: z
      .object({
        sleep_quality: z.number().min(0).max(1).optional(),
        fatigue: z.number().min(0).max(1).optional(),
        started_at: z.string().optional(),
        ended_at: z.string().optional(),
        stages: z.array(z.record(z.unknown())).default([])
      })
      .optional()
  })
  .strict();

export const proposalCreateRequestSchema = z
  .object({
    proposerId: z.union([z.string().min(1), z.literal("ai_agent")]),
    proposalType: z.enum([
      "add_claim",
      "modify_claim",
      "deprecate_claim",
      "add_concept",
      "split_concept",
      "merge_concepts",
      "add_edge",
      "remove_edge",
      "modify_definition",
      "add_video",
      "rank_video",
      "add_assessment",
      "modify_sleep_cue",
      "change_learning_path",
      "flag_misinformation",
      "flag_outdated",
      "change_badge"
    ] satisfies [Proposal["proposal_type"], ...Proposal["proposal_type"][]]),
    affectedObjectIds: z.array(z.string().min(1)).min(1),
    diff: z.record(z.unknown()),
    rationale: z.string().min(8),
    evidenceFor: z.array(sourceRefSchema).default([]),
    evidenceAgainst: z.array(sourceRefSchema).default([]),
    riskLevel: z.enum(["low", "medium", "high", "critical"]).default("low")
  })
  .strict();

export const proposalReviewRequestSchema = z
  .object({
    proposalId: z.string().min(1),
    actorId: z.union([z.string().min(1), z.literal("ai_agent")]).default("ai_agent")
  })
  .strict();

export const proposalVoteRequestSchema = z
  .object({
    proposalId: z.string().min(1),
    voterId: z.string().min(1),
    perspectiveId: z.string().min(1).default("learner"),
    voteType: z.enum([
      "clear",
      "unclear",
      "accurate",
      "wrong",
      "outdated",
      "too_easy",
      "too_hard",
      "misleading",
      "great_for_beginners",
      "great_for_experts",
      "bad_sleep_cue",
      "good_sleep_cue",
      "wrong_prerequisite",
      "better_video_exists",
      "needs_expert_review"
    ])
  })
  .strict();

export const proposalCommentRequestSchema = z
  .object({
    proposalId: z.string().min(1),
    authorId: z.string().min(1),
    text: z.string().min(4),
    commentType: z.enum(["expert", "learner", "moderator", "appeal"]).default("learner")
  })
  .strict();

export const proposalReleaseRequestSchema = z
  .object({
    proposalId: z.string().min(1),
    releaserId: z.string().min(1),
    graphVersion: z.string().min(1).optional(),
    notes: z.string().min(4).optional()
  })
  .strict();

export const humanOverrideRequestSchema = z
  .object({
    proposalId: z.string().min(1),
    moderatorId: z.string().min(1),
    status: z.enum(["accepted", "accepted_with_modifications", "rejected", "disputed", "reverted"]),
    reason: z.string().min(8)
  })
  .strict();

export const creatorIngestionRequestSchema = z
  .object({
    creatorId: userIdSchema,
    title: z.string().min(3),
    license: z.string().min(2).default("CC-BY-4.0"),
    notes: z.string().max(2_000).optional(),
    source: sourceRefSchema.optional(),
    evidence: z.array(sourceRefSchema).default([]),
    draft: z
      .object({
        concepts: z.array(conceptNodeSchema).default([]),
        videos: z.array(videoAssetSchema).default([]),
        assessments: z.array(assessmentItemSchema).default([]),
        sleepCues: z.array(sleepCueTemplateSchema).default([]),
        flashreadAssets: z.array(flashReadAssetSchema).default([])
      })
      .strict()
      .refine(
        (draft) =>
          draft.concepts.length +
            draft.videos.length +
            draft.assessments.length +
            draft.sleepCues.length +
            draft.flashreadAssets.length >
          0,
        "At least one creator content object is required."
      )
  })
  .strict();

export function validateRequest<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown
): z.output<TSchema> {
  return schema.parse(input);
}
