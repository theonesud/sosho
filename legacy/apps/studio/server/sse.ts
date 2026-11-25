export class SseHub {
  private clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private encoder = new TextEncoder();
  private heartbeatTimer: ReturnType<typeof setInterval>;

  constructor(heartbeatMs = 15_000) {
    this.heartbeatTimer = setInterval(() => {
      this.sendRaw(": ping\n\n");
    }, heartbeatMs);
    this.heartbeatTimer.unref();
  }

  subscribe(): ReadableStream<Uint8Array> {
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        controllerRef = controller;
        this.clients.add(controller);
        try {
          controller.enqueue(this.encoder.encode(`data: ${JSON.stringify({ type: "connected" })}\n\n`));
        } catch {
          this.clients.delete(controller);
        }
      },
      cancel: () => {
        if (controllerRef) {
          this.clients.delete(controllerRef);
          controllerRef = null;
        }
      },
    });
  }

  broadcast(payload: Record<string, unknown>): void {
    this.sendRaw(`data: ${JSON.stringify(payload)}\n\n`);
  }

  broadcastQueueStats(stats: Record<string, unknown>): void {
    this.broadcast({ type: "queue_stats", ...stats, ts: Date.now() });
  }

  broadcastGpuState(gpu: Record<string, unknown>): void {
    this.broadcast({ type: "gpu_state", ...gpu, ts: Date.now() });
  }

  broadcastMusicJob(job: Record<string, unknown>): void {
    this.broadcast({ type: "music_job", ...job, ts: Date.now() });
  }

  clientCount(): number {
    return this.clients.size;
  }

  closeAll(): void {
    clearInterval(this.heartbeatTimer);
    for (const ctrl of this.clients) {
      try {
        ctrl.close();
      } catch {
        // ignore already closed streams
      }
    }
    this.clients.clear();
  }

  private sendRaw(chunk: string): void {
    const encoded = this.encoder.encode(chunk);
    for (const ctrl of this.clients) {
      try {
        ctrl.enqueue(encoded);
      } catch {
        this.clients.delete(ctrl);
      }
    }
  }
}
