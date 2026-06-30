import type {
  AssessmentResponse,
  AssessmentItem,
  AudioPlan,
  ConceptNode,
  DailyLearningPacket,
  Experiment,
  PacedReadAsset,
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
  UserKnowledgeGraph,
  VideoAsset
} from "@mnemosyne/schema";
import type { JobRecord, ObjectManifest, QueueName } from "@mnemosyne/ops-core";
import type { OutcomeDashboard } from "@mnemosyne/outcome-core";
import { createId, nowIso, stableHash, todayIsoDate } from "@mnemosyne/shared-utils";
import type { NormalizedWearableSleepSession, WearableConnection } from "@mnemosyne/wearables-core";

export type AuditEvent = {
  id: string;
  actor_id: string;
  action: string;
  object_type: string;
  object_id?: string;
  payload: Record<string, unknown>;
  policy_version: string;
  created_at: string;
};

export type SessionRecord = {
  id: string;
  user_id: string;
  daily_packet_id?: string;
  session_type: "morning_forge" | "graphfeed" | "walk_mode" | "evening_lock_in" | "sleep" | "paced_read";
  status: "planned" | "running" | "completed" | "abandoned";
  started_at?: string;
  completed_at?: string;
  event_ids: string[];
};

export type KnowledgePackRecord = {
  id: string;
  slug: string;
  title: string;
  domain: string;
  quality_tier: string;
  graph_version: string;
  installed_for_user_ids: string[];
};

export type CreatorSubmissionStatus =
  "submitted" | "needs_evidence" | "queued_for_review" | "proposal_created" | "rejected";

export type CreatorSubmissionRecord = {
  id: string;
  creator_id: string;
  title: string;
  status: CreatorSubmissionStatus;
  license: string;
  notes?: string;
  source?: SourceRef;
  evidence: SourceRef[];
  content: {
    concepts: ConceptNode[];
    videos: VideoAsset[];
    assessments: AssessmentItem[];
    sleep_cues: SleepCueTemplate[];
    paced_read_assets: PacedReadAsset[];
  };
  risk_flags: string[];
  proposal_ids: string[];
  created_at: string;
  updated_at: string;
};

export type ExperimentAssignmentRecord = {
  id: string;
  user_id: string;
  experiment_id: string;
  unit_id: string;
  unit_kind: "concept" | "cue";
  condition_id: string;
  technique_id?: string;
  matched_control_unit_id?: string;
  assigned_at: string;
  rationale: string[];
};

export type PersonalizationProfileRecord = {
  user_id: string;
  generated_at: string;
  tracked_experiment_count: number;
  active_assignment_count: number;
  technique_response: Array<{
    technique_id: string;
    experiment_id: string;
    observations: number;
    effect_vs_control: number;
    recommendation: string;
  }>;
  sleep_cue_response: Record<string, unknown>;
  modality_response: Record<string, unknown>;
  recommended_technique_ids: string[];
  suppressed_technique_ids: string[];
  scheduler_adjustments: {
    morning_screen_budget_minutes: number;
    optional_watch_budgets: number[];
    evening_screen_policy: "audio_only" | "minimal_visual" | "visual_required";
    conservative_sleep: boolean;
    recommended_mode_bias: "walk" | "audio_visual" | "desk";
    rationale: string[];
  };
};

export type SocialChallengeRecord = {
  id: string;
  creator_id: string;
  title: string;
  challenge_type:
    | "retention_duel"
    | "boss_fight"
    | "screen_efficiency"
    | "walk_recall"
    | "same_video_recall"
    | "sleep_cue_gain"
    | "creator_quality";
  participant_ids: string[];
  share_level: "badges_only" | "friends" | "public";
  scoring_metric: string;
  anti_gaming_policy: string[];
  status: "open" | "active" | "completed" | "archived";
  scoreboard: Array<{
    user_id: string;
    display_name: string;
    score: number;
    rank: number;
    evidence: string[];
  }>;
  created_at: string;
  ends_at?: string;
};

export type AwardedBadgeRecord = {
  id: string;
  user_id: string;
  badge_id: string;
  title: string;
  category: string;
  rarity: string;
  awarded_at: string;
  score: number;
  evidence: string[];
};

export type MnemosyneSeedData = {
  user: User;
  goals: Goal[];
  masterGraph: MasterGraph;
  userStates: UserConceptState[];
  readiness: ReadinessProfile;
  proposals?: Proposal[];
  packs?: KnowledgePackRecord[];
};

export type DataDeletionScope = "account" | "health" | "sleep" | "voice";

