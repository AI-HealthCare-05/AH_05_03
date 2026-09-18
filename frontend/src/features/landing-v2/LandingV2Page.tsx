/**
 * 이어봄 공개 랜딩페이지 **v2 — Violet Capsule Minimal**.
 *
 * ## v1 과 무엇이 다른가
 *
 * 이야기 순서·장면 수·예시 데이터는 v1(`features/landing`)과 **같은 것을 쓴다**
 * (`../landing/landingStory`). 다른 것은 **표현 계층 하나**다 — 딥 오버진과 고스트
 * 라벤더의 단색 바이올렛 세계, 굵기 300~350 의 속삭이는 타이포, 모든 조작 요소가
 * 캡슐(100px)인 기하학. 그림자는 시스템 전체에서 하나뿐이다(주 CTA 의 라벤더 발광).
 *
 * 두 버전이 같은 이야기를 쓰는 것은 의도다. 랜딩을 두 벌 유지하는 이유는 **디자인을
 * 견주기 위해서**이고, 문구와 숫자가 갈리면 견줄 수 없다 — 그때는 "어느 쪽 디자인이
 * 나은가" 가 아니라 "어느 쪽 카피가 나은가" 를 보게 된다.
 *
 * ## 이 화면이 관문 밖에 있어도 되는 이유
 *
 * v1 과 같은 조건이다 — 이 폴더는 `useLocalDomain` 도 `serverApiClient` 도 부르지
 * 않고, 화면의 수치는 전부 `landingStory.ts` 의 예시 시나리오다. 기기·서버의
 * 건강기록은 한 줄도 읽지 않으며 `LandingV2Page.test.tsx` 가 원문을 훑어 지킨다.
 *
 * ## 재사용
 *
 * 스크롤 엔진(`../landing/scrollProgress`)·3D 인체 장면(`../landing/scene/*`)·
 * 정원 나무(`../challenge/GardenArt`)·챗봇 마스코트는 전부 앱/v1 의 것을 그대로
 * 쓴다. 랜딩용 더미를 새로 만들지 않는다 — 랜딩에서 본 몸과 가입 뒤에 만나는 몸이
 * 다르면 그 장면은 광고이지 데모가 아니다.
 */

import { useEffect } from "react";

import { usePrefersReducedMotion } from "../landing/scrollProgress";
import { AssistantLauncherV2 } from "./AssistantLauncherV2";
import { ensureDisplayFont } from "./displayFont";
import "./landingV2.css";
import { AssistantV2 } from "./sections/AssistantV2";
import { BodyV2 } from "./sections/BodyV2";
import { ChallengeV2 } from "./sections/ChallengeV2";
import { FamilyV2 } from "./sections/FamilyV2";
import { FinalCtaV2 } from "./sections/FinalCtaV2";
import { FooterV2 } from "./sections/FooterV2";
import { HeroV2 } from "./sections/HeroV2";
import { InsightV2 } from "./sections/InsightV2";
import { NavV2 } from "./sections/NavV2";
import { OcrV2 } from "./sections/OcrV2";
import { ProgressV2 } from "./sections/ProgressV2";

export function LandingV2Page() {
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    document.title = "이어봄 · 건강을 이어가는 것으로";
    ensureDisplayFont();
  }, []);

  return (
    <div className="lnv2-root" data-motion={reducedMotion ? "reduced" : "full"}>
      <a className="lnv2-skip" href="#lnv2-main">
        본문으로 건너뛰기
      </a>
      <NavV2 />

      <main id="lnv2-main" tabIndex={-1}>
        <HeroV2 />
        <OcrV2 />
        <InsightV2 />
        {/* 밝은 화면(Bone)에서 딥 오버진으로 넘어가는 자리. **섹션 안에서 색을
            바꾸지 않는다** — 그러면 그 섹션의 글이 배경 중간 색 위에 앉아 대비가
            무너진다(v1 실측). 전환은 글자가 한 자도 없는 구간에서 한다. */}
        <div className="lnv2-fade lnv2-fade-dark" aria-hidden="true" />
        <BodyV2 reducedMotion={reducedMotion} />
        <div className="lnv2-fade lnv2-fade-light" aria-hidden="true" />
        <ChallengeV2 />
        <ProgressV2 />
        <FamilyV2 />
        <AssistantV2 />
        <FinalCtaV2 />
      </main>

      <FooterV2 />
      <AssistantLauncherV2 />
    </div>
  );
}
