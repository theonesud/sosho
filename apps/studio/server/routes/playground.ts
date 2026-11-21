import { Hono } from "hono";
import { z } from "zod";
import { type ChatMessage, chatCompletionStream } from "@sosho/llm";
import { executeNodeActivity } from "@sosho/workflow-engine/activities";
import { parseValidatedBody, type StudioContext } from "../context.ts";

const chatSchema = z.object({
  role: z.string().min(1),
  systemPrompt: z.string().optional(),
  prompt: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(32768).optional(),
});

const compareSchema = z.object({
  roles: z.tuple([z.string().min(1), z.string().min(1)]),
  systemPrompt: z.string().optional(),
  prompt: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(32768).optional(),
});

const skillSchema = z.object({
  skillName: z.string().min(1),
  prompt: z.string().min(1),
});

function buildMessages(prompt: string, systemPrompt?: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (systemPrompt?.trim()) {
    messages.push({ role: "system", content: systemPrompt.trim() });
  }
  messages.push({ role: "user", content: prompt });
  return messages;
}

export function createPlaygroundRoutes(ctx: StudioContext): Hono {
  const app = new Hono();

  app.post("/chat", async (c) => {
    const body = await parseValidatedBody(c, chatSchema);
    const messages = buildMessages(body.prompt, body.systemPrompt);
    const encoder = new TextEncoder();
    const ac = new AbortController();

    const onAbort = () => ac.abort();
    c.req.raw.signal.addEventListener("abort", onAbort, { once: true });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (payload: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          } catch {
            // stream closed
          }
        };

        try {
          if (ctx.langflowUrl) {
            const lfRes = await fetch(`${ctx.langflowUrl}/api/v1/run/default`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                input_value: body.prompt,
                output_type: "chat",
                input_type: "chat",
                tweaks: { role: body.role, systemPrompt: body.systemPrompt },
              }),
              signal: ac.signal,
            });
            if (!lfRes.ok) {
              throw new Error(`Langflow HTTP ${lfRes.status}`);
            }
            const lfData = (await lfRes.json()) as { result?: string; outputs?: Array<{ outputs?: Array<{ results?: { message?: { text?: string } } }> }> };
            const text =
              lfData.result ||
              lfData.outputs?.[0]?.outputs?.[0]?.results?.message?.text ||
              "";
            if (text) send({ type: "delta", content: text });
            send({ type: "done", content: text, provider: "langflow", model: body.role, durationMs: 0, fallbackUsed: false });
          } else {
            for await (const ev of chatCompletionStream({
              role: body.role,
              messages,
              temperature: body.temperature,
              maxTokens: body.maxTokens,
              cwd: ctx.root,
              soshoRoot: ctx.root,
              signal: ac.signal,
              traceName: "studio.playground.chat",
            })) {
              send(ev as unknown as Record<string, unknown>);
            }
          }
        } catch (err) {
          if (!ac.signal.aborted) {
            send({ type: "error", message: err instanceof Error ? err.message : String(err) });
          }
        } finally {
          c.req.raw.signal.removeEventListener("abort", onAbort);
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      },
      cancel() {
        ac.abort();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  app.post("/compare", async (c) => {
    const body = await parseValidatedBody(c, compareSchema);
    const messages = buildMessages(body.prompt, body.systemPrompt);
    const encoder = new TextEncoder();
    const ac = new AbortController();

    const onAbort = () => ac.abort();
    c.req.raw.signal.addEventListener("abort", onAbort, { once: true });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (payload: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          } catch {
            // stream closed
          }
        };

        const runSlot = async (slot: 0 | 1, role: string) => {
          try {
            for await (const ev of chatCompletionStream({
              role,
              messages,
              temperature: body.temperature,
              maxTokens: body.maxTokens,
              cwd: ctx.root,
              soshoRoot: ctx.root,
              signal: ac.signal,
              traceName: `studio.playground.compare.${slot}`,
            })) {
              send({ ...(ev as unknown as Record<string, unknown>), slot, role });
            }
          } catch (err) {
            if (!ac.signal.aborted) {
              send({
                type: "error",
                slot,
                role,
                message: err instanceof Error ? err.message : String(err),
              });
            }
          }
        };

        try {
          await Promise.all([runSlot(0, body.roles[0]), runSlot(1, body.roles[1])]);
        } finally {
          c.req.raw.signal.removeEventListener("abort", onAbort);
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      },
      cancel() {
        ac.abort();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  app.post("/skill", async (c) => {
    const body = await parseValidatedBody(c, skillSchema);
    const t0 = Date.now();
    const result = await executeNodeActivity({
      node: {
        id: "playground-skill",
        type: "skill",
        label: body.skillName,
        skillName: body.skillName,
        promptTemplate: body.prompt,
        tier: "main",
        outputKey: "output",
      },
      data: {},
      cwd: ctx.root,
      signal: c.req.raw.signal,
    });
    return c.json({
      output: result.value,
      preview: result.preview,
      durationMs: Date.now() - t0,
    });
  });

  return app;
}