export type UserDataExportBundle = {
  schema_version: "mnemosyne-export-v0.1";
  user_id: string;
  exported_at: string;
  user?: User;
  goals: Goal[];
  readiness?: ReadinessProfile;
  user_graph: UserKnowledgeGraph;
  daily_packets: DailyLearningPacket[];
  sleep_cue_packets: SleepCuePacket[];
  audio_plans: AudioPlan[];
  assessment_responses: AssessmentResponse[];
  learning_events: LearningEvent[];
  audit_events: AuditEvent[];
  sessions: SessionRecord[];
  installed_packs: KnowledgePackRecord[];
  experiment_assignments: ExperimentAssignmentRecord[];
  personalization_profile?: PersonalizationProfileRecord;
  social_challenges: SocialChallengeRecord[];
  awarded_badges: AwardedBadgeRecord[];
  wearable_connections: WearableConnection[];
  wearable_sleep_sessions: NormalizedWearableSleepSession[];
  outcome_dashboards: OutcomeDashboard[];
  jobs: JobRecord[];
  object_manifests: ObjectManifest[];
};

export type UserDataDeletionSummary = {
  user_id: string;
  scope: DataDeletionScope;
  deleted_at: string;
  counts: Record<string, number>;
  retained_audit_event_ids: string[];
};

export type AppendLearningEventInput = Omit<LearningEvent, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

export type AppendAuditEventInput = Omit<AuditEvent, "id" | "created_at" | "policy_version"> & {
  id?: string;
  created_at?: string;
  policy_version?: string;
};

export interface MnemosyneStore {
  getUser(userId: string): Promise<User | undefined>;
  saveUser(user: User): Promise<User>;
  listGoals(userId: string): Promise<Goal[]>;
  saveGoal(goal: Goal): Promise<Goal>;
  getReadiness(userId: string): Promise<ReadinessProfile | undefined>;
  saveReadiness(userId: string, readiness: ReadinessProfile): Promise<ReadinessProfile>;
  getMasterGraph(): Promise<MasterGraph>;
  saveMasterGraph(graph: MasterGraph): Promise<MasterGraph>;
  getUserGraph(userId: string): Promise<UserKnowledgeGraph>;
  saveUserConceptStates(userId: string, states: UserConceptState[]): Promise<UserKnowledgeGraph>;
  getDailyPacket(userId: string, date?: string): Promise<DailyLearningPacket | undefined>;
  saveDailyPacket(packet: DailyLearningPacket): Promise<DailyLearningPacket>;
  getSleepCuePacket(userId: string, nightDate?: string): Promise<SleepCuePacket | undefined>;
  saveSleepCuePacket(packet: SleepCuePacket): Promise<SleepCuePacket>;
  saveAudioPlan(plan: AudioPlan): Promise<AudioPlan>;
  getAudioPlan(planId: string): Promise<AudioPlan | undefined>;
  saveAssessmentResponse(response: AssessmentResponse): Promise<AssessmentResponse>;
  listAssessmentResponses(userId: string): Promise<AssessmentResponse[]>;
  appendLearningEvent(input: AppendLearningEventInput): Promise<LearningEvent>;
  listLearningEvents(userId: string): Promise<LearningEvent[]>;
  appendAuditEvent(input: AppendAuditEventInput): Promise<AuditEvent>;
  listAuditEvents(actorId?: string): Promise<AuditEvent[]>;
  saveSession(session: SessionRecord): Promise<SessionRecord>;
  getSession(sessionId: string): Promise<SessionRecord | undefined>;
  listSessions(userId: string): Promise<SessionRecord[]>;
  listProposals(): Promise<Proposal[]>;
  getProposal(proposalId: string): Promise<Proposal | undefined>;
  saveProposal(proposal: Proposal): Promise<Proposal>;
  listCreatorSubmissions(creatorId?: string): Promise<CreatorSubmissionRecord[]>;
  getCreatorSubmission(submissionId: string): Promise<CreatorSubmissionRecord | undefined>;
  saveCreatorSubmission(submission: CreatorSubmissionRecord): Promise<CreatorSubmissionRecord>;
  listPacks(): Promise<KnowledgePackRecord[]>;
  savePack(pack: KnowledgePackRecord): Promise<KnowledgePackRecord>;
  installPack(userId: string, packId: string): Promise<KnowledgePackRecord>;
  listExperiments(): Promise<Experiment[]>;
  saveExperiment(experiment: Experiment): Promise<Experiment>;
  listExperimentAssignments(userId?: string): Promise<ExperimentAssignmentRecord[]>;
  saveExperimentAssignment(assignment: ExperimentAssignmentRecord): Promise<ExperimentAssignmentRecord>;
  getPersonalizationProfile(userId: string): Promise<PersonalizationProfileRecord | undefined>;
  savePersonalizationProfile(profile: PersonalizationProfileRecord): Promise<PersonalizationProfileRecord>;
  listSocialChallenges(userId?: string): Promise<SocialChallengeRecord[]>;
  saveSocialChallenge(challenge: SocialChallengeRecord): Promise<SocialChallengeRecord>;
  listAwardedBadges(userId: string): Promise<AwardedBadgeRecord[]>;
  saveAwardedBadge(badge: AwardedBadgeRecord): Promise<AwardedBadgeRecord>;
  listWearableConnections(userId: string): Promise<WearableConnection[]>;
  getWearableConnection(connectionId: string): Promise<WearableConnection | undefined>;
  saveWearableConnection(connection: WearableConnection): Promise<WearableConnection>;
  saveWearableSleepSession(session: NormalizedWearableSleepSession): Promise<NormalizedWearableSleepSession>;
  listWearableSleepSessions(userId: string): Promise<NormalizedWearableSleepSession[]>;
  saveOutcomeDashboard(dashboard: OutcomeDashboard): Promise<OutcomeDashboard>;
  getLatestOutcomeDashboard(userId: string): Promise<OutcomeDashboard | undefined>;
  saveJob(job: JobRecord): Promise<JobRecord>;
  getJob(jobId: string): Promise<JobRecord | undefined>;
  listJobs(queue?: QueueName): Promise<JobRecord[]>;
  saveObjectManifest(manifest: ObjectManifest): Promise<ObjectManifest>;
  getObjectManifest(objectId: string): Promise<ObjectManifest | undefined>;
  listObjectManifests(ownerId?: string): Promise<ObjectManifest[]>;
  exportUserData(userId: string): Promise<UserDataExportBundle>;
  deleteUserData(userId: string, scope: DataDeletionScope): Promise<UserDataDeletionSummary>;
}

