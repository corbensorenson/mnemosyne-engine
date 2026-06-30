import { createWorkerServiceRuntime, runWorkerService, runWorkerServiceLoop } from "./runtime";

const runtime = await createWorkerServiceRuntime();
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
  });
}

console.log(
  JSON.stringify({
    service: "mnemosyne-worker",
    status: "starting",
    worker_id: runtime.config.workerId,
    mode: runtime.config.mode,
    queues: runtime.config.queues ?? "all_registered",
    storage: runtime.config.storage
  })
);

try {
  const result =
    runtime.config.mode === "loop"
      ? await runWorkerServiceLoop(runtime, () => stopping)
      : await runWorkerService(runtime);
  console.log(
    JSON.stringify({
      service: "mnemosyne-worker",
      status: "stopped",
      worker_id: runtime.config.workerId,
      result
    })
  );
} finally {
  await runtime.close();
}
