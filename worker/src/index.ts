export interface Env {
  LEAD_QUEUE: Queue;

  GOOGLE_SA_CLIENT_EMAIL: string;
  GOOGLE_SA_PRIVATE_KEY: string;
  GOOGLE_SHEETS_SPREADSHEET_ID: string;
  GOOGLE_SHEETS_SHEET_NAME: string;

  // Turnstile을 붙일 때 사용 (지금은 미사용)
  // TURNSTILE_SECRET_KEY: string;
}

const allowedSources = ["yc1", "yc2", "p1", "p2", "p3", "p4", "c1", "c2", "c3", "c4"];

function normalizeSource(input: string) {
  if (!input) return "direct";
  const cleaned = input.toLowerCase().trim();
  return allowedSources.includes(cleaned) ? cleaned : "unknown";
}

// UA/Referer: 참고용 원문 저장(최소 안전장치 = 길이 제한만)
const MAX_CELL_LEN = 300;

function clamp(s: string, max = MAX_CELL_LEN) {
  const v = (s ?? "").trim();
  return v.length > max ? v.slice(0, max) : v;
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function fixPrivateKey(key: string) {
  return (key || "").replace(/\\n/g, "\n");
}

async function getAccessToken(env: Env): Promise<string> {
  const clientEmail = env.GOOGLE_SA_CLIENT_EMAIL;
  const privateKeyPem = fixPrivateKey(env.GOOGLE_SA_PRIVATE_KEY);

  if (!clientEmail) throw new Error("Missing env: GOOGLE_SA_CLIENT_EMAIL");
  if (!privateKeyPem) throw new Error("Missing env: GOOGLE_SA_PRIVATE_KEY");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const enc = (obj: any) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

  const unsigned = `${enc(header)}.${enc(claimSet)}`;

  const keyData = privateKeyPem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const binaryDer = Uint8Array.from(atob(keyData), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsigned)
  );

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  const jwt = `${unsigned}.${sig}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!resp.ok) throw new Error(`Token request failed: ${resp.status} ${await resp.text()}`);

  const data: any = await resp.json();
  if (!data.access_token) throw new Error("Token response missing access_token");

  return data.access_token;
}

async function appendRows(env: Env, rows: any[][]) {
  const spreadsheetId = env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const sheetName = env.GOOGLE_SHEETS_SHEET_NAME;

  if (!spreadsheetId) throw new Error("Missing env: GOOGLE_SHEETS_SPREADSHEET_ID");
  if (!sheetName) throw new Error("Missing env: GOOGLE_SHEETS_SHEET_NAME");

  const token = await getAccessToken(env);

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/` +
    `${encodeURIComponent(sheetName)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: rows }),
  });

  if (!resp.ok) {
    throw new Error(`Sheets append failed: ${resp.status} ${await resp.text()}`);
  }
}

function normalizePhone(input: unknown): string {
  const digits = String(input ?? "").replace(/[^\d]/g, "");
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return String(input ?? "").trim();
}

function toRow(msg: any) {
  // Sheets는 결국 셀 값으로 들어가므로 문자열/빈문자열로 정리
  return [
    msg.server_time || "",
    msg.phone || "",
    msg.src || "",
    msg.user_agent || "",
    msg.referer || "",
  ];
}

// Turnstile 템플릿(필요해지면 활성화)
// async function verifyTurnstile(env: Env, token: string, remoteip?: string) {
//   const secret = (env as any).TURNSTILE_SECRET_KEY as string;
//   if (!secret) throw new Error("Missing env: TURNSTILE_SECRET_KEY");
//   if (!token) return false;
//
//   const form = new FormData();
//   form.append("secret", secret);
//   form.append("response", token);
//   if (remoteip) form.append("remoteip", remoteip);
//
//   const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
//     method: "POST",
//     body: form,
//   });
//
//   if (!resp.ok) return false;
//   const data: any = await resp.json().catch(() => ({}));
//   return data.success === true;
// }

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
      if (req.method !== "POST") return json({ ok: true, note: "POST only" }, 200);

      const body: any = await req.json().catch(() => ({}));

      const url = new URL(req.url);
      const rawSrc = url.searchParams.get("src") || "";
      const src = normalizeSource(rawSrc);

      // 원문 그대로(길이 제한만)
      const user_agent = clamp(req.headers.get("User-Agent") || "");
      const referer = clamp(req.headers.get("Referer") || "");

      const phone = normalizePhone(body.phone);

      // Turnstile을 붙이는 시점에만 아래를 켜십시오.
      // const turnstileToken = String(body.turnstile_token || "");
      // const ok = await verifyTurnstile(env, turnstileToken);
      // if (!ok) return json({ ok: false, error: "Turnstile failed" }, 403);

      if (!phone || phone.replace(/[^\d]/g, "").length < 10) {
        return json({ ok: false, error: "Invalid phone" }, 400);
      }

      const payload = {
        server_time: new Date().toISOString(),
        phone,
        src,
        user_agent,
        referer,
      };

      await env.LEAD_QUEUE.send(payload);
      return json({ ok: true }, 200);
    } catch (e: any) {
      console.error("FETCH ERROR", e?.stack || e?.message || e);
      return json({ ok: false, error: String(e?.message || e) }, 500);
    }
  },

  async queue(batch: MessageBatch<any>, env: Env) {
    const rows = batch.messages.map((m) => toRow(m.body));

    try {
      if (rows.length === 0) {
        batch.ackAll();
        return;
      }

      await appendRows(env, rows);
      batch.ackAll();
    } catch (e: any) {
      console.error("QUEUE ERROR", e?.stack || e?.message || e);
      throw e;
    }
  },
};