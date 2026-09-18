/**
 * 푸터. 여기서만 할 수 있는 말이 둘 있다 —
 * **이것은 진단 서비스가 아니라는 것**과, 3D 인체 아틀라스의 출처 표기다.
 * 후자는 자산 라이선스(CC BY-SA 4.0)가 요구하는 것이라 뺄 수 없다
 * (`public/vendor/vanatome/ATTRIBUTION.txt`).
 */

import { Link } from "react-router-dom";

export function LandingFooter() {
  return (
    <footer className="ln-footer">
      <div className="ln-container ln-footer-inner">
        <div className="ln-footer-brand">
          <img src="/ieobom-icon.svg" alt="" width={36} height={36} aria-hidden="true" />
          <div>
            <strong>이어봄</strong>
            <p>흩어진 건강 기록을 하나로 잇습니다.</p>
          </div>
        </div>

        <nav className="ln-footer-links" aria-label="바로가기">
          <a href="#service">서비스</a>
          <a href="#challenge">건강 챌린지</a>
          <a href="#family">가족 건강</a>
          <Link to="/signup">시작하기</Link>
          <Link to="/signin">로그인</Link>
        </nav>

        <div className="ln-footer-notes">
          <p>
            이어봄은 건강 기록을 이해하고 관리하도록 돕는 서비스이며, 의료 진단이나 처방을 대신하지 않습니다. 증상이
            있으면 의료진과 상의해 주세요.
          </p>
          <p>
            3D 해부 모델: Z-Anatomy 기반 Vanatome ·{" "}
            <a href="/vendor/vanatome/ATTRIBUTION.txt" rel="license">
              CC BY-SA 4.0 출처 표기
            </a>
          </p>
          <p className="ln-footer-copy">© {new Date().getFullYear()} 이어봄</p>
        </div>
      </div>
    </footer>
  );
}
