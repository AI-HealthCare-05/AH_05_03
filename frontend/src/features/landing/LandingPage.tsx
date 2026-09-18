/**
 * 이어봄 공개 랜딩페이지.
 *
 * ## 이 화면이 관문 밖에 있어도 되는 이유
 *
 * `router.tsx` 의 관문(`RootLayout`)은 기기·서버의 건강기록을 읽는 화면을 전부
 * 뒤에 둔다. 이 폴더는 그 조건을 지킨다 — **`useLocalDomain` 도, `serverApiClient`
 * 도 부르지 않는다.** 화면에 보이는 수치는 `landingStory.ts` 의 예시 시나리오
 * 하나뿐이고, 실제 기록으로 가는 문은 전부 `/signup` 과 `/` 링크다.
 * 그 사실은 `LandingPage.test.tsx` 와 `router.test.tsx` 가 지킨다.
 *
 * ## 장면 순서
 *
 * 히어로 → 검진표/OCR → 해석 → **3D 인체(정점)** → 챌린지 → 변화 → 가족 →
 * 챗봇 → 마지막 제안. 한 화면에 메시지는 하나다.
 */

import { useEffect } from "react";

import { LandingAssistant } from "./LandingAssistant";
import "./landing.css";
import { usePrefersReducedMotion } from "./scrollProgress";
import { AssistantSection } from "./sections/AssistantSection";
import { BodySection } from "./sections/BodySection";
import { ChallengeSection } from "./sections/ChallengeSection";
import { FamilySection } from "./sections/FamilySection";
import { FinalCta } from "./sections/FinalCta";
import { HeroSection } from "./sections/HeroSection";
import { InsightSection } from "./sections/InsightSection";
import { LandingFooter } from "./sections/LandingFooter";
import { LandingNav } from "./sections/LandingNav";
import { OcrSection } from "./sections/OcrSection";
import { ProgressSection } from "./sections/ProgressSection";

export function LandingPage() {
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    document.title = "이어봄 · 흩어진 건강 기록을 하나로";
  }, []);

  return (
    <div className="ln-root" data-motion={reducedMotion ? "reduced" : "full"}>
      <a className="skip-to-main" href="#landing-main">
        본문으로 건너뛰기
      </a>
      <LandingNav />

      <main id="landing-main" tabIndex={-1}>
        <HeroSection />
        <OcrSection />
        <InsightSection />
        {/* 밝은 화면에서 검은 화면으로 넘어가는 구간. 섹션 안에서 색을 바꾸면
            그 섹션의 글자가 배경 중간 색 위에 앉아 대비가 무너진다(실측) —
            **전환은 아무 글자도 없는 자리에서 한다.** */}
        <div className="ln-fade ln-fade-to-dark" aria-hidden="true" />
        <BodySection reducedMotion={reducedMotion} />
        <div className="ln-fade ln-fade-to-light" aria-hidden="true" />
        <ChallengeSection />
        <ProgressSection />
        <FamilySection />
        <AssistantSection />
        <FinalCta />
      </main>

      <LandingFooter />
      <LandingAssistant />
    </div>
  );
}
