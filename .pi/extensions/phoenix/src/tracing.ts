import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { AlwaysOnSampler, BatchSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import type { Tracer } from "@opentelemetry/api";
import { reportError, type PhoenixConfig } from "./config.ts";

const TRACER_NAME = "sosho-pi";
const EXPORT_TIMEOUT_MS = 3000;

export interface Tracing {
  tracer: Tracer;
  flush: (budgetMs: number) => Promise<void>;
  shutdown: (budgetMs: number) => Promise<void>;
}

async function within(work: () => Promise<unknown>, budgetMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, budgetMs);
    timer.unref();
  });
  try {
    await Promise.race([work().then(() => undefined), limit]);
  } catch (error) {
    reportError(error);
    return;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createTracing(config: PhoenixConfig): Tracing {
  const exporter = new OTLPTraceExporter({
    url: config.tracesUrl,
    timeoutMillis: EXPORT_TIMEOUT_MS,
  });
  const provider = new TracerProvider({
    resource: resourceFromAttributes({
      "openinference.project.name": config.projectName,
      "service.name": TRACER_NAME,
    }),
    sampler: new AlwaysOnSampler(),
    spanProcessors: [new BatchSpanProcessor({ exporter })],
  });
  return {
    tracer: provider.getTracer(TRACER_NAME),
    flush: (budgetMs) => within(() => provider.forceFlush(), budgetMs),
    shutdown: (budgetMs) => within(() => provider.shutdown(), budgetMs),
  };
}
