import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities.ts";

async function main() {
  const address = process.env.TEMPORAL_ADDRESS || "127.0.0.1:7233";
  const namespace = process.env.TEMPORAL_NAMESPACE || "default";
  const connection = await NativeConnection.connect({ address });

  const workflowsPath = new URL("./workflows.ts", import.meta.url).pathname;

  const [cloudWorker, gpuWorker, browserWorker] = await Promise.all([
    Worker.create({
      connection,
      namespace,
      taskQueue: "cloud-io",
      workflowsPath,
      activities,
      maxConcurrentActivityTaskExecutions: 8,
    }),
    Worker.create({
      connection,
      namespace,
      taskQueue: "local-gpu",
      workflowsPath,
      activities,
      maxConcurrentActivityTaskExecutions: 1, // Protects 8 GB RTX 3070 Ti VRAM (-np 1 / YuE2)
    }),
    Worker.create({
      connection,
      namespace,
      taskQueue: "host-browser",
      workflowsPath,
      activities,
      maxConcurrentActivityTaskExecutions: 2, // Matches Dokobot max-2-tabs guardrail
    }),
  ]);

  console.log(`[Sosho Worker] Connected to Temporal at ${address} (queues: cloud-io[8], local-gpu[1], host-browser[2])`);
  await Promise.all([cloudWorker.run(), gpuWorker.run(), browserWorker.run()]);
}

main().catch((err) => {
  console.error("[Sosho Worker] Fatal error:", err);
  process.exit(1);
});
