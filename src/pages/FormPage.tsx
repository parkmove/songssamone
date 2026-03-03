import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./FormPage.css";

function onlyDigits(s: string) {
  return s.replace(/[^\d]/g, "");
}

function gaEvent(name: string, params?: Record<string, any>) {
  const g = (window as any).gtag;
  if (typeof g === "function") g("event", name, params);
}

export default function FormPage() {
  const nav = useNavigate();

  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [p3, setP3] = useState("");
  const [error, setError] = useState<string>("");

  const r1 = useRef<HTMLInputElement | null>(null);
  const r2 = useRef<HTMLInputElement | null>(null);
  const r3 = useRef<HTMLInputElement | null>(null);

  // 기존 코드 구조를 최대한 유지합니다.
  // (단, 스타일 객체는 더 이상 의미가 없어서 빈 객체로 대체)
  const containerStyle = useMemo(() => ({} as React.CSSProperties), []);

  function validate(): boolean {
    const a = onlyDigits(p1);
    const b = onlyDigits(p2);
    const c = onlyDigits(p3);

    if (a.length !== 3) return setError("휴대폰 앞 3자리를 입력해 주세요."), false;
    if (b.length !== 4) return setError("가운데 4자리를 입력해 주세요."), false;
    if (c.length !== 4) return setError("마지막 4자리를 입력해 주세요."), false;

    setError("");
    return true;
  }

  function formattedPhone() {
    return `${onlyDigits(p1)}-${onlyDigits(p2)}-${onlyDigits(p3)}`;
  }

  async function onSubmit() {
    gaEvent("lead_submit_attempt");

    if (!validate()) {
      gaEvent("lead_submit_fail", { reason: "client_validation" });
      return;
    }

    const apiUrl = import.meta.env.VITE_LEAD_API_URL;
    if (!apiUrl) {
      alert("VITE_LEAD_API_URL이 설정되어 있지 않습니다.");
      gaEvent("lead_submit_fail", { reason: "client_config_missing" });
      return;
    }

    try {
      // 현재 페이지 쿼리스트링(src=...)을 Worker로 그대로 전달
      const endpoint = apiUrl + window.location.search;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Turnstile 붙일 때: { phone: formattedPhone(), turnstile_token: token }
        body: JSON.stringify({ phone: formattedPhone() }),
      });

      const json = await res.json().catch(() => ({}));
      console.log("응답:", json);

      if (!res.ok || json?.ok !== true) {
        gaEvent("lead_submit_fail", { reason: "server_reject" });
        alert("전송 실패");
        return;
      }

      nav("/done", { state: { fromSubmit: true } });
    } catch (e) {
      console.error(e);
      gaEvent("lead_submit_fail", { reason: "network_error" });
      alert("전송 실패");
    }
  }

  function onChangeP1(v: string) {
    const d = onlyDigits(v).slice(0, 3);
    setP1(d);
    if (d.length === 3) r2.current?.focus();
  }

  function onChangeP2(v: string) {
    const d = onlyDigits(v).slice(0, 4);
    setP2(d);
    if (d.length === 4) r3.current?.focus();
  }

  function onChangeP3(v: string) {
    const d = onlyDigits(v).slice(0, 4);
    setP3(d);
  }

  return (
    <main className="fp" style={containerStyle}>
      <h1 className="fp__title">전화번호 입력</h1>

      <div className="fp__row">
        <input
          ref={r1}
          value={p1}
          onChange={(e) => onChangeP1(e.target.value)}
          inputMode="numeric"
          autoComplete="tel"
          placeholder="010"
          className="fp__input fp__input--p1"
        />
        <span className="fp__dash">-</span>
        <input
          ref={r2}
          value={p2}
          onChange={(e) => onChangeP2(e.target.value)}
          inputMode="numeric"
          placeholder="1234"
          className="fp__input fp__input--p2"
        />
        <span className="fp__dash">-</span>
        <input
          ref={r3}
          value={p3}
          onChange={(e) => onChangeP3(e.target.value)}
          inputMode="numeric"
          placeholder="5678"
          className="fp__input fp__input--p3"
        />
      </div>

      {error && <p className="fp__error">{error}</p>}

      <button onClick={onSubmit} className="fp__submit">
        제출
      </button>
    </main>
  );
}