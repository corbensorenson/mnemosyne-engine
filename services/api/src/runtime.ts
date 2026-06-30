import { readdir, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { Pool } from "pg";
import {
  createMemoryStore,
  createPostgresStore,
  type MnemosyneStore,
  type SqlExecutor
} from "@mnemosyne/persistence-core";
import { createApiHttpHandler } from "./http";
import { seedDemoStore } from "./seed";

export type ApiRuntimeEnvironment = "local" | "staging" | "production";
export type ApiStorageDriver = "memory" | "postgres";

export type ApiRuntimeConfig = {
  host: string;
  port: number;
  environment: ApiRuntimeEnvironment;
  storage: ApiStorageDriver;
  databaseUrl?: string;
  seedDemo: boolean;
  runMigrations: boolean;
  migrationsDir: string;
};

export type ApiRuntime = {
  server: Server;
  store: MnemosyneStore;
  config: ApiRuntimeConfig;
  close: () => Promise<void>;
};

export type MigrationResult = {
  applied: string[];
  skipped: string[];
};

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ApiRuntimeConfig {
  const environment = parseEnvironment(env.MNEMOSYNE_ENV ?? env.NODE_ENV);
  const databaseUrl = env.DATABASE_URL;
  const storage = parseStorage(env.MNEMOSYNE_STORAGE, databaseUrl);
  return {
    host: env.HOST ?? "0.0.0.0",
    port: parsePort(env.PORT),
    environment,
    storage,
    databaseUrl,
    seedDemo: parseBoolean(env.MNEMOSYNE_SEED_DEMO, storage === "memory"),
    runMigrations: parseBoolean(env.MNEMOSYNE_RUN_MIGRATIONS, false),
    migrationsDir: env.MNEMOSYNE_MIGRATIONS_DIR ?? resolve(process.cwd(), "infra/migrations")
  };
}

export async function createApiRuntime(config: ApiRuntimeConfig = configFromEnv()): Promise<ApiRuntime> {
  const { store, close } = await createConfiguredStore(config);
  if (config.seedDemo) await seedDemoStore(store);
  const handler = createApiHttpHandler({
    store,
    environment: config.environment
  });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  return { server, store, config, close };
}

export async function createConfiguredStore(config: ApiRuntimeConfig): Promise<{
  store: MnemosyneStore;
  close: () => Promise<void>;
}> {
  if (config.storage === "memory") {
    return {
      store: createMemoryStore(),
      close: async () => undefined
    };
  }

  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required when MNEMOSYNE_STORAGE=postgres.");
  }

  const pool = new Pool({ connectionString: config.databaseUrl });
  if (config.runMigrations) await runMigrations(pool, { migrationsDir: config.migrationsDir });
  return {
    store: createPostgresStore(pool),
    close: () => pool.end()
  };
}

export async function startApiRuntime(runtime: ApiRuntime): Promise<string> {
  await new Promise<void>((resolveStart, rejectStart) => {
    runtime.server.once("error", rejectStart);
    runtime.server.listen(runtime.config.port, runtime.config.host, () => {
      runtime.server.off("error", rejectStart);
      resolveStart();
    });
  });
  const address = runtime.server.address();
  if (address && typeof address !== "string") {
    const host = address.address === "0.0.0.0" || address.address === "::" ? "127.0.0.1" : address.address;
    return `http://${host}:${address.port}`;
  }
  return `http://${runtime.config.host}:${runtime.config.port}`;
}

export async function runApiServerFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<ApiRuntime> {
  const runtime = await createApiRuntime(configFromEnv(env));
  const url = await startApiRuntime(runtime);
  console.log(
    JSON.stringify({
      service: "mnemosyne-api",
      status: "listening",
      url,
      environment: runtime.config.environment,
      storage: runtime.config.storage
    })
  );
  return runtime;
}

export async function runMigrations(
  sql: SqlExecutor,
  options: { migrationsDir?: string } = {}
): Promise<MigrationResult> {
  const migrationsDir = options.migrationsDir ?? resolve(process.cwd(), "infra/migrations");
  await sql.query(`CREATE TABLE IF NOT EXISTS mnemosyne_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const existing = await sql.query<{ filename: string }>("SELECT filename FROM mnemosyne_migrations");
  const appliedSet = new Set(existing.rows.map((row) => row.filename));
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  const result: MigrationResult = { applied: [], skipped: [] };

  for (const file of files) {
    if (appliedSet.has(file)) {
      result.skipped.push(file);
      continue;
    }

    const sqlText = await readFile(resolve(migrationsDir, file), "utf8");
    await sql.query("BEGIN");
    try {
      await sql.query(sqlText);
      await sql.query("INSERT INTO mnemosyne_migrations (filename) VALUES ($1)", [file]);
      await sql.query("COMMIT");
      result.applied.push(file);
    } catch (error) {
      await sql.query("ROLLBACK");
      throw error;
    }
  }

  return result;
}

export async function runMigrationsFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<MigrationResult> {
  const config = configFromEnv({ ...env, MNEMOSYNE_STORAGE: "postgres" });
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required to run migrations.");
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    return await runMigrations(pool, { migrationsDir: config.migrationsDir });
  } finally {
    await pool.end();
  }
}

function parseEnvironment(value: string | undefined): ApiRuntimeEnvironment {
  if (value === "production" || value === "staging") return value;
  return "local";
}

function parseStorage(value: string | undefined, databaseUrl: string | undefined): ApiStorageDriver {
  if (value === "memory" || value === "postgres") return value;
  return databaseUrl ? "postgres" : "memory";
}

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? "8787");
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return 8787;
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
