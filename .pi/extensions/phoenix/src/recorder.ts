import {
  type Context,
  ROOT_CONTEXT,
  type Span,
  SpanStatusCode,
  type Tracer,
  TraceFlags,
  trace,
} from "@opentelemetry/api";
import {
  baseAttributes,
  type Identity,
  inputAttributes,
  modelAttributes,
  outputAttributes,
  type PiUsage,
  type SpanAttributes,
  type SpanKind,
  usageAttributes,
} from "./attributes.ts";
import {
  ENV_PARENT_DEPTH,
  ENV_PARENT_SESSION_ID,
  ENV_PARENT_SPAN_ID,
  ENV_PARENT_TRACE_ID,
  formatTraceparent,
  type InheritedParent,
} from "./parent.ts";
import { createSecretRedactor } from "./redact.ts";
import { truncateText } from "./text.ts";

export interface RecorderOptions {
  tracer: Tracer;
  identity: Identity;
  maxChars: number;
  inherited?: InheritedParent | undefined;
  env?: NodeJS.ProcessEnv;
  secrets?: readonly string[];
}

export interface LlmStart {
  input?: string;
  model?: string;
  provider?: string;
  linked: boolean;
}

export interface LlmEnd {
  output?: string;
  model?: string;
  usage?: PiUsage | undefined;
  error?: string | undefined;
}

interface Scope {
  span: Span;
  context: Context;
}

const PARENT_KEYS = [
  ENV_PARENT_TRACE_ID,
  ENV_PARENT_SPAN_ID,
  ENV_PARENT_SESSION_ID,
  ENV_PARENT_DEPTH,
] as const;

export class Recorder {
  private readonly env: NodeJS.ProcessEnv;
  private readonly redact: (value: unknown) => unknown;
  private readonly savedEnv: ReadonlyArray<readonly [string, string | undefined]>;
  private session: Scope | undefined;
  private agent: Scope | undefined;
  private turn: Scope | undefined;
  private llm: (Scope & { linked: boolean }) | undefined;
  private readonly tools = new Map<string, Scope>();

  constructor(private readonly options: RecorderOptions) {
    this.env = options.env ?? process.env;
    this.redact = createSecretRedactor(...(options.secrets ?? []));
    this.savedEnv = PARENT_KEYS.map((key) => [key, this.env[key]] as const);
  }

  beginAgent(prompt: string): void {
    if (this.agent) this.endAgent({ cancelled: true });
    this.session ??= this.start("pi session", this.remoteParent(), "AGENT", {});
    this.agent = this.start("agent", this.session.context, "AGENT", inputAttributes(this.clean(prompt)));
    this.publishParent(this.agent);
  }

  beginTurn(index: number): void {
    if (!this.agent) return;
    if (this.turn) finish(this.turn, {});
    this.turn = this.start(`turn ${index}`, this.agent.context, "CHAIN", { "pi.turn.index": index });
  }

  beginLlm(info: LlmStart): void {
    const parent = this.turn ?? this.agent;
    if (!parent) return;
    if (this.llm) finish(this.llm, {}, "Superseded by provider retry");
    const extra = {
      ...inputAttributes(this.clean(info.input)),
      ...modelAttributes(info.model, info.provider),
    };
    const kind = info.linked ? "CHAIN" : "LLM";
    this.llm = { ...this.start("LLM Call", parent.context, kind, extra), linked: info.linked };
  }

  traceparent(): string | undefined {
    if (!this.llm?.linked) return undefined;
    const ids = this.llm.span.spanContext();
    return formatTraceparent(ids.traceId, ids.spanId);
  }

  requestHeaders(): Record<string, string> {
    const traceparent = this.traceparent();
    if (!traceparent) return {};
    const sessionId = this.options.identity.sessionId;
    return { traceparent, "x-litellm-session-id": sessionId };
  }

