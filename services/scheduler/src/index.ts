import { createJob } from "@mnemosyne/ops-core";
import type { PersonalizationProfileRecord } from "@mnemosyne/persistence-core";
import { buildDailyLearningPacket, type SessionConstraints } from "@mnemosyne/scheduler-core";
import type { Goal, MasterGraph, ReadinessProfile, User, UserKnowledgeGraph } from "@mnemosyne/schema";
import type { WorkerHandlerDefinition, WorkerJobContext, WorkerJobResult } from "@mnemosyne/worker-core";

export const GENERATE_DAILY_PACKET_JOB_TYPE = "generate_daily_packet";

export type SchedulerJob = {
  id: string;
  user: User;
  userGraph: UserKnowledgeGraph;
  masterGraph: MasterGraph;
  goals: Goal[];
  readiness: ReadinessProfile;
  constraints?: SessionConstraints;
};

export function runSchedulerJob(job: SchedulerJob) {
  return buildDailyLearningPacket({
    user: job.user,
    userGraph: job.userGraph,
    masterGraph: job.masterGraph,
    goals: job.goals,
    readiness: job.readiness,
    constraints: job.constraints ?? schedulerConstraintsFor(job.readiness)
  });
}

export function createSchedulerWorkerHandlers(): WorkerHandlerDefinition[] {
  return [
    {
      queue: "scheduler",
      type: GENERATE_DAILY_PACKET_JOB_TYPE,
      handle: runDailyPacketWorkerJob
    }
  ];
}

export async function runDailyPacketWorkerJob(context: WorkerJobContext): Promise<WorkerJobResult> {
  const userId = requiredPayloadString(context.job.payload, "userId", "user_id");
  const user = await context.store.getUser(userId);
  if (!user) throw new Error(`Cannot schedule daily packet for unknown user: ${userId}`);
  const readiness = await context.store.getReadiness(userId);
  if (!readiness) throw new Error(`Cannot schedule daily packet without readiness profile: ${userId}`);

  const [goals, userGraph, masterGraph, profile] = await Promise.all([
    context.store.listGoals(userId),
    context.store.getUserGraph(userId),
    context.store.getMasterGraph(),
    context.store.getPersonalizationProfile(userId)
  ]);

  const scheduled = runSchedulerJob({
    id: context.job.id,
    user,
    userGraph,
    masterGraph,
    goals,
    readiness,
    constraints: schedulerConstraintsFor(readiness, profile)
  });
  const [packet, sleepPacket, audioPlan] = await Promise.all([
    context.store.saveDailyPacket(scheduled.packet),
    context.store.saveSleepCuePacket(scheduled.packet.sleep),
    context.store.saveAudioPlan(scheduled.audioPlan)
  ]);
  const renderJob = await context.store.saveJob(
    createJob({
      queue: "audio_render",
      type: "render_sleep_audio",
      payload: {
        user_id: userId,
        daily_packet_id: packet.id,
        sleep_cue_packet_id: sleepPacket.id,
        audio_plan_id: audioPlan.id
      },
      priority: context.job.priority,
      idempotencyKey: `render_sleep_audio:${audioPlan.id}`,
      auditSubjectId: userId
    })
  );

  return {
    user_id: userId,
    daily_packet_id: packet.id,
    sleep_cue_packet_id: sleepPacket.id,
    audio_plan_id: audioPlan.id,
    queued_audio_job_id: renderJob.id,
    graph_delta_expected_mastery_gain: packet.graph_delta_target.expected_durable_mastery_gain
  };
}

export function schedulerConstraintsFor(
  readiness: ReadinessProfile,
  profile?: PersonalizationProfileRecord
): SessionConstraints {
  const adjustments = profile?.scheduler_adjustments;
  return {
    morningScreenBudget:
      adjustments?.morning_screen_budget_minutes ?? (readiness.screen_budget_minutes > 20 ? 10 : 4),
    optionalWatchBudgets: adjustments?.optional_watch_budgets ?? [30, 18, 8],
    eveningScreenPolicy:
      adjustments?.evening_screen_policy ?? (readiness.dusk_mode ? "audio_only" : "minimal_visual"),
    conservativeSleep:
      adjustments?.conservative_sleep ?? (readiness.sleep_quality < 0.5 || readiness.fatigue > 0.7)
  };
}

function requiredPayloadString(payload: Record<string, unknown>, ...keys: string[]): string {
  const value = keys.map((key) => payload[key]).find((entry) => typeof entry === "string" && entry);
  if (typeof value === "string") return value;
  throw new Error(`Missing required job payload field: ${keys.join(" or ")}`);
}
