export interface Env {
  LEAD_QUEUE: Queue;

  GOOGLE_SA_CLIENT_EMAIL: string;
  GOOGLE_SA_PRIVATE_KEY: string;
  GOOGLE_SHEETS_SPREADSHEET_ID: string;

  // Queue consumer가 append할 대상 시트명(=leads)
  GOOGLE_SHEETS_SHEET_NAME: string;

  // CRM 대상 RAW / AUTH 시트명 (vars)
  CRM_RAW_SHEET_NAME: string;   // songssamone_raw
  CRM_AUTH_SHEET_NAME: string;  // crm_auth

  // CRM 인증용 (secrets)
  CRM_JWT_SECRET: string;
  CRM_INITIAL_PIN: string;
}

const allowedSources = ["yc1", "yc2", "p1", "p2", "p3", "p4", "c1", "c2", "c3", "c4"];

function normalizeSource(input: string) {
  if (!input) return "direct";
  const cleaned = input.toLowerCase().trim();
  return allowedSources.includes(cleaned) ? cleaned : "unknown";
}

const MAX_CELL_LEN = 300;
function clamp(s: string, max = MAX_CELL_LEN) {
  const v = (s ?? "").trim();
  return v.length > max ? v.slice(0, max) : v;
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
  });
}

function fixPrivateKey(key: string) {
  return (key || "").replace(/\\n/g, "\n");
}

function nowISO() {
  return new Date().toISOString();
}

/* --------------------------
   base64url / crypto helpers
-------------------------- */

function base64url(input: ArrayBuffer | Uint8Array | string) {
  let bytes: Uint8Array;
  if (typeof input === "string") bytes = new TextEncoder().encode(input);
  else if (input instanceof Uint8Array) bytes = input;
  else bytes = new Uint8Array(input);

  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlJson(obj: any) {
  return base64url(JSON.stringify(obj));
}

function base64urlDecodeToString(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const bytes = new Uint8Array(buf);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSHA256Base64Url(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return base64url(sig);
}

/* --------------------------
   Google SA JWT -> AccessToken
-------------------------- */

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

  const unsigned = `${base64urlJson(header)}.${base64urlJson(claimSet)}`;

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

  const jwt = `${unsigned}.${base64url(signature)}`;

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

/* --------------------------
   Sheets Values API helpers
-------------------------- */

async function sheetsGetValues(env: Env, rangeA1: string): Promise<any[][]> {
  const spreadsheetId = env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("Missing env: GOOGLE_SHEETS_SPREADSHEET_ID");

  const token = await getAccessToken(env);
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(rangeA1)}`
  );
  // 수식 결과를 값으로 받기
  url.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) throw new Error(`Sheets get failed: ${resp.status} ${await resp.text()}`);

  const data: any = await resp.json();
  return (data.values || []) as any[][];
}

async function sheetsBatchUpdate(env: Env, updates: Array<{ rangeA1: string; values: any[][] }>) {
  const spreadsheetId = env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("Missing env: GOOGLE_SHEETS_SPREADSHEET_ID");
  if (updates.length === 0) return;

  const token = await getAccessToken(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`;

  const body = {
    valueInputOption: "RAW",
    data: updates.map((u) => ({ range: u.rangeA1, values: u.values })),
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) throw new Error(`Sheets batchUpdate failed: ${resp.status} ${await resp.text()}`);
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
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: rows }),
  });

  if (!resp.ok) throw new Error(`Sheets append failed: ${resp.status} ${await resp.text()}`);
}

/* --------------------------
   leads ingestion helpers
-------------------------- */

function normalizePhone(input: unknown): string {
  const digits = String(input ?? "").replace(/[^\d]/g, "");
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return String(input ?? "").trim();
}

function phoneDigits(input: unknown): string {
  return String(input ?? "").replace(/[^\d]/g, "");
}

function maskPhone(phone: string): string {
  const d = phoneDigits(phone);
  if (d.length < 8) return phone;
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}

function toLeadRow(msg: any) {
  return [msg.server_time || "", msg.phone || "", msg.src || "", msg.user_agent || "", msg.referer || ""];
}

/* --------------------------
   CRM auth JWT (HMAC-SHA256)
-------------------------- */

async function signJWT(payload: any, env: Env, expSeconds: number): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expSeconds };

  const h = base64urlJson(header);
  const p = base64urlJson(body);
  const toSign = `${h}.${p}`;
  const sig = await hmacSHA256Base64Url(env.CRM_JWT_SECRET, toSign);
  return `${toSign}.${sig}`;
}

async function verifyJWT(token: string, env: Env): Promise<any | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const toSign = `${h}.${p}`;
  const sig = await hmacSHA256Base64Url(env.CRM_JWT_SECRET, toSign);
  if (sig !== s) return null;

  const payload = JSON.parse(base64urlDecodeToString(p));
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  return payload;
}

function getBearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

/* --------------------------
   CRM sheets model
-------------------------- */