export class InMemoryMnemosyneStore implements MnemosyneStore {
  private users = new Map<string, User>();
  private goals = new Map<string, Goal>();
  private readiness = new Map<string, ReadinessProfile>();
  private masterGraph: MasterGraph = {
    concepts: [],
    claims: [],
    edges: [],
    videos: [],
    sleepCues: [],
    pacedReads: []
  };
  private states = new Map<string, UserConceptState>();
  private dailyPackets = new Map<string, DailyLearningPacket>();
  private sleepCuePackets = new Map<string, SleepCuePacket>();
  private audioPlans = new Map<string, AudioPlan>();
  private assessmentResponses = new Map<string, AssessmentResponse>();
  private learningEvents: LearningEvent[] = [];
  private auditEvents: AuditEvent[] = [];
  private sessions = new Map<string, SessionRecord>();
  private proposals = new Map<string, Proposal>();
  private creatorSubmissions = new Map<string, CreatorSubmissionRecord>();
  private packs = new Map<string, KnowledgePackRecord>();
  private experiments = new Map<string, Experiment>();
  private experimentAssignments = new Map<string, ExperimentAssignmentRecord>();
  private personalizationProfiles = new Map<string, PersonalizationProfileRecord>();
  private socialChallenges = new Map<string, SocialChallengeRecord>();
  private awardedBadges = new Map<string, AwardedBadgeRecord>();
  private wearableConnections = new Map<string, WearableConnection>();
  private wearableSleepSessions = new Map<string, NormalizedWearableSleepSession>();
  private outcomeDashboards = new Map<string, OutcomeDashboard[]>();
  private jobs = new Map<string, JobRecord>();
  private objectManifests = new Map<string, ObjectManifest>();

  constructor(seed?: MnemosyneSeedData) {
    if (!seed) return;
    this.users.set(seed.user.id, seed.user);
    for (const goal of seed.goals) this.goals.set(goal.id, goal);
    this.masterGraph = seed.masterGraph;
    for (const state of seed.userStates) this.states.set(stateKey(seed.user.id, state.concept_id), state);
    this.readiness.set(seed.user.id, seed.readiness);
    for (const proposal of seed.proposals ?? []) this.proposals.set(proposal.id, proposal);
    for (const pack of seed.packs ?? defaultPackRecords()) this.packs.set(pack.id, pack);
  }

  async getUser(userId: string): Promise<User | undefined> {
    return this.users.get(userId);
  }

