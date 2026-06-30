import type {
  AssessmentResponse,
  AudioPlan,
  DailyLearningPacket,
  Goal,
  LearningEvent,
  MasterGraph,
  Proposal,
  ReadinessProfile,
  SleepCuePacket,
  User,
  UserConceptState,
  UserKnowledgeGraph
} from "@mnemosyne/schema";
import { createId, nowIso, todayIsoDate } from "@mnemosyne/shared-utils";

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
  session_type: "morning_forge" | "graphfeed" | "walk_mode" | "evening_lock_in" | "sleep" | "flashread";
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

export type MnemosyneSeedData = {
  user: User;
  goals: Goal[];
  masterGraph: MasterGraph;
  userStates: UserConceptState[];
  readiness: ReadinessProfile;
  proposals?: Proposal[];
  packs?: KnowledgePackRecord[];
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
  listPacks(): Promise<KnowledgePackRecord[]>;
  savePack(pack: KnowledgePackRecord): Promise<KnowledgePackRecord>;
  installPack(userId: string, packId: string): Promise<KnowledgePackRecord>;
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
    flashReads: []
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
  private packs = new Map<string, KnowledgePackRecord>();

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
}

export function createMemoryStore(seed?: MnemosyneSeedData): MnemosyneStore {
  return new InMemoryMnemosyneStore(seed);
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
