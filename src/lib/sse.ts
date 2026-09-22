/** SSE Response 工廠：心跳 + abort 清理 */
export function sseResponse(
  setup: (
    send: (obj: unknown) => void,
    signal: AbortSignal,
  ) => void | Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const heartbeat = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            closed = true;
          }
        }
      }, 25000);

      const ac = new AbortController();
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {}
      };
      ac.signal.addEventListener("abort", cleanup);

      try {
        await setup(send, ac.signal);
      } catch (e) {
        console.error("SSE setup error", e);
      }
      if (closed) return;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
