import { runMigrationsFromEnv } from "./runtime";

const result = await runMigrationsFromEnv();
console.log(JSON.stringify({ service: "mnemosyne-api", migrations: result }));
