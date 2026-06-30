import type {
  AssessmentResponse,
  AudioPlan,
  DailyLearningPacket,
  Experiment,
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
import type { JobRecord, ObjectManifest, QueueName } from "@mnemosyne/ops-core";
import type { OutcomeDashboard } from "@mnemosyne/outcome-core";
import { createId, nowIso, stableHash, todayIsoDate } from "@mnemosyne/shared-utils";
import type { NormalizedWearableSleepSession, WearableConnection } from "@mnemosyne/wearables-core";
import type {
  AppendAuditEventInput,
  AppendLearningEventInput,
  AuditEvent,
  AwardedBadgeRecord,
  ClaimRunnableJobInput,
  CreatorSubmissionRecord,
  DataDeletionScope,
  ExperimentAssignmentRecord,
  KnowledgePackRecord,
  MnemosyneSeedData,
  MnemosyneStore,
  PersonalizationProfileRecord,
  SessionRecord,
  SocialChallengeRecord,
  UserDataDeletionSummary,
  UserDataExportBundle
} from "./index";

export type SqlQueryResult<TRow = Record<string, unknown>> = {
  rows: TRow[];
};

export type SqlExecutor = {
  query<TRow = Record<string, unknown>>(
    statement: string,
    params?: readonly unknown[]
  ): Promise<SqlQueryResult<TRow>>;
};

type RecordRow = {
  payload: unknown;
};

type RecordType =
  | "user"
  | "goal"
  | "readiness"
  | "master_graph"
  | "user_concept_state"
  | "daily_packet"
  | "sleep_cue_packet"
  | "audio_plan"
  | "assessment_response"
  | "learning_event"
  | "audit_event"
  | "session"
  | "proposal"
  | "creator_submission"
  | "knowledge_pack"
  | "experiment"
  | "experiment_assignment"
  | "personalization_profile"
  | "social_challenge"
  | "awarded_badge"
  | "wearable_connection"
  | "wearable_sleep_session"
  | "outcome_dashboard"
  | "job"
  | "object_manifest";

export class PostgresMnemosyneStore implements MnemosyneStore {
  constructor(private readonly sql: SqlExecutor) {}

  async getUser(userId: string): Promise<User | undefined> {
    return this.getRecord<User>("user", userId);
  }

  async saveUser(user: User): Promise<User> {
    return this.upsertRecord("user", user.id, user, user.id, user.updated_at);
  }

  async listGoals(userId: string): Promise<Goal[]> {
    return this.listRecords<Goal>("goal", userId);
  }

  async saveGoal(goal: Goal): Promise<Goal> {
    return this.upsertRecord("goal", goal.id, goal, goal.user_id, goal.updated_at);
  }

  async getReadiness(userId: string): Promise<ReadinessProfile | undefined> {
    return this.getRecord<ReadinessProfile>("readiness", userId);
  }

  async saveReadiness(userId: string, readiness: ReadinessProfile): Promise<ReadinessProfile> {
    return this.upsertRecord("readiness", userId, readiness, userId, nowIso());
  }

  async getMasterGraph(): Promise<MasterGraph> {
    return (
      (await this.getRecord<MasterGraph>("master_graph", "current")) ?? {
        concepts: [],
        claims: [],
        edges: [],
        videos: [],
        sleepCues: [],
        pacedReads: []
      }
    );
  }

  async saveMasterGraph(graph: MasterGraph): Promise<MasterGraph> {
    return this.upsertRecord("master_graph", "current", graph, undefined, nowIso());
  }

  async getUserGraph(userId: string): Promise<UserKnowledgeGraph> {
    return {
      userId,
      states: await this.listRecords<UserConceptState>("user_concept_state", userId)
    };
  }

  async saveUserConceptStates(userId: string, states: UserConceptState[]): Promise<UserKnowledgeGraph> {
    for (const state of states) {
      await this.upsertRecord(
        "user_concept_state",
        stateKey(userId, state.concept_id),
        { ...state, user_id: userId },
        userId,
        state.updated_at
      );
    }
    return this.getUserGraph(userId);
  }

  async getDailyPacket(userId: string, date = todayIsoDate()): Promise<DailyLearningPacket | undefined> {
    return this.getRecord<DailyLearningPacket>("daily_packet", packetKey(userId, date));
  }

  async saveDailyPacket(packet: DailyLearningPacket): Promise<DailyLearningPacket> {
    return this.upsertRecord(
      "daily_packet",
      packetKey(packet.user_id, packet.date),
      packet,
      packet.user_id,
      packet.date
    );
  }

  async getSleepCuePacket(userId: string, nightDate = todayIsoDate()): Promise<SleepCuePacket | undefined> {
    return this.getRecord<SleepCuePacket>("sleep_cue_packet", packetKey(userId, nightDate));
  }

  async saveSleepCuePacket(packet: SleepCuePacket): Promise<SleepCuePacket> {
    return this.upsertRecord(
      "sleep_cue_packet",
      packetKey(packet.user_id, packet.night_date),
      packet,
      packet.user_id,
      packet.night_date
    );
  }

  async saveAudioPlan(plan: AudioPlan): Promise<AudioPlan> {
    return this.upsertRecord("audio_plan", plan.id, plan, plan.user_id, plan.created_at);
  }

  async getAudioPlan(planId: string): Promise<AudioPlan | undefined> {
    return this.getRecord<AudioPlan>("audio_plan", planId);
  }

  async saveAssessmentResponse(response: AssessmentResponse): Promise<AssessmentResponse> {
    return this.upsertRecord(
      "assessment_response",
      response.id,
      response,
      response.user_id,
      response.created_at
    );
  }

  async listAssessmentResponses(userId: string): Promise<AssessmentResponse[]> {
    return this.listRecords<AssessmentResponse>("assessment_response", userId);
  }

  async appendLearningEvent(input: AppendLearningEventInput): Promise<LearningEvent> {
    const event: LearningEvent = {
      ...input,
      id: input.id ?? createId("learning_event"),
      created_at: input.created_at ?? nowIso()
    };
    return this.upsertRecord("learning_event", event.id, event, event.user_id, event.created_at);
  }

  async listLearningEvents(userId: string): Promise<LearningEvent[]> {
    return this.listRecords<LearningEvent>("learning_event", userId);
  }

  async appendAuditEvent(input: AppendAuditEventInput): Promise<AuditEvent> {
    const event: AuditEvent = {
      ...input,
      id: input.id ?? createId("audit_event"),
      policy_version: input.policy_version ?? "mnemosyne-audit-v0.1",
      created_at: input.created_at ?? nowIso()
    };
    return this.upsertRecord("audit_event", event.id, event, event.actor_id, event.created_at);
  }

  async listAuditEvents(actorId?: string): Promise<AuditEvent[]> {
    return this.listRecords<AuditEvent>("audit_event", actorId);
  }

  async saveSession(session: SessionRecord): Promise<SessionRecord> {
    return this.upsertRecord(
      "session",
      session.id,
      session,
      session.user_id,
      session.completed_at ?? session.started_at
    );
  }

  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    return this.getRecord<SessionRecord>("session", sessionId);
  }

  async listSessions(userId: string): Promise<SessionRecord[]> {
    return this.listRecords<SessionRecord>("session", userId);
  }

  async listProposals(): Promise<Proposal[]> {
    return this.listRecords<Proposal>("proposal");
  }

  async getProposal(proposalId: string): Promise<Proposal | undefined> {
    return this.getRecord<Proposal>("proposal", proposalId);
  }

  async saveProposal(proposal: Proposal): Promise<Proposal> {
    return this.upsertRecord(
      "proposal",
      proposal.id,
      proposal,
      proposal.proposer_id === "ai_agent" ? undefined : proposal.proposer_id,
      proposal.updated_at
    );
  }

  async listCreatorSubmissions(creatorId?: string): Promise<CreatorSubmissionRecord[]> {
    return this.listRecords<CreatorSubmissionRecord>("creator_submission", creatorId);
  }

  async getCreatorSubmission(submissionId: string): Promise<CreatorSubmissionRecord | undefined> {
    return this.getRecord<CreatorSubmissionRecord>("creator_submission", submissionId);
  }

  async saveCreatorSubmission(submission: CreatorSubmissionRecord): Promise<CreatorSubmissionRecord> {
    return this.upsertRecord(
      "creator_submission",
      submission.id,
      submission,
      submission.creator_id,
      submission.updated_at
    );
  }

  async listPacks(): Promise<KnowledgePackRecord[]> {
    return this.listRecords<KnowledgePackRecord>("knowledge_pack");
  }

  async savePack(pack: KnowledgePackRecord): Promise<KnowledgePackRecord> {
    return this.upsertRecord("knowledge_pack", pack.id, pack, undefined, pack.graph_version);
  }

  async installPack(userId: string, packId: string): Promise<KnowledgePackRecord> {
    const pack = await this.getRecord<KnowledgePackRecord>("knowledge_pack", packId);
    if (!pack) throw new Error(`Unknown knowledge pack: ${packId}`);
    const installed_for_user_ids = Array.from(new Set([...pack.installed_for_user_ids, userId]));
    return this.savePack({ ...pack, installed_for_user_ids });
  }

  async listExperiments(): Promise<Experiment[]> {
    return this.listRecords<Experiment>("experiment");
  }

  async saveExperiment(experiment: Experiment): Promise<Experiment> {
    return this.upsertRecord("experiment", experiment.id, experiment, undefined, experiment.created_at);
  }

  async listExperimentAssignments(userId?: string): Promise<ExperimentAssignmentRecord[]> {
    return this.listRecords<ExperimentAssignmentRecord>("experiment_assignment", userId);
  }

  async saveExperimentAssignment(
    assignment: ExperimentAssignmentRecord
  ): Promise<ExperimentAssignmentRecord> {
    const recordId = `${assignment.user_id}:${assignment.experiment_id}:${assignment.unit_kind}:${assignment.unit_id}`;
    return this.upsertRecord(
      "experiment_assignment",
      recordId,
      assignment,
      assignment.user_id,
      assignment.assigned_at
    );
  }

  async getPersonalizationProfile(userId: string): Promise<PersonalizationProfileRecord | undefined> {
    return this.getRecord<PersonalizationProfileRecord>("personalization_profile", userId);
  }

  async savePersonalizationProfile(
    profile: PersonalizationProfileRecord
  ): Promise<PersonalizationProfileRecord> {
    return this.upsertRecord(
      "personalization_profile",
      profile.user_id,
      profile,
      profile.user_id,
      profile.generated_at
    );
  }

  async listSocialChallenges(userId?: string): Promise<SocialChallengeRecord[]> {
    const challenges = await this.listRecords<SocialChallengeRecord>("social_challenge");
    return userId ? challenges.filter((challenge) => challenge.participant_ids.includes(userId)) : challenges;
  }

  async saveSocialChallenge(challenge: SocialChallengeRecord): Promise<SocialChallengeRecord> {
    return this.upsertRecord(
      "social_challenge",
      challenge.id,
      challenge,
      challenge.creator_id,
      challenge.created_at
    );
  }

  async listAwardedBadges(userId: string): Promise<AwardedBadgeRecord[]> {
    return this.listRecords<AwardedBadgeRecord>("awarded_badge", userId);
  }

  async saveAwardedBadge(badge: AwardedBadgeRecord): Promise<AwardedBadgeRecord> {
    return this.upsertRecord(
      "awarded_badge",
      `${badge.user_id}:${badge.badge_id}`,
      badge,
      badge.user_id,
      badge.awarded_at
    );
  }

  async listWearableConnections(userId: string): Promise<WearableConnection[]> {
    return this.listRecords<WearableConnection>("wearable_connection", userId);
  }

  async getWearableConnection(connectionId: string): Promise<WearableConnection | undefined> {
    return this.getRecord<WearableConnection>("wearable_connection", connectionId);
  }

  async saveWearableConnection(connection: WearableConnection): Promise<WearableConnection> {
    return this.upsertRecord(
      "wearable_connection",
      connection.id,
      connection,
      connection.user_id,
      connection.updated_at ?? connection.created_at
    );
  }

  async saveWearableSleepSession(
    session: NormalizedWearableSleepSession
  ): Promise<NormalizedWearableSleepSession> {
    return this.upsertRecord(
      "wearable_sleep_session",
      session.id,
      session,
      session.user_id,
      session.ended_at ?? session.started_at
    );
  }

  async listWearableSleepSessions(userId: string): Promise<NormalizedWearableSleepSession[]> {
    return this.listRecords<NormalizedWearableSleepSession>("wearable_sleep_session", userId);
  }

  async saveOutcomeDashboard(dashboard: OutcomeDashboard): Promise<OutcomeDashboard> {
    return this.upsertRecord(
      "outcome_dashboard",
      `${dashboard.user_id}:${dashboard.generated_at}`,
      dashboard,
      dashboard.user_id,
      dashboard.generated_at
    );
  }

  async getLatestOutcomeDashboard(userId: string): Promise<OutcomeDashboard | undefined> {
    return (await this.listRecords<OutcomeDashboard>("outcome_dashboard", userId)).sort((left, right) =>
      right.generated_at.localeCompare(left.generated_at)
    )[0];
  }

  async saveJob(job: JobRecord): Promise<JobRecord> {
    return this.upsertRecord("job", job.id, job, job.audit_subject_id, job.updated_at);
  }

  async getJob(jobId: string): Promise<JobRecord | undefined> {
    return this.getRecord<JobRecord>("job", jobId);
  }

  async listJobs(queue?: QueueName): Promise<JobRecord[]> {
    const jobs = await this.listRecords<JobRecord>("job");
    return queue ? jobs.filter((job) => job.queue === queue) : jobs;
  }

  async claimNextRunnableJob(input: ClaimRunnableJobInput): Promise<JobRecord | undefined> {
    const at = input.at ?? nowIso();
    const result = await this.sql.query<RecordRow>(
      `WITH candidate AS (
         SELECT record_id, payload
         FROM mnemosyne_records
         WHERE record_type = 'job'
           AND payload->>'status' IN ('queued', 'failed')
           AND COALESCE((payload->>'attempts')::int, 0) < COALESCE((payload->>'max_attempts')::int, 0)
           AND (payload->>'run_after')::timestamptz <= $1::timestamptz
           AND ($2::text[] IS NULL OR payload->>'queue' = ANY($2::text[]))
           AND ($3::text[] IS NULL OR ((payload->>'queue') || ':' || (payload->>'type')) = ANY($3::text[]))
         ORDER BY CASE payload->>'priority'
                    WHEN 'critical' THEN 3
                    WHEN 'high' THEN 2
                    WHEN 'normal' THEN 1
                    ELSE 0
                  END DESC,
                  payload->>'run_after' ASC,
                  payload->>'created_at' ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       ),
       updated AS (
         UPDATE mnemosyne_records records
         SET payload = jsonb_set(
             jsonb_set(
               jsonb_set(
                 jsonb_set(
                   jsonb_set(
                     candidate.payload,
                     '{status}',
                     '"running"'::jsonb
                   ),
                   '{attempts}',
                   to_jsonb(COALESCE((candidate.payload->>'attempts')::int, 0) + 1)
                 ),
                 '{locked_at}',
                 to_jsonb($1::text)
               ),
               '{locked_by}',
               to_jsonb($4::text)
             ),
             '{updated_at}',
             to_jsonb($1::text)
           ),
             updated_at = $1::timestamptz
         FROM candidate
         WHERE records.record_type = 'job'
           AND records.record_id = candidate.record_id
         RETURNING records.payload
       )
       SELECT payload FROM updated`,
      [at, input.queues ?? null, input.handlerKeys ?? null, input.workerId]
    );
    return result.rows[0] ? readPayload<JobRecord>(result.rows[0].payload) : undefined;
  }

  async saveObjectManifest(manifest: ObjectManifest): Promise<ObjectManifest> {
    return this.upsertRecord(
      "object_manifest",
      manifest.id,
      manifest,
      manifest.owner_id,
      manifest.created_at
    );
  }

  async getObjectManifest(objectId: string): Promise<ObjectManifest | undefined> {
    return this.getRecord<ObjectManifest>("object_manifest", objectId);
  }

  async listObjectManifests(ownerId?: string): Promise<ObjectManifest[]> {
    return this.listRecords<ObjectManifest>("object_manifest", ownerId);
  }

  async exportUserData(userId: string): Promise<UserDataExportBundle> {
    const dailyPackets = await this.listRecords<DailyLearningPacket>("daily_packet", userId);
    const sleepCuePackets = await this.listRecords<SleepCuePacket>("sleep_cue_packet", userId);
    const audioPlanIds = new Set([
      ...sleepCuePackets.map((packet) => packet.audio_plan_id),
      ...dailyPackets.map((packet) => packet.sleep.audio_plan_id)
    ]);
    const audioPlans = await Promise.all(
      [...audioPlanIds].map((audioPlanId) => this.getRecord<AudioPlan>("audio_plan", audioPlanId))
    );
    return {
      schema_version: "mnemosyne-export-v0.1",
      user_id: userId,
      exported_at: nowIso(),
      user: await this.getUser(userId),
      goals: await this.listGoals(userId),
      readiness: await this.getReadiness(userId),
      user_graph: await this.getUserGraph(userId),
      daily_packets: dailyPackets,
      sleep_cue_packets: sleepCuePackets,
      audio_plans: audioPlans.filter(isDefined),
      assessment_responses: await this.listAssessmentResponses(userId),
      learning_events: await this.listLearningEvents(userId),
      audit_events: await this.listAuditEvents(userId),
      sessions: await this.listSessions(userId),
      installed_packs: (await this.listPacks()).filter((pack) =>
        pack.installed_for_user_ids.includes(userId)
      ),
      experiment_assignments: await this.listExperimentAssignments(userId),
      personalization_profile: await this.getPersonalizationProfile(userId),
      social_challenges: await this.listSocialChallenges(userId),
      awarded_badges: await this.listAwardedBadges(userId),
      wearable_connections: await this.listWearableConnections(userId),
      wearable_sleep_sessions: await this.listWearableSleepSessions(userId),
      outcome_dashboards: await this.listRecords<OutcomeDashboard>("outcome_dashboard", userId),
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
      count("wearable_connections", await this.deleteOwnedRecords("wearable_connection", userId));
      count("wearable_sleep_sessions", await this.deleteOwnedRecords("wearable_sleep_session", userId));
    }

    if (scope === "sleep" || scope === "account") {
      const dailyPackets = await this.listRecords<DailyLearningPacket>("daily_packet", userId);
      const sleepPackets = await this.listRecords<SleepCuePacket>("sleep_cue_packet", userId);
      const audioPlanIds = new Set([
        ...sleepPackets.map((packet) => packet.audio_plan_id),
        ...dailyPackets.map((packet) => packet.sleep.audio_plan_id)
      ]);
      count("sleep_cue_packets", await this.deleteOwnedRecords("sleep_cue_packet", userId));
      count("sleep_audio_plans", await this.deleteRecords("audio_plan", [...audioPlanIds]));
      const audioManifests = (await this.listObjectManifests(userId)).filter(
        (manifest) => manifest.bucket === "audio"
      );
      count(
        "sleep_object_manifests",
        await this.deleteRecords(
          "object_manifest",
          audioManifests.map((manifest) => manifest.id)
        )
      );
      const sleepEvents = (await this.listLearningEvents(userId)).filter(
        (event) =>
          event.event_type === "sleep_cue_played" ||
          event.event_type === "cue_bound" ||
          typeof event.payload.sleep_packet_id === "string"
      );
      count(
        "sleep_learning_events",
        await this.deleteRecords(
          "learning_event",
          sleepEvents.map((event) => event.id)
        )
      );
      count("wearable_sleep_sessions", await this.deleteOwnedRecords("wearable_sleep_session", userId));
    }

    if (scope === "voice" || scope === "account") {
      let scrubbedEvents = 0;
      for (const event of await this.listLearningEvents(userId)) {
        const scrubbed = scrubVoicePayload(event.payload);
        if (!scrubbed.changed) continue;
        await this.upsertRecord(
          "learning_event",
          event.id,
          { ...event, payload: scrubbed.payload },
          userId,
          event.created_at
        );
        scrubbedEvents += 1;
      }
      count("voice_payloads_scrubbed", scrubbedEvents);
    }

    if (scope === "account") {
      count("users", await this.deleteRecords("user", [userId]));
      count("goals", await this.deleteOwnedRecords("goal", userId));
      count("readiness_profiles", await this.deleteRecords("readiness", [userId]));
      count("concept_states", await this.deleteOwnedRecords("user_concept_state", userId));
      count("daily_packets", await this.deleteOwnedRecords("daily_packet", userId));
      count("assessment_responses", await this.deleteOwnedRecords("assessment_response", userId));
      count("learning_events", await this.deleteOwnedRecords("learning_event", userId));
      count("sessions", await this.deleteOwnedRecords("session", userId));
      count("creator_submissions", await this.deleteOwnedRecords("creator_submission", userId));
      count("experiment_assignments", await this.deleteOwnedRecords("experiment_assignment", userId));
      count("personalization_profiles", await this.deleteRecords("personalization_profile", [userId]));
      count("outcome_dashboards", await this.deleteOwnedRecords("outcome_dashboard", userId));
      count("jobs", await this.deleteOwnedRecords("job", userId));
      count("object_manifests", await this.deleteOwnedRecords("object_manifest", userId));
      count("awarded_badges", await this.deleteOwnedRecords("awarded_badge", userId));
      count("pack_installations", await this.removePackInstallations(userId));
      count("social_challenges", await this.removeUserFromChallenges(userId));
      count("audit_events_anonymized", await this.anonymizeAuditEvents(userId, deletedAt));
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
    await this.upsertRecord(
      "audit_event",
      auditEvent.id,
      auditEvent,
      auditEvent.actor_id,
      auditEvent.created_at
    );

    return {
      user_id: scope === "account" ? deletedUserId(userId) : userId,
      scope,
      deleted_at: deletedAt,
      counts,
      retained_audit_event_ids: [auditEvent.id]
    };
  }

  private async getRecord<T>(recordType: RecordType, recordId: string): Promise<T | undefined> {
    const result = await this.sql.query<RecordRow>(
      "SELECT payload FROM mnemosyne_records WHERE record_type = $1 AND record_id = $2",
      [recordType, recordId]
    );
    return result.rows[0] ? readPayload<T>(result.rows[0].payload) : undefined;
  }

  private async listRecords<T>(recordType: RecordType, ownerId?: string): Promise<T[]> {
    const result = ownerId
      ? await this.sql.query<RecordRow>(
          "SELECT payload FROM mnemosyne_records WHERE record_type = $1 AND owner_id = $2 ORDER BY sort_key DESC NULLS LAST, updated_at DESC",
          [recordType, ownerId]
        )
      : await this.sql.query<RecordRow>(
          "SELECT payload FROM mnemosyne_records WHERE record_type = $1 ORDER BY sort_key DESC NULLS LAST, updated_at DESC",
          [recordType]
        );
    return result.rows.map((row) => readPayload<T>(row.payload));
  }

  private async upsertRecord<T>(
    recordType: RecordType,
    recordId: string,
    payload: T,
    ownerId?: string,
    sortKey?: string
  ): Promise<T> {
    const result = await this.sql.query<RecordRow>(
      `INSERT INTO mnemosyne_records (record_type, record_id, owner_id, sort_key, payload, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, now(), now())
       ON CONFLICT (record_type, record_id)
       DO UPDATE SET owner_id = EXCLUDED.owner_id,
                     sort_key = EXCLUDED.sort_key,
                     payload = EXCLUDED.payload,
                     updated_at = now()
       RETURNING payload`,
      [recordType, recordId, ownerId, sortKey, JSON.stringify(payload)]
    );
    return result.rows[0] ? readPayload<T>(result.rows[0].payload) : payload;
  }

  private async deleteRecords(recordType: RecordType, recordIds: string[]): Promise<number> {
    if (recordIds.length === 0) return 0;
    const result = await this.sql.query<{ record_id: string }>(
      "DELETE FROM mnemosyne_records WHERE record_type = $1 AND record_id = ANY($2::text[]) RETURNING record_id",
      [recordType, recordIds]
    );
    return result.rows.length;
  }

  private async deleteOwnedRecords(recordType: RecordType, ownerId: string): Promise<number> {
    const result = await this.sql.query<{ record_id: string }>(
      "DELETE FROM mnemosyne_records WHERE record_type = $1 AND owner_id = $2 RETURNING record_id",
      [recordType, ownerId]
    );
    return result.rows.length;
  }

  private async removePackInstallations(userId: string): Promise<number> {
    let updated = 0;
    for (const pack of await this.listPacks()) {
      if (!pack.installed_for_user_ids.includes(userId)) continue;
      await this.savePack({
        ...pack,
        installed_for_user_ids: pack.installed_for_user_ids.filter(
          (installedUserId) => installedUserId !== userId
        )
      });
      updated += 1;
    }
    return updated;
  }

  private async removeUserFromChallenges(userId: string): Promise<number> {
    let changed = 0;
    for (const challenge of await this.listRecords<SocialChallengeRecord>("social_challenge")) {
      if (challenge.creator_id === userId) {
        changed += await this.deleteRecords("social_challenge", [challenge.id]);
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
      await this.saveSocialChallenge({ ...challenge, participant_ids: participantIds, scoreboard });
      changed += 1;
    }
    return changed;
  }

  private async anonymizeAuditEvents(userId: string, deletedAt: string): Promise<number> {
    let anonymized = 0;
    for (const event of await this.listAuditEvents(userId)) {
      await this.upsertRecord(
        "audit_event",
        event.id,
        {
          ...event,
          actor_id: deletedUserId(userId),
          object_id: event.object_type === "user" ? deletedUserId(userId) : event.object_id,
          payload: {
            redacted: true,
            original_action: event.action,
            original_object_type: event.object_type,
            deleted_at: deletedAt
          }
        },
        deletedUserId(userId),
        event.created_at
      );
      anonymized += 1;
    }
    return anonymized;
  }
}

export function createPostgresStore(sql: SqlExecutor): MnemosyneStore {
  return new PostgresMnemosyneStore(sql);
}

export async function seedPostgresStore(
  store: MnemosyneStore,
  seed: MnemosyneSeedData
): Promise<MnemosyneSeedData> {
  await store.saveUser(seed.user);
  await store.saveMasterGraph(seed.masterGraph);
  await store.saveUserConceptStates(seed.user.id, seed.userStates);
  await store.saveReadiness(seed.user.id, seed.readiness);
  await Promise.all(seed.goals.map((goal) => store.saveGoal(goal)));
  await Promise.all((seed.proposals ?? []).map((proposal) => store.saveProposal(proposal)));
  await Promise.all((seed.packs ?? []).map((knowledgePack) => store.savePack(knowledgePack)));
  return seed;
}

function readPayload<T>(payload: unknown): T {
  return typeof payload === "string" ? (JSON.parse(payload) as T) : (payload as T);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function packetKey(userId: string, date: string): string {
  return `${userId}:${date}`;
}

function stateKey(userId: string, conceptId: string): string {
  return `${userId}:${conceptId}`;
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

function deletedUserId(userId: string): string {
  return `deleted_user:${stableHash(userId).toString(36)}`;
}