  async saveUser(user: User): Promise<User> {
    this.users.set(user.id, user);
    return user;
  }

  async listGoals(userId: string): Promise<Goal[]> {
    return [...this.goals.values()].filter((goal) => goal.user_id === userId);
  }

  async saveGoal(goal: Goal): Promise<Goal> {
    this.goals.set(goal.id, goal);
    return goal;
  }

  async getReadiness(userId: string): Promise<ReadinessProfile | undefined> {
    return this.readiness.get(userId);
  }

  async saveReadiness(userId: string, readiness: ReadinessProfile): Promise<ReadinessProfile> {
    this.readiness.set(userId, readiness);
    return readiness;
  }

  async getMasterGraph(): Promise<MasterGraph> {
    return this.masterGraph;
  }

  async saveMasterGraph(graph: MasterGraph): Promise<MasterGraph> {
    this.masterGraph = graph;
    return graph;
  }

  async getUserGraph(userId: string): Promise<UserKnowledgeGraph> {
    return {
      userId,
      states: [...this.states.values()].filter((state) => state.user_id === userId)
    };
  }

  async saveUserConceptStates(userId: string, states: UserConceptState[]): Promise<UserKnowledgeGraph> {
    for (const state of states) this.states.set(stateKey(userId, state.concept_id), state);
    return this.getUserGraph(userId);
  }

  async getDailyPacket(userId: string, date = todayIsoDate()): Promise<DailyLearningPacket | undefined> {
    return this.dailyPackets.get(packetKey(userId, date));
  }

  async saveDailyPacket(packet: DailyLearningPacket): Promise<DailyLearningPacket> {
    this.dailyPackets.set(packetKey(packet.user_id, packet.date), packet);
    return packet;
  }

  async getSleepCuePacket(userId: string, nightDate = todayIsoDate()): Promise<SleepCuePacket | undefined> {
    return this.sleepCuePackets.get(packetKey(userId, nightDate));
  }

  async saveSleepCuePacket(packet: SleepCuePacket): Promise<SleepCuePacket> {
    this.sleepCuePackets.set(packetKey(packet.user_id, packet.night_date), packet);
    return packet;
  }

  async saveAudioPlan(plan: AudioPlan): Promise<AudioPlan> {
    this.audioPlans.set(plan.id, plan);
    return plan;
  }

  async getAudioPlan(planId: string): Promise<AudioPlan | undefined> {
    return this.audioPlans.get(planId);
  }

  async saveAssessmentResponse(response: AssessmentResponse): Promise<AssessmentResponse> {
    this.assessmentResponses.set(response.id, response);
    return response;
  }

  async listAssessmentResponses(userId: string): Promise<AssessmentResponse[]> {
    return [...this.assessmentResponses.values()].filter((response) => response.user_id === userId);
  }

  async appendLearningEvent(input: AppendLearningEventInput): Promise<LearningEvent> {
    const event: LearningEvent = {
      ...input,
      id: input.id ?? createId("learning_event"),
      created_at: input.created_at ?? nowIso()
    };
    this.learningEvents.push(event);
    return event;
  }

  async listLearningEvents(userId: string): Promise<LearningEvent[]> {
    return this.learningEvents.filter((event) => event.user_id === userId);
  }

  async appendAuditEvent(input: AppendAuditEventInput): Promise<AuditEvent> {
    const event: AuditEvent = {
      ...input,
      id: input.id ?? createId("audit_event"),
      policy_version: input.policy_version ?? "mnemosyne-audit-v0.1",
      created_at: input.created_at ?? nowIso()
    };
    this.auditEvents.push(event);
    return event;
  }

  async listAuditEvents(actorId?: string): Promise<AuditEvent[]> {
    return actorId ? this.auditEvents.filter((event) => event.actor_id === actorId) : [...this.auditEvents];
  }

