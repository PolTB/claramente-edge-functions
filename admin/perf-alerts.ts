export const config = { runtime: 'edge' };
type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ALLOWED_ORIGINS?: string;
  P95_THRESHOLD_MS?: string;
  SLACK_WEBHOOK_URL?: string;
};
function cors(origin: string | null, allowed: string[]) {
  const ok = origin && allowed.some(a => a.trim().toLowerCase() === origin.toLowerCase());
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Vary": "Origin"
  };
  if (ok) headers["Access-Control-Allow-Origin"] = origin!;
  return headers;
}
export default async function handler(req: Request) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALLOWED_ORIGINS, P95_THRESHOLD_MS, SLACK_WEBHOOK_URL } = process.env as unknown as Env;
  const allowed = (ALLOWED_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin, allowed) });
  const threshold = Number(P95_THRESHOLD_MS ?? "2000");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Missing Supabase envs" }), { status: 500 });
  }
  const url = `${SUPABASE_URL}/rest/v1/mv_metrics_15m?select=ts,flow,p95_ms&order=ts.desc&limit=4`;
  const r = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    },
    cache: "no-store"
  });
  if (!r.ok) {
    const text = await r.text();
    return new Response(JSON.stringify({ error: "Supabase error", detail: text }), { status: 502, headers: cors(origin, allowed) });
  }
  const rows: Array<{ ts: string; flow: string; p95_ms: number }> = await r.json();
  const worst = rows.reduce<{ ts: string; flow: string; p95_ms: number } | null>((acc, x) => {
    if (!acc || x.p95_ms > acc.p95_ms) return x;
    return acc;
  }, null);
  const breached = worst && worst.p95_ms >= threshold;
  if (breached && SLACK_WEBHOOK_URL) {
    const msg = { text: `⚠️ *Perf Alert* — p95=${worst!.p95_ms}ms (≥${threshold}ms) | flow=${worst!.flow} | ts=${worst!.ts}` };
    await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg)
    });
  }
  return new Response(JSON.stringify({ ok: true, checked_rows: rows.length, threshold_ms: threshold, breached, worst }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors(origin, allowed) }
  });
}
