/**
 * 푸터. 여기서만 할 수 있는 말이 둘 있다 —
 * **이것은 진단 서비스가 아니라는 것**과, 3D 인체 아틀라스의 출처 표기다.
 * 후자는 자산 라이선스(CC BY-SA 4.0)가 요구하는 것이라 뺄 수 없다
 * (`public/vendor/vanatome/ATTRIBUTION.txt`).
 *
 * 마지막 제안과 같은 오버진 평면 위에 이어 붙는다 — 색이 한 번 더 바뀌면 끝난
 * 페이지가 다시 시작하는 것처럼 보인다.
 */

import { Link } from "react-router-dom";

import { BrandMarkV2 } from "../BrandMarkV2";

export function FooterV2() {
  return (
    <footer className="lnv2-footer">
      <div className="lnv2-container lnv2-footer-inner">
        <div className="lnv2-footer-brand">
          <BrandMarkV2 size={40} tone="onDark" />
          <div>
            <strong>이어봄</strong>
            <p>흩어진 건강 기록을 하나로 잇습니다.</p>
          </div>
        </div>

        <nav className="lnv2-footer-links" aria-label="바로가기">
          <a href="#v2-service">서비스</a>
          <a href="#v2-challenge">건강 챌린지</a>
          <a href="#v2-family">가족 건강</a>
          <Link to="/signup">시작하기</Link>
          <Link to="/signin">로그인</Link>
        </nav>

        <div className="lnv2-footer-notes">
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
          <p className="lnv2-footer-copy">© {new Date().getFullYear()} 이어봄</p>
        </div>
      </div>
    </footer>
  );
}
