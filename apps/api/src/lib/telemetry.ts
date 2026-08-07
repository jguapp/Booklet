/**
 * OpenTelemetry tracing, exported over OTLP.
 *
 * Vendor-neutral on purpose: Datadog is a first-class OTLP backend, so
 * pointing at it is configuration (OTEL_EXPORTER_OTLP_ENDPOINT) rather than
 * code, and moving to Grafana/Tempo or Honeycomb later is the same one
 * variable. Datadog's own dd-trace would be marginally simpler and slightly
 * deeper on Datadog-specific features; portability was judged worth more.
 *
 * Sentry stays: it tracks errors, this tracks latency. They answer different
 * questions and neither replaces the other.
 *
 * No-op without OTEL_EXPORTER_OTLP_ENDPOINT, matching how REDIS_URL,
 * SENTRY_DSN, and RESEND_API_KEY already behave -- absent means the feature
 * is off, never an error, so nothing here is a prerequisite for running the
 * app locally or in CI.
 *
 * Manual instrumentation only -- deliberately no @opentelemetry/auto-
 * instrumentations-node. Auto-instrumentation works by patching modules as
 * they load, which under Node ESM needs a loader hook installed before any
 * instrumented module is imported. This app is ESM *and* bundled by esbuild
 * for production (see scripts/build.mjs), which flattens the import graph
 * into one file -- so there is no reliable "before" for a hook to run in, and
 * an auto-instrumentation that silently patches nothing is worse than none at
 * all: the traces still appear, just missing the spans you were relying on.
 * The spans this app actually needs (queue wait vs. generation, cache tier)
 * are ones auto-instrumentation could never produce anyway, since they're
 * internal to the TTS pool rather than a library boundary.
 */
import { trace, type Span, type Tracer } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || "booklet-api";

let provider: NodeTracerProvider | null = null;

export function isTelemetryEnabled(): boolean {
  return provider !== null;
}

/**
 * Safe to call more than once (tests build several app instances); only the
 * first call installs a provider.
 */
export function initTelemetry(): void {
  if (provider) return;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? "0.0.0",
      "deployment.environment.name": process.env.NODE_ENV ?? "development",
    }),
    spanProcessors: [
      // Batched, not simple: a span export is a network call, and doing one
      // synchronously per span would add exactly the kind of latency this
      // exists to measure.
      new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, "")}/v1/traces` })),
    ],
  });
  provider.register();
}

export async function shutdownTelemetry(): Promise<void> {
  if (!provider) return;
  // Flushes whatever the batch processor is still holding. Without this a
  // clean shutdown drops the last few seconds of spans -- which are usually
  // the interesting ones, since something just made the process exit.
  await provider.shutdown().catch(() => {});
  provider = null;
}

export function tracer(): Tracer {
  return trace.getTracer(SERVICE_NAME);
}

/**
 * Runs `fn` inside a span, recording a thrown error on it before rethrowing.
 * Returns fn's result untouched, so wrapping a call never changes behavior --
 * including when telemetry is off, where the no-op tracer makes this a thin
 * pass-through.
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer().startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}