  async saveSession(session: SessionRecord): Promise<SessionRecord> {
    this.sessions.set(session.id, session);
    return session;
  }

  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    return this.sessions.get(sessionId);
  }

  async listSessions(userId: string): Promise<SessionRecord[]> {
    return [...this.sessions.values()].filter((session) => session.user_id === userId);
  }

  async listProposals(): Promise<Proposal[]> {
    return [...this.proposals.values()];
  }

  async getProposal(proposalId: string): Promise<Proposal | undefined> {
    return this.proposals.get(proposalId);
  }

  async saveProposal(proposal: Proposal): Promise<Proposal> {
    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  async listCreatorSubmissions(creatorId?: string): Promise<CreatorSubmissionRecord[]> {
    const submissions = [...this.creatorSubmissions.values()];
    return creatorId ? submissions.filter((submission) => submission.creator_id === creatorId) : submissions;
  }

  async getCreatorSubmission(submissionId: string): Promise<CreatorSubmissionRecord | undefined> {
    return this.creatorSubmissions.get(submissionId);
  }

  async saveCreatorSubmission(submission: CreatorSubmissionRecord): Promise<CreatorSubmissionRecord> {
    this.creatorSubmissions.set(submission.id, submission);
    return submission;
  }

  async listPacks(): Promise<KnowledgePackRecord[]> {
    return [...this.packs.values()];
  }

  async savePack(pack: KnowledgePackRecord): Promise<KnowledgePackRecord> {
    this.packs.set(pack.id, pack);
    return pack;
  }

  async installPack(userId: string, packId: string): Promise<KnowledgePackRecord> {
    const pack = this.packs.get(packId);
    if (!pack) throw new Error(`Unknown knowledge pack: ${packId}`);
    const installed_for_user_ids = Array.from(new Set([...pack.installed_for_user_ids, userId]));
    const updated = { ...pack, installed_for_user_ids };
    this.packs.set(pack.id, updated);
    return updated;
  }

  async listExperiments(): Promise<Experiment[]> {
    return [...this.experiments.values()];
  }

  async saveExperiment(experiment: Experiment): Promise<Experiment> {
    this.experiments.set(experiment.id, experiment);
    return experiment;
  }

  async listExperimentAssignments(userId?: string): Promise<ExperimentAssignmentRecord[]> {
    const assignments = [...this.experimentAssignments.values()];
    return userId ? assignments.filter((assignment) => assignment.user_id === userId) : assignments;
  }

  async saveExperimentAssignment(
    assignment: ExperimentAssignmentRecord
  ): Promise<ExperimentAssignmentRecord> {
    this.experimentAssignments.set(
      `${assignment.user_id}:${assignment.experiment_id}:${assignment.unit_kind}:${assignment.unit_id}`,
      assignment
    );
    return assignment;
  }

  async getPersonalizationProfile(userId: string): Promise<PersonalizationProfileRecord | undefined> {
    return this.personalizationProfiles.get(userId);
  }

  async savePersonalizationProfile(
    profile: PersonalizationProfileRecord
  ): Promise<PersonalizationProfileRecord> {
    this.personalizationProfiles.set(profile.user_id, profile);
    return profile;
  }

  async listSocialChallenges(userId?: string): Promise<SocialChallengeRecord[]> {
    const challenges = [...this.socialChallenges.values()];
    return userId ? challenges.filter((challenge) => challenge.participant_ids.includes(userId)) : challenges;
  }

  async saveSocialChallenge(challenge: SocialChallengeRecord): Promise<SocialChallengeRecord> {
    this.socialChallenges.set(challenge.id, challenge);
    return challenge;
  }

  async listAwardedBadges(userId: string): Promise<AwardedBadgeRecord[]> {
    return [...this.awardedBadges.values()].filter((badge) => badge.user_id === userId);
  }

  async saveAwardedBadge(badge: AwardedBadgeRecord): Promise<AwardedBadgeRecord> {
    this.awardedBadges.set(`${badge.user_id}:${badge.badge_id}`, badge);
    return badge;
  }

  async listWearableConnections(userId: string): Promise<WearableConnection[]> {
    return [...this.wearableConnections.values()].filter((connection) => connection.user_id === userId);
  }

  async getWearableConnection(connectionId: string): Promise<WearableConnection | undefined> {
    return this.wearableConnections.get(connectionId);
  }

  async saveWearableConnection(connection: WearableConnection): Promise<WearableConnection> {
    this.wearableConnections.set(connection.id, connection);
    return connection;
  }

  async saveWearableSleepSession(
    session: NormalizedWearableSleepSession
  ): Promise<NormalizedWearableSleepSession> {
    this.wearableSleepSessions.set(session.id, session);
    return session;
  }

  async listWearableSleepSessions(userId: string): Promise<NormalizedWearableSleepSession[]> {
    return [...this.wearableSleepSessions.values()].filter((session) => session.user_id === userId);
  }

  async saveOutcomeDashboard(dashboard: OutcomeDashboard): Promise<OutcomeDashboard> {
    const dashboards = this.outcomeDashboards.get(dashboard.user_id) ?? [];
    this.outcomeDashboards.set(dashboard.user_id, [...dashboards, dashboard]);
    return dashboard;
  }

  async getLatestOutcomeDashboard(userId: string): Promise<OutcomeDashboard | undefined> {
    return (this.outcomeDashboards.get(userId) ?? []).sort((left, right) =>
      right.generated_at.localeCompare(left.generated_at)
    )[0];
  }

  async saveJob(job: JobRecord): Promise<JobRecord> {
    this.jobs.set(job.id, job);
    return job;
  }

  async getJob(jobId: string): Promise<JobRecord | undefined> {
    return this.jobs.get(jobId);
  }

  async listJobs(queue?: QueueName): Promise<JobRecord[]> {
    const jobs = [...this.jobs.values()];
    return queue ? jobs.filter((job) => job.queue === queue) : jobs;
  }

  async saveObjectManifest(manifest: ObjectManifest): Promise<ObjectManifest> {
    this.objectManifests.set(manifest.id, manifest);
    return manifest;
  }

  async getObjectManifest(objectId: string): Promise<ObjectManifest | undefined> {
    return this.objectManifests.get(objectId);
  }

  async listObjectManifests(ownerId?: string): Promise<ObjectManifest[]> {
    const manifests = [...this.objectManifests.values()];
    return ownerId ? manifests.filter((manifest) => manifest.owner_id === ownerId) : manifests;
  }

  async exportUserData(userId: string): Promise<UserDataExportBundle> {
    const dailyPackets = [...this.dailyPackets.values()].filter((packet) => packet.user_id === userId);
    const sleepCuePackets = [...this.sleepCuePackets.values()].filter((packet) => packet.user_id === userId);
    const audioPlanIds = new Set([
      ...sleepCuePackets.map((packet) => packet.audio_plan_id),
      ...dailyPackets.map((packet) => packet.sleep.audio_plan_id)
    ]);
    return {
      schema_version: "mnemosyne-export-v0.1",
      user_id: userId,
      exported_at: nowIso(),
      user: this.users.get(userId),
      goals: await this.listGoals(userId),
      readiness: this.readiness.get(userId),
      user_graph: await this.getUserGraph(userId),
      daily_packets: dailyPackets,
      sleep_cue_packets: sleepCuePackets,
      audio_plans: [...audioPlanIds].map((id) => this.audioPlans.get(id)).filter(isDefined),
      assessment_responses: await this.listAssessmentResponses(userId),
      learning_events: await this.listLearningEvents(userId),
      audit_events: await this.listAuditEvents(userId),
      sessions: await this.listSessions(userId),
      installed_packs: [...this.packs.values()].filter((pack) =>
        pack.installed_for_user_ids.includes(userId)
      ),
      experiment_assignments: await this.listExperimentAssignments(userId),
      personalization_profile: this.personalizationProfiles.get(userId),
      social_challenges: await this.listSocialChallenges(userId),
      awarded_badges: await this.listAwardedBadges(userId),
      wearable_connections: await this.listWearableConnections(userId),
      wearable_sleep_sessions: await this.listWearableSleepSessions(userId),
      outcome_dashboards: this.outcomeDashboards.get(userId) ?? [],
      jobs: (await this.listJobs()).filter((job) => job.audit_subject_id === userId),
      object_manifests: await this.listObjectManifests(userId)
    };
  }

  async deleteUserData(userId: string, scope: DataDeletionScope): Promise<UserDataDeletionSummary> {
    const deletedAt = nowIso();
    const counts: Record<string, number> = {};
    const count = (key: string, value: number) => {
      if (value > 0) counts[key] = (counts[key] ?? 0) + value;
    };

    if (scope === "health" || scope === "account") {
      count(
        "wearable_connections",
        deleteMapEntries(this.wearableConnections, (connection) => connection.user_id === userId)
      );
      count(
        "wearable_sleep_sessions",
        deleteMapEntries(this.wearableSleepSessions, (session) => session.user_id === userId)
      );
    }

    if (scope === "sleep" || scope === "account") {
      const deletedSleepAudioIds = new Set(
        [
          ...[...this.sleepCuePackets.values()]
            .filter((packet) => packet.user_id === userId)
            .map((packet) => packet.audio_plan_id),
          ...[...this.dailyPackets.values()]
            .filter((packet) => packet.user_id === userId)
            .map((packet) => packet.sleep.audio_plan_id)
        ].filter(Boolean)
      );
      count(
        "sleep_cue_packets",
        deleteMapEntries(this.sleepCuePackets, (packet) => packet.user_id === userId)
      );
      count(
        "sleep_audio_plans",
        deleteMapEntries(this.audioPlans, (plan) => deletedSleepAudioIds.has(plan.id))
      );
      count(
        "sleep_object_manifests",
        deleteMapEntries(
          this.objectManifests,
          (manifest) => manifest.owner_id === userId && manifest.bucket === "audio"
        )
      );
      const beforeEvents = this.learningEvents.length;
      this.learningEvents = this.learningEvents.filter(
        (event) =>
          event.user_id !== userId ||
          !(
            event.event_type === "sleep_cue_played" ||
            event.event_type === "cue_bound" ||
            typeof event.payload.sleep_packet_id === "string"
          )
      );
      count("sleep_learning_events", beforeEvents - this.learningEvents.length);
      count(
        "wearable_sleep_sessions",
        deleteMapEntries(this.wearableSleepSessions, (session) => session.user_id === userId)
      );
    }

    if (scope === "voice" || scope === "account") {
      let scrubbedEvents = 0;
      this.learningEvents = this.learningEvents.map((event) => {
        if (event.user_id !== userId) return event;
        const scrubbed = scrubVoicePayload(event.payload);
        if (!scrubbed.changed) return event;
        scrubbedEvents += 1;
        return { ...event, payload: scrubbed.payload };
      });
      count("voice_payloads_scrubbed", scrubbedEvents);
    }

    if (scope === "account") {
      count(
        "users",
        deleteMapEntries(this.users, (user) => user.id === userId)
      );
      count(
        "goals",
        deleteMapEntries(this.goals, (goal) => goal.user_id === userId)
      );
      count(
        "readiness_profiles",
        deleteMapEntries(this.readiness, (_readiness, key) => key === userId)
      );
      count(
        "concept_states",
        deleteMapEntries(this.states, (state) => state.user_id === userId)
      );
      count(
        "daily_packets",
        deleteMapEntries(this.dailyPackets, (packet) => packet.user_id === userId)
      );
      count(
        "assessment_responses",
        deleteMapEntries(this.assessmentResponses, (response) => response.user_id === userId)
      );
      const beforeLearningEvents = this.learningEvents.length;
      this.learningEvents = this.learningEvents.filter((event) => event.user_id !== userId);
      count("learning_events", beforeLearningEvents - this.learningEvents.length);
      count(
        "sessions",
        deleteMapEntries(this.sessions, (session) => session.user_id === userId)
      );
      count(
        "creator_submissions",
        deleteMapEntries(this.creatorSubmissions, (submission) => submission.creator_id === userId)
      );
      count(
        "experiment_assignments",
        deleteMapEntries(this.experimentAssignments, (assignment) => assignment.user_id === userId)
      );
      count(
        "personalization_profiles",
        deleteMapEntries(this.personalizationProfiles, (_profile, key) => key === userId)
      );
      count(
        "outcome_dashboards",
        deleteMapEntries(this.outcomeDashboards, (_dashboards, key) => key === userId)
      );
      count(
        "jobs",
        deleteMapEntries(this.jobs, (job) => job.audit_subject_id === userId)
      );
      count(
        "object_manifests",
        deleteMapEntries(this.objectManifests, (manifest) => manifest.owner_id === userId)
      );
      count(
        "awarded_badges",
        deleteMapEntries(this.awardedBadges, (badge) => badge.user_id === userId)
      );
      count("pack_installations", removePackInstallations(this.packs, userId));
      count("social_challenges", removeUserFromChallenges(this.socialChallenges, userId));
      count("audit_events_anonymized", anonymizeAuditEvents(this.auditEvents, userId, deletedAt));
    }

    const auditEvent: AuditEvent = {
      id: createId("audit_event", `${userId}:${scope}:${deletedAt}`),
      actor_id: scope === "account" ? deletedUserId(userId) : userId,
      action: "user_data_deleted",
      object_type: "privacy_request",
      object_id: scope === "account" ? deletedUserId(userId) : userId,
      payload: { scope, counts },
      policy_version: "mnemosyne-audit-v0.1",
      created_at: deletedAt
    };
    this.auditEvents.push(auditEvent);

    return {
      user_id: scope === "account" ? deletedUserId(userId) : userId,
      scope,
      deleted_at: deletedAt,
      counts,
      retained_audit_event_ids: [auditEvent.id]
    };
  }
}

