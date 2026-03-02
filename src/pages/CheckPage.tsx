import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { crmLogin, crmMe, crmStats, crmUpdate, crmLogout } from "../lib/crmApi";

type Row = {
  joinNo: string;
  name: string;
  phone: string;
  /**
   * 회원 구분: A/B/C 구분 값
   * G열에 저장되며, 서버는 문자열로 처리한다.
   */
  memberType: string;
  /**
   * 링크 접속 여부 (0: 미확인, 1: 예, 2: 아니오)
   */
  linkAccess: 0 | 1 | 2;
  /**
   * 최종 가입 여부 (0: 미확인, 1: 예, 2: 아니오)
   */
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

/**
 * 회원 구분 선택 컴포넌트.
 * A, B, C 세 가지 값을 선택할 수 있다.
 */
function MemberTypeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">-</option>
      <option value="A">A</option>
      <option value="B">B</option>
      <option value="C">C</option>
    </select>
  );
}

export default function CheckPage() {
  const { token = "" } = useParams();

  const [pin, setPin] = useState("");           // 일반 로그인 PIN
  const [showFirstJoin, setShowFirstJoin] = useState(false);

  const [initialPin, setInitialPin] = useState(""); // 가입용 PIN(초기 PIN)
  const [setPinValue, setSetPinValue] = useState(""); // 바꿀 PIN(새 PIN)

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
  // URL token 바뀌면 저장 토큰 검사 후 불일치 시 제거
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

  // 토큰이 남아 있을 때만 자동 로딩
  if (localStorage.getItem("crm_token")) {
    loadAll().catch(() => setRecommenderName(""));
  } else {
    setRecommenderName("");
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [token]);

  const changedCount = useMemo(() => Object.keys(dirty).length, [dirty]);

async function onLogin() {
  // 1) 기본 입력 체크
  if (!pin) {
    alert("PIN을 입력해 주십시오.");
    return;
  }

  setLoading(true);
  try {
    await crmLogin(token, pin);
    setPin("");
    await loadAll();
  } catch (e: any) {
    alert(String(e?.message || e));
  } finally {
    setLoading(false);
  }
}

async function onFirstJoin() {
  if (!initialPin) {
    alert("가입용 PIN을 입력해 주십시오.");
    return;
  }
  if (!setPinValue || setPinValue.length < 4) {
    alert("바꿀 PIN은 최소 4자리 이상이어야 합니다.");
    return;
  }

  setLoading(true);
  try {
    // 서버 규칙: 최초 로그인은 pin=초기PIN, newPin=새PIN
    await crmLogin(token, initialPin, setPinValue);

    // 성공하면 가입 화면 닫고 초기화
    setShowFirstJoin(false);
    setInitialPin("");
    setSetPinValue("");

    await loadAll();
  } catch (e: any) {
    alert(String(e?.message || e));
  } finally {
    setLoading(false);
  }
}

  async function onSubmit() {
    const updates = Object.entries(dirty).map(([joinNo, patch]) => ({
      joinNo,
      // 회원 구분과 최종가입만 서버에 전송한다. H열(payable)은 더 이상 사용하지 않는다.
      memberType: (patch as any).memberType,
      finalJoin: (patch as any).finalJoin,
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
  <div style={{ border: "1px solid #ddd", padding: 12, maxWidth: 460 }}>
    {!showFirstJoin ? (
      <>
        <div style={{ marginBottom: 8 }}>PIN 입력</div>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
        />

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={onLogin} disabled={loading}>
            로그인
          </button>

          <button
            type="button"
            onClick={() => setShowFirstJoin(true)}
            disabled={loading}
          >
            처음 접속했습니다
          </button>
        </div>
      </>
    ) : (
      <>
        <div style={{ marginBottom: 10, fontWeight: 600 }}>새로운 PIN 설정하기</div>

        <div style={{ marginBottom: 6 }}>가입용 PIN</div>
        <input
          value={initialPin}
          onChange={(e) => setInitialPin(e.target.value)}
          placeholder="가입용 PIN"
        />

        <div style={{ marginTop: 10, marginBottom: 6 }}>바꿀 PIN</div>
        <input
          value={setPinValue}
          onChange={(e) => setSetPinValue(e.target.value)}
          placeholder="바꿀 PIN (최소 4자리)"
        />

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={onFirstJoin} disabled={loading}>
            관리자 가입
          </button>
          <button
            type="button"
            onClick={() => {
              setShowFirstJoin(false);
              setInitialPin("");
              setSetPinValue("");
            }}
            disabled={loading}
          >
            돌아가기
          </button>
        </div>
      </>
    )}
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
                  <th align="left">회원구분</th>
                  {/* 납부가능 여부는 더 이상 사용하지 않으며, 예비 열로 남겨둔다. */}
                  <th align="left" style={{ visibility: "hidden" }}>예비</th>
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
                      <MemberTypeSelect
                        value={r.memberType}
                        onChange={(v) => updateRow(r.joinNo, { memberType: v } as any)}
                      />
                    </td>
                    {/* 납부가능 열은 더 이상 사용하지 않으므로 비워둡니다. */}
                    <td></td>
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