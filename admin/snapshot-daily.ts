export const config = { runtime: "edge" };

export default async function handler() {
  const env = typeof process !== "undefined" ? (process.env as any) : {};
  const SUPABASE_URL = env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  const MIN_REQS_THRESHOLD = Number(env.MIN_REQS_THRESHOLD ?? "0");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(
      JSON.stringify({
        error: "Missing Supabase envs in snapshot-daily",
      }),
      { status: 500 }
    );
  }

  const readUrl = `${SUPABASE_URL}/rest/v1/mv_metrics_daily` +
    `?select=day,event_name,total_requests,p95_response_time`;

  const read = await fetch(readUrl, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!read.ok) {
    const detail = await read.text().catch(() => "");
    return new Response(
      JSON.stringify({
        error: "Supabase read failed",
        status: read.status,
        detail: detail.slice(0, 1000),
      }),
      { status: 502 }
    );
  }

  const raw = await read.text().catch(() => "");
  let rows: any[] = [];
  try {
    rows = raw ? JSON.parse(raw) : [];
  } catch (e: any) {
    return new Response(
      JSON.stringify({
        error: "Snapshot JSON parse failed",
        message: e?.message ?? String(e),
        preview: raw.slice(0, 500),
      }),
      { status: 502 }
    );
  }

  const filtered = rows.filter(
    (r) => (r.total_requests ?? 0) >= MIN_REQS_THRESHOLD
  );

  if (!filtered.length) {
    return new Response(
      JSON.stringify({
        ok: true,
        inserted: 0,
        note: "No rows >= MIN_REQS_THRESHOLD",
      }),
      { status: 200 }
    );
  }

  const writeUrl = `${SUPABASE_URL}/rest/v1/metrics_snapshots` +
    `?on_conflict=day,event_name`;

  const write = await fetch(writeUrl, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(
      filtered.map((r) => ({
        day: r.day,
        event_name: r.event_name,
        total_requests: r.total_requests,
        p95_response_time: r.p95_response_time,
      }))
    ),
  });

  if (!write.ok) {
    const detail = await write.text().catch(() => "");
    return new Response(
      JSON.stringify({
        error: "Supabase write failed",
        status: write.status,
        detail: detail.slice(0, 1000),
      }),
      { status: 502 }
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      inserted: filtered.length,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    }
  );
}
