const API_BASE = import.meta.env.VITE_CRM_API_BASE || "";

function authHeaders(): Headers {
  const headers = new Headers();
  const t = localStorage.getItem("crm_token");
  if (t) headers.set("Authorization", `Bearer ${t}`);
  return headers;
}

export async function crmLogin(token: string, pin: string, newPin?: string) {
  const r = await fetch(`${API_BASE}/crm/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, pin, newPin }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "login_failed");
  localStorage.setItem("crm_token", j.token);
  return j;
}

export async function crmMe() {
  const headers = authHeaders();
  const r = await fetch(`${API_BASE}/crm/me`, { headers });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "me_failed");
  return j;
}

export async function crmStats() {
  const headers = authHeaders();
  const r = await fetch(`${API_BASE}/crm/stats`, { headers });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "stats_failed");
  return j;
}

export async function crmUpdate(
  updates: Array<{ joinNo: string; joinable?: number; payable?: number; finalJoin?: number }>
) {
  const headers = authHeaders();
  headers.set("content-type", "application/json");

  const r = await fetch(`${API_BASE}/crm/update`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ updates }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "update_failed");
  return j;
}

export function crmLogout() {
  localStorage.removeItem("crm_token");
}