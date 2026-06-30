import { createApiHandlers, seedDemoStore } from "@mnemosyne/api";
import { demoUser } from "@mnemosyne/demo-fixtures";
import { createJob, type JobRecord } from "@mnemosyne/ops-core";
import { createPostgresStore, type SqlExecutor, type SqlQueryResult } from "@mnemosyne/persistence-core";
import { describe, expect, it } from "vitest";

type Envelope<T> = { ok: true; data: T; audit_event_id?: string } | { ok: false; error?: unknown };

type StoredRecord = {
  record_type: string;
  record_id: string;
  owner_id?: string;
  sort_key?: string;
  payload: unknown;
};

class MemorySqlExecutor implements SqlExecutor {
  readonly records = new Map<string, StoredRecord>();
  readonly statements: string[] = [];

  async query<TRow = Record<string, unknown>>(
    statement: string,
    params: readonly unknown[] = []
  ): Promise<SqlQueryResult<TRow>> {
    this.statements.push(statement);
    if (statement.includes("WITH candidate AS") && statement.includes("FOR UPDATE SKIP LOCKED")) {
      const [at, queues, handlerKeys, workerId] = params as [
        string,
        string[] | null,
        string[] | null,
        string
      ];
      const candidate = [...this.records.values()]
        .filter((record) => record.record_type === "job")
        .map((record) => ({ record, job: record.payload as JobRecord }))
        .filter(({ job }) => job.status === "queued" || job.status === "failed")
        .filter(({ job }) => job.attempts < job.max_attempts)
        .filter(({ job }) => Date.parse(job.run_after) <= Date.parse(at))
        .filter(({ job }) => !queues || queues.includes(job.queue))
        .filter(({ job }) => !handlerKeys || handlerKeys.includes(`${job.queue}:${job.type}`))
        .sort((left, right) => compareJobs(left.job, right.job))[0];
      if (!candidate) return rows([]);
      const running: JobRecord = {
        ...candidate.job,
        status: "running",
        attempts: candidate.job.attempts + 1,
        locked_at: at,
        locked_by: workerId,
        last_error: undefined,
        updated_at: at
      };
      candidate.record.payload = running;
      return rows([{ payload: running }]);
    }

    if (statement.startsWith("INSERT INTO mnemosyne_records")) {
      const [recordType, recordId, ownerId, sortKey, payload] = params as [
        string,
        string,
        string | undefined,
        string | undefined,
        string
      ];
      const parsedPayload = JSON.parse(payload) as unknown;
      this.records.set(key(recordType, recordId), {
        record_type: recordType,
        record_id: recordId,
        owner_id: ownerId,
        sort_key: sortKey,
        payload: parsedPayload
      });
      return rows([{ payload: parsedPayload }]);
    }

    if (statement.includes("WHERE record_type = $1 AND record_id = $2")) {
      const [recordType, recordId] = params as [string, string];
      const record = this.records.get(key(recordType, recordId));
      return rows(record ? [{ payload: record.payload }] : []);
    }

    if (statement.includes("WHERE record_type = $1 AND owner_id = $2")) {
      const [recordType, ownerId] = params as [string, string];
      return rows(
        [...this.records.values()]
          .filter((record) => record.record_type === recordType && record.owner_id === ownerId)
          .sort(bySortKeyDesc)
          .map((record) => ({ payload: record.payload }))
      );
    }

    if (statement.includes("WHERE record_type = $1 ORDER BY")) {
      const [recordType] = params as [string];
      return rows(
        [...this.records.values()]
          .filter((record) => record.record_type === recordType)
          .sort(bySortKeyDesc)
          .map((record) => ({ payload: record.payload }))
      );
    }

    if (statement.includes("record_id = ANY")) {
      const [recordType, recordIds] = params as [string, string[]];
      const deleted = recordIds
        .filter((recordId) => this.records.delete(key(recordType, recordId)))
        .map((recordId) => ({ record_id: recordId }));
      return rows(deleted);
    }

    if (statement.includes("DELETE FROM mnemosyne_records") && statement.includes("owner_id = $2")) {
      const [recordType, ownerId] = params as [string, string];
      const deleted: Array<{ record_id: string }> = [];
      for (const record of [...this.records.values()]) {
        if (record.record_type !== recordType || record.owner_id !== ownerId) continue;
        this.records.delete(key(record.record_type, record.record_id));
        deleted.push({ record_id: record.record_id });
      }
      return rows(deleted);
    }

    throw new Error(`Unhandled SQL in test executor: ${statement}`);
  }
}

