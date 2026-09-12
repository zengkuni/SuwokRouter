import { createInflightStream } from "@/utils/inflight";

export async function GET(request) {
  const { stream, status, cleanup } = createInflightStream();

  if (status === 429 || !stream) {
    return new Response(
      JSON.stringify({ error: "Too many SSE connections", maxClients: 10 }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
  }

  request.signal?.addEventListener("abort", () => cleanup());

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
