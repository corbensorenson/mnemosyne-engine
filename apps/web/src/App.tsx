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
import { useMemo, useState } from "react";
import { applyAssessmentToUserState, scoreAssessmentResponse } from "@mnemosyne/assessment-core";
import { estimateCueDensity } from "@mnemosyne/audio-core";
import { arbitrateProposal, computeBridgingPriority } from "@mnemosyne/content-court";
import { buildGraphSnapshot } from "@mnemosyne/graph-core";
import { buildDailyLearningPacket } from "@mnemosyne/scheduler-core";
import type { AssessmentResponse, ConceptNode, ReadinessProfile, UserConceptState } from "@mnemosyne/schema";
import { clamp, humanMinutes, round } from "@mnemosyne/shared-utils";
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

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("today");
  const [readiness, setReadiness] = useState<ReadinessProfile>(defaultReadiness);
  const [states, setStates] = useState<UserConceptState[]>(initialUserStates);
  const [selectedNodeId, setSelectedNodeId] = useState("attention_qkv");
  const [answer, setAnswer] = useState("");
  const [confidence, setConfidence] = useState(0.66);
  const [lastResponse, setLastResponse] = useState<AssessmentResponse | null>(null);
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

  function submitAnswer() {
    const prompt =
      scheduled.packet.morning.cold_retrieval_items[0] ?? scheduled.packet.evening.transfer_drills[0];
    if (!prompt || answer.trim().length === 0) return;
    const response = scoreAssessmentResponse({
      userId: demoUser.id,
      item: prompt,
      rawResponse: answer,
      confidence,
      latencyMs: 24_000
    });
    setLastResponse(response);
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
    setEventLog((current) => [`assessment scored: ${response.model_feedback}`, ...current].slice(0, 6));
    setAnswer("");
  }

  const page = {
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
        prompt={scheduled.packet.morning.cold_retrieval_items[0]}
        frontier={scheduled.packet.morning.frontier_items}
        answer={answer}
        setAnswer={setAnswer}
        confidence={confidence}
        setConfidence={setConfidence}
        submitAnswer={submitAnswer}
        lastResponse={lastResponse}
      />
    ),
    cinema: <CinemaView rankedVideos={rankedVideos} packet={scheduled.packet.optional_watch_packets[0]} />,
    walk: <WalkView prompts={scheduled.packet.walk_packets[0]?.prompts ?? []} />,
    lock: <LockInView packet={scheduled.packet} />,
    sleep: (
      <SleepView packet={scheduled.packet.sleep} audioPlan={scheduled.audioPlan} integrity={sleepIntegrity} />
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
  prompt,
  frontier,
  answer,
  setAnswer,
  confidence,
  setConfidence,
  submitAnswer,
  lastResponse
}: {
  prompt:
    | ReturnType<typeof buildDailyLearningPacket>["packet"]["morning"]["cold_retrieval_items"][number]
    | undefined;
  frontier: ConceptNode[];
  answer: string;
  setAnswer: (value: string) => void;
  confidence: number;
  setConfidence: (value: number) => void;
  submitAnswer: () => void;
  lastResponse: AssessmentResponse | null;
}) {
  return (
    <div className="page-grid forge-grid">
      <section className="panel session-player">
        <PanelTitle icon={SunMedium} title="Morning Forge" meta="cold retrieval" />
        <div className="prompt-box">
          <p className="eyebrow">Prompt</p>
          <h2>{prompt?.prompt ?? "No prompt due"}</h2>
        </div>
        <textarea
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder="Answer before review..."
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
          <button className="command">
            <AudioLines size={18} />
            Voice
          </button>
          <button className="command">
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
      </section>
      <section className="frontier-list">
        {frontier.map((concept) => (
          <article className="item-card" key={concept.id}>
            <div className="item-card-header">
              <span className={`domain-dot ${concept.domain}`} />
              <h3>{concept.title}</h3>
            </div>
            <Progress label="Difficulty" value={concept.difficulty} />
            <Progress label="Importance" value={concept.importance} />
          </article>
        ))}
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

function LockInView({ packet }: { packet: ReturnType<typeof buildDailyLearningPacket>["packet"] }) {
  return (
    <div className="page-grid lock-grid">
      <section className="panel dusk-panel">
        <PanelTitle icon={Headphones} title="Evening Lock-In" meta={packet.evening.screen_policy} />
        <div className="dusk-meter">
          <Moon size={54} />
          <div>
            <h2>{packet.evening.transfer_drills.length} transfer drills</h2>
            <p>{packet.evening.sleep_cue_binding_items.length} cue bindings queued</p>
          </div>
        </div>
        <div className="ritual-list">
          {packet.evening.recall_items.slice(0, 4).map((item) => (
            <ObjectLine key={item.id} label="Recall" value={item.prompt} />
          ))}
        </div>
      </section>
      <section className="panel">
        <PanelTitle icon={ShieldCheck} title="Dusk Guard" meta="active" />
        <div className="guard-grid">
          {[
            "leaderboards",
            "graph browsing",
            "infinite video",
            "bright UI",
            "unneeded typing",
            "friend comparisons"
          ].map((item) => (
            <div className="guard-item" key={item}>
              <ShieldCheck size={18} />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SleepView({
  packet,
  audioPlan,
  integrity
}: {
  packet: ReturnType<typeof buildDailyLearningPacket>["packet"]["sleep"];
  audioPlan: ReturnType<typeof buildDailyLearningPacket>["audioPlan"];
  integrity: number;
}) {
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
        <MiniStat label="Sleep integrity" value={`${Math.round(integrity * 100)}%`} />
      </section>
      <section className="panel">
        <PanelTitle icon={Radio} title="Audio Plan" meta={audioPlan.render_status} />
        <div className="object-list">
          {audioPlan.layers.slice(0, 8).map((layer) => (
            <ObjectLine
              key={layer.id}
              label={humanMinutes(Math.round(layer.starts_at_seconds))}
              value={`${layer.kind} - ${layer.label}`}
            />
          ))}
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

function avg(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}
