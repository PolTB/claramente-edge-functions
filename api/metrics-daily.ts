export const config = { runtime: 'edge' };

type Env = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ALLOWED_ORIGINS?: string;
};

function parseAllowed(originsCSV?: string) {
  return (originsCSV ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.toLowerCase());
}

function cors(origin: string | null, allowed: string[]) {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Vary': 'Origin',
  };
  if (origin && allowed.includes(origin.toLowerCase())) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export default async function handler(req: Request) {
  // 🔐 Acceso a envs SIEMPRE dentro del handler y protegido
  const env: Env = typeof process !== 'undefined' ? (process.env as unknown as Env) : {};
  const SUPABASE_URL = env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  const ALLOWED_ORIGINS = env.ALLOWED_ORIGINS;

  const origin = req.headers.get('Origin');
  const allowed = parseAllowed(ALLOWED_ORIGINS);

  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: cors(origin, allowed),
    });
  }

  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: cors(origin, allowed),
      }
    );
  }

  // Guard de envs (ahora NO revienta el runtime)
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(
      JSON.stringify({
        error: 'Missing Supabase envs inside Edge runtime',
        debug: {
          hasProcess: typeof process !== 'undefined',
          SUPABASE_URL: SUPABASE_URL ? 'set' : 'missing',
          SUPABASE_SERVICE_ROLE_KEY: SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'missing',
        },
      }),
      {
        status: 500,
        headers: cors(origin, allowed),
      }
    );
  }

  try {
    const url =
      `${SUPABASE_URL}` +
      `/rest/v1/mv_metrics_daily` +
      `?select=day,event_name,total_requests,p95_response_time` +
      `&order=day.desc&limit=60`;

    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    const status = res.status;
    const contentType = res.headers.get('content-type') || '';
    const isJSON = contentType.toLowerCase().includes('application/json');

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return new Response(
        JSON.stringify({
          error: 'Supabase error',
          status,
          contentType,
          detail: detail.slice(0, 1000),
        }),
        {
          status: 502,
          headers: cors(origin, allowed),
        }
      );
    }

    const raw = await res.text().catch(() => '');

    if (!raw || !raw.trim()) {
      return new Response(
        JSON.stringify({ ok: true, data: [] }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            ...cors(origin, allowed),
          },
        }
      );
    }

    if (!isJSON) {
      return new Response(
        JSON.stringify({
          ok: false,
          warning: 'Non-JSON response from Supabase',
          status,
          contentType,
          preview: raw.slice(0, 500),
        }),
        {
          status: 502,
          headers: cors(origin, allowed),
        }
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (e: any) {
      return new Response(
        JSON.stringify({
          error: 'JSON parse failed',
          status,
          contentType,
          message: e?.message ?? String(e),
          preview: raw.slice(0, 500),
        }),
        {
          status: 502,
          headers: cors(origin, allowed),
        }
      );
    }

    return new Response(JSON.stringify({ ok: true, data }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...cors(origin, allowed),
      },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({
        error: 'Unhandled exception in /api/metrics-daily',
        message: e?.message ?? String(e),
      }),
      {
        status: 500,
        headers: cors(origin, allowed),
      }
    );
  }
}
