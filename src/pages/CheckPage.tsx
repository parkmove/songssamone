import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { crmLogin, crmMe, crmStats, crmUpdate, crmLogout } from "../lib/crmApi";

type Row = {
  joinNo: string;
  name: string;
  phone: string;
  joinable: 0 | 1 | 2;
  payable: 0 | 1 | 2;
  linkAccess: 0 | 1 | 2;
  finalJoin: 0 | 1 | 2;
};

function triLabel(v: number) {
  if (v === 1) return "예";
  if (v === 2) return "아니오";
  return "미확인";
}

function TriToggle({
  value,
  onChange,
}: {
  value: 0 | 1 | 2;
  onChange: (v: 0 | 1 | 2) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value) as 0 | 1 | 2)}>
      <option value={0}>미확인</option>
      <option value={1}>예</option>
      <option value={2}>아니오</option>
    </select>
  );
}

export default function CheckPage() {
  const { token = "" } = useParams();

  const [pin, setPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [needsNewPin, setNeedsNewPin] = useState(false);

  const [loading, setLoading] = useState(false);
  const [recommenderName, setRecommenderName] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [stats, setStats] = useState<{ total: number; link: number; done: number } | null>(null);

  const [dirty, setDirty] = useState<Record<string, Partial<Row>>>({}); // joinNo -> changed fields

  async function loadAll() {
    setLoading(true);
    try {
      const me = await crmMe();
      setRecommenderName(me.recommenderName || "");
      setRows(me.rows || []);
      const st = await crmStats();
      setStats({ total: st.total, link: st.link, done: st.done });
    } finally {
      setLoading(false);
    }
  }

useEffect(() => {
  // URL token이 바뀌면, 기존 저장 토큰이 다른 추천인 토큰일 수 있으니 제거
  const t = localStorage.getItem("crm_token");
  if (t) {
    try {
      const payloadPart = t.split(".")[1];
      if (!payloadPart) throw new Error("bad_jwt");

      const b64 =
        payloadPart.replace(/-/g, "+").replace(/_/g, "/") +
        "===".slice((payloadPart.length + 3) % 4);

      const payload = JSON.parse(atob(b64));
      const savedToken = String(payload?.token || "");

      if (savedToken && token && savedToken !== token) {
        localStorage.removeItem("crm_token");
      }
    } catch {
      localStorage.removeItem("crm_token");
    }
  }

  loadAll().catch(() => {
    // 자동 로그인 실패 시 로그인 화면으로 남기기
    setRecommenderName("");
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [token]);

  const changedCount = useMemo(() => Object.keys(dirty).length, [dirty]);

  async function onLogin() {
    setLoading(true);
    try {
      const r = await crmLogin(token, pin, needsNewPin ? newPin : undefined);
      setRecommenderName(r.recommenderName || "");
      setNeedsNewPin(false);
      setPin("");
      setNewPin("");
      await loadAll();
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("invalid_initial_pin") || msg.includes("newPin")) {
        // 최초 PIN 설정 플로우가 섞이면 여기서 처리
        setNeedsNewPin(true);
      }
      alert(msg);
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit() {
    const updates = Object.entries(dirty).map(([joinNo, patch]) => ({
      joinNo,
      joinable: patch.joinable,
      payable: patch.payable,
      finalJoin: patch.finalJoin,
    }));
    if (updates.length === 0) return;

    setLoading(true);
    try {
      await crmUpdate(updates);
      setDirty({});
      await loadAll();
      alert("저장 완료");
    } catch (e: any) {
      alert(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  function updateRow(joinNo: string, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((r) => (r.joinNo === joinNo ? { ...r, ...patch } as Row : r))
    );
    setDirty((prev) => ({ ...prev, [joinNo]: { ...(prev[joinNo] || {}), ...patch } }));
  }

  function onPrint() {
    window.print();
  }

  function onLogout() {
    crmLogout();
    location.reload();
  }

  return (
    <div style={{ padding: 16 }}>
      <h2>추천인 확인 페이지</h2>

      <div style={{ marginBottom: 12 }}>
        <div>토큰: {token}</div>
        {recommenderName ? <div>추천인: {recommenderName}</div> : null}
      </div>

      {!recommenderName ? (
        <div style={{ border: "1px solid #ddd", padding: 12, maxWidth: 420 }}>
          <div style={{ marginBottom: 8 }}>PIN 입력</div>
          <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN" />
          {needsNewPin ? (
            <div style={{ marginTop: 8 }}>
              <div style={{ marginBottom: 4 }}>새 PIN 설정(최소 4자리)</div>
              <input
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                placeholder="새 PIN"
              />
            </div>
          ) : null}
          <div style={{ marginTop: 10 }}>
            <button onClick={onLogin} disabled={loading}>
              로그인
            </button>
          </div>
        </div>
      ) : null}

      {recommenderName ? (
        <>
          <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
            <button onClick={onPrint}>프린트</button>
            <button onClick={onSubmit} disabled={loading || changedCount === 0}>
              제출하기 {changedCount ? `(${changedCount})` : ""}
            </button>
            <button onClick={onLogout}>로그아웃</button>
          </div>

          {stats ? (
            <div style={{ marginBottom: 12 }}>
              표출 인원: {stats.total} / 링크접속: {stats.link} / 최종가입: {stats.done}
            </div>
          ) : null}

          <div style={{ overflowX: "auto" }}>
            <table cellPadding={8} style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th align="left">가입번호</th>
                  <th align="left">이름</th>
                  <th align="left">전화</th>
                  <th align="left">가입가능</th>
                  <th align="left">납부가능</th>
                  <th align="left">링크접속</th>
                  <th align="left">최종가입</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.joinNo} style={{ borderTop: "1px solid #eee" }}>
                    <td>{r.joinNo}</td>
                    <td>{r.name}</td>
                    <td>{r.phone}</td>
                    <td>
                      <TriToggle
                        value={r.joinable}
                        onChange={(v) => updateRow(r.joinNo, { joinable: v })}
                      />
                    </td>
                    <td>
                      <TriToggle
                        value={r.payable}
                        onChange={(v) => updateRow(r.joinNo, { payable: v })}
                      />
                    </td>
                    <td>{triLabel(r.linkAccess)}</td>
                    <td>
                      <TriToggle
                        value={r.finalJoin}
                        onChange={(v) => updateRow(r.joinNo, { finalJoin: v })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 16, color: "#666" }}>
            데이터 관련 문의: (여기에 연락처 문구)
          </div>
        </>
      ) : null}
    </div>
  );
}