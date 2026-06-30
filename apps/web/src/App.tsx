import {
  Activity,
  AudioLines,
  BadgeCheck,
  BarChart3,
  BookOpen,
  Brain,
  CheckCircle2,
  CircleGauge,
  ClipboardCheck,
  Database,
  FlaskConical,
  Footprints,
  Gavel,
  Gauge,
  GitBranch,
  Headphones,
  Home,
  LifeBuoy,
  Link2,
  Moon,
  Network,
  Pause,
  Play,
  Radio,
  RefreshCcw,
  Rewind,
  Search,
  ShieldCheck,
  SkipForward,
  Smartphone,
  Sparkles,
  SunMedium,
  Trophy,
  Unplug,
  Video,
  Volume2,
  Wand2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  applyAssessmentToUserState,
  generateAssessmentForConcept,
  scoreAssessmentResponse
} from "@mnemosyne/assessment-core";
import { estimateCueDensity } from "@mnemosyne/audio-core";
import {
  arbitrateProposal,
  castVote,
  computeBridgingPriority,
  statusForArbiterDecision,
  type VoteType
} from "@mnemosyne/content-court";
import {
  buildPacedReadSession,
  scorePacedReadCompletion,
  type PacedReadDisplayUnit,
  type PacedReadSessionPlan
} from "@mnemosyne/paced-reader-core";
import { buildGraphSnapshot } from "@mnemosyne/graph-core";
import {
  buildIncidentResponseReport,
  buildOpsHealthDashboard,
  buildOpsMonitoringDashboard,
  createJob as createOpsJob,
  createObjectManifest,
  failJob as failOpsJob,
  startJob as startOpsJob,
  type IncidentResponseReport,
  type ObjectManifest,
  type OpsMonitoringDashboard
} from "@mnemosyne/ops-core";
import {
  createOfflineQueueItem,
  recoverStaleOfflineItems,
  summarizeOfflineQueue,
  syncOfflineQueueItems,
  upsertOfflineItem,
  type OfflineActionType,
  type OfflineHttpMethod,
  type OfflinePayloadScope,
  type OfflineQueueItem,
  type OfflineQueueSummary
} from "@mnemosyne/offline-core";
import { buildDailyLearningPacket, type ScheduledDay } from "@mnemosyne/scheduler-core";
import type {
  AudioPlan,
  DailyLearningPacket,
  AssessmentItem,
  AssessmentResponse,
  ConceptNode,
  Goal,
  PacedReadAsset,
  LearningEvent,
  Proposal,
  ReadinessProfile,
  UserConceptState,
  VideoAsset,
  WatchPacket
} from "@mnemosyne/schema";
import { clamp, createId, humanMinutes, nowIso, round, stableHash, unique } from "@mnemosyne/shared-utils";
import { buildSleepCuePacket } from "@mnemosyne/sleep-core";
import {
  buildSocialDashboard,
  createChallenge as createSocialChallenge,
  outcomeBadgeTemplates,
  type SocialChallenge,
  type SocialDashboard
} from "@mnemosyne/social-core";
import {
  buildOuraAuthorizationRequest,
  buildWearableCapabilityDashboard,
  normalizeWearableSleepSession,
  readinessFromWearableSleep,
  revokeWearableConnection,
  type WearableCapabilityDashboard,
  type NormalizedWearableSleepSession,
  type WearableConnection,
  type WearableConnectionStatus
} from "@mnemosyne/wearables-core";
import {
  assignExperiments,
  buildPersonalizationProfile,
  createDefaultExperimentSuite,
  createTechniqueExperiment,
  personalizeSessionConstraints,
  recommendTechniques,
  rollupExperimentOutcomes,
  techniqueRegistry,
  type ExperimentAssignment,
  type ExperimentOutcomeRollup,
  type PersonalizationProfile
} from "@mnemosyne/technique-lab";
import { rankVideosForUser } from "@mnemosyne/video-core";
import {
  defaultReadiness,
  demoBadges,
  demoGoals,
  demoMasterGraph,
  demoProposals,
  demoUser,
  emptyState,
  initialUserStates
} from "@mnemosyne/demo-fixtures";
import { clearSyncedOfflineQueueItems, listOfflineQueueItems, putOfflineQueueItem } from "./offlineQueue";
import { createBrowserOfflineSyncTransport } from "./offlineSync";
import {
  fetchAppBootstrap,
  webApiConfigFromEnv,
  type AppBootstrapPayload,
  type WebApiConfig
} from "./apiClient";
import { scheduleFromPersistedPacket } from "./bootstrapState";

type TabId =
  | "onboarding"
  | "today"
  | "graph"
  | "forge"
  | "cinema"
  | "pacedRead"
  | "walk"
  | "lock"
  | "sleep"
  | "stats"
  | "social"
  | "wearables"
  | "packs"
  | "court"
  | "lab"
  | "workbench"
  | "admin";

const tabs: Array<{ id: TabId; label: string; icon: typeof Home }> = [
  { id: "onboarding", label: "Onboard", icon: Sparkles },
  { id: "today", label: "Today", icon: Home },
  { id: "graph", label: "Graph", icon: Network },
  { id: "forge", label: "Forge", icon: SunMedium },
  { id: "cinema", label: "Cinema", icon: Video },
  { id: "pacedRead", label: "Paced Read", icon: Gauge },
  { id: "walk", label: "Walk", icon: Footprints },
  { id: "lock", label: "Lock-In", icon: Headphones },
  { id: "sleep", label: "Sleep", icon: Moon },
  { id: "stats", label: "Stats", icon: BarChart3 },
  { id: "social", label: "Social", icon: Trophy },
  { id: "wearables", label: "Wear", icon: Activity },
  { id: "packs", label: "Packs", icon: BookOpen },
  { id: "court", label: "Court", icon: Gavel },
  { id: "lab", label: "Lab", icon: FlaskConical },
  { id: "workbench", label: "Workbench", icon: ClipboardCheck },
  { id: "admin", label: "Admin", icon: ShieldCheck }
];

type AnswerMode = "text" | "voice";
type PhoneDownKey = "notificationsSilenced" | "screenDimmingEnabled" | "chargerReady" | "alarmSet";
type EveningPromptPhase = "recall" | "review" | "transfer";
type EveningPrompt = {
  phase: EveningPromptPhase;
  item: AssessmentItem;
};
type SleepPlaybackStatus = "planned" | "running" | "logged";
type SleepStopCondition =
  "none" | "movement_detected" | "user_wake_report" | "wearable_wake_signal" | "time_limit";
type SleepRecallResult = {
  completedAt: string;
  cuedScore: number;
  controlScore: number;
  cueGainDelta: number;
  cuedConceptIds: string[];
  controlConceptIds: string[];
};
type WalkPhase = "prompt" | "listening" | "feedback" | "complete";
type PacedReadEngineResult = ReturnType<typeof scorePacedReadCompletion> & {
  completedAt: string;
  rawWpm: number;
  comprehensionScore: number;
  retentionScore: number;
  strainRating: number;
};
type GraphFeedRecallResult = {
  completedAt: string;
  videoId: string;
  response: AssessmentResponse;
  recallPassed: boolean;
  screenMinutes: number;
};
type BackendStatus = "local" | "connecting" | "connected" | "error";

