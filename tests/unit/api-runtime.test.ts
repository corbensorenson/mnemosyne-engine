import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configFromEnv,
  createApiRuntime,
  runMigrations,
  startApiRuntime,
  type ApiRuntimeConfig
} from "@mnemosyne/api";
import { demoUser } from "@mnemosyne/demo-fixtures";
import type { SqlExecutor, SqlQueryResult } from "@mnemosyne/persistence-core";
import { describe, expect, it } from "vitest";

type ApiJson = {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
};

class MigrationSqlExecutor implements SqlExecutor {
  applied = new Set<string>();
  executedSql: string[] = [];
  transactionLog: string[] = [];

  constructor(applied: string[] = []) {
    this.applied = new Set(applied);
  }

  async query<TRow = Record<string, unknown>>(
    statement: string,
    params: readonly unknown[] = []
  ): Promise<SqlQueryResult<TRow>> {
    if (statement.startsWith("CREATE TABLE IF NOT EXISTS mnemosyne_migrations")) return rows([]);
    if (statement === "SELECT filename FROM mnemosyne_migrations") {
      return rows([...this.applied].map((filename) => ({ filename })));
    }
    if (statement === "BEGIN" || statement === "COMMIT" || statement === "ROLLBACK") {
      this.transactionLog.push(statement);
      return rows([]);
    }
    if (statement === "INSERT INTO mnemosyne_migrations (filename) VALUES ($1)") {
      this.applied.add(params[0] as string);
      return rows([]);
    }

    this.executedSql.push(statement);
    return rows([]);
  }
}

describe("API runtime", () => {
  it("derives deployment config from environment", () => {
    const config = configFromEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://example",
      HOST: "127.0.0.1",
      PORT: "9999",
      MNEMOSYNE_RUN_MIGRATIONS: "true"
    });

    expect(config.environment).toBe("production");
    expect(config.storage).toBe("postgres");
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(9999);
    expect(config.seedDemo).toBe(false);
    expect(config.runMigrations).toBe(true);
  });

  it("starts the API runtime with health checks and seeded local state", async () => {
    const config: ApiRuntimeConfig = {
      host: "127.0.0.1",
      port: 0,
      environment: "local",
      storage: "memory",
      seedDemo: true,
      runMigrations: false,
      migrationsDir: "unused"
    };
    const runtime = await createApiRuntime(config);
    const baseUrl = await startApiRuntime(runtime);

    try {
      const health = await fetch(`${baseUrl}/healthz`);
      const healthBody = (await health.json()) as ApiJson;
      expect(health.status).toBe(200);
      expect(healthBody.data).toEqual(
        expect.objectContaining({
          service: "mnemosyne-api",
          status: "ok",
          environment: "local"
        })
      );

      const me = await fetch(`${baseUrl}/api/me?userId=${demoUser.id}`);
      const meBody = (await me.json()) as ApiJson;
      expect(me.status).toBe(200);
      expect(meBody.data?.id).toBe(demoUser.id);
    } finally {
      await close(runtime.server);
      await runtime.close();
    }
  });

  it("runs SQL migrations once in filename order", async () => {
    const migrationsDir = await mkdtemp(join(tmpdir(), "mnemosyne-migrations-"));
    const sql = new MigrationSqlExecutor(["0001_foundation.sql"]);
    await writeFile(join(migrationsDir, "0001_foundation.sql"), "SELECT 'skip 1';");
    await writeFile(join(migrationsDir, "0002_postgres_record_store.sql"), "SELECT 'apply 2';");
    await writeFile(join(migrationsDir, "0003_runtime.sql"), "SELECT 'apply 3';");

    try {
      const result = await runMigrations(sql, { migrationsDir });

      expect(result.skipped).toEqual(["0001_foundation.sql"]);
      expect(result.applied).toEqual(["0002_postgres_record_store.sql", "0003_runtime.sql"]);
      expect(sql.executedSql).toEqual(["SELECT 'apply 2';", "SELECT 'apply 3';"]);
      expect(sql.transactionLog).toEqual(["BEGIN", "COMMIT", "BEGIN", "COMMIT"]);
    } finally {
      await rm(migrationsDir, { recursive: true, force: true });
    }
  });
});

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function rows<TRow>(value: unknown[]): SqlQueryResult<TRow> {
  return { rows: value as TRow[] };
}
