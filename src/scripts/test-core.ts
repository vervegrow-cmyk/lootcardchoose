import { spawnSync } from "node:child_process";

const COMMANDS = [
  "npm run build",
  "npm run gallery:test-search",
  "npm run gallery:test-select",
  "npm run shopify:webhook:test",
];

for (const command of COMMANDS) {
  console.log(`[TEST CORE] running=${command}`);
  const result = spawnSync(command, {
    cwd: process.cwd(),
    shell: true,
    stdio: "inherit",
  });

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.error) {
    console.error("[TEST CORE] failed", result.error);
    process.exit(1);
  }
}
