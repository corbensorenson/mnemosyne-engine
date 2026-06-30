import { buildDailyLearningPacket } from "@mnemosyne/scheduler-core";
import type { Goal, MasterGraph, ReadinessProfile, User, UserKnowledgeGraph } from "@mnemosyne/schema";

export type SchedulerJob = {
  id: string;
  user: User;
  userGraph: UserKnowledgeGraph;
  masterGraph: MasterGraph;
  goals: Goal[];
  readiness: ReadinessProfile;
};

export function runSchedulerJob(job: SchedulerJob) {
  return buildDailyLearningPacket({
    user: job.user,
    userGraph: job.userGraph,
    masterGraph: job.masterGraph,
    goals: job.goals,
    readiness: job.readiness,
    constraints: {
      morningScreenBudget: job.readiness.screen_budget_minutes > 20 ? 10 : 4,
      optionalWatchBudgets: [30, 18, 8],
      conservativeSleep: job.readiness.sleep_quality < 0.5 || job.readiness.fatigue > 0.7
    }
  });
}
