import type { DailyLearningPacket, User } from "@mnemosyne/schema";
import { createId, nowIso, todayIsoDate } from "@mnemosyne/shared-utils";

export const notificationKinds = ["morning_prompt", "evening_lock_in", "phone_down", "sleep_recall"] as const;
export type NotificationKind = (typeof notificationKinds)[number];

export type NotificationChannel = "in_app" | "web_push_ready" | "native_companion_recommended";

export type NotificationPlanItem = {
  id: string;
  user_id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  channel: NotificationChannel;
  scheduled_for: string;
  priority: "low" | "normal" | "high";
  payload: Record<string, unknown>;
};

export type NotificationPlan = {
  generated_at: string;
  user_id: string;
  packet_id?: string;
  items: NotificationPlanItem[];
  suppressed: Array<{
    kind: NotificationKind;
    reason: string;
  }>;
};

export function buildNotificationPlan(input: {
  user: User;
  packet?: DailyLearningPacket;
  generatedAt?: string;
  channel?: NotificationChannel;
}): NotificationPlan {
  const generatedAt = input.generatedAt ?? nowIso();
  const settings = input.user.notification_settings ?? {};
  const packetDate = input.packet?.date ?? todayIsoDate(new Date(generatedAt));
  const channel = input.channel ?? channelFromSettings(settings);
  const items: NotificationPlanItem[] = [];
  const suppressed: NotificationPlan["suppressed"] = [];

  if (settingEnabled(settings, "morning_prompt", true)) {
    const reviewCount = input.packet?.morning.cold_retrieval_items.length ?? 0;
    items.push(
      item({
        user: input.user,
        packet: input.packet,
        kind: "morning_prompt",
        title: "Morning Forge is ready",
        body:
          reviewCount > 0 ? `${reviewCount} cold recalls are waiting.` : "Start with a short recall pass.",
        channel,
        scheduledFor: settingIso(settings, "morning_prompt_at") ?? dateAtUtc(packetDate, 8, 0),
        priority: "high",
        payload: { review_count: reviewCount }
      })
    );
  } else {
    suppressed.push({ kind: "morning_prompt", reason: "morning_prompt disabled" });
  }

  if (settingEnabled(settings, "evening_prompt", true)) {
    const cueCount = input.packet?.evening.sleep_cue_binding_items.length ?? 0;
    items.push(
      item({
        user: input.user,
        packet: input.packet,
        kind: "evening_lock_in",
        title: "Evening Lock-In",
        body:
          cueCount > 0 ? `Bind ${cueCount} sleep cues before screens go away.` : "Wrap the day with recall.",
        channel,
        scheduledFor: settingIso(settings, "evening_prompt_at") ?? dateAtUtc(packetDate, 20, 0),
        priority: "normal",
        payload: { cue_binding_count: cueCount }
      })
    );
  } else {
    suppressed.push({ kind: "evening_lock_in", reason: "evening_prompt disabled" });
  }

  if (input.packet?.sleep && settingEnabled(settings, "dusk_quiet", true)) {
    items.push(
      item({
        user: input.user,
        packet: input.packet,
        kind: "phone_down",
        title: "Phone-down window",
        body: "Silence notifications and let sleep cues stay sparse.",
        channel,
        scheduledFor: minutesBefore(
          input.packet.sleep.target_sleep_window.estimated_sleep_onset_at,
          settingNumber(settings, "phone_down_lead_minutes", 30)
        ),
        priority: "high",
        payload: {
          sleep_packet_id: input.packet.sleep.id,
          audio_plan_id: input.packet.sleep.audio_plan_id
        }
      })
    );
  } else if (!input.packet?.sleep) {
    suppressed.push({ kind: "phone_down", reason: "no sleep packet available" });
  } else {
    suppressed.push({ kind: "phone_down", reason: "dusk_quiet disabled" });
  }

  if (input.packet?.sleep && settingEnabled(settings, "sleep_recall_prompt", true)) {
    items.push(
      item({
        user: input.user,
        packet: input.packet,
        kind: "sleep_recall",
        title: "SleepCue recall check",
        body: "Run the quick morning check before the cue memory fades.",
        channel,
        scheduledFor:
          settingIso(settings, "sleep_recall_at") ?? nextDateAtUtc(input.packet.sleep.night_date, 8, 0),
        priority: "normal",
        payload: {
          sleep_packet_id: input.packet.sleep.id,
          reactivate_concept_ids: input.packet.sleep.reactivate_concept_ids
        }
      })
    );
  } else if (!input.packet?.sleep) {
    suppressed.push({ kind: "sleep_recall", reason: "no sleep packet available" });
  } else {
    suppressed.push({ kind: "sleep_recall", reason: "sleep_recall_prompt disabled" });
  }

  return {
    generated_at: generatedAt,
    user_id: input.user.id,
    packet_id: input.packet?.id,
    items: items.sort((left, right) => left.scheduled_for.localeCompare(right.scheduled_for)),
    suppressed
  };
}

function item(input: {
  user: User;
  packet?: DailyLearningPacket;
  kind: NotificationKind;
  title: string;
  body: string;
  channel: NotificationChannel;
  scheduledFor: string;
  priority: "low" | "normal" | "high";
  payload: Record<string, unknown>;
}): NotificationPlanItem {
  return {
    id: createId(
      "notification",
      `${input.user.id}:${input.kind}:${input.scheduledFor}:${input.packet?.id ?? "none"}`
    ),
    user_id: input.user.id,
    kind: input.kind,
    title: input.title,
    body: input.body,
    channel: input.channel,
    scheduled_for: input.scheduledFor,
    priority: input.priority,
    payload: {
      packet_id: input.packet?.id,
      daily_packet_date: input.packet?.date,
      ...input.payload
    }
  };
}

function channelFromSettings(settings: Record<string, unknown>): NotificationChannel {
  if (settings.web_push_enabled === true) return "web_push_ready";
  if (settings.native_companion_recommended === true) return "native_companion_recommended";
  return "in_app";
}

function settingEnabled(settings: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = settings[key];
  return typeof value === "boolean" ? value : fallback;
}

function settingIso(settings: Record<string, unknown>, key: string): string | undefined {
  const value = settings[key];
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

function settingNumber(settings: Record<string, unknown>, key: string, fallback: number): number {
  const value = settings[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function dateAtUtc(date: string, hour: number, minute: number): string {
  return `${date}T${pad(hour)}:${pad(minute)}:00.000Z`;
}

function nextDateAtUtc(date: string, hour: number, minute: number): string {
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return dateAtUtc(todayIsoDate(), hour, minute);
  return dateAtUtc(new Date(parsed + 86_400_000).toISOString().slice(0, 10), hour, minute);
}

function minutesBefore(timestamp: string, minutes: number): string {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return nowIso();
  return new Date(parsed - minutes * 60_000).toISOString();
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
