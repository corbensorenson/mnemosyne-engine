import { createOfflineQueueItem } from "@mnemosyne/offline-core";
import { demoMasterGraph } from "@mnemosyne/demo-fixtures";
import { describe, expect, it } from "vitest";
import { offlineSyncRequestForItem } from "../../apps/web/src/offlineSync";

const prompt = {
  id: "assessment_demo",
  concept_ids: [demoMasterGraph.concepts[0]?.id ?? "concept_demo"],
  assessment_type: "free_recall" as const,
  prompt: "Explain the concept.",
  expected_answer: "A clear explanation.",
  rubric: {
    must_include: ["mechanism"],
    partial_credit: [],
    disallow: []
  },
  difficulty: 0.4,
  created_at: "2026-06-30T08:00:00.000Z"
};

describe("web offline sync transport", () => {
  it("routes backend-compatible Morning Forge queue items to the domain completion endpoint", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "morning_forge_response",
      endpoint: "/api/morning-forge/complete",
      method: "POST",
      payload: {
        userId: "user_demo",
        dailyPacketId: "daily_packet_demo",
        packetDate: "2026-06-30",
        responses: [
          {
            item: prompt,
            rawResponse: "A clear explanation.",
            confidence: 0.8,
            latencyMs: 12_000,
            entryMode: "text"
          }
        ],
        screenMinutes: 0.2,
        voiceUsed: false,
        completedAt: "2026-06-30T08:05:00.000Z"
      },
      idempotencyKey: "morning-domain-write"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787/", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/morning-forge/complete",
        body: item.payload,
        directDomainWrite: true
      })
    );
  });

  it("keeps legacy or receipt-only payloads on the offline receipt route", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "morning_forge_response",
      endpoint: "/api/morning-forge/complete",
      method: "POST",
      payload: {
        daily_packet_id: "daily_packet_demo",
        response: { response_id: "local_only" }
      },
      idempotencyKey: "legacy-morning-receipt"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/offline/actions/sync",
        body: { item },
        directDomainWrite: false
      })
    );
  });

  it("routes backend-compatible tutor turn queue items to the tutor endpoint", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "tutor_turn",
      endpoint: "/api/tutor/turn",
      method: "POST",
      payload: {
        userId: "user_demo",
        mode: "socratic",
        item: prompt,
        rawResponse: "A clear explanation.",
        confidence: 0.74,
        latencyMs: 14_000,
        entryMode: "text",
        transcriptRetention: "deleted",
        highStakesDomain: false
      },
      idempotencyKey: "tutor-domain-write"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787/", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/tutor/turn",
        method: "POST",
        body: item.payload,
        directDomainWrite: true
      })
    );
  });

  it("keeps legacy tutor turn payloads on the offline receipt route", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "tutor_turn",
      endpoint: "/api/tutor/turn",
      method: "POST",
      payload: {
        tutor_turn_id: "local_tutor_turn",
        response_id: "local_response"
      },
      idempotencyKey: "legacy-tutor-receipt"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/offline/actions/sync",
        method: "POST",
        body: { item },
        directDomainWrite: false
      })
    );
  });

  it("routes backend-compatible WalkMode queue items to the domain completion endpoint", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "walk_mode_completion",
      endpoint: "/api/walk-mode/complete",
      method: "POST",
      payload: {
        userId: "user_demo",
        dailyPacketId: "daily_packet_demo",
        packetDate: "2026-06-30",
        walkPacketId: "walk_packet_demo",
        responses: [
          {
            item: prompt,
            rawResponse: "A clear walking recall answer.",
            confidence: 0.74,
            latencyMs: 18_000,
            hintCount: 1,
            entryMode: "voice"
          }
        ],
        skippedPromptIds: ["walk_skip"],
        confusingPromptIds: ["walk_confusing"],
        commandLog: ["listen", "give hint"],
        screenLocked: true,
        voiceUsed: true,
        transcriptRetention: "deleted",
        completedAt: "2026-06-30T08:10:00.000Z"
      },
      idempotencyKey: "walk-domain-write"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787/", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/walk-mode/complete",
        body: item.payload,
        directDomainWrite: true
      })
    );
  });

  it("keeps legacy WalkMode payloads on the offline receipt route", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "walk_mode_completion",
      endpoint: "/api/walk-mode/complete",
      method: "POST",
      payload: {
        walk_packet_id: "walk_packet_demo",
        responses: [{ response_id: "local_only" }]
      },
      idempotencyKey: "legacy-walk-receipt"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/offline/actions/sync",
        body: { item },
        directDomainWrite: false
      })
    );
  });

  it("routes backend-compatible Evening Lock-In queue items to the domain completion endpoint", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "evening_lock_in_completion",
      endpoint: "/api/evening-lock-in/complete",
      method: "POST",
      payload: {
        userId: "user_demo",
        dailyPacketId: "daily_packet_demo",
        packetDate: "2026-06-30",
        recallResponses: [
          {
            item: prompt,
            rawResponse: "A recall answer before bed.",
            confidence: 0.7,
            latencyMs: 16_000,
            entryMode: "voice"
          }
        ],
        transferResponses: [
          {
            item: prompt,
            rawResponse: "A transfer example before bed.",
            confidence: 0.66,
            latencyMs: 24_000,
            entryMode: "text"
          }
        ],
        boundCueIds: ["cue_sleep_1"],
        phoneDownChecklist: {
          notificationsSilenced: true,
          screenDimmingEnabled: true,
          chargerReady: true,
          alarmSet: true
        },
        screenMinutes: 1.2,
        voiceUsed: true,
        completedAt: "2026-06-30T21:15:00.000Z"
      },
      idempotencyKey: "evening-domain-write"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787/", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/evening-lock-in/complete",
        body: item.payload,
        directDomainWrite: true
      })
    );
  });

  it("keeps legacy Evening Lock-In payloads on the offline receipt route", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "evening_lock_in_completion",
      endpoint: "/api/evening-lock-in/complete",
      method: "POST",
      payload: {
        daily_packet_id: "daily_packet_demo",
        completed_responses: 2,
        bound_cue_ids: ["cue_legacy"]
      },
      idempotencyKey: "legacy-evening-receipt"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/offline/actions/sync",
        body: { item },
        directDomainWrite: false
      })
    );
  });

  it("routes backend-compatible GraphFeed recall queue items to the watch completion endpoint", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "graphfeed_recall",
      endpoint: "/api/watch-packets/watch_packet_demo/complete",
      method: "POST",
      payload: {
        userId: "user_demo",
        watchPacketId: "watch_packet_demo",
        videoIds: ["video_demo"],
        recallPassed: true,
        screenMinutes: 18
      },
      idempotencyKey: "graphfeed-domain-write"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787/", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/watch-packets/watch_packet_demo/complete",
        body: item.payload,
        directDomainWrite: true
      })
    );
  });

  it("keeps legacy GraphFeed recall payloads on the offline receipt route", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "graphfeed_recall",
      endpoint: "/api/watch-packets/watch_packet_demo/complete",
      method: "POST",
      payload: {
        watch_packet_id: "watch_packet_demo",
        response: { response_id: "local_only" }
      },
      idempotencyKey: "legacy-graphfeed-receipt"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/offline/actions/sync",
        body: { item },
        directDomainWrite: false
      })
    );
  });

  it("routes backend-compatible Paced Read completion queue items to the completion endpoint", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "paced_read_completion",
      endpoint: "/api/paced-read/complete",
      method: "POST",
      payload: {
        userId: "user_demo",
        pacedReadSessionId: "paced_read_session_demo",
        assetId: "paced_read_asset_demo",
        rawWpm: 420,
        comprehensionScore: 0.84,
        retentionScore: 0.78,
        strainRating: 0.22,
        screenMinutes: 3.4,
        completedAt: "2026-06-30T19:30:00.000Z"
      },
      idempotencyKey: "paced-read-domain-write"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787/", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/paced-read/complete",
        body: item.payload,
        directDomainWrite: true
      })
    );
  });

  it("keeps legacy Paced Read completion payloads on the offline receipt route", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "paced_read_completion",
      endpoint: "/api/paced-read/complete",
      method: "POST",
      payload: {
        paced_read_session_id: "paced_read_session_demo",
        effective_wpm: 312,
        advance_allowed: true
      },
      idempotencyKey: "legacy-paced-read-receipt"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/offline/actions/sync",
        body: { item },
        directDomainWrite: false
      })
    );
  });

  it("routes backend-compatible SleepCue playback queue items to the playback endpoint", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "sleep_playback_event",
      endpoint: "/api/sleep/playback/events",
      method: "POST",
      payload: {
        userId: "user_demo",
        sleepPacketId: "sleep_packet_demo",
        nightDate: "2026-06-30",
        audioPlanId: "audio_plan_demo",
        playbackStartedAt: "2026-06-30T22:00:00.000Z",
        playbackEndedAt: "2026-06-30T22:30:00.000Z",
        cueEvents: [
          {
            conceptId: "concept_demo",
            bucket: "reactivate",
            playedAt: "2026-06-30T22:05:00.000Z",
            volume: 0.18,
            completed: true
          }
        ],
        stopCondition: "none",
        sleepDisruptionReported: false
      },
      idempotencyKey: "sleep-playback-domain-write"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787/", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/sleep/playback/events",
        body: item.payload,
        directDomainWrite: true
      })
    );
  });

  it("keeps legacy SleepCue playback payloads on the offline receipt route", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "sleep_playback_event",
      endpoint: "/api/sleep/playback/events",
      method: "POST",
      payload: {
        sleep_packet_id: "sleep_packet_demo",
        cue_events: [{ concept_id: "concept_demo", bucket: "reactivate" }]
      },
      idempotencyKey: "legacy-sleep-playback-receipt"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/offline/actions/sync",
        body: { item },
        directDomainWrite: false
      })
    );
  });

  it("routes backend-compatible SleepCue recall queue items to the recall endpoint", () => {
    const sleepResponse = {
      item: prompt,
      rawResponse: "A clear explanation.",
      confidence: 0.72,
      latencyMs: 18_000,
      entryMode: "text"
    };
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "sleep_recall_completion",
      endpoint: "/api/sleep/recall/complete",
      method: "POST",
      payload: {
        userId: "user_demo",
        sleepPacketId: "sleep_packet_demo",
        nightDate: "2026-06-30",
        cuedResponses: [sleepResponse],
        controlResponses: [{ ...sleepResponse, rawResponse: "not sure yet", confidence: 0.34 }],
        screenMinutes: 2.4,
        voiceUsed: false,
        completedAt: "2026-07-01T07:00:00.000Z"
      },
      idempotencyKey: "sleep-recall-domain-write"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787/", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/sleep/recall/complete",
        body: item.payload,
        directDomainWrite: true
      })
    );
  });

  it("keeps legacy SleepCue recall payloads on the offline receipt route", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "sleep_recall_completion",
      endpoint: "/api/sleep/recall/complete",
      method: "POST",
      payload: {
        sleep_packet_id: "sleep_packet_demo",
        controls_revealed: true,
        responses: [{ response_id: "local_only" }]
      },
      idempotencyKey: "legacy-sleep-recall-receipt"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/offline/actions/sync",
        body: { item },
        directDomainWrite: false
      })
    );
  });

  it("routes backend-compatible wearable sleep sync queue items to the wearable endpoint", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "wearable_sleep_sync",
      endpoint: "/api/wearables/sync",
      method: "POST",
      payload: {
        userId: "user_demo",
        provider: "oura",
        sleepSession: {
          external_id: "demo_oura_sleep_2026_06_29",
          sleep_score: 0.82,
          readiness_score: 0.78,
          efficiency: 0.91,
          started_at: "2026-06-29T03:46:00.000Z",
          ended_at: "2026-06-29T11:54:00.000Z",
          stages: [
            { stage: "awake", duration_minutes: 22 },
            { stage: "light", duration_minutes: 242 },
            { stage: "deep", duration_minutes: 74 },
            { stage: "rem", duration_minutes: 92 }
          ]
        }
      },
      payloadScope: "health",
      idempotencyKey: "wearable-sleep-domain-write"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787/", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/wearables/sync",
        body: item.payload,
        directDomainWrite: true
      })
    );
  });

  it("keeps legacy wearable sleep summaries on the offline receipt route", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "wearable_sleep_sync",
      endpoint: "/api/wearables/sync",
      method: "POST",
      payload: {
        provider: "oura",
        external_id: "demo_oura_sleep_2026_06_29",
        sleep_quality: 0.82,
        readiness_delta: 0.08,
        stage_minutes: { awake: 22, light: 242, deep: 74, rem: 92, unknown: 0 }
      },
      payloadScope: "health",
      idempotencyKey: "legacy-wearable-sleep-receipt"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/offline/actions/sync",
        body: { item },
        directDomainWrite: false
      })
    );
  });

  it("routes backend-compatible incident report queue items to the ops endpoint", () => {
    const item = createOfflineQueueItem({
      userId: "operator_demo",
      actionType: "incident_report",
      endpoint: "/api/ops/incidents/reports",
      method: "POST",
      payload: {
        operatorId: "operator_demo",
        environment: "production",
        title: "Production release incident drill"
      },
      payloadScope: "ops",
      idempotencyKey: "incident-report-domain-write"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787/", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/ops/incidents/reports",
        body: item.payload,
        directDomainWrite: true
      })
    );
  });

  it("keeps local incident report artifacts on the offline receipt route", () => {
    const item = createOfflineQueueItem({
      userId: "operator_demo",
      actionType: "incident_report",
      endpoint: "/api/ops/incidents/reports",
      method: "POST",
      payload: {
        report: {
          schema_version: "mnemosyne-incident-response-v0.1",
          id: "incident_local_preview"
        },
        manifest: {
          key: "incidents/production/incident_local_preview.json"
        }
      },
      payloadScope: "ops",
      idempotencyKey: "legacy-incident-report-receipt"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/offline/actions/sync",
        body: { item },
        directDomainWrite: false
      })
    );
  });

  it("routes backend-compatible privacy export jobs to the privacy export endpoint", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "privacy_operation",
      endpoint: "/api/privacy/export/jobs",
      method: "POST",
      payload: {
        userId: "user_demo",
        idempotencyKey: "user_demo:privacy_export:2026-06-30T20:00:00.000Z"
      },
      payloadScope: "privacy",
      idempotencyKey: "privacy-export-domain-write"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787/", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/privacy/export/jobs",
        method: "POST",
        body: item.payload,
        directDomainWrite: true
      })
    );
  });

  it("routes backend-compatible privacy deletion queue items with DELETE", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "privacy_operation",
      endpoint: "/api/privacy/data",
      method: "DELETE",
      payload: {
        userId: "user_demo",
        scope: "voice",
        confirmation: "DELETE"
      },
      payloadScope: "privacy",
      idempotencyKey: "privacy-delete-domain-write"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787/", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/privacy/data",
        method: "DELETE",
        body: item.payload,
        directDomainWrite: true
      })
    );
  });

  it("routes confirmed account deletion queue items with DELETE", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "privacy_operation",
      endpoint: "/api/privacy/data",
      method: "DELETE",
      payload: {
        userId: "user_demo",
        scope: "account",
        confirmation: "DELETE"
      },
      payloadScope: "privacy",
      idempotencyKey: "privacy-account-delete-domain-write"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787/", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/privacy/data",
        method: "DELETE",
        body: item.payload,
        directDomainWrite: true
      })
    );
  });

  it("keeps legacy privacy operation payloads on the offline receipt route", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "privacy_operation",
      endpoint: "/api/privacy/data",
      method: "DELETE",
      payload: {
        scope: "voice",
        confirmation_pending: true
      },
      payloadScope: "privacy",
      idempotencyKey: "legacy-privacy-receipt"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/offline/actions/sync",
        method: "POST",
        body: { item },
        directDomainWrite: false
      })
    );
  });
});
