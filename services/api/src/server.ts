import { runApiServerFromEnv } from "./runtime";

const runtime = await runApiServerFromEnv();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void runtime.close().finally(() => process.exit(0));
  });
}