export function createMemoryStore(seed?: MnemosyneSeedData): MnemosyneStore {
  return new InMemoryMnemosyneStore(seed);
}

export {
  PostgresMnemosyneStore,
  createPostgresStore,
  seedPostgresStore,
  type SqlExecutor,
  type SqlQueryResult
} from "./postgres";

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function deleteMapEntries<K, V>(map: Map<K, V>, shouldDelete: (value: V, key: K) => boolean): number {
  let deleted = 0;
  for (const [key, value] of map.entries()) {
    if (!shouldDelete(value, key)) continue;
    map.delete(key);
    deleted += 1;
  }
  return deleted;
}

function scrubVoicePayload(payload: Record<string, unknown>): {
  payload: Record<string, unknown>;
  changed: boolean;
} {
  let changed = false;
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (/transcript|raw_voice|raw_audio|voice_audio|voice_recording|audio_url|recording_url/i.test(key)) {
      scrubbed[key] = "[deleted]";
      changed = true;
    } else if (Array.isArray(value)) {
      const result = scrubVoiceArray(value);
      scrubbed[key] = result.value;
      changed ||= result.changed;
    } else if (isRecord(value)) {
      const result = scrubVoicePayload(value);
      scrubbed[key] = result.payload;
      changed ||= result.changed;
    } else {
      scrubbed[key] = value;
    }
  }
  return { payload: changed ? scrubbed : payload, changed };
}