function norm(v: any) {
  return String(v ?? "").trim();
}

function toTri(v: any): 0 | 1 | 2 {
  const n = Number(v);
  if (n === 1) return 1;
  if (n === 2) return 2;
  return 0;
}

type AuthRow = {
  token: string;
  recommenderName: string;
  pinHash: string;
  pinSetAt: string;
  lastLoginAt: string;
  rowIndex1Based: number;
};

async function computePinHash(token: string, pin: string) {
  return sha256Hex(`${token}:${pin}`);
}

async function getAuthByToken(env: Env, token: string): Promise<AuthRow | null> {
  const sheet = env.CRM_AUTH_SHEET_NAME || "crm_auth";
  const values = await sheetsGetValues(env, `${sheet}!A1:E`);
  if (values.length < 2) return null;

  for (let i = 1; i < values.length; i++) {
    const r = values[i] || [];
    const t = norm(r[0]);
    if (t === token) {
      return {
        token: t,
        recommenderName: norm(r[1]),
        pinHash: norm(r[2]),
        pinSetAt: norm(r[3]),
        lastLoginAt: norm(r[4]),
        rowIndex1Based: i + 1,
      };
    }
  }
  return null;
}

async function updateAuthRow(env: Env, row: AuthRow, patch: Partial<AuthRow>) {
  const sheet = env.CRM_AUTH_SHEET_NAME || "crm_auth";
  const n = row.rowIndex1Based;
  const next = { ...row, ...patch };
  await sheetsBatchUpdate(env, [
    {
      rangeA1: `${sheet}!A${n}:E${n}`,
      values: [[next.token, next.recommenderName, next.pinHash, next.pinSetAt, next.lastLoginAt]],
    },
  ]);
}

type RawMember = {
  joinNo: string;
  name: string;
  phone: string;
  recommender1: string;
  recommender2: string;
  recommender3: string;
  joinable: 0 | 1 | 2;
  payable: 0 | 1 | 2;
  linkAccess: 0 | 1 | 2; // 수식 결과 값
  finalJoin: 0 | 1 | 2;
  rowIndex1Based: number;
};

function matchesRecommender(m: RawMember, rn: string) {
  const key = rn.trim();
  if (!key) return false;
  return m.recommender1 === key || m.recommender2 === key || m.recommender3 === key;
}

async function loadRaw(env: Env): Promise<RawMember[]> {
  const sheet = env.CRM_RAW_SHEET_NAME || "songssamone_raw";
  const values = await sheetsGetValues(env, `${sheet}!A1:J`);
  if (values.length < 2) return [];

  const rows: RawMember[] = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i] || [];
    const joinNo = norm(r[0]);
    if (!joinNo) continue;

    rows.push({
      joinNo,
      name: norm(r[1]),
      phone: norm(r[2]),
      recommender1: norm(r[3]),
      recommender2: norm(r[4]),
      recommender3: norm(r[5]),
      joinable: toTri(r[6]),
      payable: toTri(r[7]),
      linkAccess: toTri(r[8]), // I열 수식 결과
      finalJoin: toTri(r[9]),
      rowIndex1Based: i + 1,
    });
  }
  return rows;
}

/* --------------------------
   CRM handlers
-------------------------- */