describe("PostgresMnemosyneStore", () => {
  it("persists API state through the driver-agnostic Postgres record adapter", async () => {
    const sql = new MemorySqlExecutor();
    const store = createPostgresStore(sql);
    await seedDemoStore(store);
    const handlers = createApiHandlers(store);

    const generated = unwrap(await handlers.generateDailyPacket({ userId: demoUser.id }));
    const persisted = unwrap(await handlers.getTodayPacket(demoUser.id, generated.packet.date));
    const exportBundle = unwrap(await handlers.exportUserData({ userId: demoUser.id }));
    const systemBackup = await store.exportSystemData();

    expect(persisted.packet.id).toBe(generated.packet.id);
    expect(exportBundle.user?.id).toBe(demoUser.id);
    expect(exportBundle.daily_packets.map((packet) => packet.id)).toContain(generated.packet.id);
    expect(systemBackup.schema_version).toBe("mnemosyne-system-backup-v0.1");
    expect(systemBackup.counts.users).toBe(1);
    expect(systemBackup.users.map((bundle) => bundle.user_id)).toContain(demoUser.id);
    expect(sql.records.has(`daily_packet:${demoUser.id}:${generated.packet.date}`)).toBe(true);
    expect(sql.statements.every((statement) => !statement.includes(demoUser.id))).toBe(true);
  });

  it("preserves privacy deletion semantics on the Postgres adapter", async () => {
    const sql = new MemorySqlExecutor();
    const store = createPostgresStore(sql);
    await seedDemoStore(store);
    const handlers = createApiHandlers(store);

    await store.appendLearningEvent({
      user_id: demoUser.id,
      event_type: "assessment_answered",
      payload: {
        transcript: "spoken private answer",
        nested: { raw_voice_audio_url: "https://audio.example/private.wav" }
      }
    });

    const voiceDeletion = unwrap(
      await handlers.deleteUserData({
        userId: demoUser.id,
        scope: "voice",
        confirmation: "DELETE"
      })
    );
    const exportBundle = unwrap(await handlers.exportUserData({ userId: demoUser.id }));

    expect(voiceDeletion.counts.voice_payloads_scrubbed).toBe(1);
    expect(JSON.stringify(exportBundle.learning_events)).not.toContain("spoken private answer");
    expect(JSON.stringify(exportBundle.learning_events)).toContain("[deleted]");
  });

  it("claims the next runnable handled job through the Postgres record adapter", async () => {
    const sql = new MemorySqlExecutor();
    const store = createPostgresStore(sql);
    const createdAt = "2026-06-30T10:00:00.000Z";
    const delayed = await store.saveJob(
      createJob({
        queue: "scheduler",
        type: "generate_daily_packet",
        payload: { user_id: demoUser.id, variant: "delayed" },
        priority: "critical",
        runAfter: "2026-06-30T12:00:00.000Z",
        idempotencyKey: "delayed",
        createdAt
      })
    );
    const unhandled = await store.saveJob(
      createJob({
        queue: "scheduler",
        type: "unregistered_job",
        payload: { user_id: demoUser.id },
        priority: "critical",
        idempotencyKey: "unhandled",
        createdAt
      })
    );
    const normal = await store.saveJob(
      createJob({
        queue: "scheduler",
        type: "generate_daily_packet",
        payload: { user_id: demoUser.id, variant: "normal" },
        priority: "normal",
        idempotencyKey: "normal",
        createdAt: "2026-06-30T10:01:00.000Z"
      })
    );
    const high = await store.saveJob(
      createJob({
        queue: "scheduler",
        type: "generate_daily_packet",
        payload: { user_id: demoUser.id, variant: "high" },
        priority: "high",
        idempotencyKey: "high",
        createdAt: "2026-06-30T10:02:00.000Z"
      })
    );

    const claimed = await store.claimNextRunnableJob({
      workerId: "worker-scheduler",
      queues: ["scheduler"],
      handlerKeys: ["scheduler:generate_daily_packet"],
      at: "2026-06-30T10:05:00.000Z"
    });

    expect(claimed).toEqual(
      expect.objectContaining({
        id: high.id,
        status: "running",
        attempts: 1,
        locked_by: "worker-scheduler",
        locked_at: "2026-06-30T10:05:00.000Z"
      })
    );
    expect((await store.getJob(delayed.id))?.status).toBe("queued");
    expect((await store.getJob(unhandled.id))?.status).toBe("queued");
    expect((await store.getJob(normal.id))?.status).toBe("queued");
    expect(sql.statements.some((statement) => statement.includes("FOR UPDATE SKIP LOCKED"))).toBe(true);
  });
});

function unwrap<T>(envelope: Envelope<T>): T {
  if (!envelope.ok) throw new Error(`Expected ok envelope: ${JSON.stringify(envelope.error)}`);
  return envelope.data;
}

function rows<TRow>(value: unknown[]): SqlQueryResult<TRow> {
  return { rows: value as TRow[] };
}

function key(recordType: string, recordId: string): string {
  return `${recordType}:${recordId}`;
}

function bySortKeyDesc(left: StoredRecord, right: StoredRecord): number {
  return (right.sort_key ?? "").localeCompare(left.sort_key ?? "");
}

function compareJobs(left: JobRecord, right: JobRecord): number {
  const priorityDelta = priorityRank(right.priority) - priorityRank(left.priority);
  if (priorityDelta !== 0) return priorityDelta;
  const runAfterDelta = left.run_after.localeCompare(right.run_after);
  if (runAfterDelta !== 0) return runAfterDelta;
  return left.created_at.localeCompare(right.created_at);
}

function priorityRank(priority: JobRecord["priority"]): number {
  if (priority === "critical") return 3;
  if (priority === "high") return 2;
  if (priority === "normal") return 1;
  return 0;
}
