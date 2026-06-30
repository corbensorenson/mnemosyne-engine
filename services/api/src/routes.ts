import type { DailyLearningPacket, LearningEvent } from "@mnemosyne/schema";

export type ApiRoute = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  service: string;
  eventType?: LearningEvent["event_type"];
};

export const apiRoutes: ApiRoute[] = [
  {
    method: "POST",
    path: "/api/onboarding/complete",
    service: "Onboarding Service",
    eventType: "graph_updated"
  },
  { method: "GET", path: "/api/me", service: "User Service" },
  { method: "POST", path: "/api/auth/session", service: "Auth Service" },
  { method: "POST", path: "/api/auth/verify", service: "Auth Service" },
  { method: "POST", path: "/api/auth/authorize", service: "Auth Service" },
  { method: "PATCH", path: "/api/me/preferences", service: "User Service", eventType: "graph_updated" },
  { method: "GET", path: "/api/privacy/export", service: "Privacy Service" },
  { method: "DELETE", path: "/api/privacy/data", service: "Privacy Service" },
  { method: "GET", path: "/api/me/capabilities", service: "Wearable Integration Service" },
  { method: "GET", path: "/api/goals", service: "User Service" },
  { method: "POST", path: "/api/goals", service: "User Service", eventType: "graph_updated" },
  { method: "GET", path: "/api/daily-packet/today", service: "Scheduler Service" },
  {
    method: "POST",
    path: "/api/daily-packet/generate",
    service: "Scheduler Service",
    eventType: "session_started"
  },
  {
    method: "POST",
    path: "/api/sessions/:id/events",
    service: "Analytics Service",
    eventType: "session_started"
  },
  {
    method: "POST",
    path: "/api/tutor/turn",
    service: "Tutor Service",
    eventType: "assessment_answered"
  },
  {
    method: "POST",
    path: "/api/walk-mode/complete",
    service: "WalkMode Service",
    eventType: "walk_recall_completed"
  },
  {
    method: "POST",
    path: "/api/assessments/:id/response",
    service: "Assessment Service",
    eventType: "assessment_answered"
  },
  {
    method: "POST",
    path: "/api/morning-forge/complete",
    service: "Assessment Service",
    eventType: "graph_updated"
  },
  {
    method: "POST",
    path: "/api/evening-lock-in/complete",
    service: "SleepCue Service",
    eventType: "cue_bound"
  },
  { method: "GET", path: "/api/graph/master", service: "Master Graph Service" },
  { method: "GET", path: "/api/graph/user", service: "Personal Graph Service" },
  { method: "GET", path: "/api/videos/recommended", service: "VideoGraph Service" },
  {
    method: "POST",
    path: "/api/watch-packets/generate",
    service: "VideoGraph Service",
    eventType: "video_watched"
  },
  {
    method: "POST",
    path: "/api/watch-packets/:id/complete",
    service: "VideoGraph Service",
    eventType: "video_watched"
  },
  {
    method: "POST",
    path: "/api/paced-read/generate",
    service: "Paced Read Engine",
    eventType: "session_started"
  },
  {
    method: "POST",
    path: "/api/paced-read/complete",
    service: "Paced Read Engine",
    eventType: "paced_read_completed"
  },
  { method: "POST", path: "/api/sleep/packet/generate", service: "SleepCue Service", eventType: "cue_bound" },
  { method: "GET", path: "/api/sleep/packet/tonight", service: "SleepCue Service" },
  { method: "POST", path: "/api/sleep/audio/render", service: "Audio Render Service" },
  {
    method: "POST",
    path: "/api/sleep/playback/events",
    service: "SleepCue Service",
    eventType: "sleep_cue_played"
  },
  {
    method: "POST",
    path: "/api/sleep/recall/complete",
    service: "Assessment Service",
    eventType: "graph_updated"
  },
  { method: "POST", path: "/api/wearables/sync", service: "Wearable Integration Service" },
  { method: "GET", path: "/api/wearables/status", service: "Wearable Integration Service" },
  { method: "POST", path: "/api/wearables/oura/connect", service: "Wearable Integration Service" },
  { method: "POST", path: "/api/wearables/:id/revoke", service: "Wearable Integration Service" },
  {
    method: "POST",
    path: "/api/experiments/assign",
    service: "Technique Lab Service",
    eventType: "graph_updated"
  },
  { method: "GET", path: "/api/personalization/profile", service: "Technique Lab Service" },
  { method: "GET", path: "/api/outcomes/dashboard", service: "Outcome Analytics Service" },
  { method: "POST", path: "/api/outcomes/refresh", service: "Outcome Analytics Service" },
  { method: "POST", path: "/api/jobs", service: "Ops Queue Service" },
  { method: "POST", path: "/api/jobs/:id/start", service: "Ops Queue Service" },
  { method: "POST", path: "/api/jobs/:id/complete", service: "Ops Queue Service" },
  { method: "POST", path: "/api/jobs/:id/fail", service: "Ops Queue Service" },
  { method: "POST", path: "/api/objects", service: "Object Manifest Service" },
  { method: "POST", path: "/api/objects/store", service: "Object Storage Service" },
  { method: "GET", path: "/api/ops/monitoring", service: "Ops Monitoring Service" },
  { method: "GET", path: "/api/ops/health", service: "Ops Health Service" },
  { method: "GET", path: "/api/security/release-gate", service: "Security Service" },
  {
    method: "POST",
    path: "/api/proposals",
    service: "Content Court Service",
    eventType: "proposal_submitted"
  },
  { method: "POST", path: "/api/proposals/:id/ai-review", service: "AI Agent Orchestrator" },
  { method: "POST", path: "/api/proposals/:id/vote", service: "Content Court Service" },
  { method: "POST", path: "/api/proposals/:id/comment", service: "Content Court Service" },
  { method: "POST", path: "/api/proposals/:id/human-override", service: "Admin/Moderation Service" },
  { method: "POST", path: "/api/proposals/:id/release", service: "Master Graph Release Service" },
  {
    method: "POST",
    path: "/api/creator/ingestions",
    service: "Creator Studio Service",
    eventType: "proposal_submitted"
  },
  { method: "GET", path: "/api/creator/ingestions", service: "Creator Studio Service" },
  { method: "GET", path: "/api/creator/ingestions/:id", service: "Creator Studio Service" },
  { method: "GET", path: "/api/packs", service: "Master Graph Service" },
  { method: "GET", path: "/api/social/dashboard", service: "Social Service" },
  { method: "GET", path: "/api/challenges", service: "Social Service" },
  { method: "POST", path: "/api/challenges", service: "Social Service", eventType: "content_reviewed" },
  { method: "GET", path: "/api/badges", service: "Badge Service" }
];

