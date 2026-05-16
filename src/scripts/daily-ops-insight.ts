import { OpsInsightAgent } from "../agents/ops-insight/ops-insight.agent";

const run = async (): Promise<void> => {
  const agent = new OpsInsightAgent();
  const result = await agent.run();

  console.log(
    `[OPS INSIGHT] report generated date=${result.date} health=${result.health} source=${result.logSource} path=${result.reportPath}`
  );
};

run().catch((error) => {
  console.error("[OPS INSIGHT] fatal error", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
