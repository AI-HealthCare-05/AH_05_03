/**
 * 마지막 화면. 문장 하나와 버튼 하나.
 *
 * 여기까지 온 사람은 이미 다 봤다. 기능을 한 번 더 요약하지 않는다.
 */

import { Link } from "react-router-dom";

import { Reveal } from "../Reveal";

export function FinalCta() {
  return (
    <section className="ln-final" aria-labelledby="ln-final-title">
      <Reveal className="ln-final-inner">
        <h2 id="ln-final-title" className="ln-display ln-display-center">
          오늘부터,
          <br />
          건강을 이어보세요.
        </h2>
        <div className="ln-hero-actions ln-hero-actions-center">
          <Link className="ln-button ln-button-primary ln-button-lg" to="/signup">
            이어봄 시작하기
          </Link>
          <Link className="ln-button ln-button-ghost ln-button-lg" to="/signin">
            이미 계정이 있어요
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
