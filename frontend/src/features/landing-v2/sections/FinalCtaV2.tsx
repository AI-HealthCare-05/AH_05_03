/**
 * 마지막 화면. 문장 하나와 버튼 하나.
 *
 * 여기까지 온 사람은 이미 다 봤다. 기능을 한 번 더 요약하지 않는다. 디자인
 * 시스템이 말하는 **몰입형 오버진 평면**을 페이지의 마지막 숨으로 쓴다 —
 * 고스트 라벤더 CTA 의 발광이 이 시스템에서 유일하게 허용된 그림자다.
 */

import { Link } from "react-router-dom";

import { Reveal } from "../../landing/Reveal";

export function FinalCtaV2() {
  return (
    <section className="lnv2-final" aria-labelledby="lnv2-final-title">
      <Reveal className="lnv2-final-inner">
        <h2 id="lnv2-final-title" className="lnv2-display lnv2-display-center">
          오늘부터,
          <br />
          건강을 이어보세요.
        </h2>
        <div className="lnv2-actions lnv2-actions-center">
          <Link className="lnv2-btn lnv2-btn-primary lnv2-btn-lg" to="/signup">
            이어봄 시작하기
          </Link>
          <Link className="lnv2-btn lnv2-btn-onDark lnv2-btn-lg" to="/">
            이미 계정이 있어요
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