  endLlm(info: LlmEnd): void {
    if (!this.llm) return;
    const own = this.llm.linked
      ? {}
      : { ...usageAttributes(info.usage), ...modelAttributes(info.model, undefined) };
    finish(this.llm, { ...outputAttributes(this.clean(info.output)), ...own }, info.error);
    this.llm = undefined;
  }

  beginTool(id: string, name: string, args: unknown): void {
    const parent = this.turn ?? this.agent;
    if (!parent) return;
    const redacted = this.redact(args);
    const text = typeof redacted === "string" ? redacted : JSON.stringify(redacted);
    const extra = { ...inputAttributes(this.clean(text)), "tool.name": name, "pi.tool.call_id": id };
    this.tools.set(id, this.start(`tool ${name}`, parent.context, "TOOL", extra));
  }

  endTool(id: string, output: string, isError: boolean): void {
    const scope = this.tools.get(id);
    if (!scope) return;
    this.tools.delete(id);
    finish(scope, outputAttributes(this.clean(output)), isError ? "Tool execution failed" : undefined);
  }

  endTurn(): void {
    if (!this.turn) return;
    finish(this.turn, {});
    this.turn = undefined;
  }

  endAgent(opts: { cancelled: boolean; output?: string; error?: boolean }): void {
    if (!this.agent) return;
    this.closeDangling("interrupted");
    const extra: SpanAttributes = {
      ...outputAttributes(this.clean(opts.output)),
      ...(opts.cancelled ? { "pi.cancelled": true } : {}),
    };
    finish(this.agent, extra, opts.error ? "Agent run failed" : undefined);
    this.agent = undefined;
    this.withdrawParent();
  }

  endSession(): void {
    this.endAgent({ cancelled: true });
    if (this.session) finish(this.session, {});
    this.session = undefined;
  }

  private clean(text: string | undefined): string | undefined {
    if (!text) return undefined;
    const redacted = this.redact(text);
    return truncateText(typeof redacted === "string" ? redacted : "", this.options.maxChars).text;
  }

  private start(name: string, parent: Context, kind: SpanKind, extra: SpanAttributes): Scope {
    const attributes = { ...baseAttributes(kind, this.options.identity), ...extra };
    const span = this.options.tracer.startSpan(name, { attributes }, parent);
    return { span, context: trace.setSpan(ROOT_CONTEXT, span) };
  }

  private remoteParent(): Context {
    const inherited = this.options.inherited;
    if (!inherited) return ROOT_CONTEXT;
    return trace.setSpanContext(ROOT_CONTEXT, {
      traceId: inherited.traceId,
      spanId: inherited.spanId,
      traceFlags: TraceFlags.SAMPLED,
      isRemote: true,
    });
  }

  private publishParent(scope: Scope): void {
    const ids = scope.span.spanContext();
    this.env[ENV_PARENT_TRACE_ID] = ids.traceId;
    this.env[ENV_PARENT_SPAN_ID] = ids.spanId;
    this.env[ENV_PARENT_SESSION_ID] = this.options.identity.sessionId;
    this.env[ENV_PARENT_DEPTH] = String((this.options.inherited?.depth ?? 0) + 1);
  }

  private withdrawParent(): void {
    for (const [key, value] of this.savedEnv) {
      if (value === undefined) delete this.env[key];
      else this.env[key] = value;
    }
  }

  private closeDangling(reason: string): void {
    for (const scope of this.tools.values()) finish(scope, {}, `Tool run ${reason}`);
    this.tools.clear();
    if (this.llm) finish(this.llm, {}, `LLM call ${reason}`);
    this.llm = undefined;
    if (this.turn) finish(this.turn, {}, `Turn ${reason}`);
    this.turn = undefined;
  }
}

function finish(scope: Scope, extra: SpanAttributes, error?: string): void {
  scope.span.setAttributes(extra);
  if (error) scope.span.setStatus({ code: SpanStatusCode.ERROR, message: error });
  scope.span.end();
}
