import {
  assessmentItemSchema,
  conceptNodeSchema,
  deviceCapabilityProfileSchema,
  pacedReadAssetSchema,
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

export const authRoleSchema = z.enum(["learner", "creator", "moderator", "admin", "researcher", "service"]);

export const authProviderSchema = z.enum(["passkey", "oauth", "dev"]);

export const authActionSchema = z.enum([
  "read",
  "create",
  "update",
  "delete",
  "export",
  "sync",
  "score",
  "assign",
  "moderate",
  "release",
  "operate"
]);

export const authResourceSchema = z
  .object({
    kind: z.enum([
      "user_profile",
      "goal",
      "personal_graph",
      "daily_packet",
      "session",
      "assessment_response",
      "sleep_data",
      "health_data",
      "voice_data",
      "privacy_export",
      "privacy_delete",
      "master_graph",
      "proposal",
      "creator_submission",
      "social_challenge",
      "experiment",
      "analytics",
      "admin_ops",
      "service_job"
    ]),
    object_id: z.string().min(1).optional(),
    owner_id: z.string().min(1).optional(),
    visibility: z.enum(["private", "badges_only", "friends", "public", "aggregate", "internal"]).optional(),
    consent_required: z.enum(["product_analytics", "research"]).optional(),
    risk_level: z.enum(["low", "medium", "high"]).optional()
  })
  .strict();

export const authSessionSchema = z
  .object({
    id: z.string().min(1),
    user_id: userIdSchema,
    roles: z.array(authRoleSchema).min(1),
    provider: authProviderSchema,
    issued_at: z.string().min(1),
    expires_at: z.string().min(1),
    session_token_hash: z.string().min(32),
    csrf_token_hash: z.string().min(32),
    device_binding_hash: z.string().min(32).optional(),
    last_seen_at: z.string().optional()
  })
  .strict();

export const authSessionIssueRequestSchema = z
  .object({
    userId: userIdSchema,
    provider: authProviderSchema.default("passkey"),
    roles: z.array(authRoleSchema).min(1).default(["learner"]),
    ttlMinutes: z
      .number()
      .int()
      .positive()
      .max(60 * 24 * 30)
      .default(480),
    sessionSeed: z.string().min(1).optional(),
    csrfSeed: z.string().min(1).optional(),
    deviceBinding: z.string().min(4).optional()
  })
  .strict();

export const authTokenVerifyRequestSchema = z
  .object({
    session: authSessionSchema,
    sessionToken: z.string().min(8),
    csrfToken: z.string().min(8).optional()
  })
  .strict();

export const authAuthorizationRequestSchema = z
  .object({
    session: authSessionSchema,
    action: authActionSchema,
    resource: authResourceSchema
  })
  .strict();

const learningEventTypeSchema = z.enum([
  "session_started",
  "concept_seen",
  "assessment_answered",
  "cue_bound",
  "sleep_cue_played",
  "video_watched",
  "paced_read_completed",
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

export const privacyExportRequestSchema = z
  .object({
    userId: userIdSchema
  })
  .strict();

export const privacyDeletionRequestSchema = z
  .object({
    userId: userIdSchema,
    scope: z.enum(["account", "health", "sleep", "voice"]),
    confirmation: z.literal("DELETE")
  })
  .strict();

export const userGraphReplayRequestSchema = z
  .object({
    userId: userIdSchema,
    dryRun: z.boolean().default(false),
    resetTouchedConcepts: z.boolean().default(true)
  })
  .strict();

export const outcomeDashboardRequestSchema = z
  .object({
    userId: userIdSchema,
    generatedAt: z.string().optional()
  })
  .strict();

const queueNameSchema = z.enum([
  "scheduler",
  "ingestion",
  "local_ai",
  "audio_render",
  "notification",
  "analytics",
  "export",
  "moderation"
]);
const jobPrioritySchema = z.enum(["low", "normal", "high", "critical"]);

export const outcomeDashboardJobRequestSchema = z
  .object({
    userId: userIdSchema,
    generatedAt: z.string().optional(),
    priority: jobPrioritySchema.default("normal"),
    runAfter: z.string().optional(),
    idempotencyKey: z.string().min(3).optional(),
    maxAttempts: z.number().int().positive().max(25).default(3)
  })
  .strict();

export const privacyExportJobRequestSchema = z
  .object({
    userId: userIdSchema,
    priority: jobPrioritySchema.default("high"),
    runAfter: z.string().optional(),
    idempotencyKey: z.string().min(3).optional(),
    maxAttempts: z.number().int().positive().max(25).default(3)
  })
  .strict();

export const systemBackupJobRequestSchema = z
  .object({
    operatorId: userIdSchema,
    priority: jobPrioritySchema.default("high"),
    runAfter: z.string().optional(),
    idempotencyKey: z.string().min(3).optional(),
    maxAttempts: z.number().int().positive().max(25).default(3)
  })
  .strict();

export const systemBackupRestoreDrillJobRequestSchema = z
  .object({
    operatorId: userIdSchema,
    objectManifestId: z.string().min(1),
    priority: jobPrioritySchema.default("high"),
    runAfter: z.string().optional(),
    idempotencyKey: z.string().min(3).optional(),
    maxAttempts: z.number().int().positive().max(25).default(3)
  })
  .strict();

export const notificationScheduleRequestSchema = z
  .object({
    userId: userIdSchema,
    date: z.string().optional(),
    generatedAt: z.string().optional(),
    channel: z.enum(["in_app", "web_push_ready", "native_companion_recommended"]).optional(),
    idempotencyPrefix: z.string().min(3).optional(),
    maxAttempts: z.number().int().positive().max(25).default(3)
  })
  .strict();

export const proposalModerationJobRequestSchema = z
  .object({
    proposalId: z.string().min(1),
    moderatorId: z.string().min(1),
    priority: jobPrioritySchema.optional(),
    runAfter: z.string().optional(),
    idempotencyKey: z.string().min(3).optional(),
    maxAttempts: z.number().int().positive().max(25).default(3)
  })
  .strict();

const objectBucketSchema = z.enum([
  "audio",
  "transcript",
  "import",
  "generated_asset",
  "export",
  "evidence",
  "backup"
]);
const objectRetentionPolicySchema = z.enum([
  "temporary",
  "user_controlled",
  "product",
  "legal_hold",
  "backup"
]);

export const jobCreateRequestSchema = z
  .object({
    userId: userIdSchema,
    queue: queueNameSchema,
    type: z.string().min(2),
    payload: z.record(z.unknown()).default({}),
    priority: jobPrioritySchema.default("normal"),
    runAfter: z.string().optional(),
    idempotencyKey: z.string().min(3).optional(),
    maxAttempts: z.number().int().positive().max(25).default(3)
  })
  .strict();

export const jobTransitionRequestSchema = z
  .object({
    userId: userIdSchema,
    jobId: z.string().min(1),
    workerId: z.string().min(1),
    result: z.record(z.unknown()).default({}),
    error: z.string().min(1).optional()
  })
  .strict();

export const objectManifestRequestSchema = z
  .object({
    userId: userIdSchema,
    bucket: objectBucketSchema,
    key: z.string().min(1),
    contentType: z.string().min(3),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
    retentionPolicy: objectRetentionPolicySchema.default("user_controlled"),
    metadata: z.record(z.unknown()).default({})
  })
  .strict();

export const objectPutRequestSchema = z
  .object({
    userId: userIdSchema,
    bucket: objectBucketSchema,
    key: z.string().min(1),
    contentType: z.string().min(3),
    bodyBase64: z
      .string()
      .min(1)
      .refine((value) => isBase64(value), "bodyBase64 must be valid base64 content."),
    expectedSha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .optional(),
    retentionPolicy: objectRetentionPolicySchema.default("user_controlled"),
    metadata: z.record(z.unknown()).default({})
  })
  .strict();

export const securityReleaseGateRequestSchema = z
  .object({
    userId: userIdSchema,
    environment: z.enum(["local", "staging", "production"]).default("production"),
    reportUri: z.string().url().optional()
  })
  .strict();

export const opsMonitoringRequestSchema = z
  .object({
    userId: userIdSchema,
    environment: z.enum(["local", "staging", "production"]).default("production"),
    reportUri: z.string().url().optional()
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
        paced_read: z.boolean().default(true),
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
    sessionType: z.enum(["morning_forge", "graphfeed", "walk_mode", "evening_lock_in", "sleep", "paced_read"])
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

const tutorModeSchema = z.enum([
  "socratic",
  "examiner",
  "calm_coach",
  "debate_opponent",
  "language_partner",
  "debugger",
  "oral_board",
  "walk_coach",
  "sleep_prep_guide"
]);

export const tutorTurnRequestSchema = z
  .object({
    userId: userIdSchema,
    mode: tutorModeSchema.default("socratic"),
    item: assessmentItemSchema,
    rawResponse: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
    latencyMs: z.number().int().nonnegative(),
    hintCount: z.number().int().nonnegative().optional(),
    retries: z.number().int().nonnegative().optional(),
    entryMode: z.enum(["text", "voice"]).default("text"),
    transcript: z.string().optional(),
    transcriptRetention: z.enum(["deleted", "transcript_only", "retained"]).default("deleted"),
    highStakesDomain: z.boolean().default(false)
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

const pacedReadDisplayUnitSchema = z.enum(["word", "phrase", "clause", "concept"]);

export const pacedReadGenerateRequestSchema = z
  .object({
    userId: userIdSchema,
    assetId: z.string().min(1).optional(),
    conceptIds: z.array(z.string().min(1)).default([]),
    displayUnit: pacedReadDisplayUnitSchema.default("phrase"),
    requestedWpm: z.number().int().min(120).max(1200).optional()
  })
  .strict();

export const pacedReadCompleteRequestSchema = z
  .object({
    userId: userIdSchema,
    sessionId: z.string().min(1).optional(),
    pacedReadSessionId: z.string().min(1),
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
    connectionId: z.string().min(1).optional(),
    sleepSession: z
      .object({
        external_id: z.string().min(1).optional(),
        sleep_quality: z.number().min(0).max(1).optional(),
        fatigue: z.number().min(0).max(1).optional(),
        readiness_score: z.number().min(0).max(1).optional(),
        sleep_score: z.number().min(0).max(1).optional(),
        efficiency: z.number().min(0).max(1).optional(),
        started_at: z.string().optional(),
        ended_at: z.string().optional(),
        stages: z.array(z.record(z.unknown())).default([])
      })
      .optional()
  })
  .strict();

export const wearableOuraConnectRequestSchema = z
  .object({
    userId: userIdSchema,
    clientId: z.string().min(1),
    redirectUri: z.string().url(),
    scopes: z.array(z.string().min(1)).default(["daily"]),
    accessToken: z.string().min(8).optional(),
    refreshToken: z.string().min(8).optional(),
    encryptionSecret: z.string().min(12).optional()
  })
  .strict();

export const wearableRevokeRequestSchema = z
  .object({
    userId: userIdSchema,
    connectionId: z.string().min(1)
  })
  .strict();

export const experimentAssignmentRequestSchema = z
  .object({
    userId: userIdSchema,
    maxPairsPerExperiment: z.number().int().positive().max(8).optional()
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
    actorId: z.string().min(1).default("local_arbiter")
  })
  .strict();

export const proposalArbiterJobRequestSchema = z
  .object({
    proposalId: z.string().min(1),
    actorId: z.string().min(1).default("local_arbiter"),
    priority: jobPrioritySchema.default("normal"),
    runAfter: z.string().optional(),
    idempotencyKey: z.string().min(3).optional(),
    maxAttempts: z.number().int().positive().max(25).default(3)
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
        pacedReadAssets: z.array(pacedReadAssetSchema).default([])
      })
      .strict()
      .refine(
        (draft) =>
          draft.concepts.length +
            draft.videos.length +
            draft.assessments.length +
            draft.sleepCues.length +
            draft.pacedReadAssets.length >
          0,
        "At least one creator content object is required."
      )
  })
  .strict();

export const creatorIngestionJobRequestSchema = creatorIngestionRequestSchema
  .extend({
    priority: jobPrioritySchema.default("normal"),
    runAfter: z.string().optional(),
    idempotencyKey: z.string().min(3).optional(),
    maxAttempts: z.number().int().positive().max(25).default(3)
  })
  .strict();

export const challengeCreateRequestSchema = z
  .object({
    userId: userIdSchema,
    title: z.string().min(3),
    challengeType: z.enum([
      "retention_duel",
      "boss_fight",
      "screen_efficiency",
      "walk_recall",
      "same_video_recall",
      "sleep_cue_gain",
      "creator_quality"
    ]),
    participantIds: z.array(z.string().min(1)).default([]),
    shareLevel: z.enum(["badges_only", "friends", "public"]).default("friends"),
    endsAt: z.string().optional()
  })
  .strict();

export function validateRequest<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown
): z.output<TSchema> {
  return schema.parse(input);
}

function isBase64(value: string): boolean {
  const compact = value.replace(/\s+/g, "");
  if (!compact) return false;
  try {
    const decoded = Buffer.from(compact, "base64");
    return decoded.length > 0 && decoded.toString("base64").replace(/=+$/, "") === compact.replace(/=+$/, "");
  } catch {
    return false;
  }
}
