export const config = { runtime: 'edge' };
type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ALLOWED_ORIGINS?: string;
};
function cors(origin: string | null, allowed: string[]) {
  const ok = origin && allowed.some(a => a.trim().toLowerCase() === origin.toLowerCase());
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Vary": "Origin"
  };
  if (ok) headers["Access-Control-Allow-Origin"] = origin!;
  return headers;
}
export default async function handler(req: Request) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALLOWED_ORIGINS } = process.env as unknown as Env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Missing Supabase envs" }), { status: 500 });
  }
  const allowed = (ALLOWED_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(origin, allowed) });
  }
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors(origin, allowed) });
  }
  const url = `${SUPABASE_URL}/rest/v1/mv_metrics_daily?select=*`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    },
    cache: "no-store"
  });
  if (!res.ok) {
    const text = await res.text();
    return new Response(JSON.stringify({ error: "Supabase error", detail: text }), { status: 502, headers: cors(origin, allowed) });
  }
  const data = await res.json();
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors(origin, allowed) }
  });
}
