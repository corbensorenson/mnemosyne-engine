import type {
  DailyLearningPacket,
  Goal,
  ReadinessProfile,
  User,
  UserKnowledgeGraph
} from "@mnemosyne/schema";
import type { OutcomeDashboard } from "@mnemosyne/outcome-core";
import type { KnowledgePackRecord } from "@mnemosyne/persistence-core";

type ApiEnvelope<T> =
  | {
      ok: true;
      data: T;
      audit_event_id?: string;
    }
  | {
      ok: false;
      error?: {
        code: string;
        message: string;
      };
    };

export type AppBootstrapPayload = {
  user: User;
  goals: Goal[];
  readiness: ReadinessProfile;
  user_graph: UserKnowledgeGraph;
  daily_packet?: DailyLearningPacket;
  daily_packet_summary?: {
    id: string;
    date: string;
    morning_items: number;
    watch_packets: number;
    walk_prompts: number;
    sleep_cues: number;
  };
  daily_packet_source: "existing" | "generated" | "missing";
  packs: KnowledgePackRecord[];
  installed_packs: KnowledgePackRecord[];
  latest_outcome_dashboard?: OutcomeDashboard;
};

export type WebApiConfig = {
  baseUrl: string;
  userId: string;
};

export function webApiConfigFromEnv(): WebApiConfig | null {
  const baseUrl = String(import.meta.env.VITE_MNEMOSYNE_API_URL ?? "").replace(/\/$/, "");
  const userId = String(import.meta.env.VITE_MNEMOSYNE_USER_ID ?? "").trim();
  return baseUrl && userId ? { baseUrl, userId } : null;
}

export async function fetchAppBootstrap(
  config: WebApiConfig,
  input: {
    generateMissingPacket?: boolean;
    date?: string;
  } = {}
): Promise<AppBootstrapPayload> {
  const url = new URL("/api/app/bootstrap", config.baseUrl);
  url.searchParams.set("userId", config.userId);
  url.searchParams.set("generateMissingPacket", String(input.generateMissingPacket ?? true));
  if (input.date) url.searchParams.set("date", input.date);

  const response = await fetch(url);
  const envelope = (await response.json().catch(() => ({}))) as ApiEnvelope<AppBootstrapPayload>;
  if (!response.ok || !envelope.ok) {
    const message = "error" in envelope ? envelope.error?.message : undefined;
    throw new Error(message ?? `Bootstrap failed with HTTP ${response.status}.`);
  }
  return envelope.data;
}
