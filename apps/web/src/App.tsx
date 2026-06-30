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
  GitBranch,
  Headphones,
  Home,
  Moon,
  Network,
  Pause,
  Play,
  Radio,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sparkles,
  SunMedium,
  Trophy,
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
import { arbitrateProposal, computeBridgingPriority } from "@mnemosyne/content-court";
import { buildGraphSnapshot } from "@mnemosyne/graph-core";
import { buildDailyLearningPacket } from "@mnemosyne/scheduler-core";
import type {
  AssessmentItem,
  AssessmentResponse,
  ConceptNode,
  ReadinessProfile,
  UserConceptState
} from "@mnemosyne/schema";
import { clamp, humanMinutes, round, unique } from "@mnemosyne/shared-utils";
import { buildSleepCuePacket } from "@mnemosyne/sleep-core";
import { createTechniqueExperiment, recommendTechniques, techniqueRegistry } from "@mnemosyne/technique-lab";
import { rankVideosForUser } from "@mnemosyne/video-core";
import {
  defaultReadiness,
  demoGoals,
  demoMasterGraph,
  demoProposals,
  demoUser,
  emptyState,
  initialUserStates
} from "@mnemosyne/demo-fixtures";

type TabId =
  | "onboarding"
  | "today"
  | "graph"
  | "forge"
  | "cinema"
  | "walk"
  | "lock"
  | "sleep"
  | "stats"
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
  { id: "walk", label: "Walk", icon: Footprints },
  { id: "lock", label: "Lock-In", icon: Headphones },
  { id: "sleep", label: "Sleep", icon: Moon },
  { id: "stats", label: "Stats", icon: BarChart3 },
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

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("onboarding");
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
  const [eventLog, setEventLog] = useState<string[]>([
    "daily packet generated",
    "sleep controls assigned",
    "content court policy loaded"
  ]);

  const userGraph = useMemo(() => ({ userId: demoUser.id, states }), [states]);
  const scheduled = useMemo(
    () =>
      buildDailyLearningPacket({
        user: demoUser,
        userGraph,
        masterGraph: demoMasterGraph,
        goals: demoGoals,
        readiness,
        constraints: {
          morningScreenBudget: readiness.screen_budget_minutes > 20 ? 10 : 4,
          optionalWatchBudgets: [30, 18, 8],
          eveningScreenPolicy: readiness.dusk_mode ? "audio_only" : "minimal_visual",
          conservativeSleep: readiness.sleep_quality < 0.5 || readiness.fatigue > 0.7
        }
      }),
    [readiness, userGraph]
  );
  const snapshot = useMemo(() => buildGraphSnapshot(demoMasterGraph, userGraph), [userGraph]);
  const rankedVideos = useMemo(
    () =>
      rankVideosForUser({
        videos: demoMasterGraph.videos,
        states,
        goals: demoGoals,
        frontierConceptIds: scheduled.packet.morning.frontier_items.map((concept) => concept.id),
        horizonConceptIds: scheduled.packet.morning.horizon_items.map((concept) => concept.id),
        readiness
      }),
    [readiness, scheduled.packet.morning.frontier_items, scheduled.packet.morning.horizon_items, states]
  );
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
        user: demoUser,
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
    try {
      window.localStorage.setItem(
        "mnemosyne.dailyPacket.v1",
        JSON.stringify({
          cached_at: new Date().toISOString(),
          packet_id: scheduled.packet.id,
          date: scheduled.packet.date,
          user_id: scheduled.packet.user_id,
          morning_items: scheduled.packet.morning.cold_retrieval_items.length,
          walk_packets: scheduled.packet.walk_packets.length,
          sleep_audio_plan_id: scheduled.audioPlan.id
        })
      );
      setOfflineCacheStatus("ready");
    } catch {
      setOfflineCacheStatus("unavailable");
    }
  }, [scheduled.audioPlan.id, scheduled.packet]);

  function submitAnswer() {
    const prompt = activeForgePrompt;
    if (!prompt || answer.trim().length === 0) return;
    const response = scoreAssessmentResponse({
      userId: demoUser.id,
      item: prompt,
      rawResponse: answer,
      confidence,
      latencyMs: Math.max(1_000, Date.now() - forgeStartedAt)
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
    setAnswer("");
    setForgeIndex((index) => (forgeQueue.length > 0 ? (index + 1) % forgeQueue.length : index));
    setForgeStartedAt(Date.now());
  }

  function submitLockInAnswer() {
    const prompt = activeLockPrompt;
    if (!prompt || lockAnswer.trim().length === 0) return;
    const response = scoreAssessmentResponse({
      userId: demoUser.id,
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
          user_id: demoUser.id,
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
          user_id: demoUser.id,
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
          userId: demoUser.id,
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
          userId: demoUser.id,
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
          user_id: demoUser.id,
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
    setReadiness(config.readiness);
    setStates(config.states);
    setSelectedNodeId(config.targetConceptIds[0] ?? "attention_qkv");
    setForgeIndex(0);
    setForgeResponses(0);
    setRepairTips([]);
    setLastResponse(null);
    setForgeStartedAt(Date.now());
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
    cinema: <CinemaView rankedVideos={rankedVideos} packet={scheduled.packet.optional_watch_packets[0]} />,
    walk: <WalkView prompts={scheduled.packet.walk_packets[0]?.prompts ?? []} />,
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
    packs: <PacksView />,
    court: <CourtView verdict={verdict} />,
    lab: <LabView techniques={recommendedTechniques} />,
    workbench: <WorkbenchView />,
    admin: <AdminView eventLog={eventLog} />
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
  packCount: number;
  diagnosticCount: number;
  targetConceptIds: string[];
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
  const [flashread, setFlashread] = useState(true);
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
      packCount: selectedPacks.length,
      diagnosticCount: diagnostics.length,
      targetConceptIds: targetConcepts.map((concept) => concept.id),
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
              <ToggleCard label="FlashRead" checked={flashread} onChange={setFlashread} icon={BookOpen} />
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
  packet: ReturnType<typeof buildDailyLearningPacket>["packet"];
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
  packet: ReturnType<typeof buildDailyLearningPacket>["packet"];
  prompt:
    | ReturnType<typeof buildDailyLearningPacket>["packet"]["morning"]["cold_retrieval_items"][number]
    | undefined;
  promptIndex: number;
  queueLength: number;
  frontier: ConceptNode[];
  horizon: ConceptNode[];
  cuePreview: ReturnType<typeof buildDailyLearningPacket>["packet"]["morning"]["cue_preview_items"];
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
  packet
}: {
  rankedVideos: ReturnType<typeof rankVideosForUser>;
  packet: ReturnType<typeof buildDailyLearningPacket>["packet"]["optional_watch_packets"][number] | undefined;
}) {
  return (
    <div className="page-grid cinema-grid">
      <section className="panel watch-packet">
        <PanelTitle icon={Video} title="Bounded Packet" meta={packet?.purpose ?? "none"} />
        <div className="packet-visual">
          {(packet?.video_ids ?? []).map((id, index) => (
            <div className="chapter-bar" key={id} style={{ width: `${42 + index * 18}%` }} />
          ))}
        </div>
        <div className="case-grid">
          <MiniStat label="Budget" value={`${packet?.total_time_budget_minutes ?? 0}m`} />
          <MiniStat label="Videos" value={`${packet?.video_ids.length ?? 0}`} />
          <MiniStat label="Recall" value={packet?.required_post_watch_recall ? "armed" : "off"} />
          <MiniStat label="Next" value={packet?.suggested_next_mode ?? "stop"} />
        </div>
      </section>
      <section className="video-list">
        {rankedVideos.slice(0, 5).map(({ video, score, reasons }) => (
          <article className="video-card" key={video.id}>
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
          </article>
        ))}
      </section>
    </div>
  );
}

function WalkView({
  prompts
}: {
  prompts: ReturnType<typeof buildDailyLearningPacket>["packet"]["walk_packets"][number]["prompts"];
}) {
  return (
    <div className="walk-layout">
      <section className="phone-down">
        <div className="phone-frame">
          <div className="waveform">
            {Array.from({ length: 34 }).map((_, index) => (
              <span key={index} style={{ height: `${18 + ((index * 17) % 44)}px` }} />
            ))}
          </div>
          <div className="audio-controls">
            <IconButton title="Previous" icon={RefreshCcw} />
            <IconButton title="Pause" icon={Pause} />
            <IconButton title="Play" icon={Play} />
          </div>
        </div>
      </section>
      <section className="panel walk-prompts">
        <PanelTitle icon={Footprints} title="WalkMode" meta="screen locked" />
        {prompts.slice(0, 5).map((prompt) => (
          <ObjectLine key={prompt.id} label={prompt.assessment_type} value={prompt.prompt} />
        ))}
        <div className="tag-row commands">
          {["repeat", "slower", "harder", "hint", "mark confusing", "screen off"].map((command) => (
            <span className="tag" key={command}>
              {command}
            </span>
          ))}
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
  packet: ReturnType<typeof buildDailyLearningPacket>["packet"];
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
  packet: ReturnType<typeof buildDailyLearningPacket>["packet"]["sleep"];
  audioPlan: ReturnType<typeof buildDailyLearningPacket>["audioPlan"];
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

function CourtView({ verdict }: { verdict: ReturnType<typeof arbitrateProposal> }) {
  const proposal = demoProposals[0];
  return (
    <div className="page-grid court-grid">
      <section className="panel">
        <PanelTitle icon={Gavel} title="Content Court" meta={proposal.status} />
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
      </section>
      <section className="panel">
        <PanelTitle icon={ShieldCheck} title="Arbiter Verdict" meta={verdict.decision} />
        <p className="dense-copy">{verdict.reasoning_summary}</p>
        <ObjectLine label="For" value={verdict.strongest_argument_for} />
        <ObjectLine label="Against" value={verdict.strongest_argument_against} />
        <Progress label="Confidence" value={verdict.confidence} />
      </section>
    </div>
  );
}

function LabView({ techniques }: { techniques: typeof techniqueRegistry }) {
  return (
    <div className="lab-grid">
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
    </div>
  );
}

function AdminView({ eventLog }: { eventLog: string[] }) {
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
    "Content Court",
    "AI Orchestrator",
    "Analytics"
  ];
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

function WorkbenchView() {
  return (
    <div className="page-grid workbench-grid">
      <section className="metric-strip">
        <MetricTile icon={GitBranch} label="Known" value="ready" tone="teal" />
        <MetricTile icon={CircleGauge} label="Frontier" value="active" tone="amber" />
        <MetricTile icon={Activity} label="Blocked" value="hold" tone="coral" />
        <MetricTile icon={Moon} label="Sleep" value="safe" tone="indigo" />
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