export type ApiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  audit_event_id?: string;
};

export function envelope<T>(data: T, auditEventId?: string): ApiEnvelope<T> {
  return { ok: true, data, audit_event_id: auditEventId };
}

export function packetSummary(packet: DailyLearningPacket) {
  return {
    id: packet.id,
    date: packet.date,
    morning_items: packet.morning.cold_retrieval_items.length + packet.morning.frontier_items.length,
    watch_packets: packet.optional_watch_packets.length,
    walk_prompts: packet.walk_packets.reduce((sum, walk) => sum + walk.prompts.length, 0),
    sleep_cues:
      packet.sleep.reactivate_concept_ids.length +
      packet.sleep.stabilize_concept_ids.length +
      packet.sleep.prime_concept_ids.length
  };
}

export { createApiHandlers } from "./handlers";
export {
  InMemoryRateLimitStore,
  createApiHttpHandler,
  createApiHttpServer,
  createSeededDemoApiHttpServer
} from "./http";
export {
  configFromEnv,
  createApiRuntime,
  createConfiguredStore,
  runApiServerFromEnv,
  runMigrations,
  runMigrationsFromEnv,
  startApiRuntime,
  type ApiRuntime,
  type ApiRuntimeConfig,
  type ApiRuntimeEnvironment,
  type ApiStorageDriver,
  type MigrationResult
} from "./runtime";
export { createDemoSeedData, demoKnowledgePacks, seedDemoStore } from "./seed";
export * from "./validation";
