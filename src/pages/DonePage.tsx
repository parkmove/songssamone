import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./DonePage.css";

const REDIRECT_URL = "https://example.com/선거인단등록";
// 실제 이동할 URL로 교체하세요.

export default function DonePage() {
  const location = useLocation();
  const navigate = useNavigate();

  // 직접 접근 방지: 제출 플로우로 들어온 게 아니면 홈으로
  useEffect(() => {
    if (!location.state?.fromSubmit) {
      navigate("/", { replace: true });
    }
  }, [location.state, navigate]);

  useEffect(() => {
    // GA4 이벤트 (gtag가 로드되어 있을 때만)
    if ((window as any).gtag) {
      (window as any).gtag("event", "lead_submit_success");
    }

    const timer = window.setTimeout(() => {
      window.location.href = REDIRECT_URL;
    }, 5000); // 5초

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="done">
      <h1 className="done__title">
        잠시 후 선거인단 등록 페이지로 이동합니다.
      </h1>

      <p className="done__desc">
        선거인단 페이지에서 본인인증을 진행하여야 신청이 완료됩니다.
      </p>

      <p className="done__guide">
        자동으로 이동하지 않으면 아래 버튼을 눌러주세요.
      </p>

      <a href={REDIRECT_URL} className="done__button">
        바로 이동하기
      </a>
    </main>
  );
}