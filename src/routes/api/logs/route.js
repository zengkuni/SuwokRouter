import { searchLogs } from "@/lib/usageDb.js";

export async function GET(request) {
  const url = new URL(request.url);
  const qp = url.searchParams;

  const result = await searchLogs({
    page:     qp.get("page")     || 1,
    limit:    qp.get("limit")    || 50,
    provider: qp.get("provider") || undefined,
    model:    qp.get("model")    || undefined,
    status:   qp.get("status")   || undefined,
    q:        qp.get("q")        || undefined,
  });

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
}