export default function App() {
  const apiConfig = useMemo<WebApiConfig | null>(() => webApiConfigFromEnv(), []);
  const [activeTab, setActiveTab] = useState<TabId>("onboarding");
  const [activeUser, setActiveUser] = useState(demoUser);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>(apiConfig ? "connecting" : "local");
  const [backendMeta, setBackendMeta] = useState(apiConfig ? "API pending" : "local demo");
  const [backendPacketSource, setBackendPacketSource] =
    useState<AppBootstrapPayload["daily_packet_source"]>("missing");
  const [activeGoals, setActiveGoals] = useState<Goal[]>(demoGoals);
  const [backendPacket, setBackendPacket] = useState<DailyLearningPacket | null>(null);
  const [backendAudioPlan, setBackendAudioPlan] = useState<AudioPlan | null>(null);
  const [readiness, setReadiness] = useState<ReadinessProfile>(defaultReadiness);
  const [states, setStates] = useState<UserConceptState[]>(initialUserStates);
  const [selectedNodeId, setSelectedNodeId] = useState("attention_qkv");
  const [answer, setAnswer] = useState("");
  const [confidence, setConfidence] = useState(0.66);
  const [answerMode, setAnswerMode] = useState<AnswerMode>("text");
  const [forgeIndex, setForgeIndex] = useState(0);
  const [forgeStartedAt, setForgeStartedAt] = useState(Date.now());
  const [forgeResponses, setForgeResponses] = useState(0);
  const [lastResponse, setLastResponse] = useState<AssessmentResponse | null>(null);
  const [repairTips, setRepairTips] = useState<string[]>([]);
  const [offlineCacheStatus, setOfflineCacheStatus] = useState("pending");
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueueItem[]>([]);
  const [offlineSyncStatus, setOfflineSyncStatus] = useState("indexeddb loading");
  const [cinemaVideoId, setCinemaVideoId] = useState(demoMasterGraph.videos[0]?.id ?? "");
  const [cinemaAnswer, setCinemaAnswer] = useState("");
  const [cinemaConfidence, setCinemaConfidence] = useState(0.62);
  const [cinemaStartedAt, setCinemaStartedAt] = useState(Date.now());
  const [cinemaResult, setCinemaResult] = useState<GraphFeedRecallResult | null>(null);
  const [cinemaCacheStatus, setCinemaCacheStatus] = useState("pending");
  const [walkIndex, setWalkIndex] = useState(0);
  const [walkPhase, setWalkPhase] = useState<WalkPhase>("prompt");
  const [walkAnswer, setWalkAnswer] = useState("");
  const [walkAnswerMode, setWalkAnswerMode] = useState<AnswerMode>("voice");
  const [walkConfidence, setWalkConfidence] = useState(0.6);
  const [walkStartedAt, setWalkStartedAt] = useState(Date.now());
  const [walkHintCount, setWalkHintCount] = useState(0);
  const [walkResponses, setWalkResponses] = useState<AssessmentResponse[]>([]);
  const [walkLastResponse, setWalkLastResponse] = useState<AssessmentResponse | null>(null);
  const [walkRepairTips, setWalkRepairTips] = useState<string[]>([]);
  const [walkCommandLog, setWalkCommandLog] = useState<string[]>([]);
  const [walkSkippedIds, setWalkSkippedIds] = useState<string[]>([]);
  const [walkConfusingIds, setWalkConfusingIds] = useState<string[]>([]);
  const [walkCacheStatus, setWalkCacheStatus] = useState("pending");
  const [walkCompletedAt, setWalkCompletedAt] = useState<string | null>(null);
  const [walkTranscriptDeleted, setWalkTranscriptDeleted] = useState(true);
  const [lockAnswer, setLockAnswer] = useState("");
  const [lockConfidence, setLockConfidence] = useState(0.58);
  const [lockAnswerMode, setLockAnswerMode] = useState<AnswerMode>("voice");
  const [lockIndex, setLockIndex] = useState(0);
  const [lockStartedAt, setLockStartedAt] = useState(Date.now());
  const [lockResponses, setLockResponses] = useState(0);
  const [lockLastResponse, setLockLastResponse] = useState<AssessmentResponse | null>(null);
  const [lockRepairTips, setLockRepairTips] = useState<string[]>([]);
  const [boundCueIds, setBoundCueIds] = useState<string[]>([]);
  const [phoneDownChecklist, setPhoneDownChecklist] = useState<Record<PhoneDownKey, boolean>>({
    notificationsSilenced: true,
    screenDimmingEnabled: true,
    chargerReady: true,
    alarmSet: true
  });
  const [lockSleepCacheStatus, setLockSleepCacheStatus] = useState("pending");
  const [lockCompletedAt, setLockCompletedAt] = useState<string | null>(null);
  const [lockAudioPlaying, setLockAudioPlaying] = useState(false);
  const [sleepPlaybackStatus, setSleepPlaybackStatus] = useState<SleepPlaybackStatus>("planned");
  const [sleepPlaybackStartedAt, setSleepPlaybackStartedAt] = useState<string | null>(null);
  const [sleepStopCondition, setSleepStopCondition] = useState<SleepStopCondition>("none");
  const [sleepDisruptionReported, setSleepDisruptionReported] = useState(false);
  const [sleepRecallResult, setSleepRecallResult] = useState<SleepRecallResult | null>(null);
  const [sleepCacheStatus, setSleepCacheStatus] = useState("pending");
  const [pacedReadAssetId, setPacedReadAssetId] = useState(
    demoMasterGraph.pacedReads.find((asset) => asset.concept_ids.includes("attention_qkv"))?.id ??
      demoMasterGraph.pacedReads[0]?.id ??
      ""
  );
  const [pacedReadDisplayUnit, setPacedReadDisplayUnit] = useState<PacedReadDisplayUnit>("phrase");
  const [pacedReadRequestedWpm, setPacedReadRequestedWpm] = useState(420);
  const [pacedReadChunkIndex, setPacedReadChunkIndex] = useState(0);
  const [pacedReadPlaying, setPacedReadPlaying] = useState(false);
  const [pacedReadComprehension, setPacedReadComprehension] = useState(0.78);
  const [pacedReadRetention, setPacedReadRetention] = useState(0.72);
  const [pacedReadStrain, setPacedReadStrain] = useState(0.24);
  const [pacedReadResult, setPacedReadResult] = useState<PacedReadEngineResult | null>(null);
  const [pacedReadCacheStatus, setPacedReadCacheStatus] = useState("pending");
  const [wearableConnectionStatus, setWearableConnectionStatus] =
    useState<WearableConnectionStatus>("authorization_required");
  const [wearableSleep, setWearableSleep] = useState<NormalizedWearableSleepSession | null>(null);
  const [eventLog, setEventLog] = useState<string[]>([
    "daily packet generated",
    "sleep controls assigned",
    "content court policy loaded"
  ]);

  const userGraph = useMemo(() => ({ userId: activeUser.id, states }), [activeUser.id, states]);
  const offlineQueueSummary = useMemo(() => summarizeOfflineQueue(offlineQueue), [offlineQueue]);
  const baselineConstraints = useMemo(() => personalizeSessionConstraints(readiness), [readiness]);
  const baseLocalScheduled = useMemo(
    () =>
      buildDailyLearningPacket({
        user: activeUser,
        userGraph,
        masterGraph: demoMasterGraph,
        goals: activeGoals,
        readiness,
        constraints: baselineConstraints
      }),
    [activeGoals, activeUser, baselineConstraints, readiness, userGraph]
  );
  const baseScheduled = useMemo<ScheduledDay>(
    () => scheduleFromPersistedPacket(backendPacket, backendAudioPlan, baseLocalScheduled),
    [backendAudioPlan, backendPacket, baseLocalScheduled]
  );
  const experimentSuite = useMemo(() => createDefaultExperimentSuite(), []);
  const experimentResponses = useMemo(
    () =>
      uniqueResponses([
        lastResponse,
        cinemaResult?.response ?? null,
        ...walkResponses,
        walkLastResponse,
        lockLastResponse
      ]),
    [cinemaResult?.response, lastResponse, lockLastResponse, walkLastResponse, walkResponses]
  );
  const experimentEvents = useMemo(
    () =>
      buildLocalExperimentEvents({
        userId: activeUser.id,
        cinemaResult,
        walkCompletedAt,
        walkResponses,
        sleepRecallResult,
        sleepCuedConceptIds: baseScheduled.packet.sleep.reactivate_concept_ids,
        sleepControlConceptIds: baseScheduled.packet.sleep.control_concept_ids
      }),
    [
      activeUser.id,
      baseScheduled.packet.sleep.control_concept_ids,
      baseScheduled.packet.sleep.reactivate_concept_ids,
      cinemaResult,
      sleepRecallResult,
      walkCompletedAt,
      walkResponses
    ]
  );
  const socialEvidence = useMemo(
    () => ({
      user: activeUser,
      states,
      events: experimentEvents,
      proposals: demoProposals,
      creatorSubmissionCount: 1
    }),
    [activeUser, experimentEvents, states]
  );
  const socialChallenges = useMemo<SocialChallenge[]>(
    () => [
      createSocialChallenge({
        creator: activeUser,
        title: "Recall Without Scroll",
        challengeType: "screen_efficiency",
        shareLevel: "friends",
        evidenceByUser: new Map([[activeUser.id, socialEvidence]])
      }),
      createSocialChallenge({
        creator: activeUser,
        title: "Sleep Cue Gain Check",
        challengeType: "sleep_cue_gain",
        shareLevel: "badges_only",
        evidenceByUser: new Map([[activeUser.id, socialEvidence]])
      })
    ],
    [activeUser, socialEvidence]
  );
  const socialDashboard = useMemo<SocialDashboard>(
    () =>
      buildSocialDashboard({
        evidence: socialEvidence,
        badgeTemplates: uniqueBadgeTemplates([...outcomeBadgeTemplates, ...demoBadges]),
        challenges: socialChallenges
      }),
    [socialChallenges, socialEvidence]
  );
  const ouraAuthorization = useMemo(
    () =>
      buildOuraAuthorizationRequest({
        userId: activeUser.id,
        clientId: "demo_oura_client",
        redirectUri: "https://mnemosyne.local/oauth/oura/callback",
        scopes: ["daily"]
      }),
    [activeUser.id]
  );
  const wearableConnection = useMemo<WearableConnection>(() => {
    const base: WearableConnection = {
      id: createId("wearable_connection", `${activeUser.id}:oura`),
      user_id: activeUser.id,
      provider: "oura",
      status: wearableConnectionStatus,
      scopes: ouraAuthorization.scopes,
      authorization_url: ouraAuthorization.authorization_url,
      state: ouraAuthorization.state,
      created_at: "2026-06-29T08:00:00.000Z",
      updated_at:
        wearableConnectionStatus === "connected" ? "2026-06-29T08:05:00.000Z" : "2026-06-29T08:00:00.000Z"
    };
    return wearableConnectionStatus === "revoked"
      ? revokeWearableConnection(base, "2026-06-29T08:12:00.000Z")
      : base;
  }, [activeUser.id, ouraAuthorization, wearableConnectionStatus]);
  const sampleWearableSleep = useMemo(
    () =>
      normalizeWearableSleepSession({
        userId: activeUser.id,
        provider: "oura",
        raw: {
          external_id: "demo_oura_sleep_2026_06_29",
          sleep_score: 0.82,
          readiness_score: 0.78,
          efficiency: 0.91,
          started_at: "2026-06-29T03:46:00.000Z",
          ended_at: "2026-06-29T11:54:00.000Z",
          stages: [
            { stage: "awake", duration_minutes: 22 },
            { stage: "light", duration_minutes: 242 },
            { stage: "deep", duration_minutes: 74 },
            { stage: "rem", duration_minutes: 92 }
          ]
        },
        createdAt: "2026-06-29T12:05:00.000Z"
      }),
    [activeUser.id]
  );
  const wearableReadiness = useMemo(
    () => (wearableSleep ? readinessFromWearableSleep(wearableSleep, readiness) : readiness),
    [readiness, wearableSleep]
  );
  const wearableDashboard = useMemo<WearableCapabilityDashboard>(
    () =>
      buildWearableCapabilityDashboard({
        userId: activeUser.id,
        device: {
          platform: "desktop",
          pwa_installed: false,
          web_push_supported: true,
          background_audio_supported: true,
          microphone_supported: true,
          notifications_permission: "prompt",
          healthkit_available: false,
          health_connect_available: false,
          oura_connected: wearableConnection.status === "connected",
          bluetooth_supported: false,
          offline_cache_supported: true
        },
        connections: [wearableConnection],
        latestSleep: wearableSleep ?? undefined,
        readiness: wearableReadiness
      }),
    [activeUser.id, wearableConnection, wearableReadiness, wearableSleep]
  );
  const experimentAssignments = useMemo(
    () =>
      assignExperiments({
        userId: activeUser.id,
        states,
        experiments: experimentSuite,
        sleepPacket: baseScheduled.packet.sleep
      }),
    [activeUser.id, baseScheduled.packet.sleep, experimentSuite, states]
  );
  const experimentRollups = useMemo(
    () =>
      rollupExperimentOutcomes({
        experiments: experimentSuite,
        assignments: experimentAssignments,
        responses: experimentResponses,
        events: experimentEvents,
        states
      }),
    [experimentAssignments, experimentEvents, experimentResponses, experimentSuite, states]
  );
  const personalizationProfile = useMemo(
    () =>
      buildPersonalizationProfile({
        userId: activeUser.id,
        experiments: experimentSuite,
        assignments: experimentAssignments,
        responses: experimentResponses,
        events: experimentEvents,
        states,
        rollups: experimentRollups
      }),
    [
      activeUser.id,
      experimentAssignments,
      experimentEvents,
      experimentResponses,
      experimentRollups,
      experimentSuite,
      states
    ]
  );
  const personalizedConstraints = useMemo(
    () => personalizeSessionConstraints(readiness, personalizationProfile),
    [personalizationProfile, readiness]
  );
  const personalizedLocalScheduled = useMemo(
    () =>
      buildDailyLearningPacket({
        user: activeUser,
        userGraph,
        masterGraph: demoMasterGraph,
        goals: activeGoals,
        readiness,
        constraints: personalizedConstraints
      }),
    [activeGoals, activeUser, personalizedConstraints, readiness, userGraph]
  );
  const scheduled = useMemo<ScheduledDay>(
    () => scheduleFromPersistedPacket(backendPacket, backendAudioPlan, personalizedLocalScheduled),
    [backendAudioPlan, backendPacket, personalizedLocalScheduled]
  );
  const snapshot = useMemo(() => buildGraphSnapshot(demoMasterGraph, userGraph), [userGraph]);
  const rankedVideos = useMemo(
    () =>
      rankVideosForUser({
        videos: demoMasterGraph.videos,
        states,
        goals: activeGoals,
        frontierConceptIds: scheduled.packet.morning.frontier_items.map((concept) => concept.id),
        horizonConceptIds: scheduled.packet.morning.horizon_items.map((concept) => concept.id),
        readiness
      }),
    [
      activeGoals,
      readiness,
      scheduled.packet.morning.frontier_items,
      scheduled.packet.morning.horizon_items,
      states
    ]
  );
  const activeWatchPacket = scheduled.packet.optional_watch_packets[0];
  const packetVideos = useMemo(
    () =>
      (activeWatchPacket?.video_ids ?? [])
        .map((id) => demoMasterGraph.videos.find((video) => video.id === id))
        .filter((video): video is VideoAsset => Boolean(video)),
    [activeWatchPacket?.video_ids]
  );
  const activeCinemaVideo =
    packetVideos.find((video) => video.id === cinemaVideoId) ??
    packetVideos[0] ??
    rankedVideos[0]?.video ??
    demoMasterGraph.videos[0];
  const activeCinemaRecallPrompt = useMemo(
    () =>
      activeCinemaVideo ? buildVideoRecallPrompt(activeCinemaVideo, demoMasterGraph.concepts) : undefined,
    [activeCinemaVideo]
  );
  const pacedReadAssets = useMemo(
    () =>
      rankPacedReadAssets(
        demoMasterGraph.pacedReads,
        states,
        scheduled.packet.morning.frontier_items.map((concept) => concept.id),
        scheduled.packet.morning.horizon_items.map((concept) => concept.id)
      ),
    [scheduled.packet.morning.frontier_items, scheduled.packet.morning.horizon_items, states]
  );
  const activePacedReadAsset =
    pacedReadAssets.find((asset) => asset.id === pacedReadAssetId) ??
    pacedReadAssets[0] ??
    demoMasterGraph.pacedReads[0];
  const pacedReadPlan = useMemo(
    () =>
      activePacedReadAsset
        ? buildPacedReadSession(activePacedReadAsset, pacedReadDisplayUnit, pacedReadRequestedWpm)
        : null,
    [activePacedReadAsset, pacedReadDisplayUnit, pacedReadRequestedWpm]
  );
  const activePacedReadChunk = pacedReadPlan?.chunks[pacedReadChunkIndex] ?? "";
  const pacedReadProgress = pacedReadPlan
    ? clamp((pacedReadChunkIndex + 1) / Math.max(pacedReadPlan.chunks.length, 1))
    : 0;
  const selectedNode =
    demoMasterGraph.concepts.find((concept) => concept.id === selectedNodeId) ?? demoMasterGraph.concepts[0];
  const selectedState = states.find((state) => state.concept_id === selectedNode.id);
  const cueDensity = estimateCueDensity(scheduled.audioPlan);
  const sleepIntegrity = clamp(1 - cueDensity * 12 - readiness.fatigue * 0.12);
  const durableMastery = round(
    states.reduce((sum, state) => sum + state.mastery * 0.55 + state.transfer_score * 0.45, 0) /
      Math.max(states.length, 1),
    2
  );
  const screenEfficiency = round(durableMastery / Math.max(0.2, readiness.screen_budget_minutes / 60), 2);
  const recommendedTechniques = useMemo(
    () =>
      recommendTechniques({
        states,
        conceptTypes: scheduled.packet.morning.frontier_items.map((concept) => concept.concept_type),
        avoidDuskActivation: readiness.dusk_mode,
        limit: 8
      }),
    [readiness.dusk_mode, scheduled.packet.morning.frontier_items, states]
  );
  const verdict = arbitrateProposal(demoProposals[0]);
  const forgeQueue = useMemo(
    () => [
      ...scheduled.packet.morning.cold_retrieval_items,
      ...scheduled.packet.evening.transfer_drills.slice(0, 2)
    ],
    [scheduled.packet.evening.transfer_drills, scheduled.packet.morning.cold_retrieval_items]
  );
  const activeForgePrompt = forgeQueue[forgeIndex % Math.max(forgeQueue.length, 1)];
  const activeWalkPacket = scheduled.packet.walk_packets[0];
  const walkPrompts = activeWalkPacket?.prompts ?? [];
  const activeWalkPrompt = walkPrompts[walkIndex % Math.max(walkPrompts.length, 1)];
  const eveningQueue = useMemo<EveningPrompt[]>(
    () => [
      ...scheduled.packet.evening.recall_items.map((item) => ({ phase: "recall" as const, item })),
      ...scheduled.packet.evening.interleaved_review_items
        .slice(0, 2)
        .map((item) => ({ phase: "review" as const, item })),
      ...scheduled.packet.evening.transfer_drills.map((item) => ({ phase: "transfer" as const, item }))
    ],
    [
      scheduled.packet.evening.interleaved_review_items,
      scheduled.packet.evening.recall_items,
      scheduled.packet.evening.transfer_drills
    ]
  );
  const activeLockPrompt = eveningQueue[lockIndex % Math.max(eveningQueue.length, 1)];
  const defaultBoundCueIds = useMemo(
    () => scheduled.packet.evening.sleep_cue_binding_items.slice(0, 3).map((cue) => cue.id),
    [scheduled.packet.evening.sleep_cue_binding_items]
  );
  const selectedBoundCueIds = boundCueIds.length > 0 ? boundCueIds : defaultBoundCueIds;
  const boundCues = useMemo(
    () =>
      scheduled.packet.evening.sleep_cue_binding_items.filter((cue) => selectedBoundCueIds.includes(cue.id)),
    [scheduled.packet.evening.sleep_cue_binding_items, selectedBoundCueIds]
  );
  const lockSleepResult = useMemo(
    () =>
      buildSleepCuePacket({
        user: activeUser,
        concepts: demoMasterGraph.concepts,
        states,
        knownIds: unique([
          ...scheduled.packet.evening.recall_items.flatMap((item) => item.concept_ids),
          ...boundCues.map((cue) => cue.concept_id)
        ]),
        frontierIds: unique([
          ...scheduled.packet.evening.transfer_drills.flatMap((item) => item.concept_ids),
          ...boundCues.map((cue) => cue.concept_id)
        ]),
        horizonIds: scheduled.packet.morning.horizon_items.map((concept) => concept.id),
        readiness,
        conservative:
          scheduled.packet.evening.screen_policy === "audio_only" ||
          readiness.dusk_mode ||
          readiness.fatigue > 0.7
      }),
    [
      boundCues,
      readiness,
      scheduled.packet.evening.recall_items,
      scheduled.packet.evening.screen_policy,
      scheduled.packet.evening.transfer_drills,
      scheduled.packet.morning.horizon_items,
      states
    ]
  );
  const phoneDownReady = Object.values(phoneDownChecklist).every(Boolean);
  const sleepCuedConceptIds = useMemo(
    () =>
      unique([
        ...scheduled.packet.sleep.reactivate_concept_ids,
        ...scheduled.packet.sleep.stabilize_concept_ids,
        ...scheduled.packet.sleep.prime_concept_ids
      ]).slice(0, 3),
    [scheduled.packet.sleep]
  );
  const sleepControlConceptIds = useMemo(
    () => scheduled.packet.sleep.control_concept_ids.slice(0, 3),
    [scheduled.packet.sleep.control_concept_ids]
  );

  useEffect(() => {
    if (!apiConfig) return;
    void hydrateFromBackend("initial");
  }, [apiConfig]);

  useEffect(() => {
    let active = true;
    listOfflineQueueItems()
      .then((items) => {
        if (!active) return;
        setOfflineQueue((current) => items.reduce((next, item) => upsertOfflineItem(next, item), current));
        setOfflineSyncStatus(items.length > 0 ? `${items.length} stored actions` : "indexeddb ready");
      })
      .catch(() => {
        if (active) setOfflineSyncStatus("memory fallback");
      });
    return () => {
      active = false;
    };
  }, []);

  async function hydrateFromBackend(reason: "initial" | "manual") {
    if (!apiConfig) {
      setBackendStatus("local");
      setBackendMeta("local demo");
      setEventLog((current) => ["backend not configured", ...current].slice(0, 6));
      return;
    }
    setBackendStatus("connecting");
    setBackendMeta("loading persisted state");
    try {
      const bootstrap = await fetchAppBootstrap(apiConfig, { generateMissingPacket: true });
      setActiveUser(bootstrap.user);
      setActiveGoals(bootstrap.goals);
      setBackendPacket(bootstrap.daily_packet ?? null);
      setBackendAudioPlan(bootstrap.audio_plan ?? null);
      setReadiness(bootstrap.readiness);
      if (bootstrap.user_graph.states.length > 0) {
        setStates(bootstrap.user_graph.states);
      }
      const firstGoalTarget = bootstrap.goals[0]?.target_concept_ids[0];
      const firstGraphState = bootstrap.user_graph.states[0]?.concept_id;
      if (firstGoalTarget || firstGraphState) {
        setSelectedNodeId(firstGoalTarget ?? firstGraphState ?? selectedNodeId);
      }
      const firstPacketVideoId = bootstrap.daily_packet?.optional_watch_packets[0]?.video_ids[0];
      if (firstPacketVideoId) setCinemaVideoId(firstPacketVideoId);
      setBackendPacketSource(bootstrap.daily_packet_source);
      setBackendStatus("connected");
      setBackendMeta(
        `${bootstrap.daily_packet_source} packet / ${bootstrap.goals.length} goals / ${bootstrap.installed_packs.length} packs`
      );
      setEventLog((current) =>
        [
          `backend ${reason} bootstrap: ${bootstrap.daily_packet_source}`,
          bootstrap.daily_packet
            ? `persisted packet active: ${bootstrap.daily_packet.id}`
            : "local packet fallback",
          bootstrap.audio_plan
            ? `persisted audio plan: ${bootstrap.audio_plan.render_status}`
            : "audio preview fallback",
          `persisted graph states: ${bootstrap.user_graph.states.length}`,
          ...current
        ].slice(0, 6)
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBackendStatus("error");
      setBackendMeta(message);
      setEventLog((current) => [`backend bootstrap failed: ${message}`, ...current].slice(0, 6));
    }
  }

  useEffect(() => {
    const cachedAt = new Date().toISOString();
    const payload = {
      cached_at: cachedAt,
      packet_id: scheduled.packet.id,
      date: scheduled.packet.date,
      user_id: scheduled.packet.user_id,
      morning_items: scheduled.packet.morning.cold_retrieval_items.length,
      walk_packets: scheduled.packet.walk_packets.length,
      sleep_audio_plan_id: scheduled.audioPlan.id
    };
    try {
      window.localStorage.setItem("mnemosyne.dailyPacket.v1", JSON.stringify(payload));
      setOfflineCacheStatus("ready");
      stageOfflineAction({
        actionType: "daily_packet_cache",
        endpoint: "/api/daily-packet/today",
        method: "GET",
        payload,
        idempotencyKey: `${activeUser.id}:daily_packet_cache:${scheduled.packet.id}`
      });
    } catch {
      setOfflineCacheStatus("unavailable");
    }
  }, [scheduled.audioPlan.id, scheduled.packet]);

  useEffect(() => {
    setPacedReadChunkIndex(0);
    setPacedReadPlaying(false);
    setPacedReadResult(null);
    setPacedReadCacheStatus("pending");
  }, [pacedReadPlan?.id]);

  useEffect(() => {
    if (!pacedReadPlaying || !pacedReadPlan) return;
    if (pacedReadChunkIndex >= pacedReadPlan.chunks.length - 1) {
      setPacedReadPlaying(false);
      return;
    }
    const currentChunk = pacedReadPlan.chunks[pacedReadChunkIndex] ?? "";
    const wordsInChunk = currentChunk.split(/\s+/).filter(Boolean).length || 1;
    const delayMs = Math.max(180, Math.round((wordsInChunk / pacedReadPlan.raw_wpm) * 60_000));
    const timer = window.setTimeout(() => {
      setPacedReadChunkIndex((index) => Math.min(index + 1, pacedReadPlan.chunks.length - 1));
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [pacedReadChunkIndex, pacedReadPlan, pacedReadPlaying]);

  function stageOfflineAction(input: {
    actionType: OfflineActionType;
    endpoint: string;
    method: OfflineHttpMethod;
    payload: Record<string, unknown>;
    payloadScope?: OfflinePayloadScope;
    idempotencyKey: string;
  }) {
    const item = createOfflineQueueItem({
      userId: activeUser.id,
      actionType: input.actionType,
      endpoint: input.endpoint,
      method: input.method,
      payload: input.payload,
      payloadScope: input.payloadScope,
      idempotencyKey: input.idempotencyKey
    });
    setOfflineQueue((current) => upsertOfflineItem(current, item));
    void putOfflineQueueItem(item)
      .then(() => setOfflineSyncStatus(`${input.actionType} queued`))
      .catch(() => setOfflineSyncStatus("memory fallback"));
  }

  function syncQueuedOfflineActions() {
    setOfflineSyncStatus("syncing actions");
    void syncOfflineQueueItems({
      items: offlineQueue,
      transport: createBrowserOfflineSyncTransport(),
      workerId: "pwa-offline-sync"
    })
      .then((run) => {
        setOfflineQueue(run.items);
        persistOfflineQueue(run.items);
        setOfflineSyncStatus(`synced ${run.synced}, failed ${run.failed}`);
        setEventLog((current) =>
          [
            `offline sync receipts: ${run.synced}`,
            run.failed > 0 ? `offline sync failures: ${run.failed}` : "offline sync accepted",
            ...current
          ].slice(0, 6)
        );
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setOfflineSyncStatus("sync failed");
        setEventLog((current) => [`offline sync failed: ${message}`, ...current].slice(0, 6));
      });
  }

  function recoverOfflineQueue() {
    const recoveredAt = nowIso();
    const next = recoverStaleOfflineItems(offlineQueue, { at: recoveredAt, staleAfterMinutes: 15 });
    const recoveredCount = next.filter(
      (item, index) => item.updated_at !== offlineQueue[index]?.updated_at
    ).length;
    setOfflineQueue(next);
    persistOfflineQueue(next);
    setOfflineSyncStatus(`recovered ${recoveredCount} actions`);
    setEventLog((current) => [`offline recovery checked: ${recoveredCount}`, ...current].slice(0, 6));
  }

  function clearSyncedOfflineActions() {
    const next = offlineQueue.filter((item) => item.status !== "synced" && item.status !== "discarded");
    setOfflineQueue(next);
    void clearSyncedOfflineQueueItems()
      .then(() => setOfflineSyncStatus("synced actions cleared"))
      .catch(() => setOfflineSyncStatus("memory fallback"));
  }

  function persistOfflineQueue(items: OfflineQueueItem[]) {
    void Promise.all(items.map((item) => putOfflineQueueItem(item))).catch(() =>
      setOfflineSyncStatus("memory fallback")
    );
  }

  function submitAnswer() {
    const prompt = activeForgePrompt;
    if (!prompt || answer.trim().length === 0) return;
    const submittedAnswer = answer;
    const latencyMs = Math.max(1_000, Date.now() - forgeStartedAt);
    const response = scoreAssessmentResponse({
      userId: activeUser.id,
      item: prompt,
      rawResponse: submittedAnswer,
      confidence,
      latencyMs
    });
    setLastResponse(response);
    setRepairTips(repairTipsFor(response));
    setForgeResponses((count) => count + 1);
    setStates((current) => {
      const next = [...current];
      for (const conceptId of prompt.concept_ids) {
        const index = next.findIndex((state) => state.concept_id === conceptId);
        const state = index >= 0 ? next[index] : emptyState(conceptId);
        const updated = applyAssessmentToUserState(state, response);
        if (index >= 0) next[index] = updated;
        else next.push(updated);
      }
      return next;
    });
    setEventLog((current) =>
      [
        `${answerMode} assessment scored: ${response.model_feedback}`,
        `latency captured: ${Math.round(response.latency_ms / 1000)}s`,
        ...current
      ].slice(0, 6)
    );
    stageOfflineAction({
      actionType: "morning_forge_response",
      endpoint: "/api/morning-forge/complete",
      method: "POST",
      payload: {
        userId: activeUser.id,
        dailyPacketId: scheduled.packet.id,
        packetDate: scheduled.packet.date,
        responses: [
          {
            item: prompt,
            rawResponse: submittedAnswer,
            confidence,
            latencyMs,
            entryMode: answerMode,
            transcript: answerMode === "voice" ? submittedAnswer : undefined
          }
        ],
        screenMinutes: round(latencyMs / 60_000, 2),
        voiceUsed: answerMode === "voice",
        completedAt: new Date().toISOString()
      },
      payloadScope: answerMode === "voice" ? "voice" : "learning",
      idempotencyKey: `${activeUser.id}:morning_forge:${prompt.id}:${response.id}`
    });
    setAnswer("");
    setForgeIndex((index) => (forgeQueue.length > 0 ? (index + 1) % forgeQueue.length : index));
    setForgeStartedAt(Date.now());
  }

  function selectCinemaVideo(videoId: string) {
    setCinemaVideoId(videoId);
    setCinemaAnswer("");
    setCinemaResult(null);
    setCinemaCacheStatus("pending");
    setCinemaStartedAt(Date.now());
    const video = demoMasterGraph.videos.find((candidate) => candidate.id === videoId);
    if (video?.concept_ids[0]) setSelectedNodeId(video.concept_ids[0]);
  }

  function updateCinemaAnswer(value: string) {
    if (cinemaAnswer.trim().length === 0 && value.trim().length > 0) {
      setCinemaStartedAt(Date.now());
    }
    setCinemaAnswer(value);
    setCinemaResult(null);
    setCinemaCacheStatus("pending");
  }

  function completeGraphFeedRecall() {
    if (!activeCinemaVideo || !activeCinemaRecallPrompt || cinemaAnswer.trim().length === 0) return;
    const completedAt = new Date().toISOString();
    const response = scoreAssessmentResponse({
      userId: activeUser.id,
      item: activeCinemaRecallPrompt,
      rawResponse: cinemaAnswer,
      confidence: cinemaConfidence,
      latencyMs: Math.max(1_000, Date.now() - cinemaStartedAt)
    });
    const recallPassed = response.correctness_score >= 0.72;
    const screenMinutes = Math.min(
      activeWatchPacket?.total_time_budget_minutes ?? Math.ceil(activeCinemaVideo.duration_seconds / 60),
      Math.ceil(activeCinemaVideo.duration_seconds / 60)
    );
    const result: GraphFeedRecallResult = {
      completedAt,
      videoId: activeCinemaVideo.id,
      response,
      recallPassed,
      screenMinutes
    };
    setCinemaResult(result);
    if (recallPassed) {
      setStates((current) => applyGraphFeedResultToLocalStates(current, activeCinemaVideo, result));
    }
    try {
      window.localStorage.setItem(
        "mnemosyne.graphFeedRecall.v1",
        JSON.stringify({
          cached_at: completedAt,
          user_id: activeUser.id,
          watch_packet_id: activeWatchPacket?.id,
          video_id: activeCinemaVideo.id,
          concept_ids: activeCinemaVideo.concept_ids,
          recall_score: response.correctness_score,
          semantic_score: response.semantic_score,
          confidence: cinemaConfidence,
          recall_passed: recallPassed,
          graph_progress_awarded: recallPassed,
          screen_minutes: screenMinutes,
          suggested_next_mode: recallPassed ? activeWatchPacket?.suggested_next_mode : "retry_recall"
        })
      );
      setCinemaCacheStatus("ready");
      stageOfflineAction({
        actionType: "graphfeed_recall",
        endpoint: `/api/watch-packets/${activeWatchPacket?.id ?? "local"}/complete`,
        method: "POST",
        payload: {
          watch_packet_id: activeWatchPacket?.id,
          video_id: activeCinemaVideo.id,
          recall_passed: recallPassed,
          graph_progress_awarded: recallPassed,
          screen_minutes: screenMinutes,
          response: assessmentResponseSyncPayload(response)
        },
        idempotencyKey: `${activeUser.id}:graphfeed:${activeCinemaVideo.id}:${completedAt}`
      });
    } catch {
      setCinemaCacheStatus("unavailable");
    }
    setEventLog((current) =>
      [
        recallPassed ? "GraphFeed recall passed: progress counted" : "GraphFeed recall held progress",
        `video recall score: ${Math.round(response.correctness_score * 100)}%`,
        ...current
      ].slice(0, 6)
    );
  }

  function startWalkListening() {
    setWalkPhase("listening");
    setWalkStartedAt(Date.now());
    setWalkCommandLog((current) => ["listen", ...current].slice(0, 24));
  }

  function updateWalkAnswer(value: string) {
    if (walkAnswer.trim().length === 0 && value.trim().length > 0) {
      setWalkStartedAt(Date.now());
    }
    setWalkAnswer(value);
    setWalkCompletedAt(null);
    setWalkCacheStatus("pending");
  }

  function scoreWalkAnswer() {
    const prompt = activeWalkPrompt;
    if (!prompt || walkAnswer.trim().length === 0) return;
    const response = scoreAssessmentResponse({
      userId: activeUser.id,
      item: prompt,
      rawResponse: walkAnswer,
      confidence: walkConfidence,
      latencyMs: Math.max(1_000, Date.now() - walkStartedAt),
      hintCount: walkHintCount
    });
    setWalkResponses((current) => [...current, response]);
    setWalkLastResponse(response);
    setWalkRepairTips(repairTipsFor(response));
    setWalkPhase("feedback");
    setStates((current) => applyResponseToLocalStates(current, response));
    setEventLog((current) =>
      [
        `walk ${walkAnswerMode} recall scored: ${response.model_feedback}`,
        `walk latency: ${Math.round(response.latency_ms / 1000)}s`,
        ...current
      ].slice(0, 6)
    );
  }

  function advanceWalkPrompt() {
    const nextIndex = walkIndex + 1;
    setWalkAnswer("");
    setWalkHintCount(0);
    setWalkLastResponse(null);
    setWalkRepairTips([]);
    setWalkStartedAt(Date.now());
    if (nextIndex >= walkPrompts.length) {
      setWalkPhase("complete");
    } else {
      setWalkIndex(nextIndex);
      setWalkPhase("prompt");
    }
  }

  function runWalkCommand(command: string) {
    setWalkCommandLog((current) => [command, ...current].slice(0, 24));
    const prompt = activeWalkPrompt;
    if (command === "repeat that") {
      setWalkPhase("prompt");
    } else if (command === "give hint") {
      setWalkHintCount((count) => count + 1);
      setWalkAnswer(
        (current) => current || "I need the mechanism, a concrete example, and a boundary condition."
      );
    } else if (command === "skip" && prompt) {
      setWalkSkippedIds((current) => unique([...current, prompt.id]));
      advanceWalkPrompt();
    } else if (command === "mark confusing" && prompt) {
      setWalkConfusingIds((current) => unique([...current, prompt.id]));
      setWalkRepairTips(["Marked for repair. Keep walking and revisit this concept later."]);
      setWalkPhase("feedback");
    } else if (command === "end session") {
      completeWalkSession();
    } else if (command === "screen off") {
      setWalkPhase("listening");
    } else if (command === "harder") {
      setWalkConfidence((value) => clamp(value + 0.08));
    } else if (command === "slower") {
      setWalkConfidence((value) => clamp(value - 0.08));
    } else if (command === "explain why") {
      setWalkAnswer((current) => current || "Because the mechanism links the cause, example, and limit.");
    }
  }

  function completeWalkSession() {
    const completedAt = new Date().toISOString();
    try {
      window.localStorage.setItem(
        "mnemosyne.walkMode.v1",
        JSON.stringify({
          cached_at: completedAt,
          user_id: activeUser.id,
          walk_packet_id: activeWalkPacket?.id,
          prompts_answered: walkResponses.length,
          skipped_prompt_ids: walkSkippedIds,
          confusing_prompt_ids: walkConfusingIds,
          commands: walkCommandLog,
          voice_used: walkAnswerMode === "voice" || walkCommandLog.length > 0,
          text_used: walkResponses.some((response) => response.raw_response),
          screen_locked: true,
          transcript_retention: walkTranscriptDeleted ? "deleted" : "transcript_only",
          compatible_assessment_events: true,
          average_correctness: avg(walkResponses.map((response) => response.correctness_score))
        })
      );
      setWalkCacheStatus("ready");
      stageOfflineAction({
        actionType: "walk_mode_completion",
        endpoint: "/api/walk-mode/complete",
        method: "POST",
        payload: {
          walk_packet_id: activeWalkPacket?.id,
          prompts_answered: walkResponses.length,
          skipped_prompt_ids: walkSkippedIds,
          confusing_prompt_ids: walkConfusingIds,
          commands: walkCommandLog,
          voice_used: walkAnswerMode === "voice" || walkCommandLog.length > 0,
          screen_locked: true,
          transcript_retention: walkTranscriptDeleted ? "deleted" : "transcript_only",
          responses: walkResponses.map(assessmentResponseSyncPayload)
        },
        payloadScope: walkAnswerMode === "voice" ? "voice" : "learning",
        idempotencyKey: `${activeUser.id}:walk_mode:${activeWalkPacket?.id ?? "local"}:${completedAt}`
      });
    } catch {
      setWalkCacheStatus("unavailable");
    }
    setWalkCompletedAt(completedAt);
    setWalkPhase("complete");
    setEventLog((current) =>
      [
        `walkmode completed: ${walkResponses.length} recall events`,
        `voice transcript: ${walkTranscriptDeleted ? "deleted" : "retained as text"}`,
        ...current
      ].slice(0, 6)
    );
  }

  function deleteWalkTranscript() {
    setWalkAnswer("");
    setWalkTranscriptDeleted(true);
    setWalkCommandLog((current) => ["delete transcript", ...current].slice(0, 24));
    setWalkCacheStatus("pending");
  }

  function selectPacedReadAsset(assetId: string) {
    const asset = pacedReadAssets.find((candidate) => candidate.id === assetId);
    setPacedReadAssetId(assetId);
    if (asset?.concept_ids[0]) setSelectedNodeId(asset.concept_ids[0]);
  }

  function completePacedReadSession() {
    if (!activePacedReadAsset || !pacedReadPlan) return;
    const completedAt = new Date().toISOString();
    const scored = scorePacedReadCompletion({
      rawWpm: pacedReadPlan.raw_wpm,
      comprehensionScore: pacedReadComprehension,
      retentionScore: pacedReadRetention,
      strainRating: pacedReadStrain
    });
    const result: PacedReadEngineResult = {
      ...scored,
      completedAt,
      rawWpm: pacedReadPlan.raw_wpm,
      comprehensionScore: pacedReadComprehension,
      retentionScore: pacedReadRetention,
      strainRating: pacedReadStrain
    };
    setPacedReadPlaying(false);
    setPacedReadResult(result);
    setStates((current) => applyPacedReadResultToLocalStates(current, activePacedReadAsset, result));
    try {
      window.localStorage.setItem(
        "mnemosyne.pacedRead.v1",
        JSON.stringify({
          cached_at: completedAt,
          user_id: activeUser.id,
          asset_id: activePacedReadAsset.id,
          session_id: pacedReadPlan.id,
          display_unit: pacedReadPlan.display_unit,
          chunk_count: pacedReadPlan.chunks.length,
          raw_wpm: result.rawWpm,
          effective_wpm: result.effectiveWpm,
          comprehension_score: result.comprehensionScore,
          retention_score: result.retentionScore,
          strain_rating: result.strainRating,
          screen_load_score: result.screenLoadScore,
          advance_allowed: result.advanceAllowed,
          concept_ids: activePacedReadAsset.concept_ids
        })
      );
      setPacedReadCacheStatus("ready");
      stageOfflineAction({
        actionType: "paced_read_completion",
        endpoint: "/api/paced-read/complete",
        method: "POST",
        payload: {
          asset_id: activePacedReadAsset.id,
          paced_read_session_id: pacedReadPlan.id,
          raw_wpm: result.rawWpm,
          effective_wpm: result.effectiveWpm,
          comprehension_score: result.comprehensionScore,
          retention_score: result.retentionScore,
          strain_rating: result.strainRating,
          screen_load_score: result.screenLoadScore,
          advance_allowed: result.advanceAllowed,
          concept_ids: activePacedReadAsset.concept_ids
        },
        idempotencyKey: `${activeUser.id}:paced_read:${pacedReadPlan.id}:${completedAt}`
      });
    } catch {
      setPacedReadCacheStatus("unavailable");
    }
    setEventLog((current) =>
      [
        `local paced read completed: ${result.effectiveWpm} effective wpm`,
        result.advanceAllowed
          ? "paced read gate advanced graph state"
          : "paced read gate held graph progress",
        ...current
      ].slice(0, 6)
    );
  }

  function submitLockInAnswer() {
    const prompt = activeLockPrompt;
    if (!prompt || lockAnswer.trim().length === 0) return;
    const response = scoreAssessmentResponse({
      userId: activeUser.id,
      item: prompt.item,
      rawResponse: lockAnswer,
      confidence: lockConfidence,
      latencyMs: Math.max(1_000, Date.now() - lockStartedAt)
    });
    setLockLastResponse(response);
    setLockRepairTips(repairTipsFor(response));
    setLockResponses((count) => count + 1);
    setLockCompletedAt(null);
    setLockSleepCacheStatus("pending");
    setStates((current) => {
      const next = [...current];
      for (const conceptId of prompt.item.concept_ids) {
        const index = next.findIndex((state) => state.concept_id === conceptId);
        const state = index >= 0 ? next[index] : emptyState(conceptId);
        const updated = applyAssessmentToUserState(state, response);
        if (index >= 0) next[index] = updated;
        else next.push(updated);
      }
      return next;
    });
    setEventLog((current) =>
      [
        `evening ${prompt.phase} scored: ${response.model_feedback}`,
        `sleep prep latency: ${Math.round(response.latency_ms / 1000)}s`,
        ...current
      ].slice(0, 6)
    );
    setLockAnswer("");
    setLockIndex((index) => (eveningQueue.length > 0 ? (index + 1) % eveningQueue.length : index));
    setLockStartedAt(Date.now());
  }

  function toggleBoundCue(cueId: string) {
    setBoundCueIds((current) => {
      const selected = current.length > 0 ? current : defaultBoundCueIds;
      return selected.includes(cueId)
        ? selected.filter((id) => id !== cueId)
        : unique([...selected, cueId]).slice(0, 6);
    });
    setLockCompletedAt(null);
    setLockSleepCacheStatus("pending");
  }

  function togglePhoneDownItem(key: PhoneDownKey) {
    setPhoneDownChecklist((current) => ({ ...current, [key]: !current[key] }));
    setLockCompletedAt(null);
    setLockSleepCacheStatus("pending");
  }

  function completeLockIn() {
    const completedAt = new Date().toISOString();
    try {
      window.localStorage.setItem(
        "mnemosyne.eveningLockIn.v1",
        JSON.stringify({
          cached_at: completedAt,
          user_id: activeUser.id,
          daily_packet_id: scheduled.packet.id,
          screen_policy: scheduled.packet.evening.screen_policy,
          phone_down_ready: phoneDownReady,
          completed_responses: lockResponses,
          bound_cue_ids: selectedBoundCueIds,
          bound_concept_ids: boundCues.map((cue) => cue.concept_id),
          sleep_packet_id: lockSleepResult.packet.id,
          audio_plan_id: lockSleepResult.audioPlan.id,
          cue_spacing_seconds: lockSleepResult.packet.cue_spacing_seconds,
          max_cues_per_hour: lockSleepResult.packet.max_cues_per_hour,
          local_reminder_at: lockSleepResult.packet.target_sleep_window.estimated_sleep_onset_at
        })
      );
      setLockSleepCacheStatus("ready");
      stageOfflineAction({
        actionType: "evening_lock_in_completion",
        endpoint: "/api/evening-lock-in/complete",
        method: "POST",
        payload: {
          daily_packet_id: scheduled.packet.id,
          completed_responses: lockResponses,
          phone_down_ready: phoneDownReady,
          bound_cue_ids: selectedBoundCueIds,
          bound_concept_ids: boundCues.map((cue) => cue.concept_id),
          sleep_packet_id: lockSleepResult.packet.id,
          audio_plan_id: lockSleepResult.audioPlan.id
        },
        payloadScope: lockAnswerMode === "voice" ? "voice" : "sleep",
        idempotencyKey: `${activeUser.id}:evening_lock_in:${scheduled.packet.id}:${completedAt}`
      });
    } catch {
      setLockSleepCacheStatus("unavailable");
    }
    setLockCompletedAt(completedAt);
    setEventLog((current) =>
      [
        `evening lock-in completed: ${boundCues.length} cues bound`,
        `sleep packet cached: ${lockSleepResult.packet.id}`,
        `phone-down ready: ${phoneDownReady ? "yes" : "no"}`,
        ...current
      ].slice(0, 6)
    );
  }

  function startSleepPlayback() {
    const startedAt = new Date().toISOString();
    setSleepPlaybackStartedAt(startedAt);
    setSleepPlaybackStatus("running");
    setSleepRecallResult(null);
    setSleepCacheStatus("pending");
    setEventLog((current) =>
      [`sleep playback started: ${scheduled.packet.sleep.id}`, "stop conditions armed", ...current].slice(
        0,
        6
      )
    );
  }

  function logSleepPlayback() {
    const loggedAt = new Date().toISOString();
    const cueEvents = [
      ...scheduled.packet.sleep.reactivate_concept_ids.map((conceptId) => ({
        conceptId,
        bucket: "reactivate"
      })),
      ...scheduled.packet.sleep.stabilize_concept_ids.map((conceptId) => ({
        conceptId,
        bucket: "stabilize"
      })),
      ...scheduled.packet.sleep.prime_concept_ids.map((conceptId) => ({ conceptId, bucket: "prime" }))
    ].slice(0, 18);
    try {
      window.localStorage.setItem(
        "mnemosyne.sleepPlayback.v1",
        JSON.stringify({
          cached_at: loggedAt,
          user_id: activeUser.id,
          sleep_packet_id: scheduled.packet.sleep.id,
          audio_plan_id: scheduled.packet.sleep.audio_plan_id,
          playback_started_at: sleepPlaybackStartedAt ?? loggedAt,
          playback_ended_at: loggedAt,
          stop_condition: sleepStopCondition,
          sleep_disruption_reported: sleepDisruptionReported,
          cues_played: cueEvents.length,
          cue_events: cueEvents
        })
      );
      setSleepCacheStatus("playback ready");
      stageOfflineAction({
        actionType: "sleep_playback_event",
        endpoint: "/api/sleep/playback/events",
        method: "POST",
        payload: {
          sleep_packet_id: scheduled.packet.sleep.id,
          audio_plan_id: scheduled.packet.sleep.audio_plan_id,
          playback_started_at: sleepPlaybackStartedAt ?? loggedAt,
          playback_ended_at: loggedAt,
          stop_condition: sleepStopCondition,
          sleep_disruption_reported: sleepDisruptionReported,
          cue_events: cueEvents
        },
        payloadScope: "sleep",
        idempotencyKey: `${activeUser.id}:sleep_playback:${scheduled.packet.sleep.id}:${loggedAt}`
      });
    } catch {
      setSleepCacheStatus("unavailable");
    }
    setSleepPlaybackStatus("logged");
    setEventLog((current) =>
      [
        `sleep playback logged: ${cueEvents.length} cues`,
        `stop condition: ${sleepStopCondition}`,
        ...current
      ].slice(0, 6)
    );
  }

  function runSleepRecallCheck() {
    const completedAt = new Date().toISOString();
    const scoredCued = sleepCuedConceptIds.flatMap((conceptId) => {
      const concept = demoMasterGraph.concepts.find((candidate) => candidate.id === conceptId);
      if (!concept) return [];
      const item = generateAssessmentForConcept(concept, "free_recall");
      return [
        scoreAssessmentResponse({
          userId: activeUser.id,
          item,
          rawResponse: item.expected_answer ?? item.prompt,
          confidence: 0.76,
          latencyMs: 18_000
        })
      ];
    });
    const scoredControls = sleepControlConceptIds.flatMap((conceptId) => {
      const concept = demoMasterGraph.concepts.find((candidate) => candidate.id === conceptId);
      if (!concept) return [];
      const item = generateAssessmentForConcept(concept, "free_recall");
      return [
        scoreAssessmentResponse({
          userId: activeUser.id,
          item,
          rawResponse: "not sure yet",
          confidence: 0.34,
          latencyMs: 38_000
        })
      ];
    });
    const cuedScore = avg(scoredCued.map((response) => response.correctness_score));
    const controlScore = avg(scoredControls.map((response) => response.correctness_score));
    const cueGainDelta = round(cuedScore - controlScore, 3);
    setStates((current) => {
      let next = [...current];
      for (const response of [...scoredCued, ...scoredControls]) {
        next = applyResponseToLocalStates(next, response);
      }
      const cuedConceptSet = new Set(sleepCuedConceptIds);
      next = next.map((state) =>
        cuedConceptSet.has(state.concept_id)
          ? {
              ...state,
              sleep_replays: state.sleep_replays + 1,
              cue_gain_estimate: clamp(state.cue_gain_estimate * 0.72 + cueGainDelta * 0.28, -1, 1),
              best_cue_type: cueGainDelta > 0 ? "sleep_reactivation" : state.best_cue_type,
              updated_at: completedAt
            }
          : state
      );
      return next;
    });
    setSleepRecallResult({
      completedAt,
      cuedScore,
      controlScore,
      cueGainDelta,
      cuedConceptIds: sleepCuedConceptIds,
      controlConceptIds: sleepControlConceptIds
    });
    try {
      window.localStorage.setItem(
        "mnemosyne.sleepCueRecall.v1",
        JSON.stringify({
          cached_at: completedAt,
          user_id: activeUser.id,
          sleep_packet_id: scheduled.packet.sleep.id,
          controls_revealed: true,
          cued_concept_ids: sleepCuedConceptIds,
          control_concept_ids: sleepControlConceptIds,
          average_cued_correctness: cuedScore,
          average_control_correctness: controlScore,
          cue_gain_delta: cueGainDelta
        })
      );
      setSleepCacheStatus("recall ready");
      stageOfflineAction({
        actionType: "sleep_recall_completion",
        endpoint: "/api/sleep/recall/complete",
        method: "POST",
        payload: {
          sleep_packet_id: scheduled.packet.sleep.id,
          controls_revealed: true,
          cued_concept_ids: sleepCuedConceptIds,
          control_concept_ids: sleepControlConceptIds,
          average_cued_correctness: cuedScore,
          average_control_correctness: controlScore,
          cue_gain_delta: cueGainDelta,
          responses: [...scoredCued, ...scoredControls].map(assessmentResponseSyncPayload)
        },
        payloadScope: "sleep",
        idempotencyKey: `${activeUser.id}:sleep_recall:${scheduled.packet.sleep.id}:${completedAt}`
      });
    } catch {
      setSleepCacheStatus("unavailable");
    }
    setEventLog((current) =>
      [
        `sleep cue recall complete: ${Math.round(cueGainDelta * 100)}pt gain`,
        "matched controls revealed in results",
        ...current
      ].slice(0, 6)
    );
  }

  function launchFromOnboarding(config: OnboardingLaunch) {
    setActiveGoals([buildLocalGoalFromOnboarding(config, activeUser.id)]);
    setBackendPacket(null);
    setBackendAudioPlan(null);
    setBackendPacketSource("missing");
    setReadiness(config.readiness);
    setStates(config.states);
    setSelectedNodeId(config.targetConceptIds[0] ?? "attention_qkv");
    setForgeIndex(0);
    setForgeResponses(0);
    setRepairTips([]);
    setLastResponse(null);
    setForgeStartedAt(Date.now());
    setWalkIndex(0);
    setWalkPhase("prompt");
    setWalkAnswer("");
    setWalkStartedAt(Date.now());
    setWalkHintCount(0);
    setWalkResponses([]);
    setWalkLastResponse(null);
    setWalkRepairTips([]);
    setWalkCommandLog([]);
    setWalkSkippedIds([]);
    setWalkConfusingIds([]);
    setWalkCacheStatus("pending");
    setWalkCompletedAt(null);
    setWalkTranscriptDeleted(true);
    setLockIndex(0);
    setLockResponses(0);
    setLockRepairTips([]);
    setLockLastResponse(null);
    setLockSleepCacheStatus("pending");
    setLockCompletedAt(null);
    setLockStartedAt(Date.now());
    setBoundCueIds([]);
    setSleepPlaybackStatus("planned");
    setSleepPlaybackStartedAt(null);
    setSleepStopCondition("none");
    setSleepDisruptionReported(false);
    setSleepRecallResult(null);
    setSleepCacheStatus("pending");
    setEventLog((current) =>
      [
        `onboarding completed: ${config.goalTitle}`,
        `${config.packCount} packs installed`,
        `${config.diagnosticCount} diagnostics queued`,
        ...current
      ].slice(0, 6)
    );
    setActiveTab("today");
  }

  function connectOuraDemo() {
    setWearableConnectionStatus("connected");
    setEventLog((current) =>
      ["oura authorization linked", "tokens remain server-side encrypted", ...current].slice(0, 6)
    );
  }

  function syncWearableDemoSleep() {
    setWearableConnectionStatus((status) => (status === "revoked" ? "connected" : status));
    setWearableSleep(sampleWearableSleep);
    setReadiness((current) => readinessFromWearableSleep(sampleWearableSleep, current));
    stageOfflineAction({
      actionType: "wearable_sleep_sync",
      endpoint: "/api/wearables/sync",
      method: "POST",
      payload: {
        provider: sampleWearableSleep.provider,
        external_id: sampleWearableSleep.external_id,
        sleep_quality: sampleWearableSleep.sleep_quality,
        readiness_delta: sampleWearableSleep.readiness_delta,
        stage_minutes: sampleWearableSleep.stage_minutes
      },
      payloadScope: "health",
      idempotencyKey: `${activeUser.id}:wearable_sleep:${sampleWearableSleep.external_id}`
    });
    setEventLog((current) =>
      [
        `wearable sleep synced: ${Math.round(sampleWearableSleep.sleep_quality * 100)}% quality`,
        `${Math.round(sampleWearableSleep.stage_minutes.deep)}m deep / ${Math.round(sampleWearableSleep.stage_minutes.rem)}m REM`,
        ...current
      ].slice(0, 6)
    );
  }

  function revokeOuraDemo() {
    setWearableConnectionStatus("revoked");
    setWearableSleep(null);
    setEventLog((current) => ["oura connection revoked", "wearable tokens cleared", ...current].slice(0, 6));
  }

  const page = {
    onboarding: <OnboardingView onComplete={launchFromOnboarding} />,
    today: (
      <TodayView
        readiness={readiness}
        setReadiness={setReadiness}
        packet={scheduled.packet}
        metrics={{
          graphVelocity: snapshot.metrics.graphVelocity,
          durableMastery,
          screenEfficiency,
          sleepIntegrity
        }}
      />
    ),
    graph: (
      <GraphView
        snapshot={snapshot}
        selectedNode={selectedNode}
        selectedState={selectedState}
        setSelectedNodeId={setSelectedNodeId}
      />
    ),
    forge: (
      <ForgeView
        packet={scheduled.packet}
        prompt={activeForgePrompt}
        promptIndex={forgeQueue.length > 0 ? forgeIndex + 1 : 0}
        queueLength={forgeQueue.length}
        frontier={scheduled.packet.morning.frontier_items}
        horizon={scheduled.packet.morning.horizon_items}
        cuePreview={scheduled.packet.morning.cue_preview_items}
        answer={answer}
        setAnswer={setAnswer}
        answerMode={answerMode}
        setAnswerMode={setAnswerMode}
        confidence={confidence}
        setConfidence={setConfidence}
        latencySeconds={Math.max(1, Math.round((Date.now() - forgeStartedAt) / 1000))}
        submitAnswer={submitAnswer}
        lastResponse={lastResponse}
        repairTips={repairTips}
        completedCount={forgeResponses}
        offlineCacheStatus={offlineCacheStatus}
      />
    ),
    cinema: (
      <CinemaView
        rankedVideos={rankedVideos}
        packet={activeWatchPacket}
        packetVideos={packetVideos}
        activeVideo={activeCinemaVideo}
        selectVideo={selectCinemaVideo}
        recallPrompt={activeCinemaRecallPrompt}
        answer={cinemaAnswer}
        setAnswer={updateCinemaAnswer}
        confidence={cinemaConfidence}
        setConfidence={setCinemaConfidence}
        completeRecall={completeGraphFeedRecall}
        result={cinemaResult}
        cacheStatus={cinemaCacheStatus}
        concepts={demoMasterGraph.concepts}
      />
    ),
    pacedRead: (
      <PacedReadView
        assets={pacedReadAssets}
        activeAsset={activePacedReadAsset}
        plan={pacedReadPlan}
        chunk={activePacedReadChunk}
        chunkIndex={pacedReadChunkIndex}
        progress={pacedReadProgress}
        playing={pacedReadPlaying}
        setPlaying={setPacedReadPlaying}
        selectAsset={selectPacedReadAsset}
        displayUnit={pacedReadDisplayUnit}
        setDisplayUnit={setPacedReadDisplayUnit}
        requestedWpm={pacedReadRequestedWpm}
        setRequestedWpm={setPacedReadRequestedWpm}
        previousChunk={() => setPacedReadChunkIndex((index) => Math.max(0, index - 1))}
        nextChunk={() =>
          setPacedReadChunkIndex((index) => Math.min((pacedReadPlan?.chunks.length ?? 1) - 1, index + 1))
        }
        restart={() => setPacedReadChunkIndex(0)}
        comprehension={pacedReadComprehension}
        setComprehension={setPacedReadComprehension}
        retention={pacedReadRetention}
        setRetention={setPacedReadRetention}
        strain={pacedReadStrain}
        setStrain={setPacedReadStrain}
        completeSession={completePacedReadSession}
        result={pacedReadResult}
        cacheStatus={pacedReadCacheStatus}
        concepts={demoMasterGraph.concepts}
      />
    ),
    walk: (
      <WalkView
        packet={activeWalkPacket}
        prompt={activeWalkPrompt}
        promptIndex={walkPrompts.length > 0 ? walkIndex + 1 : 0}
        queueLength={walkPrompts.length}
        phase={walkPhase}
        answer={walkAnswer}
        setAnswer={updateWalkAnswer}
        answerMode={walkAnswerMode}
        setAnswerMode={setWalkAnswerMode}
        confidence={walkConfidence}
        setConfidence={setWalkConfidence}
        startListening={startWalkListening}
        scoreAnswer={scoreWalkAnswer}
        nextPrompt={advanceWalkPrompt}
        runCommand={runWalkCommand}
        completeSession={completeWalkSession}
        deleteTranscript={deleteWalkTranscript}
        lastResponse={walkLastResponse}
        repairTips={walkRepairTips}
        commandLog={walkCommandLog}
        skippedIds={walkSkippedIds}
        confusingIds={walkConfusingIds}
        cacheStatus={walkCacheStatus}
        completedAt={walkCompletedAt}
        transcriptDeleted={walkTranscriptDeleted}
        setTranscriptDeleted={setWalkTranscriptDeleted}
        answeredCount={walkResponses.length}
      />
    ),
    lock: (
      <LockInView
        packet={scheduled.packet}
        prompt={activeLockPrompt}
        promptIndex={eveningQueue.length > 0 ? lockIndex + 1 : 0}
        queueLength={eveningQueue.length}
        answer={lockAnswer}
        setAnswer={setLockAnswer}
        answerMode={lockAnswerMode}
        setAnswerMode={setLockAnswerMode}
        confidence={lockConfidence}
        setConfidence={setLockConfidence}
        latencySeconds={Math.max(1, Math.round((Date.now() - lockStartedAt) / 1000))}
        submitAnswer={submitLockInAnswer}
        lastResponse={lockLastResponse}
        repairTips={lockRepairTips}
        completedCount={lockResponses}
        selectedCueIds={selectedBoundCueIds}
        toggleCue={toggleBoundCue}
        phoneDownChecklist={phoneDownChecklist}
        togglePhoneDownItem={togglePhoneDownItem}
        phoneDownReady={phoneDownReady}
        sleepResult={lockSleepResult}
        cacheStatus={lockSleepCacheStatus}
        completedAt={lockCompletedAt}
        completeLockIn={completeLockIn}
        audioPlaying={lockAudioPlaying}
        setAudioPlaying={setLockAudioPlaying}
      />
    ),
    sleep: (
      <SleepView
        packet={scheduled.packet.sleep}
        audioPlan={scheduled.audioPlan}
        integrity={sleepIntegrity}
        playbackStatus={sleepPlaybackStatus}
        startPlayback={startSleepPlayback}
        logPlayback={logSleepPlayback}
        stopCondition={sleepStopCondition}
        setStopCondition={setSleepStopCondition}
        disruptionReported={sleepDisruptionReported}
        setDisruptionReported={setSleepDisruptionReported}
        cacheStatus={sleepCacheStatus}
        recallResult={sleepRecallResult}
        runRecallCheck={runSleepRecallCheck}
        cuedConceptIds={sleepCuedConceptIds}
        controlConceptIds={sleepControlConceptIds}
        concepts={demoMasterGraph.concepts}
      />
    ),
    stats: (
      <StatsView
        snapshot={snapshot}
        states={states}
        screenEfficiency={screenEfficiency}
        sleepIntegrity={sleepIntegrity}
      />
    ),
    social: <SocialView dashboard={socialDashboard} />,
    wearables: (
      <WearablesView
        dashboard={wearableDashboard}
        authorizationUrl={ouraAuthorization.authorization_url}
        onConnect={connectOuraDemo}
        onSync={syncWearableDemoSleep}
        onRevoke={revokeOuraDemo}
      />
    ),
    packs: <PacksView />,
    court: <CourtView verdict={verdict} userId={activeUser.id} />,
    lab: (
      <LabView
        techniques={recommendedTechniques}
        assignments={experimentAssignments}
        profile={personalizationProfile}
        rollups={experimentRollups}
      />
    ),
    workbench: (
      <WorkbenchView
        offlineSummary={offlineQueueSummary}
        offlineQueue={offlineQueue}
        offlineSyncStatus={offlineSyncStatus}
        onSyncOfflineQueue={syncQueuedOfflineActions}
        onRecoverOfflineQueue={recoverOfflineQueue}
        onClearSyncedOfflineQueue={clearSyncedOfflineActions}
      />
    ),
    admin: (
      <AdminView
        userId={activeUser.id}
        eventLog={eventLog}
        onAuditEvent={(event) => setEventLog((current) => [event, ...current].slice(0, 8))}
      />
    )
  }[activeTab];

  return (
    <div className="app-shell">
      <aside className="rail" aria-label="Primary">
        <div className="brand-mark" aria-label="Mnemosyne Engine">
          <Brain size={24} />
        </div>
        <nav className="tab-list">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                className={`tab-button ${activeTab === tab.id ? "is-active" : ""}`}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={tab.label}
                aria-label={tab.label}
              >
                <Icon size={20} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Mnemosyne Engine</p>
            <h1>{tabs.find((tab) => tab.id === activeTab)?.label}</h1>
          </div>
          <div className="topbar-actions">
            <button
              className={`backend-pill ${backendStatus}`}
              onClick={() => void hydrateFromBackend("manual")}
              title={backendMeta}
            >
              <Database size={16} />
              <span>{backendStatus}</span>
              <small>{backendPacketSource}</small>
            </button>
            <IconButton
              title="Regenerate packet"
              icon={RefreshCcw}
              onClick={() => setEventLog((log) => ["packet refreshed", ...log])}
            />
            <IconButton title="Search graph" icon={Search} />
            <IconButton title="Start audio" icon={Volume2} />
          </div>
        </header>
        {page}
      </main>
    </div>
  );
}

type GoalTemplateId = "ai" | "travel" | "python";

type OnboardingLaunch = {
  goalTitle: string;
  goalDescription: string;
  packCount: number;
  diagnosticCount: number;
  targetConceptIds: string[];
  targetDomainIds: string[];
  desiredModalities: Goal["desired_modalities"];
  readiness: ReadinessProfile;
  states: UserConceptState[];
};

const onboardingGoalTemplates: Record<
  GoalTemplateId,
  {
    title: string;
    description: string;
    domains: string[];
    conceptIds: string[];
    packs: string[];
  }
> = {
  ai: {
    title: "AI systems interview readiness",
    description: "Vectors, attention, and transformer blocks with durable recall and transfer.",
    domains: ["ai", "math"],
    conceptIds: ["ai_vectors", "attention_qkv", "transformer_blocks"],
    packs: ["pack_ai_systems", "pack_linear_algebra"]
  },
  travel: {
    title: "Mexico trip readiness",
    description: "Travel Spanish plus cultural context for restaurants, transit, and daily situations.",
    domains: ["language", "history"],
    conceptIds: ["spanish_restaurant", "spanish_directions", "mexico_etiquette"],
    packs: ["pack_spanish_travel", "pack_world_history"]
  },
  python: {
    title: "Python debugging fluency",
    description: "Functions, variables, and debugging loops for practical project work.",
    domains: ["coding"],
    conceptIds: ["python_variables", "python_functions", "python_debugging"],
    packs: ["pack_python_basics"]
  }
};

const onboardingPacks = [
  { id: "pack_ai_systems", title: "AI Systems", domain: "ai", quality: "expert reviewed" },
  { id: "pack_linear_algebra", title: "Linear Algebra", domain: "math", quality: "community" },
  { id: "pack_spanish_travel", title: "Spanish Travel", domain: "language", quality: "tested" },
  { id: "pack_python_basics", title: "Python Basics", domain: "coding", quality: "tested" },
  { id: "pack_world_history", title: "World History", domain: "history", quality: "community" }
];

function buildLocalGoalFromOnboarding(config: OnboardingLaunch, userId: string): Goal {
  const createdAt = nowIso();
  return {
    id: createId("goal", `${userId}:${config.goalTitle}:${createdAt}`),
    user_id: userId,
    title: config.goalTitle,
    description: config.goalDescription,
    goal_type: "skill",
    target_concept_ids: config.targetConceptIds,
    target_domain_ids: config.targetDomainIds,
    priority: 0.86,
    intensity: "normal",
    desired_modalities: config.desiredModalities,
    avoid_modalities: [],
    created_at: createdAt,
    updated_at: createdAt
  };
}

function OnboardingView({ onComplete }: { onComplete: (config: OnboardingLaunch) => void }) {
  const [step, setStep] = useState(0);
  const [templateId, setTemplateId] = useState<GoalTemplateId>("ai");
  const template = onboardingGoalTemplates[templateId];
  const [goalTitle, setGoalTitle] = useState(template.title);
  const [goalDescription, setGoalDescription] = useState(template.description);
  const [selectedPacks, setSelectedPacks] = useState<string[]>(template.packs);
  const [morningMinutes, setMorningMinutes] = useState(30);
  const [eveningMinutes, setEveningMinutes] = useState(30);
  const [voiceFirst, setVoiceFirst] = useState(true);
  const [walking, setWalking] = useState(true);
  const [pacedRead, setPacedRead] = useState(true);
  const [researchConsent, setResearchConsent] = useState(false);

  const targetConcepts = useMemo(
    () =>
      demoMasterGraph.concepts
        .filter(
          (concept) => template.conceptIds.includes(concept.id) || template.domains.includes(concept.domain)
        )
        .slice(0, 8),
    [template]
  );
  const diagnostics = useMemo(
    () =>
      targetConcepts
        .slice(0, 5)
        .map((concept, index) =>
          generateAssessmentForConcept(concept, index % 3 === 2 ? "transfer" : "free_recall")
        ),
    [targetConcepts]
  );
  const readiness: ReadinessProfile = {
    ...defaultReadiness,
    available_minutes_morning: morningMinutes,
    available_minutes_evening: eveningMinutes,
    screen_budget_minutes: voiceFirst ? 28 : 42,
    voice_ok: voiceFirst,
    dusk_mode: true,
    notes: "Initialized from onboarding."
  };
  const estimatedMinutes = 3 + diagnostics.length + selectedPacks.length;
  const steps = ["Goal", "Packs", "Preferences", "Diagnostics", "Launch"];

  function selectTemplate(id: GoalTemplateId) {
    const next = onboardingGoalTemplates[id];
    setTemplateId(id);
    setGoalTitle(next.title);
    setGoalDescription(next.description);
    setSelectedPacks(next.packs);
  }

  function togglePack(id: string) {
    setSelectedPacks((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  function finish() {
    onComplete({
      goalTitle,
      goalDescription,
      packCount: selectedPacks.length,
      diagnosticCount: diagnostics.length,
      targetConceptIds: targetConcepts.map((concept) => concept.id),
      targetDomainIds: template.domains,
      desiredModalities: unique([
        voiceFirst ? "voice" : "text",
        walking ? "walking" : "visual",
        pacedRead ? "text" : "visual",
        "audio"
      ]) as Goal["desired_modalities"],
      readiness,
      states: buildOnboardingPreviewStates(targetConcepts)
    });
  }

  return (
    <div className="page-grid onboarding-grid">
      <section className="panel onboarding-hero">
        <PanelTitle icon={Sparkles} title="First Packet Setup" meta={`${estimatedMinutes} min`} />
        <div className="onboarding-steps" aria-label="Onboarding steps">
          {steps.map((label, index) => (
            <button
              key={label}
              className={`step-dot ${step === index ? "is-active" : ""} ${step > index ? "is-done" : ""}`}
              onClick={() => setStep(index)}
              aria-label={label}
            >
              {index + 1}
            </button>
          ))}
        </div>
        {step === 0 && (
          <div className="wizard-stack">
            <div className="choice-grid">
              {(Object.keys(onboardingGoalTemplates) as GoalTemplateId[]).map((id) => (
                <button
                  className={`choice-card ${templateId === id ? "is-selected" : ""}`}
                  key={id}
                  onClick={() => selectTemplate(id)}
                >
                  <GitBranch size={20} />
                  <strong>{onboardingGoalTemplates[id].title}</strong>
                  <span>{onboardingGoalTemplates[id].domains.join(" + ")}</span>
                </button>
              ))}
            </div>
            <label className="form-field">
              <span>Goal title</span>
              <input value={goalTitle} onChange={(event) => setGoalTitle(event.target.value)} />
            </label>
            <label className="form-field">
              <span>Goal brief</span>
              <textarea
                value={goalDescription}
                onChange={(event) => setGoalDescription(event.target.value)}
                rows={4}
              />
            </label>
          </div>
        )}
        {step === 1 && (
          <div className="pack-grid compact">
            {onboardingPacks.map((pack) => (
              <button
                className={`choice-card pack-choice ${selectedPacks.includes(pack.id) ? "is-selected" : ""}`}
                key={pack.id}
                onClick={() => togglePack(pack.id)}
              >
                <BookOpen size={20} />
                <strong>{pack.title}</strong>
                <span>{pack.domain}</span>
                <span className="tag">{pack.quality}</span>
              </button>
            ))}
          </div>
        )}
        {step === 2 && (
          <div className="wizard-stack">
            <Slider
              label="Morning"
              value={morningMinutes / 60}
              onChange={(value) => setMorningMinutes(Math.max(10, Math.round(value * 60)))}
              suffix={`${morningMinutes}m`}
            />
            <Slider
              label="Evening"
              value={eveningMinutes / 60}
              onChange={(value) => setEveningMinutes(Math.max(10, Math.round(value * 60)))}
              suffix={`${eveningMinutes}m`}
            />
            <div className="preference-grid">
              <ToggleCard
                label="Voice first"
                checked={voiceFirst}
                onChange={setVoiceFirst}
                icon={AudioLines}
              />
              <ToggleCard label="Walking" checked={walking} onChange={setWalking} icon={Footprints} />
              <ToggleCard label="Paced Read" checked={pacedRead} onChange={setPacedRead} icon={BookOpen} />
              <ToggleCard
                label="Research consent"
                checked={researchConsent}
                onChange={setResearchConsent}
                icon={FlaskConical}
              />
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="object-list">
            {diagnostics.map((item, index) => (
              <ObjectLine key={item.id} label={`D${index + 1}`} value={item.prompt} />
            ))}
          </div>
        )}
        {step === 4 && (
          <div className="launch-panel">
            <CheckCircle2 size={32} />
            <h2>{goalTitle}</h2>
            <div className="case-grid">
              <MiniStat label="Packs" value={`${selectedPacks.length}`} />
              <MiniStat label="Diagnostics" value={`${diagnostics.length}`} />
              <MiniStat label="Private" value="default" />
              <MiniStat label="Voice" value={voiceFirst ? "on" : "off"} />
            </div>
          </div>
        )}
        <div className="wizard-actions">
          <button className="command" onClick={() => setStep(Math.max(0, step - 1))}>
            Back
          </button>
          {step < steps.length - 1 ? (
            <button className="command primary" onClick={() => setStep(Math.min(steps.length - 1, step + 1))}>
              Next
            </button>
          ) : (
            <button className="command primary" onClick={finish}>
              <CheckCircle2 size={18} />
              Start
            </button>
          )}
        </div>
      </section>

      <section className="panel">
        <PanelTitle icon={ShieldCheck} title="Defaults" meta="private" />
        <div className="object-list">
          <ObjectLine label="Sharing" value="private" />
          <ObjectLine label="Voice" value={voiceFirst ? "transcript only after consent" : "off"} />
          <ObjectLine label="Health" value="derived readiness only" />
          <ObjectLine label="Research" value={researchConsent ? "allowed" : "off"} />
        </div>
      </section>

      <section className="panel">
        <PanelTitle icon={Database} title="Detected Device" meta="browser" />
        <div className="case-grid">
          <MiniStat label="Push" value="prompt" />
          <MiniStat label="Audio" value="ready" />
          <MiniStat label="Mic" value={voiceFirst ? "check" : "skip"} />
          <MiniStat label="Offline" value="cache" />
        </div>
      </section>
    </div>
  );
}

function ToggleCard({
  label,
  checked,
  onChange,
  icon: Icon
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  icon: typeof Home;
}) {
  return (
    <label className={`toggle-card ${checked ? "is-on" : ""}`}>
      <Icon size={18} />
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function buildOnboardingPreviewStates(concepts: ConceptNode[]): UserConceptState[] {
  const targets = concepts.slice(0, 8).map((concept) => ({
    ...emptyState(concept.id),
    mastery: 0.18,
    recall_strength: 0.12,
    transfer_score: 0.1,
    status: "previewed" as const
  }));
  const existing = initialUserStates.filter(
    (state) => !targets.some((target) => target.concept_id === state.concept_id)
  );
  return [...targets, ...existing].slice(0, 14);
}

function TodayView({
  readiness,
  setReadiness,
  packet,
  metrics
}: {
  readiness: ReadinessProfile;
  setReadiness: (next: ReadinessProfile) => void;
  packet: ScheduledDay["packet"];
  metrics: {
    graphVelocity: number;
    durableMastery: number;
    screenEfficiency: number;
    sleepIntegrity: number;
  };
}) {
  return (
    <div className="page-grid today-grid">
      <section className="metric-strip">
        <MetricTile
          icon={GitBranch}
          label="Graph Velocity"
          value={`${metrics.graphVelocity}/wk`}
          tone="teal"
        />
        <MetricTile
          icon={CircleGauge}
          label="Durable Mastery"
          value={`${Math.round(metrics.durableMastery * 100)}%`}
          tone="amber"
        />
        <MetricTile
          icon={Activity}
          label="Screen Efficiency"
          value={metrics.screenEfficiency.toFixed(2)}
          tone="coral"
        />
        <MetricTile
          icon={Moon}
          label="Sleep Integrity"
          value={`${Math.round(metrics.sleepIntegrity * 100)}%`}
          tone="indigo"
        />
      </section>

      <section className="panel timeline-panel">
        <PanelTitle icon={Sparkles} title="Daily Packet" meta={packet.date} />
        <div className="session-stack">
          <SessionRow
            icon={SunMedium}
            title="Morning Forge"
            time="30 min"
            details={[
              `${packet.morning.cold_retrieval_items.length} cold retrieval`,
              `${packet.morning.frontier_items.length} frontier`,
              packet.morning.recommended_mode
            ]}
          />
          <SessionRow
            icon={Video}
            title="GraphFeed"
            time={`${packet.optional_watch_packets[0]?.total_time_budget_minutes ?? 0} min`}
            details={[
              `${packet.optional_watch_packets[0]?.video_ids.length ?? 0} videos`,
              "post-watch recall",
              packet.optional_watch_packets[0]?.suggested_next_mode ?? "stop"
            ]}
          />
          <SessionRow
            icon={Footprints}
            title="WalkMode"
            time="12 min"
            details={[
              `${packet.walk_packets[0]?.prompts.length ?? 0} prompts`,
              "screen locked",
              "voice scored"
            ]}
          />
          <SessionRow
            icon={Headphones}
            title="Evening Lock-In"
            time="30 min"
            details={[
              `${packet.evening.transfer_drills.length} transfer`,
              `${packet.evening.sleep_cue_binding_items.length} cue binds`,
              packet.evening.screen_policy
            ]}
          />
          <SessionRow
            icon={Moon}
            title="Night Reactivation"
            time="8 hr"
            details={[
              `${packet.sleep.reactivate_concept_ids.length} reactivate`,
              `${packet.sleep.stabilize_concept_ids.length} stabilize`,
              `${packet.sleep.control_concept_ids.length} controls`
            ]}
          />
        </div>
      </section>

      <section className="panel readiness-panel">
        <PanelTitle
          icon={ClipboardCheck}
          title="Readiness"
          meta={readiness.dusk_mode ? "Dusk mode" : "Day mode"}
        />
        <Slider
          label="Sleep quality"
          value={readiness.sleep_quality}
          onChange={(value) => setReadiness({ ...readiness, sleep_quality: value })}
        />
        <Slider
          label="Fatigue"
          value={readiness.fatigue}
          onChange={(value) => setReadiness({ ...readiness, fatigue: value })}
        />
        <Slider
          label="Stress"
          value={readiness.stress}
          onChange={(value) => setReadiness({ ...readiness, stress: value })}
        />
        <Slider
          label="Screen budget"
          value={readiness.screen_budget_minutes / 60}
          onChange={(value) => setReadiness({ ...readiness, screen_budget_minutes: Math.round(value * 60) })}
          suffix={`${readiness.screen_budget_minutes}m`}
        />
        <label className="switch-row">
          <input
            type="checkbox"
            checked={readiness.voice_ok}
            onChange={(event) => setReadiness({ ...readiness, voice_ok: event.target.checked })}
          />
          <span>Voice OK</span>
        </label>
      </section>
    </div>
  );
}

function GraphView({
  snapshot,
  selectedNode,
  selectedState,
  setSelectedNodeId
}: {
  snapshot: ReturnType<typeof buildGraphSnapshot>;
  selectedNode: ConceptNode;
  selectedState?: UserConceptState;
  setSelectedNodeId: (id: string) => void;
}) {
  return (
    <div className="page-grid graph-grid">
      <section className="panel graph-canvas-panel">
        <PanelTitle icon={Network} title="Personal Graph" meta={`${snapshot.nodes.length} nodes`} />
        <svg viewBox="0 0 560 460" className="graph-canvas" role="img" aria-label="Personal knowledge graph">
          {snapshot.edges.map((edge) => {
            const from = snapshot.nodes.find((node) => node.id === edge.from_id);
            const to = snapshot.nodes.find((node) => node.id === edge.to_id);
            if (!from || !to) return null;
            return (
              <line
                key={`${edge.from_id}-${edge.to_id}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className="graph-edge"
              />
            );
          })}
          {snapshot.nodes.map((node) => (
            <button
              type="button"
              className="graph-node-button"
              key={node.id}
              onClick={() => setSelectedNodeId(node.id)}
              aria-label={node.title}
            >
              <circle
                cx={node.x}
                cy={node.y}
                r={selectedNode.id === node.id ? 18 : 13}
                className={`graph-node ${node.window}`}
              />
              <text x={node.x} y={node.y + 32} textAnchor="middle" className="graph-label">
                {node.title.length > 17 ? `${node.title.slice(0, 15)}...` : node.title}
              </text>
            </button>
          ))}
        </svg>
      </section>
      <section className="panel case-file">
        <PanelTitle icon={Database} title="Case File" meta={selectedNode.status} />
        <h2>{selectedNode.title}</h2>
        <p className="dense-copy">{(selectedNode.definitions[0] as { text?: string })?.text}</p>
        <div className="case-grid">
          <MiniStat label="Mastery" value={`${Math.round((selectedState?.mastery ?? 0) * 100)}%`} />
          <MiniStat label="Transfer" value={`${Math.round((selectedState?.transfer_score ?? 0) * 100)}%`} />
          <MiniStat
            label="Latency"
            value={
              selectedState?.answer_latency_ms
                ? `${Math.round(selectedState.answer_latency_ms / 1000)}s`
                : "new"
            }
          />
          <MiniStat
            label="Cue gain"
            value={`${Math.round((selectedState?.cue_gain_estimate ?? 0) * 100)}%`}
          />
        </div>
        <div className="object-list">
          <ObjectLine
            label="Prerequisites"
            value={selectedNode.prerequisites.map((edge) => edge.from_id).join(", ") || "none"}
          />
          <ObjectLine label="Sleep cue" value={selectedNode.sleep_cues[0]?.text ?? "none"} />
          <ObjectLine label="Video assets" value={`${selectedNode.video_assets.length}`} />
          <ObjectLine label="Review after" value="180 days" />
        </div>
      </section>
    </div>
  );
}

function ForgeView({
  packet,
  prompt,
  promptIndex,
  queueLength,
  frontier,
  horizon,
  cuePreview,
  answer,
  setAnswer,
  answerMode,
  setAnswerMode,
  confidence,
  setConfidence,
  latencySeconds,
  submitAnswer,
  lastResponse,
  repairTips,
  completedCount,
  offlineCacheStatus
}: {
  packet: ScheduledDay["packet"];
  prompt: ScheduledDay["packet"]["morning"]["cold_retrieval_items"][number] | undefined;
  promptIndex: number;
  queueLength: number;
  frontier: ConceptNode[];
  horizon: ConceptNode[];
  cuePreview: ScheduledDay["packet"]["morning"]["cue_preview_items"];
  answer: string;
  setAnswer: (value: string) => void;
  answerMode: "text" | "voice";
  setAnswerMode: (value: "text" | "voice") => void;
  confidence: number;
  setConfidence: (value: number) => void;
  latencySeconds: number;
  submitAnswer: () => void;
  lastResponse: AssessmentResponse | null;
  repairTips: string[];
  completedCount: number;
  offlineCacheStatus: string;
}) {
  return (
    <div className="page-grid forge-grid">
      <section className="panel session-player">
        <PanelTitle icon={SunMedium} title="Morning Forge" meta={packet.morning.recommended_mode} />
        <div className="forge-status-grid">
          <MiniStat label="Prompt" value={`${promptIndex}/${Math.max(queueLength, 1)}`} />
          <MiniStat label="Latency" value={`${latencySeconds}s`} />
          <MiniStat label="Completed" value={`${completedCount}`} />
          <MiniStat label="Offline" value={offlineCacheStatus} />
        </div>
        <div className="prompt-box">
          <p className="eyebrow">Prompt</p>
          <h2>{prompt?.prompt ?? "No prompt due"}</h2>
        </div>
        <div className="segmented-control" aria-label="Answer mode">
          {(["text", "voice"] as const).map((mode) => (
            <button
              className={answerMode === mode ? "is-active" : ""}
              key={mode}
              onClick={() => setAnswerMode(mode)}
            >
              {mode === "voice" ? <AudioLines size={16} /> : <ClipboardCheck size={16} />}
              <span>{mode}</span>
            </button>
          ))}
        </div>
        <textarea
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder={
            answerMode === "voice" ? "Voice transcript appears here..." : "Answer before review..."
          }
          rows={6}
        />
        <Slider
          label="Confidence"
          value={confidence}
          onChange={setConfidence}
          suffix={`${Math.round(confidence * 100)}%`}
        />
        <div className="action-row">
          <button className="command primary" onClick={submitAnswer}>
            <CheckCircle2 size={18} />
            Score
          </button>
          <button
            className="command"
            onClick={() => setAnswerMode(answerMode === "voice" ? "text" : "voice")}
          >
            <AudioLines size={18} />
            {answerMode === "voice" ? "Text" : "Voice"}
          </button>
          <button
            className="command"
            onClick={() => setAnswer(answer || "I need a mechanism, an example, and a boundary.")}
          >
            <Wand2 size={18} />
            Hint
          </button>
        </div>
        {lastResponse && (
          <div className="feedback-band">
            <strong>{Math.round(lastResponse.correctness_score * 100)}%</strong>
            <span>{lastResponse.model_feedback}</span>
          </div>
        )}
        {repairTips.length > 0 && (
          <div className="repair-list">
            {repairTips.map((tip) => (
              <ObjectLine key={tip} label="Repair" value={tip} />
            ))}
          </div>
        )}
      </section>
      <section className="frontier-list forge-side">
        <PanelTitle icon={GitBranch} title="Frontier Push" meta={`${frontier.length} nodes`} />
        {frontier.slice(0, 4).map((concept) => (
          <article className="item-card" key={concept.id}>
            <div className="item-card-header">
              <span className={`domain-dot ${concept.domain}`} />
              <h3>{concept.title}</h3>
            </div>
            <Progress label="Difficulty" value={concept.difficulty} />
            <Progress label="Importance" value={concept.importance} />
          </article>
        ))}
        <div className="panel compact-panel">
          <PanelTitle icon={Network} title="Horizon Preview" meta={`${horizon.length} next`} />
          <div className="tag-row">
            {horizon.map((concept) => (
              <span className="tag" key={concept.id}>
                {concept.title}
              </span>
            ))}
          </div>
        </div>
        <div className="panel compact-panel">
          <PanelTitle icon={Moon} title="Cue Preview" meta={`${cuePreview.length} cues`} />
          <div className="object-list">
            {cuePreview.slice(0, 3).map((cue) => (
              <ObjectLine key={cue.id} label={cue.cue_type} value={cue.text ?? cue.concept_id} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function CinemaView({
  rankedVideos,
  packet,
  packetVideos,
  activeVideo,
  selectVideo,
  recallPrompt,
  answer,
  setAnswer,
  confidence,
  setConfidence,
  completeRecall,
  result,
  cacheStatus,
  concepts
}: {
  rankedVideos: ReturnType<typeof rankVideosForUser>;
  packet: WatchPacket | undefined;
  packetVideos: VideoAsset[];
  activeVideo: VideoAsset | undefined;
  selectVideo: (videoId: string) => void;
  recallPrompt: AssessmentItem | undefined;
  answer: string;
  setAnswer: (value: string) => void;
  confidence: number;
  setConfidence: (value: number) => void;
  completeRecall: () => void;
  result: GraphFeedRecallResult | null;
  cacheStatus: string;
  concepts: ConceptNode[];
}) {
  const selectedVideos =
    packetVideos.length > 0 ? packetVideos : rankedVideos.slice(0, 3).map(({ video }) => video);
  const activeConcepts = activeVideo?.concept_ids.map((id) => conceptTitle(concepts, id)) ?? [];
  const recallState = result ? (result.recallPassed ? "counted" : "held") : "armed";
  const totalPacketSeconds = selectedVideos.reduce((sum, video) => sum + video.duration_seconds, 0);
  return (
    <div className="page-grid cinema-grid">
      <section className="panel watch-packet graphfeed-player">
        <PanelTitle icon={Video} title="GraphFeed" meta={packet?.purpose ?? "none"} />
        <div className="graphfeed-screen">
          <div className="video-thumb graphfeed-hero">
            <Video size={34} />
            <span>{activeVideo ? humanMinutes(activeVideo.duration_seconds) : "0m"}</span>
          </div>
          <div className="graphfeed-copy">
            <p className="eyebrow">Bounded Video</p>
            <h2>{activeVideo?.title ?? "No video selected"}</h2>
            <p>{activeVideo?.creator ?? "Local graph metadata"}</p>
            <div className="tag-row">
              {activeConcepts.map((title) => (
                <span className="tag" key={title}>
                  {title}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="chapter-timeline" aria-label="Chapter timeline">
          {(activeVideo?.chapter_map ?? []).map((chapter, index) => (
            <span
              key={`${activeVideo?.id}-${index}`}
              style={{
                left: `${chapterStartPercent(chapter, activeVideo?.duration_seconds ?? 1)}%`
              }}
              title={chapterTitle(chapter)}
            />
          ))}
        </div>
        <div className="case-grid">
          <MiniStat label="Budget" value={`${packet?.total_time_budget_minutes ?? 0}m`} />
          <MiniStat label="Videos" value={`${selectedVideos.length}`} />
          <MiniStat label="Recall" value={recallState} />
          <MiniStat label="Next" value={packet?.suggested_next_mode ?? "stop"} />
        </div>
        <div className="graphfeed-recall">
          <div className="prompt-box graphfeed-prompt">
            <p className="eyebrow">Post-Watch Recall</p>
            <h2>{recallPrompt?.prompt ?? "No recall prompt due"}</h2>
          </div>
          <textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="Explain from memory before progress counts..."
            rows={5}
          />
          <Slider
            label="Confidence"
            value={confidence}
            onChange={setConfidence}
            suffix={`${Math.round(confidence * 100)}%`}
          />
          <div className="action-row">
            <button className="command primary" onClick={completeRecall}>
              <BadgeCheck size={18} />
              Score Recall
            </button>
            <button
              className="command"
              onClick={() =>
                setAnswer(answer || "I can name the core idea, one example, and when it does not apply.")
              }
            >
              <Wand2 size={18} />
              Prime
            </button>
          </div>
          {result && (
            <div
              className={`feedback-band graphfeed-result ${result.recallPassed ? "is-counted" : "is-held"}`}
            >
              <strong>{Math.round(result.response.correctness_score * 100)}%</strong>
              <span>
                {result.recallPassed
                  ? "recall passed, graph progress counted"
                  : "recall missed, video watch held out of progress"}
              </span>
            </div>
          )}
        </div>
      </section>
      <section className="video-list graphfeed-side">
        <div className="panel compact-panel">
          <PanelTitle icon={ClipboardCheck} title="Packet Rules" meta={cacheStatus} />
          <div className="object-list">
            <ObjectLine label="Boundary" value={humanMinutes(totalPacketSeconds)} />
            <ObjectLine label="Progress" value="recall gate required" />
            <ObjectLine label="Transcript" value={activeVideo?.transcript_id ?? "none"} />
            <ObjectLine label="Walk handoff" value={result?.recallPassed ? "ready" : "locked"} />
          </div>
        </div>
        {rankedVideos.slice(0, 5).map(({ video, score, reasons }) => {
          const inPacket = selectedVideos.some((candidate) => candidate.id === video.id);
          return (
            <button
              className={`video-card video-choice ${activeVideo?.id === video.id ? "is-selected" : ""}`}
              key={video.id}
              onClick={() => selectVideo(video.id)}
            >
              <div className="video-thumb">
                <Video size={28} />
                <span>{humanMinutes(video.duration_seconds)}</span>
              </div>
              <div>
                <h3>{video.title}</h3>
                <p>{video.creator}</p>
                <div className="tag-row">
                  {reasons.slice(0, 4).map((reason) => (
                    <span className="tag" key={reason}>
                      {reason}
                    </span>
                  ))}
                </div>
              </div>
              <strong>{Math.round(score * 100)}</strong>
              {inPacket && <span className="packet-badge">packet</span>}
            </button>
          );
        })}
      </section>
    </div>
  );
}

function PacedReadView({
  assets,
  activeAsset,
  plan,
  chunk,
  chunkIndex,
  progress,
  playing,
  setPlaying,
  selectAsset,
  displayUnit,
  setDisplayUnit,
  requestedWpm,
  setRequestedWpm,
  previousChunk,
  nextChunk,
  restart,
  comprehension,
  setComprehension,
  retention,
  setRetention,
  strain,
  setStrain,
  completeSession,
  result,
  cacheStatus,
  concepts
}: {
  assets: PacedReadAsset[];
  activeAsset: PacedReadAsset | undefined;
  plan: PacedReadSessionPlan | null;
  chunk: string;
  chunkIndex: number;
  progress: number;
  playing: boolean;
  setPlaying: (value: boolean) => void;
  selectAsset: (assetId: string) => void;
  displayUnit: PacedReadDisplayUnit;
  setDisplayUnit: (unit: PacedReadDisplayUnit) => void;
  requestedWpm: number;
  setRequestedWpm: (wpm: number) => void;
  previousChunk: () => void;
  nextChunk: () => void;
  restart: () => void;
  comprehension: number;
  setComprehension: (value: number) => void;
  retention: number;
  setRetention: (value: number) => void;
  strain: number;
  setStrain: (value: number) => void;
  completeSession: () => void;
  result: PacedReadEngineResult | null;
  cacheStatus: string;
  concepts: ConceptNode[];
}) {
  const displayUnits: PacedReadDisplayUnit[] = ["word", "phrase", "clause", "concept"];
  const activeConcepts = activeAsset?.concept_ids.map((id) => conceptTitle(concepts, id)) ?? [];
  const gateState = result ? (result.advanceAllowed ? "passed" : "held") : "armed";
  return (
    <div className="page-grid paced-read-grid">
      <section className="panel session-player paced-read-reader">
        <PanelTitle icon={Gauge} title="Paced Read Engine" meta="local" />
        <div className="forge-status-grid paced-read-status-grid">
          <MiniStat label="Chunk" value={`${plan ? chunkIndex + 1 : 0}/${plan?.chunks.length ?? 0}`} />
          <MiniStat label="Raw" value={`${plan?.raw_wpm ?? requestedWpm} wpm`} />
          <MiniStat
            label="Effective"
            value={result ? `${result.effectiveWpm} wpm` : `${plan?.estimated_effective_wpm ?? 0} est`}
          />
          <MiniStat label="Gate" value={gateState} />
        </div>
        <div className="paced-read-stage" aria-live={playing ? "polite" : "off"}>
          <p className="eyebrow">{activeAsset?.title ?? "No paced read asset"}</p>
          <div className="paced-read-chunk">{chunk || "Select a graph asset to begin."}</div>
          <div className="paced-read-progress-track" aria-label="Paced read progress">
            <i style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
        <div className="reader-controls">
          <IconButton title="Restart" icon={RefreshCcw} onClick={restart} />
          <IconButton title="Previous chunk" icon={Rewind} onClick={previousChunk} />
          <button className="command primary" onClick={() => setPlaying(!playing)}>
            {playing ? <Pause size={18} /> : <Play size={18} />}
            {playing ? "Pause" : "Play"}
          </button>
          <IconButton title="Next chunk" icon={SkipForward} onClick={nextChunk} />
        </div>
        <div className="segmented-control paced-read-unit-control" aria-label="Display unit">
          {displayUnits.map((unit) => (
            <button
              className={displayUnit === unit ? "is-active" : ""}
              key={unit}
              onClick={() => setDisplayUnit(unit)}
            >
              <span>{unit}</span>
            </button>
          ))}
        </div>
        <Slider
          label="Raw speed"
          value={(requestedWpm - 120) / 960}
          onChange={(value) => setRequestedWpm(Math.round((120 + value * 960) / 10) * 10)}
          suffix={`${requestedWpm} wpm`}
        />
        <div className="paced-read-gate">
          <ObjectLine label="Gate" value={activeAsset?.comprehension_gate ?? "none"} />
          <Slider
            label="Comprehension"
            value={comprehension}
            onChange={setComprehension}
            suffix={`${Math.round(comprehension * 100)}%`}
          />
          <Slider
            label="Retention"
            value={retention}
            onChange={setRetention}
            suffix={`${Math.round(retention * 100)}%`}
          />
          <Slider
            label="Strain"
            value={strain}
            onChange={setStrain}
            suffix={`${Math.round(strain * 100)}%`}
          />
          <div className="action-row">
            <button className="command primary" onClick={completeSession}>
              <BadgeCheck size={18} />
              Complete Gate
            </button>
            <button className="command" onClick={() => setPlaying(false)}>
              <Pause size={18} />
              Hold
            </button>
          </div>
        </div>
        {result && (
          <div
            className={`feedback-band paced-read-result ${result.advanceAllowed ? "is-passed" : "is-held"}`}
          >
            <strong>{result.effectiveWpm}</strong>
            <span>
              {result.advanceAllowed
                ? "effective WPM accepted into graph progress"
                : "effective WPM logged without advancing graph progress"}
            </span>
          </div>
        )}
      </section>
      <section className="paced-read-side">
        <div className="panel">
          <PanelTitle icon={Network} title="Graph Assets" meta={`${assets.length} local`} />
          <div className="paced-read-asset-list">
            {assets.map((asset) => (
              <button
                className={`paced-read-asset-card ${activeAsset?.id === asset.id ? "is-selected" : ""}`}
                key={asset.id}
                onClick={() => selectAsset(asset.id)}
              >
                <strong>{asset.title}</strong>
                <span>{asset.concept_ids.map((id) => conceptTitle(concepts, id)).join(" + ")}</span>
                <small>
                  {asset.recommended_wpm} wpm - load {Math.round(asset.cognitive_load_score * 100)}%
                </small>
              </button>
            ))}
          </div>
        </div>
        <div className="panel">
          <PanelTitle icon={ShieldCheck} title="Runtime" meta="first-party" />
          <div className="case-grid">
            <MiniStat label="Playback" value="browser" />
            <MiniStat label="Network" value="none" />
            <MiniStat label="Cache" value={cacheStatus} />
            <MiniStat label="Display" value={displayUnit} />
          </div>
          <div className="tag-row">
            {activeConcepts.map((title) => (
              <span className="tag" key={title}>
                {title}
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function WalkView({
  packet,
  prompt,
  promptIndex,
  queueLength,
  phase,
  answer,
  setAnswer,
  answerMode,
  setAnswerMode,
  confidence,
  setConfidence,
  startListening,
  scoreAnswer,
  nextPrompt,
  runCommand,
  completeSession,
  deleteTranscript,
  lastResponse,
  repairTips,
  commandLog,
  skippedIds,
  confusingIds,
  cacheStatus,
  completedAt,
  transcriptDeleted,
  setTranscriptDeleted,
  answeredCount
}: {
  packet: ScheduledDay["packet"]["walk_packets"][number] | undefined;
  prompt: ScheduledDay["packet"]["walk_packets"][number]["prompts"][number] | undefined;
  promptIndex: number;
  queueLength: number;
  phase: WalkPhase;
  answer: string;
  setAnswer: (value: string) => void;
  answerMode: AnswerMode;
  setAnswerMode: (value: AnswerMode) => void;
  confidence: number;
  setConfidence: (value: number) => void;
  startListening: () => void;
  scoreAnswer: () => void;
  nextPrompt: () => void;
  runCommand: (command: string) => void;
  completeSession: () => void;
  deleteTranscript: () => void;
  lastResponse: AssessmentResponse | null;
  repairTips: string[];
  commandLog: string[];
  skippedIds: string[];
  confusingIds: string[];
  cacheStatus: string;
  completedAt: string | null;
  transcriptDeleted: boolean;
  setTranscriptDeleted: (value: boolean) => void;
  answeredCount: number;
}) {
  const commands = packet?.voice_commands ?? [
    "repeat that",
    "slower",
    "harder",
    "give hint",
    "skip",
    "mark confusing",
    "screen off",
    "end session"
  ];
  return (
    <div className="walk-layout">
      <section className="phone-down">
        <div className={`phone-frame walk-phone ${phase === "listening" ? "is-listening" : ""}`}>
          <div className="walk-phone-screen">
            <span>{phase}</span>
            <strong>{prompt ? `${promptIndex}/${Math.max(queueLength, 1)}` : "0/0"}</strong>
            <p>{prompt?.prompt ?? "Walk session complete"}</p>
          </div>
          <div className="waveform">
            {Array.from({ length: 34 }).map((_, index) => (
              <span key={index} style={{ height: `${18 + ((index * 17) % 44)}px` }} />
            ))}
          </div>
          <div className="audio-controls">
            <IconButton title="Repeat" icon={RefreshCcw} onClick={() => runCommand("repeat that")} />
            <IconButton title="Pause" icon={Pause} onClick={() => runCommand("screen off")} />
            <IconButton title="Listen" icon={Play} onClick={startListening} />
          </div>
        </div>
      </section>
      <section className="panel walk-prompts walk-session-panel">
        <PanelTitle icon={Footprints} title="WalkMode" meta={phase} />
        <div className="forge-status-grid">
          <MiniStat label="Prompt" value={`${promptIndex}/${Math.max(queueLength, 1)}`} />
          <MiniStat label="Answered" value={`${answeredCount}`} />
          <MiniStat label="Cache" value={cacheStatus} />
          <MiniStat label="Screen" value="locked" />
        </div>
        <div className="prompt-box walk-prompt-box">
          <p className="eyebrow">Prompt Playback</p>
          <h2>{prompt?.prompt ?? "No walking prompt due"}</h2>
        </div>
        <div className="segmented-control" aria-label="Walk answer mode">
          {(["voice", "text"] as const).map((mode) => (
            <button
              className={answerMode === mode ? "is-active" : ""}
              key={mode}
              onClick={() => setAnswerMode(mode)}
            >
              {mode === "voice" ? <AudioLines size={16} /> : <ClipboardCheck size={16} />}
              <span>{mode}</span>
            </button>
          ))}
        </div>
        <textarea
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder={answerMode === "voice" ? "Private voice transcript..." : "Text fallback..."}
          rows={5}
        />
        <Slider
          label="Confidence"
          value={confidence}
          onChange={setConfidence}
          suffix={`${Math.round(confidence * 100)}%`}
        />
        <div className="action-row">
          <button className="command primary" onClick={phase === "prompt" ? startListening : scoreAnswer}>
            {phase === "prompt" ? <Play size={18} /> : <BadgeCheck size={18} />}
            {phase === "prompt" ? "Listen" : "Score"}
          </button>
          <button className="command" onClick={nextPrompt}>
            <SkipForward size={18} />
            Next
          </button>
          <button className="command" onClick={completeSession}>
            <CheckCircle2 size={18} />
            Complete
          </button>
        </div>
        {lastResponse && (
          <div className="feedback-band walk-feedback">
            <strong>{Math.round(lastResponse.correctness_score * 100)}%</strong>
            <span>{lastResponse.model_feedback}</span>
          </div>
        )}
        {repairTips.length > 0 && (
          <div className="repair-list">
            {repairTips.map((tip) => (
              <ObjectLine key={tip} label="Repair" value={tip} />
            ))}
          </div>
        )}
        <div className="tag-row commands">
          {commands.map((command) => (
            <button className="tag command-chip" key={command} onClick={() => runCommand(command)}>
              {command}
            </button>
          ))}
        </div>
        <div className="walk-privacy-panel">
          <label className="switch-row">
            <input
              type="checkbox"
              checked={transcriptDeleted}
              onChange={(event) => setTranscriptDeleted(event.target.checked)}
            />
            <span>Delete voice transcript after scoring</span>
          </label>
          <button className="command" onClick={deleteTranscript}>
            <ShieldCheck size={18} />
            Delete Now
          </button>
        </div>
        <div className="object-list walk-session-log">
          <ObjectLine label="Commands" value={commandLog.slice(0, 4).join(", ")} />
          <ObjectLine label="Skipped" value={`${skippedIds.length}`} />
          <ObjectLine label="Confusing" value={`${confusingIds.length}`} />
          <ObjectLine
            label="Completed"
            value={
              completedAt
                ? new Date(completedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                : "not yet"
            }
          />
        </div>
      </section>
    </div>
  );
}

function LockInView({
  packet,
  prompt,
  promptIndex,
  queueLength,
  answer,
  setAnswer,
  answerMode,
  setAnswerMode,
  confidence,
  setConfidence,
  latencySeconds,
  submitAnswer,
  lastResponse,
  repairTips,
  completedCount,
  selectedCueIds,
  toggleCue,
  phoneDownChecklist,
  togglePhoneDownItem,
  phoneDownReady,
  sleepResult,
  cacheStatus,
  completedAt,
  completeLockIn,
  audioPlaying,
  setAudioPlaying
}: {
  packet: ScheduledDay["packet"];
  prompt: EveningPrompt | undefined;
  promptIndex: number;
  queueLength: number;
  answer: string;
  setAnswer: (value: string) => void;
  answerMode: AnswerMode;
  setAnswerMode: (value: AnswerMode) => void;
  confidence: number;
  setConfidence: (value: number) => void;
  latencySeconds: number;
  submitAnswer: () => void;
  lastResponse: AssessmentResponse | null;
  repairTips: string[];
  completedCount: number;
  selectedCueIds: string[];
  toggleCue: (cueId: string) => void;
  phoneDownChecklist: Record<PhoneDownKey, boolean>;
  togglePhoneDownItem: (key: PhoneDownKey) => void;
  phoneDownReady: boolean;
  sleepResult: ReturnType<typeof buildSleepCuePacket>;
  cacheStatus: string;
  completedAt: string | null;
  completeLockIn: () => void;
  audioPlaying: boolean;
  setAudioPlaying: (value: boolean) => void;
}) {
  const phoneDownItems: Array<{ key: PhoneDownKey; label: string }> = [
    { key: "notificationsSilenced", label: "Notifications silenced" },
    { key: "screenDimmingEnabled", label: "Dimming enabled" },
    { key: "chargerReady", label: "Charger ready" },
    { key: "alarmSet", label: "Alarm set" }
  ];
  const selectedCueCount = packet.evening.sleep_cue_binding_items.filter((cue) =>
    selectedCueIds.includes(cue.id)
  ).length;
  return (
    <div className="page-grid lock-grid">
      <section className="panel session-player lock-session">
        <PanelTitle icon={Headphones} title="Evening Lock-In" meta={packet.evening.screen_policy} />
        <div className="forge-status-grid">
          <MiniStat label="Prompt" value={`${promptIndex}/${Math.max(queueLength, 1)}`} />
          <MiniStat label="Latency" value={`${latencySeconds}s`} />
          <MiniStat label="Completed" value={`${completedCount}`} />
          <MiniStat label="Sleep cache" value={cacheStatus} />
        </div>
        <div className="lock-audio-strip">
          <button
            className="icon-button"
            title={audioPlaying ? "Pause evening audio" : "Play evening audio"}
            aria-label={audioPlaying ? "Pause evening audio" : "Play evening audio"}
            onClick={() => setAudioPlaying(!audioPlaying)}
          >
            {audioPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <div className={`mini-waveform ${audioPlaying ? "is-playing" : ""}`}>
            {Array.from({ length: 22 }).map((_, index) => (
              <span key={index} style={{ height: `${12 + ((index * 13) % 34)}px` }} />
            ))}
          </div>
          <strong>{audioPlaying ? "audio-first" : "ready"}</strong>
        </div>
        <div className="prompt-box lock-prompt">
          <p className="eyebrow">{prompt?.phase ?? "complete"}</p>
          <h2>{prompt?.item.prompt ?? "Sleep handoff ready"}</h2>
        </div>
        <div className="segmented-control" aria-label="Evening answer mode">
          {(["voice", "text"] as const).map((mode) => (
            <button
              className={answerMode === mode ? "is-active" : ""}
              key={mode}
              onClick={() => setAnswerMode(mode)}
            >
              {mode === "voice" ? <AudioLines size={16} /> : <ClipboardCheck size={16} />}
              <span>{mode}</span>
            </button>
          ))}
        </div>
        <textarea
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder={answerMode === "voice" ? "Soft transcript..." : "One compact answer..."}
          rows={5}
        />
        <Slider
          label="Confidence"
          value={confidence}
          onChange={setConfidence}
          suffix={`${Math.round(confidence * 100)}%`}
        />
        <div className="action-row">
          <button className="command primary" onClick={submitAnswer}>
            <CheckCircle2 size={18} />
            Score
          </button>
          <button
            className="command"
            onClick={() => setAnswer(answer || "I can state the mechanism, boundary, and a new example.")}
          >
            <Wand2 size={18} />
            Prime
          </button>
          <button className="command" onClick={completeLockIn}>
            <Moon size={18} />
            Complete
          </button>
        </div>
        {lastResponse && (
          <div className="feedback-band lock-feedback">
            <strong>{Math.round(lastResponse.correctness_score * 100)}%</strong>
            <span>{lastResponse.model_feedback}</span>
          </div>
        )}
        {repairTips.length > 0 && (
          <div className="repair-list">
            {repairTips.map((tip) => (
              <ObjectLine key={tip} label="Repair" value={tip} />
            ))}
          </div>
        )}
      </section>
      <section className="lock-side">
        <div className="panel dusk-panel phone-down-panel">
          <PanelTitle icon={ShieldCheck} title="Phone-Down" meta={phoneDownReady ? "ready" : "open"} />
          <div className="checklist-grid">
            {phoneDownItems.map((item) => (
              <button
                className={`check-row ${phoneDownChecklist[item.key] ? "is-ready" : ""}`}
                key={item.key}
                onClick={() => togglePhoneDownItem(item.key)}
              >
                <CheckCircle2 size={18} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <div className="guard-grid compact-guard">
            {["leaderboards", "infinite video", "bright UI", "friend comparisons"].map((item) => (
              <div className="guard-item" key={item}>
                <ShieldCheck size={18} />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel cue-binding-panel">
          <PanelTitle icon={Moon} title="Cue Binding" meta={`${selectedCueCount} selected`} />
          <div className="cue-bind-grid">
            {packet.evening.sleep_cue_binding_items.slice(0, 6).map((cue) => {
              const selected = selectedCueIds.includes(cue.id);
              return (
                <button
                  className={`cue-card ${selected ? "is-selected" : ""}`}
                  key={cue.id}
                  onClick={() => toggleCue(cue.id)}
                >
                  <span>{cue.cue_type}</span>
                  <strong>{cue.text ?? cue.concept_id}</strong>
                  <small>{Math.round(cue.sleep_safety_score * 100)} safety</small>
                </button>
              );
            })}
          </div>
        </div>
        <div className="panel sleep-handoff-panel">
          <PanelTitle icon={Radio} title="Sleep Handoff" meta={completedAt ? "armed" : "draft"} />
          <div className="case-grid">
            <MiniStat label="Reactivate" value={`${sleepResult.packet.reactivate_concept_ids.length}`} />
            <MiniStat label="Stabilize" value={`${sleepResult.packet.stabilize_concept_ids.length}`} />
            <MiniStat label="Controls" value={`${sleepResult.packet.control_concept_ids.length}`} />
            <MiniStat label="Spacing" value={`${sleepResult.packet.cue_spacing_seconds}s`} />
          </div>
          <ObjectLine label="Audio plan" value={sleepResult.audioPlan.render_status} />
          <ObjectLine
            label="Reminder"
            value={new Date(
              sleepResult.packet.target_sleep_window.estimated_sleep_onset_at
            ).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit"
            })}
          />
          {completedAt && (
            <div className="feedback-band lock-complete-band">
              <strong>armed</strong>
              <span>
                {new Date(completedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function SleepView({
  packet,
  audioPlan,
  integrity,
  playbackStatus,
  startPlayback,
  logPlayback,
  stopCondition,
  setStopCondition,
  disruptionReported,
  setDisruptionReported,
  cacheStatus,
  recallResult,
  runRecallCheck,
  cuedConceptIds,
  controlConceptIds,
  concepts
}: {
  packet: ScheduledDay["packet"]["sleep"];
  audioPlan: ScheduledDay["audioPlan"];
  integrity: number;
  playbackStatus: SleepPlaybackStatus;
  startPlayback: () => void;
  logPlayback: () => void;
  stopCondition: SleepStopCondition;
  setStopCondition: (value: SleepStopCondition) => void;
  disruptionReported: boolean;
  setDisruptionReported: (value: boolean) => void;
  cacheStatus: string;
  recallResult: SleepRecallResult | null;
  runRecallCheck: () => void;
  cuedConceptIds: string[];
  controlConceptIds: string[];
  concepts: ConceptNode[];
}) {
  const stopOptions: SleepStopCondition[] = [
    "none",
    "movement_detected",
    "user_wake_report",
    "wearable_wake_signal",
    "time_limit"
  ];
  const cueGainTone =
    recallResult && recallResult.cueGainDelta > 0.04
      ? "positive"
      : recallResult && recallResult.cueGainDelta < -0.04
        ? "negative"
        : "neutral";
  return (
    <div className="page-grid sleep-grid">
      <section className="panel sleep-panel">
        <PanelTitle icon={Moon} title="Night Reactivation" meta={`${packet.cue_spacing_seconds}s spacing`} />
        <div className="sleep-ratio">
          <Ratio label="Reactivate" value={packet.reactivate_concept_ids.length} color="teal" />
          <Ratio label="Stabilize" value={packet.stabilize_concept_ids.length} color="amber" />
          <Ratio label="Prime" value={packet.prime_concept_ids.length} color="coral" />
          <Ratio label="Control" value={packet.control_concept_ids.length} color="indigo" />
        </div>
        <div className="timeline-audio">
          {audioPlan.layers.slice(0, 32).map((layer) => (
            <span
              key={layer.id}
              className={`audio-layer ${layer.kind}`}
              style={{
                left: `${(layer.starts_at_seconds / audioPlan.duration_seconds) * 100}%`,
                width: `${Math.max(0.7, (layer.duration_seconds / audioPlan.duration_seconds) * 100)}%`
              }}
              title={layer.label}
            />
          ))}
        </div>
        <div className="sleep-run-grid">
          <MiniStat label="Sleep integrity" value={`${Math.round(integrity * 100)}%`} />
          <MiniStat label="Playback" value={playbackStatus} />
          <MiniStat label="Cache" value={cacheStatus} />
          <MiniStat label="Max density" value={`${packet.max_cues_per_hour}/hr`} />
        </div>
        <div className="action-row">
          <button className="command primary" onClick={startPlayback}>
            <Play size={18} />
            Start
          </button>
          <button className="command" onClick={logPlayback}>
            <ClipboardCheck size={18} />
            Log Playback
          </button>
          <button className="command" onClick={runRecallCheck}>
            <BadgeCheck size={18} />
            Recall Check
          </button>
        </div>
      </section>
      <section className="sleep-side">
        <div className="panel sleep-safety-panel">
          <PanelTitle
            icon={ShieldCheck}
            title="Sleep Safety"
            meta={disruptionReported ? "review" : "clear"}
          />
          <div className="stop-grid">
            {stopOptions.map((option) => (
              <button
                className={`stop-chip ${stopCondition === option ? "is-selected" : ""}`}
                key={option}
                onClick={() => setStopCondition(option)}
              >
                {option.replaceAll("_", " ")}
              </button>
            ))}
          </div>
          <label className="switch-row sleep-switch">
            <input
              type="checkbox"
              checked={disruptionReported}
              onChange={(event) => setDisruptionReported(event.target.checked)}
            />
            <span>Sleep disruption reported</span>
          </label>
          <div className="guard-grid compact-guard">
            <div className="guard-item">
              <ShieldCheck size={18} />
              <span>sparse cue spacing</span>
            </div>
            <div className="guard-item">
              <ShieldCheck size={18} />
              <span>movement stop</span>
            </div>
            <div className="guard-item">
              <ShieldCheck size={18} />
              <span>wake report stop</span>
            </div>
            <div className="guard-item">
              <ShieldCheck size={18} />
              <span>matched controls</span>
            </div>
          </div>
        </div>
        <div className="panel">
          <PanelTitle icon={Radio} title="Audio Plan" meta={audioPlan.render_status} />
          <div className="object-list">
            {audioPlan.layers.slice(0, 6).map((layer) => (
              <ObjectLine
                key={layer.id}
                label={humanMinutes(Math.round(layer.starts_at_seconds))}
                value={`${layer.kind} - ${layer.label}`}
              />
            ))}
          </div>
        </div>
        <div className="panel sleep-results-panel">
          <PanelTitle
            icon={BarChart3}
            title="Cue-Gain Results"
            meta={recallResult ? "controls revealed" : "pending"}
          />
          <div className={`cue-gain-badge ${cueGainTone}`}>
            <strong>{recallResult ? `${Math.round(recallResult.cueGainDelta * 100)}pt` : "hidden"}</strong>
            <span>{recallResult ? "cued minus control" : "run recall check"}</span>
          </div>
          <div className="result-columns">
            <div>
              <h3>Cued</h3>
              <strong>{recallResult ? `${Math.round(recallResult.cuedScore * 100)}%` : "pending"}</strong>
              <div className="tag-row">
                {cuedConceptIds.map((conceptId) => (
                  <span className="tag" key={conceptId}>
                    {conceptTitle(concepts, conceptId)}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <h3>Controls</h3>
              <strong>{recallResult ? `${Math.round(recallResult.controlScore * 100)}%` : "hidden"}</strong>
              <div className="tag-row">
                {(recallResult ? controlConceptIds : []).map((conceptId) => (
                  <span className="tag" key={conceptId}>
                    {conceptTitle(concepts, conceptId)}
                  </span>
                ))}
                {!recallResult && <span className="tag">revealed after recall</span>}
              </div>
            </div>
          </div>
          {recallResult && (
            <ObjectLine
              label="Completed"
              value={new Date(recallResult.completedAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit"
              })}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function StatsView({
  snapshot,
  states,
  screenEfficiency,
  sleepIntegrity
}: {
  snapshot: ReturnType<typeof buildGraphSnapshot>;
  states: UserConceptState[];
  screenEfficiency: number;
  sleepIntegrity: number;
}) {
  const bars = [
    { label: "Recall", value: avg(states.map((state) => state.recall_strength)) },
    { label: "Transfer", value: avg(states.map((state) => state.transfer_score)) },
    { label: "Calibration", value: avg(states.map((state) => state.confidence_calibration)) },
    { label: "Screen", value: clamp(screenEfficiency / 2) },
    { label: "Sleep", value: sleepIntegrity }
  ];
  return (
    <div className="page-grid stats-grid">
      <section className="panel">
        <PanelTitle icon={BarChart3} title="Outcome Metrics" meta="rolling" />
        <div className="bar-chart">
          {bars.map((bar) => (
            <div className="bar-row" key={bar.label}>
              <span>{bar.label}</span>
              <div>
                <i style={{ width: `${bar.value * 100}%` }} />
              </div>
              <strong>{Math.round(bar.value * 100)}%</strong>
            </div>
          ))}
        </div>
      </section>
      <section className="metric-strip vertical">
        <MetricTile
          icon={GitBranch}
          label="Prerequisite Debt"
          value={`${Math.round(snapshot.metrics.prerequisiteDebt * 100)}%`}
          tone="coral"
        />
        <MetricTile
          icon={Trophy}
          label="Retention Half-Life"
          value={`${snapshot.metrics.retentionHalfLifeDays}d`}
          tone="teal"
        />
        <MetricTile
          icon={BadgeCheck}
          label="False Confidence"
          value={`${Math.round(snapshot.metrics.falseConfidenceRate * 100)}%`}
          tone="amber"
        />
      </section>
    </div>
  );
}

function SocialView({ dashboard }: { dashboard: SocialDashboard }) {
  const topChallenge = dashboard.challenges[0];
  return (
    <div className="page-grid social-grid">
      <section className="panel">
        <PanelTitle icon={Trophy} title="Social Profile" meta={dashboard.share_level} />
        <div className="case-grid">
          <MiniStat label="Visible badges" value={`${dashboard.public_profile.visible_badge_count}`} />
          <MiniStat label="Challenges" value={`${dashboard.public_profile.visible_challenge_count}`} />
          <MiniStat
            label="Contribution"
            value={`${Math.round(dashboard.contributor_reputation.reputation_score * 100)}%`}
          />
          <MiniStat label="Queue" value={dashboard.contributor_reputation.moderation_queue_priority} />
        </div>
        <div className="object-list">
          <ObjectLine label="Handle" value={dashboard.public_profile.handle} />
          <ObjectLine label="Display" value={dashboard.public_profile.display_name} />
          <ObjectLine label="Accepted" value={`${dashboard.contributor_reputation.accepted_contributions}`} />
          <ObjectLine label="Merged" value={`${dashboard.contributor_reputation.merged_contributions}`} />
        </div>
      </section>

      <section className="panel">
        <PanelTitle icon={ShieldCheck} title="Anti-Gaming Rules" meta="outcome only" />
        <div className="guardrail-list">
          {dashboard.guardrails.map((guardrail) => (
            <div className="guardrail-line" key={guardrail}>
              <ShieldCheck size={16} />
              <span>{guardrail}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <PanelTitle icon={BadgeCheck} title="Outcome Badges" meta={`${dashboard.badges.length} earned`} />
        <div className="badge-grid">
          {dashboard.badges.length > 0 ? (
            dashboard.badges.map((badge) => (
              <article className="badge-card" key={badge.id}>
                <BadgeCheck size={22} />
                <h3>{badge.title}</h3>
                <p>{badge.evidence.join(" · ")}</p>
                <div className="tag-row">
                  <span className="tag">{badge.category}</span>
                  <span className="tag">{badge.rarity}</span>
                </div>
              </article>
            ))
          ) : (
            <article className="badge-card locked">
              <CircleGauge size={22} />
              <h3>Outcome locked</h3>
              <p>
                Badges unlock from recall, transfer, sleep integrity, screen efficiency, or contribution
                quality.
              </p>
            </article>
          )}
        </div>
      </section>

      <section className="panel">
        <PanelTitle
          icon={Footprints}
          title="Friend Challenges"
          meta={topChallenge?.scoring_metric.replaceAll("_", " ") ?? "ready"}
        />
        <div className="challenge-list">
          {dashboard.challenges.map((challenge) => (
            <article className="challenge-card" key={challenge.id}>
              <header>
                <span>{challenge.challenge_type.replaceAll("_", " ")}</span>
                <strong>{challenge.status}</strong>
              </header>
              <h3>{challenge.title}</h3>
              <ObjectLine label="Metric" value={challenge.scoring_metric.replaceAll("_", " ")} />
              {challenge.scoreboard.map((score) => (
                <div className="score-row" key={score.user_id}>
                  <span>#{score.rank}</span>
                  <strong>{score.display_name}</strong>
                  <em>{score.score}</em>
                </div>
              ))}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function WearablesView({
  dashboard,
  authorizationUrl,
  onConnect,
  onSync,
  onRevoke
}: {
  dashboard: WearableCapabilityDashboard;
  authorizationUrl: string;
  onConnect: () => void;
  onSync: () => void;
  onRevoke: () => void;
}) {
  const sleep = dashboard.latest_sleep;
  const connection = dashboard.connections.find((candidate) => candidate.provider === "oura");
  const providerRows = Object.entries(dashboard.provider_status) as Array<
    [keyof WearableCapabilityDashboard["provider_status"], WearableConnectionStatus]
  >;
  const sleepWindow =
    sleep?.started_at && sleep.ended_at
      ? `${new Date(sleep.started_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - ${new Date(
          sleep.ended_at
        ).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
      : "pending";

  return (
    <div className="page-grid wearables-grid">
      <section className="metric-strip wearable-strip">
        <MetricTile
          icon={Activity}
          label="Oura"
          value={statusLabel(dashboard.provider_status.oura)}
          tone={wearableToneFor(dashboard.provider_status.oura)}
        />
        <MetricTile
          icon={Moon}
          label="Sleep Quality"
          value={sleep ? `${Math.round(sleep.sleep_quality * 100)}%` : "pending"}
          tone="teal"
        />
        <MetricTile
          icon={CircleGauge}
          label="Fatigue"
          value={sleep ? `${Math.round(sleep.fatigue * 100)}%` : "pending"}
          tone="amber"
        />
        <MetricTile
          icon={Smartphone}
          label="Native Edge"
          value={statusLabel(dashboard.native_edge_plan.background_audio)}
          tone="indigo"
        />
      </section>

      <section className="panel wearable-status-panel">
        <PanelTitle icon={Activity} title="Wearable Status" meta={connection?.status ?? "fallback"} />
        <div className="provider-grid">
          {providerRows.map(([provider, status]) => (
            <article className={`provider-card status-${status}`} key={provider}>
              <header>
                <span>{provider.replaceAll("_", " ")}</span>
                <strong>{statusLabel(status)}</strong>
              </header>
              <i aria-hidden="true" />
            </article>
          ))}
        </div>
        <div className="object-list wearable-ledger">
          <ObjectLine label="OAuth" value={hostLabel(authorizationUrl)} />
          <ObjectLine label="Scope" value={connection?.scopes.join(", ") ?? "daily"} />
          <ObjectLine
            label="Fallback"
            value={dashboard.fallback_available ? "manual sleep log" : "unavailable"}
          />
          <ObjectLine label="Generated" value={new Date(dashboard.generated_at).toLocaleTimeString()} />
        </div>
        <div className="action-row wearable-actions">
          <button className="command primary" onClick={onConnect}>
            <Link2 size={18} />
            Connect Oura
          </button>
          <button className="command" onClick={onSync}>
            <RefreshCcw size={18} />
            Sync Night
          </button>
          <button className="command" onClick={onRevoke}>
            <Unplug size={18} />
            Revoke
          </button>
        </div>
      </section>

      <section className="panel wearable-sleep-panel">
        <PanelTitle icon={Moon} title="Sleep Import" meta={sleep?.external_id ?? "not synced"} />
        {sleep ? (
          <>
            <div className="case-grid">
              <MiniStat label="Window" value={sleepWindow} />
              <MiniStat label="Delta" value={`${Math.round(sleep.readiness_delta * 100)} pts`} />
              <MiniStat label="Deep" value={`${Math.round(sleep.stage_minutes.deep)} min`} />
              <MiniStat label="REM" value={`${Math.round(sleep.stage_minutes.rem)} min`} />
            </div>
            <div className="wearable-stage-grid">
              {(["awake", "light", "deep", "rem"] as const).map((stage) => (
                <article className={`stage-card stage-${stage}`} key={stage}>
                  <span>{stage}</span>
                  <strong>{Math.round(sleep.stage_minutes[stage])}m</strong>
                </article>
              ))}
            </div>
            <Progress label="Readiness sleep" value={dashboard.readiness_adjustment?.sleep_quality ?? 0} />
            <Progress label="Fatigue load" value={dashboard.readiness_adjustment?.fatigue ?? 0} />
          </>
        ) : (
          <div className="wearable-empty">
            <Moon size={24} />
            <strong>No synced sleep session</strong>
            <span>Manual logging remains available.</span>
          </div>
        )}
      </section>

      <section className="panel native-edge-panel">
        <PanelTitle icon={Smartphone} title="Native Edge" meta={dashboard.native_edge_plan.platform} />
        <div className="native-edge-grid">
          <NativeEdgeCard label="HealthKit" value={dashboard.native_edge_plan.healthkit} />
          <NativeEdgeCard label="Health Connect" value={dashboard.native_edge_plan.health_connect} />
          <NativeEdgeCard label="Audio" value={dashboard.native_edge_plan.background_audio} />
          <NativeEdgeCard label="Notifications" value={dashboard.native_edge_plan.local_notifications} />
          <NativeEdgeCard label="Watch Haptics" value={dashboard.native_edge_plan.watch_haptics} />
          <NativeEdgeCard
            label="Offline Cache"
            value={dashboard.device.offline_cache_supported ? "available" : "unavailable"}
          />
        </div>
        <div className="tag-row">
          {dashboard.native_edge_plan.notes.map((note) => (
            <span className="tag" key={note}>
              {note}
            </span>
          ))}
        </div>
      </section>

      <section className="panel token-panel">
        <PanelTitle
          icon={ShieldCheck}
          title="Token Control"
          meta={connection?.revoked_at ? "revoked" : "armed"}
        />
        <div className="token-vault">
          <ShieldCheck size={24} />
          <div>
            <strong>{connection?.token_envelope ? "AES-GCM envelope" : "No browser token"}</strong>
            <span>
              {connection?.refresh_token_envelope ? "refresh envelope present" : "refresh token withheld"}
            </span>
          </div>
        </div>
        <div className="object-list">
          <ObjectLine label="Connection" value={connection?.id ?? "manual fallback"} />
          <ObjectLine label="Status" value={statusLabel(connection?.status ?? "fallback")} />
          <ObjectLine label="Revoked" value={connection?.revoked_at ? "yes" : "no"} />
          <ObjectLine label="Readiness" value={dashboard.readiness_adjustment?.notes ?? "baseline"} />
        </div>
      </section>
    </div>
  );
}

function NativeEdgeCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="native-card">
      <span>{label}</span>
      <strong>{statusLabel(value)}</strong>
    </article>
  );
}

function statusLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function hostLabel(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "local";
  }
}

function wearableToneFor(status: WearableConnectionStatus): "teal" | "amber" | "coral" | "indigo" {
  if (status === "connected") return "teal";
  if (status === "revoked") return "coral";
  if (status === "authorization_required") return "amber";
  return "indigo";
}

function PacksView() {
  const packs = ["Spanish Travel", "Python Basics", "Linear Algebra", "World History", "AI Systems"];
  return (
    <div className="pack-grid">
      {packs.map((pack) => {
        const concepts = demoMasterGraph.concepts.filter(
          (concept) => concept.subdomain === pack || concept.domain === pack.toLowerCase()
        );
        return (
          <article className="item-card pack-card" key={pack}>
            <BookOpen size={24} />
            <h3>{pack}</h3>
            <Progress label="Graph coverage" value={Math.min(1, concepts.length / 4)} />
            <ObjectLine label="License" value="CC BY compatible seed data" />
            <ObjectLine label="Quality" value={pack === "AI Systems" ? "expert reviewed" : "tested"} />
          </article>
        );
      })}
    </div>
  );
}

function CourtView({
  verdict: initialVerdict,
  userId
}: {
  verdict: ReturnType<typeof arbitrateProposal>;
  userId: string;
}) {
  const [proposal, setProposal] = useState<Proposal>(demoProposals[0]);
  const [verdict, setVerdict] = useState(initialVerdict);
  const [comment, setComment] = useState("");
  const [release, setRelease] = useState<GraphReleasePreview | null>(null);
  const voteTypes: VoteType[] = ["clear", "accurate", "needs_expert_review", "misleading"];
  const diffBefore = proposal.diff.before;
  const diffAfter = proposal.diff.after;
  const commentPreviews = proposal.expert_comments.map(toCourtCommentPreview);

  function runArbiter() {
    const nextVerdict = arbitrateProposal(proposal);
    setVerdict(nextVerdict);
    setProposal({
      ...proposal,
      ai_review: nextVerdict as unknown as Record<string, unknown>,
      status: statusForArbiterDecision(nextVerdict.decision),
      updated_at: nowIso()
    });
    setRelease(null);
  }

  function castCourtVote(voteType: VoteType) {
    setProposal(castVote(proposal, voteType, "learner"));
    setRelease(null);
  }

  function addCourtComment() {
    if (comment.trim().length < 4) return;
    setProposal({
      ...proposal,
      expert_comments: [
        ...proposal.expert_comments,
        {
          author_id: userId,
          text: comment,
          comment_type: "learner",
          created_at: nowIso()
        }
      ],
      updated_at: nowIso()
    });
    setComment("");
    setRelease(null);
  }

  function acceptForRelease() {
    setProposal({
      ...proposal,
      status: "accepted",
      expert_comments: [
        ...proposal.expert_comments,
        {
          author_id: "moderator_demo",
          text: "Accepted for seed graph release after review.",
          comment_type: "moderator",
          override: true,
          created_at: nowIso()
        }
      ],
      updated_at: nowIso()
    });
    setRelease(null);
  }

  function releaseGraphVersion() {
    const graphVersion = `graph-${new Date().toISOString().slice(0, 10)}-court`;
    const releaseNotes = `Released ${proposal.proposal_type.replaceAll("_", " ")} for ${proposal.affected_object_ids.join(", ")}.`;
    setProposal({
      ...proposal,
      status: "merged",
      expert_comments: [
        ...proposal.expert_comments,
        {
          author_id: "release_bot",
          text: releaseNotes,
          comment_type: "release_note",
          graph_version: graphVersion,
          created_at: nowIso()
        }
      ],
      updated_at: nowIso()
    });
    setRelease({
      graphVersion,
      releaseNotes,
      affectedObjectIds: proposal.affected_object_ids,
      auditAction: "proposal_released"
    });
  }

  return (
    <div className="page-grid court-grid">
      <section className="panel court-case-file">
        <PanelTitle icon={Gavel} title="Case File" meta={proposal.status} />
        <h2>{proposal.proposal_type.replaceAll("_", " ")}</h2>
        <p className="dense-copy">{proposal.rationale}</p>
        <div className="case-grid">
          <MiniStat
            label="Bridge priority"
            value={`${Math.round(computeBridgingPriority(proposal) * 100)}%`}
          />
          <MiniStat label="Risk" value={proposal.risk_level} />
          <MiniStat label="Sources" value={`${proposal.evidence_for.length}`} />
          <MiniStat label="Objects" value={`${proposal.affected_object_ids.length}`} />
        </div>
        <div className="diff-view">
          <div>
            <span>Before</span>
            <p>{typeof diffBefore === "string" ? diffBefore : JSON.stringify(diffBefore)}</p>
          </div>
          <div>
            <span>After</span>
            <p>{typeof diffAfter === "string" ? diffAfter : JSON.stringify(diffAfter)}</p>
          </div>
        </div>
        <div className="court-actions">
          {voteTypes.map((voteType) => (
            <button className="command" key={voteType} onClick={() => castCourtVote(voteType)}>
              <BadgeCheck size={18} />
              {voteType.replaceAll("_", " ")}
            </button>
          ))}
        </div>
        <div className="court-comment-box">
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Add review note..."
            rows={4}
          />
          <button className="command primary" onClick={addCourtComment}>
            <ClipboardCheck size={18} />
            Comment
          </button>
        </div>
      </section>
      <section className="panel">
        <PanelTitle icon={ShieldCheck} title="Arbiter Verdict" meta={verdict.decision} />
        <p className="dense-copy">{verdict.reasoning_summary}</p>
        <ObjectLine label="For" value={verdict.strongest_argument_for} />
        <ObjectLine label="Against" value={verdict.strongest_argument_against} />
        <Progress label="Confidence" value={verdict.confidence} />
        <div className="action-row court-flow-actions">
          <button className="command primary" onClick={runArbiter}>
            <Sparkles size={18} />
            Review
          </button>
          <button className="command" onClick={acceptForRelease}>
            <ShieldCheck size={18} />
            Accept
          </button>
          <button
            className="command"
            onClick={releaseGraphVersion}
            disabled={!["accepted", "accepted_with_modifications"].includes(proposal.status)}
          >
            <GitBranch size={18} />
            Release
          </button>
        </div>
        <div className="object-list court-event-log">
          <ObjectLine label="Votes" value={`${Object.keys(proposal.community_votes).length}`} />
          <ObjectLine label="Comments" value={`${proposal.expert_comments.length}`} />
          <ObjectLine label="Arbiter review" value={proposal.ai_review ? "recorded" : "pending"} />
          <ObjectLine label="Audit" value={release?.auditAction ?? "proposal case open"} />
        </div>
        {commentPreviews.length > 0 && (
          <div className="court-note-ledger">
            <h3>Review Notes</h3>
            {commentPreviews.map((entry) => (
              <article className="court-note" key={entry.id}>
                <header>
                  <span>{entry.comment_type.replaceAll("_", " ")}</span>
                  <strong>{entry.author_id}</strong>
                </header>
                <p>{entry.text}</p>
              </article>
            ))}
          </div>
        )}
        {release && (
          <div className="release-note">
            <PanelTitle icon={GitBranch} title="Release Notes" meta={release.graphVersion} />
            <ObjectLine label="Graph version" value={release.graphVersion} />
            <p>{release.releaseNotes}</p>
            <div className="tag-row">
              {release.affectedObjectIds.map((objectId) => (
                <span className="tag" key={objectId}>
                  {objectId}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

type GraphReleasePreview = {
  graphVersion: string;
  releaseNotes: string;
  affectedObjectIds: string[];
  auditAction: string;
};

type CourtCommentPreview = {
  id: string;
  author_id: string;
  comment_type: string;
  text: string;
};

function LabView({
  techniques,
  assignments,
  profile,
  rollups
}: {
  techniques: typeof techniqueRegistry;
  assignments: ExperimentAssignment[];
  profile: PersonalizationProfile;
  rollups: ExperimentOutcomeRollup[];
}) {
  const activeRollups = rollups.flatMap((rollup) =>
    rollup.condition_rollups
      .filter(
        (condition) => condition.condition_id !== "control" && condition.condition_id !== "matched_control"
      )
      .map((condition) => ({ ...condition, title: rollup.title, experimentType: rollup.experiment_type }))
  );
  const visibleAssignments = assignments.slice(0, 8);
  return (
    <div className="page-grid lab-dashboard">
      <section className="panel lab-overview">
        <PanelTitle icon={FlaskConical} title="Personalization Lab" meta="within-user controls" />
        <div className="case-grid">
          <MiniStat label="Experiments" value={`${profile.tracked_experiment_count}`} />
          <MiniStat label="Assignments" value={`${profile.active_assignment_count}`} />
          <MiniStat label="Recommended" value={`${profile.recommended_technique_ids.length}`} />
          <MiniStat label="Held" value={`${profile.suppressed_technique_ids.length}`} />
        </div>
        <div className="scheduler-adjustment">
          <ObjectLine
            label="Morning screen"
            value={`${profile.scheduler_adjustments.morning_screen_budget_minutes} min`}
          />
          <ObjectLine
            label="Watch budgets"
            value={profile.scheduler_adjustments.optional_watch_budgets.join(" / ")}
          />
          <ObjectLine label="Evening" value={profile.scheduler_adjustments.evening_screen_policy} />
          <ObjectLine label="Mode bias" value={profile.scheduler_adjustments.recommended_mode_bias} />
        </div>
        <div className="tag-row">
          {profile.scheduler_adjustments.rationale.map((item) => (
            <span className="tag" key={item}>
              {item}
            </span>
          ))}
        </div>
      </section>

      <section className="panel">
        <PanelTitle icon={CircleGauge} title="Response Profile" meta="rolling" />
        <Progress label="Voice" value={profile.modality_response.voice_score} />
        <Progress label="Text" value={profile.modality_response.text_score} />
        <Progress label="Walking" value={profile.modality_response.walking_score} />
        <Progress label="Video" value={profile.modality_response.video_score} />
        <Progress label="Paced Read" value={profile.modality_response.paced_read_score} />
        <ObjectLine
          label="Sleep cue gain"
          value={`${Math.round(profile.sleep_cue_response.cue_gain_delta * 100)} pts`}
        />
      </section>

      <section className="panel lab-rollups">
        <PanelTitle icon={BarChart3} title="Effect Rollups" meta={`${activeRollups.length} active`} />
        {activeRollups.map((rollup) => (
          <article className="lab-rollup" key={`${rollup.title}-${rollup.condition_id}`}>
            <header>
              <span>{rollup.experimentType}</span>
              <strong>{rollup.recommendation.replaceAll("_", " ")}</strong>
            </header>
            <h3>{rollup.technique_id ?? rollup.condition_id}</h3>
            <Progress label="Effect vs control" value={clamp(0.5 + rollup.effect_vs_control)} />
            <ObjectLine label="Observations" value={`${rollup.observations}`} />
          </article>
        ))}
      </section>

      <section className="panel lab-assignments">
        <PanelTitle icon={GitBranch} title="Matched Assignments" meta={`${assignments.length} units`} />
        {visibleAssignments.map((assignment) => (
          <ObjectLine
            key={assignment.id}
            label={assignment.unit_id}
            value={`${assignment.condition_id} -> ${assignment.matched_control_unit_id ?? "none"}`}
          />
        ))}
      </section>

      <section className="lab-grid lab-techniques">
        {techniques.map((technique) => {
          const experiment = createTechniqueExperiment(technique);
          return (
            <article className="item-card technique-card" key={technique.id}>
              <FlaskConical size={22} />
              <h3>{technique.name}</h3>
              <p>{technique.description}</p>
              <div className="tag-row">
                <span className="tag">{technique.category}</span>
                <span className="tag">{technique.evidence_level}</span>
                <span className="tag">{experiment.assignment_strategy}</span>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

type LocalIncidentArtifact = {
  manifest: ObjectManifest;
  sizeBytes: number;
  route: string;
};

function buildLocalOpsMonitoring(userId: string): OpsMonitoringDashboard {
  const deadLetter = failOpsJob(
    startOpsJob(
      createOpsJob({
        queue: "audio_render",
        type: "render_sleep_audio",
        payload: { audio_plan_id: "sleep_audio_release_gate" },
        maxAttempts: 1,
        idempotencyKey: "release_audio_render",
        auditSubjectId: userId,
        createdAt: "2026-06-30T12:00:00.000Z"
      }),
      "worker-audio",
      "2026-06-30T12:01:00.000Z"
    ),
    "codec output missing integrity proof",
    "2026-06-30T12:02:00.000Z"
  );
  const backupObject = createObjectManifest({
    bucket: "backup",
    key: "backups/system/release-drill.json",
    contentType: "application/json",
    sizeBytes: 12_288,
    sha256: "a".repeat(64),
    ownerId: userId,
    retentionPolicy: "backup",
    createdAt: "2026-06-30T11:50:00.000Z"
  });
  return buildOpsMonitoringDashboard({
    opsHealth: buildOpsHealthDashboard({
      jobs: [deadLetter],
      objects: [backupObject],
      generatedAt: "2026-06-30T12:15:00.000Z"
    }),
    securityGate: {
      passed: true,
      csp_present: true,
      csrf_required_for_mutation: true,
      rate_limits_present: true,
      high_stakes_labeled: true,
      expert_review_required_when_high_stakes: true,
      audit_safe: true
    },
    dependencyReadiness: {
      service: "mnemosyne-api",
      status: "ready",
      environment: "production",
      checked_at: "2026-06-30T12:15:00.000Z",
      components: {
        store: { status: "ok", checked_at: "2026-06-30T12:15:00.000Z" },
        object_storage: { status: "ok", checked_at: "2026-06-30T12:15:00.000Z" }
      }
    }
  });
}

function AdminView({
  userId,
  eventLog,
  onAuditEvent
}: {
  userId: string;
  eventLog: string[];
  onAuditEvent: (event: string) => void;
}) {
  const [privacyStatus, setPrivacyStatus] = useState("export ready");
  const [incidentStatus, setIncidentStatus] = useState("release drill blocked");
  const [incidentReport, setIncidentReport] = useState<IncidentResponseReport | null>(null);
  const [incidentArtifact, setIncidentArtifact] = useState<LocalIncidentArtifact | null>(null);
  const services = [
    "Auth",
    "Graph",
    "Scheduler",
    "Assessment",
    "Technique Lab",
    "VideoGraph",
    "Audio Renderer",
    "SleepCue",
    "Wearables",
    "Privacy",
    "Content Court",
    "Local Arbiter",
    "Analytics"
  ];
  const privacyOps = [
    {
      title: "Data Export",
      endpoint: "GET /api/privacy/export",
      action: () => {
        setPrivacyStatus("export bundle prepared");
        onAuditEvent("privacy_export_staged");
      },
      icon: Database
    },
    {
      title: "Voice Delete",
      endpoint: "DELETE voice scope",
      action: () => {
        setPrivacyStatus("voice payloads scrubbed");
        onAuditEvent("voice_delete_staged");
      },
      icon: AudioLines
    },
    {
      title: "Health Delete",
      endpoint: "DELETE health scope",
      action: () => {
        setPrivacyStatus("health tokens and sleep imports queued");
        onAuditEvent("health_delete_staged");
      },
      icon: Activity
    },
    {
      title: "Account Delete",
      endpoint: "DELETE account scope",
      action: () => {
        setPrivacyStatus("account deletion requires confirmation");
        onAuditEvent("account_delete_confirmation_required");
      },
      icon: ShieldCheck
    }
  ];
  const monitoring = useMemo(() => buildLocalOpsMonitoring(userId), [userId]);
  const primaryAlerts = monitoring.alerts.slice(0, 4);
  const activeReport =
    incidentReport ??
    buildIncidentResponseReport({
      monitoring,
      operatorId: userId,
      environment: "production",
      title: "Production release incident preview",
      generatedAt: "2026-06-30T12:30:00.000Z"
    });
  async function stageIncidentReport() {
    setIncidentStatus("building report artifact");
    const report = buildIncidentResponseReport({
      monitoring,
      operatorId: userId,
      environment: "production",
      title: "Production release incident drill"
    });
    const body = JSON.stringify(report, null, 2);
    const sha256 = await sha256Hex(body);
    const manifest = createObjectManifest({
      bucket: "evidence",
      key: `incidents/production/${safePathSegment(report.id)}.json`,
      contentType: "application/json",
      sizeBytes: new TextEncoder().encode(body).byteLength,
      sha256,
      ownerId: userId,
      retentionPolicy: report.severity === "none" ? "product" : "legal_hold",
      metadata: {
        report_id: report.id,
        schema_version: report.schema_version,
        severity: report.severity,
        status: report.status,
        ready_for_release: report.ready_for_release
      },
      createdAt: report.generated_at
    });
    setIncidentReport(report);
    setIncidentArtifact({
      manifest,
      sizeBytes: manifest.size_bytes,
      route: "POST /api/ops/incidents/reports"
    });
    setIncidentStatus(`${report.severity.toUpperCase()} report staged`);
    onAuditEvent("ops_incident_report_stored");
  }
  return (
    <div className="page-grid admin-grid">
      <section className="panel">
        <PanelTitle icon={Database} title="Service Map" meta={`${services.length} services`} />
        <div className="service-grid">
          {services.map((service) => (
            <div className="service-pill" key={service}>
              <Activity size={16} />
              <span>{service}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="panel incident-panel">
        <PanelTitle icon={LifeBuoy} title="Incident Command" meta={incidentStatus} />
        <div className="incident-summary">
          <ObjectLine label="Severity" value={activeReport.severity.toUpperCase()} />
          <ObjectLine label="Alerts" value={`${activeReport.alert_counts.total}`} />
          <ObjectLine label="Release" value={activeReport.ready_for_release ? "ready" : "blocked"} />
        </div>
        <div className="incident-actions">
          <button className="command primary" onClick={() => void stageIncidentReport()}>
            <ClipboardCheck size={18} />
            Stage report
          </button>
          <span className="tag">{activeReport.status}</span>
          <span className="tag">{activeReport.recommended_actions.length} actions</span>
        </div>
        <div className="object-list incident-alerts">
          {primaryAlerts.map((alert) => (
            <ObjectLine key={alert.id} label={alert.severity} value={alert.title} />
          ))}
        </div>
        {incidentArtifact && (
          <div className="incident-artifact">
            <ObjectLine label="Route" value={incidentArtifact.route} />
            <ObjectLine label="Object" value={incidentArtifact.manifest.key} />
            <ObjectLine label="Size" value={`${incidentArtifact.sizeBytes} bytes`} />
            <ObjectLine label="Retention" value={incidentArtifact.manifest.retention_policy} />
            <ObjectLine label="SHA-256" value={incidentArtifact.manifest.sha256.slice(0, 16)} />
          </div>
        )}
      </section>
      <section className="panel privacy-ops-panel">
        <PanelTitle icon={ShieldCheck} title="Privacy Ops" meta={privacyStatus} />
        <div className="privacy-op-grid">
          {privacyOps.map((operation) => {
            const Icon = operation.icon;
            return (
              <article className="privacy-op-card" key={operation.title}>
                <Icon size={20} />
                <h3>{operation.title}</h3>
                <ObjectLine label="Route" value={operation.endpoint} />
                <button className="command" onClick={operation.action}>
                  <ClipboardCheck size={18} />
                  Stage
                </button>
              </article>
            );
          })}
        </div>
      </section>
      <section className="panel">
        <PanelTitle icon={ClipboardCheck} title="Audit Log" meta="latest" />
        <div className="object-list">
          {eventLog.map((event, index) => (
            <ObjectLine key={`${event}-${index}`} label={`#${index + 1}`} value={event} />
          ))}
        </div>
      </section>
    </div>
  );
}

async function sha256Hex(value: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return stableHash(value).toString(16).padStart(64, "0").slice(0, 64);
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function WorkbenchView({
  offlineSummary,
  offlineQueue,
  offlineSyncStatus,
  onSyncOfflineQueue,
  onRecoverOfflineQueue,
  onClearSyncedOfflineQueue
}: {
  offlineSummary: OfflineQueueSummary;
  offlineQueue: OfflineQueueItem[];
  offlineSyncStatus: string;
  onSyncOfflineQueue: () => void;
  onRecoverOfflineQueue: () => void;
  onClearSyncedOfflineQueue: () => void;
}) {
  const visibleOfflineItems = offlineQueue.slice(0, 6);
  return (
    <div className="page-grid workbench-grid">
      <section className="metric-strip">
        <MetricTile icon={GitBranch} label="Known" value="ready" tone="teal" />
        <MetricTile icon={CircleGauge} label="Frontier" value="active" tone="amber" />
        <MetricTile icon={Activity} label="Blocked" value="hold" tone="coral" />
        <MetricTile icon={Moon} label="Sleep" value="safe" tone="indigo" />
      </section>

      <section className="panel offline-ledger-panel">
        <PanelTitle icon={Unplug} title="Offline Sync Ledger" meta={offlineSyncStatus} />
        <div className="case-grid">
          <MiniStat label="Queued" value={`${offlineSummary.queued}`} />
          <MiniStat label="Synced" value={`${offlineSummary.synced}`} />
          <MiniStat label="Retryable" value={`${offlineSummary.retryable}`} />
          <MiniStat label="Stale" value={`${offlineSummary.stale_syncing_item_ids.length}`} />
        </div>
        <div className="action-row">
          <button className="command primary" onClick={onSyncOfflineQueue}>
            <Radio size={18} />
            Sync
          </button>
          <button className="command" onClick={onRecoverOfflineQueue}>
            <RefreshCcw size={18} />
            Recover
          </button>
          <button className="command" onClick={onClearSyncedOfflineQueue}>
            <ClipboardCheck size={18} />
            Clear Synced
          </button>
        </div>
        <div className="object-list">
          {visibleOfflineItems.length > 0 ? (
            visibleOfflineItems.map((item) => (
              <ObjectLine
                key={item.id}
                label={item.status}
                value={`${item.action_type} -> ${item.endpoint}`}
              />
            ))
          ) : (
            <ObjectLine label="queue" value="empty" />
          )}
        </div>
      </section>

      <section className="panel">
        <PanelTitle icon={ClipboardCheck} title="Core States" meta="surface set" />
        <div className="state-grid">
          <article className="state-card empty">
            <Database size={24} />
            <h3>Empty graph</h3>
            <p>No goals, packs, or concept states.</p>
            <button className="command">
              <BookOpen size={18} />
              Add pack
            </button>
          </article>
          <article className="state-card loading">
            <Activity size={24} />
            <h3>Packet loading</h3>
            <div className="loading-lines">
              <i />
              <i />
              <i />
            </div>
          </article>
          <article className="state-card error">
            <ShieldCheck size={24} />
            <h3>Safety hold</h3>
            <p>High-risk content needs human review.</p>
            <span className="tag">human_review_required</span>
          </article>
          <article className="state-card success">
            <CheckCircle2 size={24} />
            <h3>Review saved</h3>
            <p>Audit event and proposal case file linked.</p>
            <span className="tag">audit-ready</span>
          </article>
        </div>
      </section>

      <section className="panel">
        <PanelTitle icon={SunMedium} title="Session Rows" meta="dense states" />
        <div className="session-stack">
          <SessionRow
            icon={SunMedium}
            title="Morning Forge"
            time="30 min"
            details={["retrieval", "frontier", "voice"]}
          />
          <SessionRow
            icon={Video}
            title="GraphFeed"
            time="18 min"
            details={["bounded", "transcript", "recall gate"]}
          />
          <SessionRow
            icon={Moon}
            title="Night Reactivation"
            time="8 hr"
            details={["sparse cues", "controls", "NREM estimate"]}
          />
        </div>
      </section>

      <section className="panel">
        <PanelTitle icon={CircleGauge} title="Controls" meta="form states" />
        <Slider label="Readiness" value={0.64} onChange={() => undefined} />
        <Slider label="Screen budget" value={0.38} onChange={() => undefined} suffix="23m" />
        <label className="switch-row">
          <input type="checkbox" checked readOnly />
          <span>Dusk guard</span>
        </label>
        <div className="action-row">
          <IconButton title="Play" icon={Play} />
          <IconButton title="Pause" icon={Pause} />
          <button className="command primary">
            <CheckCircle2 size={18} />
            Save
          </button>
        </div>
      </section>

      <section className="panel">
        <PanelTitle icon={Video} title="Content Cards" meta="ranking states" />
        <article className="video-card workbench-video">
          <div className="video-thumb">
            <Video size={28} />
            <span>18m</span>
          </div>
          <div>
            <h3>Queries, keys, values in one worked trace</h3>
            <p>Creator Studio</p>
            <div className="tag-row">
              <span className="tag">frontier</span>
              <span className="tag">low load</span>
              <span className="tag">recall gate</span>
            </div>
          </div>
          <strong>91</strong>
        </article>
        <div className="case-grid">
          <MiniStat label="Quality" value="84%" />
          <MiniStat label="Risk" value="low" />
          <MiniStat label="Transfer" value="66%" />
          <MiniStat label="Efficiency" value="76%" />
        </div>
      </section>

      <section className="panel">
        <PanelTitle icon={Gavel} title="Case Lines" meta="moderation" />
        <div className="object-list">
          <ObjectLine label="Proposal" value="add_video" />
          <ObjectLine label="Evidence" value="expert transcript packet, quality 0.84" />
          <ObjectLine label="Decision" value="needs_more_evidence" />
          <ObjectLine label="Audit" value="creator_ingestion_submitted" />
        </div>
      </section>
    </div>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  tone
}: {
  icon: typeof Home;
  label: string;
  value: string;
  tone: "teal" | "amber" | "coral" | "indigo";
}) {
  return (
    <article className={`metric-tile ${tone}`}>
      <Icon size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function PanelTitle({ icon: Icon, title, meta }: { icon: typeof Home; title: string; meta?: string }) {
  return (
    <div className="panel-title">
      <Icon size={19} />
      <h2>{title}</h2>
      {meta && <span>{meta}</span>}
    </div>
  );
}

function IconButton({
  title,
  icon: Icon,
  onClick
}: {
  title: string;
  icon: typeof Home;
  onClick?: () => void;
}) {
  return (
    <button className="icon-button" title={title} aria-label={title} onClick={onClick}>
      <Icon size={18} />
    </button>
  );
}

function SessionRow({
  icon: Icon,
  title,
  time,
  details
}: {
  icon: typeof Home;
  title: string;
  time: string;
  details: string[];
}) {
  return (
    <div className="session-row">
      <Icon size={20} />
      <div>
        <h3>{title}</h3>
        <div className="tag-row">
          {details.map((detail) => (
            <span className="tag" key={detail}>
              {detail}
            </span>
          ))}
        </div>
      </div>
      <strong>{time}</strong>
    </div>
  );
}

function Slider({
  label,
  value,
  onChange,
  suffix
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <label className="slider-row">
      <span>
        {label}
        <strong>{suffix ?? `${Math.round(value * 100)}%`}</strong>
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function Progress({ label, value }: { label: string; value: number }) {
  return (
    <div className="progress-row">
      <span>{label}</span>
      <div>
        <i style={{ width: `${clamp(value) * 100}%` }} />
      </div>
      <strong>{Math.round(clamp(value) * 100)}%</strong>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="mini-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ObjectLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="object-line">
      <span>{label}</span>
      <strong>{value || "none"}</strong>
    </div>
  );
}

function Ratio({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`ratio ${color}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function buildVideoRecallPrompt(video: VideoAsset, concepts: ConceptNode[]): AssessmentItem {
  const linkedConcepts = video.concept_ids
    .map((conceptId) => concepts.find((concept) => concept.id === conceptId))
    .filter((concept): concept is ConceptNode => Boolean(concept));
  const expectedAnswer = linkedConcepts
    .map((concept) => `${concept.title}: ${conceptDefinition(concept)}`)
    .join(" ");
  return {
    id: createId("video_recall", video.id),
    concept_ids: video.concept_ids,
    assessment_type: "free_recall",
    prompt: `After watching "${video.title}", explain the mechanism, one concrete example, and one boundary or failure case.`,
    expected_answer: expectedAnswer || video.title,
    rubric: {
      must_include: linkedConcepts.slice(0, 3).map((concept) => concept.title.toLowerCase()),
      acceptable_aliases: linkedConcepts.map((concept) => concept.slug),
      common_failures: ["watched passively without recall", "names topic but misses mechanism"],
      transfer_signals: ["new example", "boundary condition", "counterexample"]
    },
    difficulty: clamp(video.difficulty + 0.08),
    time_limit_seconds: 180,
    modality: ["text", "voice", "video"],
    created_at: nowIso()
  };
}

function chapterStartPercent(chapter: Record<string, unknown>, durationSeconds: number): number {
  const start = typeof chapter.start === "number" ? chapter.start : 0;
  return clamp(start / Math.max(durationSeconds, 1)) * 100;
}

function chapterTitle(chapter: Record<string, unknown>): string {
  return typeof chapter.title === "string" ? chapter.title : "chapter";
}

function conceptDefinition(concept: ConceptNode): string {
  const definition = concept.definitions[0] as { text?: string } | undefined;
  return definition?.text ?? concept.title;
}

function applyGraphFeedResultToLocalStates(
  states: UserConceptState[],
  video: VideoAsset,
  result: GraphFeedRecallResult
): UserConceptState[] {
  if (!result.recallPassed) return states;
  const next = [...states];
  const retentionLift = video.retention_lift_score;
  const transferLift = video.transfer_lift_score;
  const screenLoad = clamp(result.screenMinutes / 60);
  for (const conceptId of video.concept_ids) {
    const index = next.findIndex((state) => state.concept_id === conceptId);
    const state = index >= 0 ? next[index] : emptyState(conceptId);
    const failures = new Set(state.failure_modes.filter((mode) => mode !== "none"));
    failures.delete("video_recall_missing");
    const updated: UserConceptState = {
      ...state,
      mastery: clamp(state.mastery + result.response.correctness_score * 0.05 + retentionLift * 0.02),
      recall_strength: clamp(state.recall_strength + result.response.correctness_score * 0.055),
      recall_stability: clamp(state.recall_stability + retentionLift * 0.02),
      transfer_score: clamp(state.transfer_score + transferLift * 0.03),
      answer_latency_ms: Math.max(4_000, Math.round(result.response.latency_ms)),
      confidence_calibration: clamp(
        state.confidence_calibration * 0.82 +
          (1 - Math.abs((result.response.confidence_reported ?? 0.5) - result.response.correctness_score)) *
            0.18
      ),
      false_confidence_risk: clamp(state.false_confidence_risk * 0.9),
      failure_modes: failures.size > 0 ? Array.from(failures) : ["none"],
      last_seen_at: result.completedAt,
      last_correct_at: result.completedAt,
      times_seen: state.times_seen + 1,
      times_recalled: state.times_recalled + 1,
      modality_response_profile: {
        ...state.modality_response_profile,
        graphfeed_recall_score: result.response.correctness_score,
        graphfeed_screen_minutes: result.screenMinutes,
        graphfeed_screen_load: screenLoad,
        graphfeed_video_quality: video.source_quality_score
      },
      status: graphFeedStatusFor(state),
      updated_at: result.completedAt
    };
    if (index >= 0) next[index] = updated;
    else next.push(updated);
  }
  return next;
}

function graphFeedStatusFor(state: UserConceptState): UserConceptState["status"] {
  const strength = state.mastery * 0.5 + state.recall_strength * 0.3 + state.transfer_score * 0.2;
  if (strength > 0.78) return "fluent";
  if (strength > 0.62) return "known";
  if (strength > 0.42) return "learning";
  return "fragile";
}

function toCourtCommentPreview(entry: Record<string, unknown>, index: number): CourtCommentPreview {
  const authorId = courtCommentString(entry.author_id, "unknown_reviewer");
  const createdAt = courtCommentString(entry.created_at, `comment-${index}`);
  return {
    id: `${authorId}-${createdAt}-${index}`,
    author_id: authorId,
    comment_type: courtCommentString(entry.comment_type, "note"),
    text: courtCommentString(entry.text, "No note text recorded.")
  };
}

function courtCommentString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function uniqueResponses(responses: Array<AssessmentResponse | null | undefined>): AssessmentResponse[] {
  return [
    ...new Map(
      responses
        .filter((response): response is AssessmentResponse => Boolean(response))
        .map((response) => [response.id, response])
    ).values()
  ];
}

function assessmentResponseSyncPayload(response: AssessmentResponse): Record<string, unknown> {
  return {
    id: response.id,
    assessment_item_id: response.assessment_item_id,
    concept_ids: response.graph_updates.map((update) => update.concept_id),
    correctness_score: response.correctness_score,
    semantic_score: response.semantic_score,
    confidence_reported: response.confidence_reported,
    latency_ms: response.latency_ms,
    hint_count: response.hint_count,
    retries: response.retries,
    graph_updates: response.graph_updates,
    failure_modes: response.detected_failure_modes
  };
}

function uniqueBadgeTemplates(templates: typeof outcomeBadgeTemplates): typeof outcomeBadgeTemplates {
  return [...new Map(templates.map((template) => [template.id, template])).values()];
}

function buildLocalExperimentEvents(input: {
  userId: string;
  cinemaResult: GraphFeedRecallResult | null;
  walkCompletedAt: string | null;
  walkResponses: AssessmentResponse[];
  sleepRecallResult: SleepRecallResult | null;
  sleepCuedConceptIds: string[];
  sleepControlConceptIds: string[];
}): LearningEvent[] {
  const events: LearningEvent[] = [];
  if (input.cinemaResult) {
    events.push({
      id: createId("learning_event", `local-video:${input.cinemaResult.completedAt}`),
      user_id: input.userId,
      event_type: "video_watched",
      payload: {
        video_ids: [input.cinemaResult.videoId],
        recall_passed: input.cinemaResult.recallPassed,
        screen_minutes: input.cinemaResult.screenMinutes,
        screen_load_multiplier: input.cinemaResult.recallPassed ? 0.42 : 0.8
      },
      created_at: input.cinemaResult.completedAt
    });
  }
  if (input.walkCompletedAt && input.walkResponses.length > 0) {
    events.push({
      id: createId("learning_event", `local-walk:${input.walkCompletedAt}`),
      user_id: input.userId,
      event_type: "walk_recall_completed",
      payload: {
        average_correctness: avg(input.walkResponses.map((response) => response.correctness_score)),
        voice_used: true,
        screen_locked: true
      },
      created_at: input.walkCompletedAt
    });
  }
  if (input.sleepRecallResult) {
    events.push({
      id: createId("learning_event", `local-sleep:${input.sleepRecallResult.completedAt}`),
      user_id: input.userId,
      event_type: "graph_updated",
      payload: {
        action: "sleep_cue_recall_completed",
        average_cued_correctness: input.sleepRecallResult.cuedScore,
        average_control_correctness: input.sleepRecallResult.controlScore,
        cue_gain_delta: input.sleepRecallResult.cueGainDelta,
        cued_concept_ids: input.sleepCuedConceptIds,
        control_concept_ids: input.sleepControlConceptIds,
        screen_minutes: 2
      },
      created_at: input.sleepRecallResult.completedAt
    });
  }
  return events;
}

function rankPacedReadAssets(
  assets: PacedReadAsset[],
  states: UserConceptState[],
  frontierIds: string[],
  horizonIds: string[]
): PacedReadAsset[] {
  const mastery = new Map(states.map((state) => [state.concept_id, state.mastery]));
  const frontier = new Set(frontierIds);
  const horizon = new Set(horizonIds);
  return [...assets].sort((left, right) => {
    const score = (asset: PacedReadAsset) => {
      const weakness = avg(asset.concept_ids.map((id) => 1 - (mastery.get(id) ?? 0.05)));
      const frontierHit = asset.concept_ids.some((id) => frontier.has(id)) ? 0.34 : 0;
      const horizonHit = asset.concept_ids.some((id) => horizon.has(id)) ? 0.16 : 0;
      const loadFit = 1 - asset.cognitive_load_score;
      const reviewFit = asset.mode === "review" || asset.mode === "learn" ? 0.18 : 0;
      return weakness * 0.42 + frontierHit + horizonHit + loadFit * 0.22 + reviewFit;
    };
    return score(right) - score(left);
  });
}

function applyPacedReadResultToLocalStates(
  states: UserConceptState[],
  asset: PacedReadAsset,
  result: PacedReadEngineResult
): UserConceptState[] {
  const next = [...states];
  for (const conceptId of asset.concept_ids) {
    const index = next.findIndex((state) => state.concept_id === conceptId);
    const state = index >= 0 ? next[index] : emptyState(conceptId);
    const failures = new Set(state.failure_modes.filter((mode) => mode !== "none"));
    if (result.advanceAllowed) {
      failures.delete("paced_read_comprehension_missed");
      failures.delete("paced_read_strain");
      failures.delete("paced_read_gate_held");
    } else {
      failures.add("paced_read_gate_held");
      if (result.comprehensionScore < 0.72) failures.add("paced_read_comprehension_missed");
      if (result.strainRating > 0.55) failures.add("paced_read_strain");
    }
    const updated: UserConceptState = {
      ...state,
      mastery: result.advanceAllowed
        ? clamp(state.mastery + result.comprehensionScore * 0.055 + result.retentionScore * 0.02)
        : state.mastery,
      recall_strength: result.advanceAllowed
        ? clamp(state.recall_strength + result.retentionScore * 0.06)
        : state.recall_strength,
      transfer_score: result.advanceAllowed
        ? clamp(state.transfer_score + result.comprehensionScore * 0.025)
        : state.transfer_score,
      answer_latency_ms: Math.max(4_000, Math.round((state.answer_latency_ms ?? 24_000) * 0.96)),
      false_confidence_risk: result.advanceAllowed
        ? clamp(state.false_confidence_risk * 0.92)
        : clamp(state.false_confidence_risk + 0.05),
      failure_modes: failures.size > 0 ? Array.from(failures) : ["none"],
      last_seen_at: result.completedAt,
      last_correct_at: result.advanceAllowed ? result.completedAt : state.last_correct_at,
      times_seen: state.times_seen + 1,
      times_recalled: state.times_recalled + (result.advanceAllowed ? 1 : 0),
      times_failed: state.times_failed + (result.advanceAllowed ? 0 : 1),
      modality_response_profile: {
        ...state.modality_response_profile,
        paced_read_effective_wpm: result.effectiveWpm,
        paced_read_screen_load: result.screenLoadScore,
        paced_read_strain: result.strainRating
      },
      status: pacedReadStatusFor(result, state),
      updated_at: result.completedAt
    };
    if (index >= 0) next[index] = updated;
    else next.push(updated);
  }
  return next;
}

function pacedReadStatusFor(
  result: PacedReadEngineResult,
  state: UserConceptState
): UserConceptState["status"] {
  if (!result.advanceAllowed) return state.mastery < 0.42 ? "fragile" : state.status;
  const strength = state.mastery * 0.5 + state.recall_strength * 0.32 + state.transfer_score * 0.18;
  if (strength > 0.78) return "fluent";
  if (strength > 0.62) return "known";
  if (strength > 0.38) return "learning";
  return "fragile";
}

function applyResponseToLocalStates(
  states: UserConceptState[],
  response: AssessmentResponse
): UserConceptState[] {
  const next = [...states];
  for (const update of response.graph_updates) {
    const conceptId = typeof update.concept_id === "string" ? update.concept_id : undefined;
    if (!conceptId) continue;
    const index = next.findIndex((state) => state.concept_id === conceptId);
    const state = index >= 0 ? next[index] : emptyState(conceptId);
    const updated = applyAssessmentToUserState(state, response);
    if (index >= 0) next[index] = updated;
    else next.push(updated);
  }
  return next;
}

function conceptTitle(concepts: ConceptNode[], conceptId: string): string {
  return concepts.find((concept) => concept.id === conceptId)?.title ?? conceptId;
}

function avg(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function repairTipsFor(response: AssessmentResponse): string[] {
  const failures = new Set(response.detected_failure_modes);
  const tips: string[] = [];
  if (failures.has("false_confidence") || failures.has("dangerous_misconception")) {
    tips.push("Repair prerequisite before advancing.");
  }
  if (failures.has("missing_core_claim")) {
    tips.push("Use one worked example, then repeat cold retrieval.");
  }
  if (failures.has("slow_fragile_recall")) {
    tips.push("Repeat tomorrow with a lower latency target.");
  }
  if (failures.has("hint_dependent")) {
    tips.push("Remove hints on the next attempt.");
  }
  if (failures.has("shallow_transfer")) {
    tips.push("Add a different-context transfer drill.");
  }
  return tips.length > 0 ? tips : ["Advance one frontier item and keep normal review cadence."];
}