function scrubVoiceArray(value: unknown[]): { value: unknown[]; changed: boolean } {
  let changed = false;
  const scrubbed = value.map((item) => {
    if (Array.isArray(item)) {
      const result = scrubVoiceArray(item);
      changed ||= result.changed;
      return result.value;
    }
    if (!isRecord(item)) return item;
    const result = scrubVoicePayload(item);
    changed ||= result.changed;
    return result.payload;
  });
  return { value: changed ? scrubbed : value, changed };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function removePackInstallations(packs: Map<string, KnowledgePackRecord>, userId: string): number {
  let updated = 0;
  for (const pack of packs.values()) {
    if (!pack.installed_for_user_ids.includes(userId)) continue;
    packs.set(pack.id, {
      ...pack,
      installed_for_user_ids: pack.installed_for_user_ids.filter(
        (installedUserId) => installedUserId !== userId
      )
    });
    updated += 1;
  }
  return updated;
}

function removeUserFromChallenges(challenges: Map<string, SocialChallengeRecord>, userId: string): number {
  let changed = 0;
  for (const challenge of [...challenges.values()]) {
    if (challenge.creator_id === userId) {
      challenges.delete(challenge.id);
      changed += 1;
      continue;
    }
    const participantIds = challenge.participant_ids.filter((participantId) => participantId !== userId);
    const scoreboard = challenge.scoreboard.filter((score) => score.user_id !== userId);
    if (
      participantIds.length === challenge.participant_ids.length &&
      scoreboard.length === challenge.scoreboard.length
    ) {
      continue;
    }
    challenges.set(challenge.id, { ...challenge, participant_ids: participantIds, scoreboard });
    changed += 1;
  }
  return changed;
}

function anonymizeAuditEvents(events: AuditEvent[], userId: string, deletedAt: string): number {
  let anonymized = 0;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!event || event.actor_id !== userId) continue;
    events[index] = {
      ...event,
      actor_id: deletedUserId(userId),
      object_id: event.object_type === "user" ? deletedUserId(userId) : event.object_id,
      payload: {
        redacted: true,
        original_action: event.action,
        original_object_type: event.object_type,
        deleted_at: deletedAt
      }
    };
    anonymized += 1;
  }
  return anonymized;
}

function deletedUserId(userId: string): string {
  return `deleted_user:${stableHash(userId).toString(36)}`;
}

export function packetKey(userId: string, date: string): string {
  return `${userId}:${date}`;
}

export function stateKey(userId: string, conceptId: string): string {
  return `${userId}:${conceptId}`;
}

function defaultPackRecords(): KnowledgePackRecord[] {
  return [
    pack("pack_spanish_travel", "spanish-travel", "Spanish Travel", "language", "tested"),
    pack("pack_python_basics", "python-basics", "Python Basics", "coding", "tested"),
    pack("pack_linear_algebra", "linear-algebra", "Linear Algebra", "math", "community"),
    pack("pack_world_history", "world-history", "World History", "history", "community"),
    pack("pack_ai_systems", "ai-systems", "AI Systems", "ai", "expert_reviewed")
  ];
}

function pack(
  id: string,
  slug: string,
  title: string,
  domain: string,
  quality_tier: string
): KnowledgePackRecord {
  return {
    id,
    slug,
    title,
    domain,
    quality_tier,
    graph_version: "0.1.0",
    installed_for_user_ids: []
  };
}
