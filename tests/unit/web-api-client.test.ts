import { fetchAppBootstrap, type AppBootstrapPayload } from "../../apps/web/src/apiClient";
import { demoUser } from "@mnemosyne/demo-fixtures";
import { describe, expect, it, vi } from "vitest";

describe("web API client", () => {
  it("fetches app bootstrap envelopes from the configured API", async () => {
    const payload: Partial<AppBootstrapPayload> = {
      user: demoUser,
      goals: [],
      readiness: {
        sleep_quality: 0.8,
        fatigue: 0.2,
        stress: 0.2,
        available_minutes_morning: 20,
        available_minutes_evening: 15,
        screen_budget_minutes: 30,
        voice_ok: true,
        dusk_mode: false
      },
      user_graph: { userId: demoUser.id, states: [] },
      audio_plan: {
        id: "audio_plan_demo",
        user_id: demoUser.id,
        duration_seconds: 120,
        layers: [],
        render_status: "pending",
        created_at: "2026-06-30T08:00:00.000Z"
      },
      daily_packet_source: "missing",
      packs: [],
      installed_packs: []
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, data: payload }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    const bootstrap = await fetchAppBootstrap({
      baseUrl: "http://127.0.0.1:8787",
      userId: demoUser.id
    });

    expect(bootstrap.user.id).toBe(demoUser.id);
    expect(bootstrap.audio_plan?.id).toBe("audio_plan_demo");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/app/bootstrap");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("generateMissingPacket=true");
    fetchMock.mockRestore();
  });

  it("surfaces API envelope errors", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: { code: "missing", message: "No user" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(
      fetchAppBootstrap({
        baseUrl: "http://127.0.0.1:8787",
        userId: "missing_user"
      })
    ).rejects.toThrow("No user");

    fetchMock.mockRestore();
  });
});