async function handleCrm(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method === "GET" && path === "/crm/health") {
    return json({ ok: true, time: nowISO() });
  }

  if (req.method === "GET" && path === "/crm/debug/raw-preview") {
    const sheet = env.CRM_RAW_SHEET_NAME || "songssamone_raw";
    const values = await sheetsGetValues(env, `${sheet}!A1:J6`);
    return json({ ok: true, range: `${sheet}!A1:J6`, values });
  }

  // POST /crm/login  body: { token, pin, newPin? }
  if (req.method === "POST" && path === "/crm/login") {
    const body: any = await req.json().catch(() => ({}));
    const token = norm(body.token);
    const pin = norm(body.pin);
    const newPin = norm(body.newPin);

    if (!token || !pin) return json({ ok: false, error: "token_and_pin_required" }, 400);
    if (!env.CRM_JWT_SECRET) return json({ ok: false, error: "missing_CRM_JWT_SECRET" }, 500);

    const auth = await getAuthByToken(env, token);
    if (!auth) return json({ ok: false, error: "unknown_token" }, 401);

    const first = !auth.pinHash;

    if (first) {
      if (!env.CRM_INITIAL_PIN) return json({ ok: false, error: "missing_CRM_INITIAL_PIN" }, 500);
      if (pin !== env.CRM_INITIAL_PIN) return json({ ok: false, error: "invalid_initial_pin" }, 401);
      if (!newPin || newPin.length < 4) return json({ ok: false, error: "newPin_min_4" }, 400);

      const nextHash = await computePinHash(token, newPin);
      await updateAuthRow(env, auth, {
        pinHash: nextHash,
        pinSetAt: nowISO(),
        lastLoginAt: nowISO(),
      });

      const jwt = await signJWT({ token, rn: auth.recommenderName }, env, 60 * 60 * 12);
      return json({ ok: true, firstSet: true, token: jwt, recommenderName: auth.recommenderName });
    }

    const hash = await computePinHash(token, pin);
    if (hash !== auth.pinHash) return json({ ok: false, error: "invalid_pin" }, 401);

    await updateAuthRow(env, auth, { lastLoginAt: nowISO() });

    const jwt = await signJWT({ token, rn: auth.recommenderName }, env, 60 * 60 * 12);
    return json({ ok: true, token: jwt, recommenderName: auth.recommenderName });
  }

  // 인증 필요
  const bearer = getBearer(req);
  if (!bearer) return json({ ok: false, error: "missing_bearer" }, 401);
  const payload = await verifyJWT(bearer, env);
  if (!payload) return json({ ok: false, error: "invalid_token" }, 401);

  const rn = norm(payload.rn);

  // GET /crm/me
  if (req.method === "GET" && path === "/crm/me") {
    const raw = await loadRaw(env);
    const mine = raw.filter((m) => matchesRecommender(m, rn));
    return json({
      ok: true,
      recommenderName: rn,
      count: mine.length,
      rows: mine.map((m) => ({
        joinNo: m.joinNo,
        name: m.name,
        phone: maskPhone(m.phone),
        joinable: m.joinable,
        payable: m.payable,
        linkAccess: m.linkAccess, // 수식 결과
        finalJoin: m.finalJoin,
      })),
      time: nowISO(),
    });
  }

  // GET /crm/stats
  if (req.method === "GET" && path === "/crm/stats") {
    const raw = await loadRaw(env);
    const mine = raw.filter((m) => matchesRecommender(m, rn));
    const total = mine.length;
    const link = mine.filter((m) => m.linkAccess === 1).length;
    const done = mine.filter((m) => m.finalJoin === 1).length;
    return json({ ok: true, recommenderName: rn, total, link, done, time: nowISO() });
  }

  // PATCH /crm/update  body: { updates: [{ joinNo, joinable?, payable?, finalJoin? }] }
  if (req.method === "PATCH" && path === "/crm/update") {
    const body: any = await req.json().catch(() => ({}));
    if (!Array.isArray(body.updates)) return json({ ok: false, error: "updates_array_required" }, 400);

    const rawSheet = env.CRM_RAW_SHEET_NAME || "songssamone_raw";
    const raw = await loadRaw(env);
    const mineMap = new Map(raw.filter((m) => matchesRecommender(m, rn)).map((m) => [m.joinNo, m]));

    const updates: Array<{ rangeA1: string; values: any[][] }> = [];
    let applied = 0;

    for (const u of body.updates) {
      const joinNo = norm(u?.joinNo);
      if (!joinNo) continue;

      const row = mineMap.get(joinNo);
      if (!row) continue; // 권한 밖

      const nextJoinable = u.joinable !== undefined ? toTri(u.joinable) : row.joinable;
      const nextPayable = u.payable !== undefined ? toTri(u.payable) : row.payable;
      const nextFinal = u.finalJoin !== undefined ? toTri(u.finalJoin) : row.finalJoin;

      const changed =
        nextJoinable !== row.joinable || nextPayable !== row.payable || nextFinal !== row.finalJoin;
      if (!changed) continue;

      const n = row.rowIndex1Based;
      // G,H,J만 수정. I(링크접속여부)는 수식이므로 절대 건드리지 않음.
      updates.push({ rangeA1: `${rawSheet}!G${n}:H${n}`, values: [[nextJoinable, nextPayable]] });
      updates.push({ rangeA1: `${rawSheet}!J${n}:J${n}`, values: [[nextFinal]] });
      applied++;
    }

    // 과도한 payload 방지
    const CHUNK = 300;
    for (let i = 0; i < updates.length; i += CHUNK) {
      await sheetsBatchUpdate(env, updates.slice(i, i + CHUNK));
    }

    return json({ ok: true, applied, time: nowISO() });
  }

  return json({ ok: false, error: "not_found" }, 404);
}

/* --------------------------
   Worker entry
-------------------------- */

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(req.url);

      // CRM 라우팅
      if (url.pathname.startsWith("/crm/")) {
        return await handleCrm(req, env);
      }

      // 기존 leads 수집 엔드포인트(현행 유지: POST only)
      if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
      if (req.method !== "POST") return json({ ok: true, note: "POST only" }, 200);

      const body: any = await req.json().catch(() => ({}));

      const rawSrc = url.searchParams.get("src") || "";
      const src = normalizeSource(rawSrc);

      const user_agent = clamp(req.headers.get("User-Agent") || "");
      const referer = clamp(req.headers.get("Referer") || "");
      const phone = normalizePhone(body.phone);

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
    const rows = batch.messages.map((m) => toLeadRow(m.body));

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