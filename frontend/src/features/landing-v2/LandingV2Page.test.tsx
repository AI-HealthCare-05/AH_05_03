/**
 * 랜딩 v2 가 지켜야 하는 것 넷.
 *
 * 1. **관문 밖에 서 있을 자격.** 이 폴더는 기기·서버의 건강기록을 읽지 않는다.
 *    `router.test.tsx` 는 "밖에 있어도 되는 주소" 목록만 지키므로, 그 자격 자체는
 *    여기서 원문을 훑어 지킨다 — 링크를 지우는 것으로는 막히지 않던 `/ui-preview`
 *    사고와 같은 종류라 표가 아니라 **코드**를 본다.
 *    (v2 가 재사용하는 `features/landing/*` 쪽은 v1 의 `LandingPage.test.tsx` 가
 *    같은 방식으로 훑는다. 두 폴더 합쳐 빈틈이 없다.)
 * 2. **이야기 순서.** 검진표 → 해석 → 몸 → 실천 → 변화 → 가족 순서가 뒤집히면
 *    스크롤만으로는 아무것도 이해할 수 없다.
 * 3. **CSS 가 이 페이지 밖으로 새지 않을 것.** v2 는 앱과 다른 디자인 시스템
 *    한 벌(딥 오버진·캡슐)을 들고 있다. 선택자 하나가 `.lnv2-root` 밖으로 나가면
 *    로그인 뒤 화면이 오버진으로 물든다.
 * 4. **고정 구간이 실제로 고정될 것.** `position: sticky` 를 같은 특이도의 뒤쪽
 *    규칙이 덮는 사고가 한 번 났다(아래 `-stage` 시험).
 * 5. **말의 선.** 진단으로 읽힐 말을 쓰지 않는다.
 */

/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { LandingV2Page } from "./LandingV2Page";
import { BODY_SCENES, LANDING_FAMILY, LANDING_VALUES } from "../landing/landingStory";

afterEach(cleanup);

function sourceFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/u.test(entry.name) || entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) {
      return [];
    }
    return [path];
  });
}

describe("랜딩 v2 경계", () => {
  it("건강기록을 읽는 계층을 import 하지 않는다", () => {
    const forbidden = [
      "useLocalDomain",
      "localDomainContext",
      "serverApiClient",
      "shared/local/",
      "local-domain/",
      "@tanstack/react-query",
    ];

    const offenders: string[] = [];
    for (const file of sourceFiles(resolve(import.meta.dirname))) {
      const source = readFileSync(file, "utf8");
      for (const token of forbidden) {
        // import 문에서만 본다. 주석에서 이름을 언급하는 것은 막을 이유가 없다.
        const pattern = new RegExp(`^\\s*import[^;]*${token.replace(/[/.]/gu, "\\$&")}`, "mu");
        if (pattern.test(source)) offenders.push(`${file} → ${token}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("예시 데이터를 v1 에서 복사하지 않고 같은 파일을 쓴다", () => {
    // 같은 사람("나")의 검진 수치가 두 랜딩에서 갈리면 디자인을 견줄 수 없다 —
    // 그때는 "어느 디자인이 나은가" 가 아니라 "어느 카피가 나은가" 를 보게 된다.
    const sources = sourceFiles(resolve(import.meta.dirname)).map((file) => readFileSync(file, "utf8"));
    expect(sources.some((source) => source.includes('from "../landing/landingStory"'))).toBe(true);
    // 값을 여기서 새로 선언한 파일이 있으면 위 import 와 무관하게 갈릴 수 있다.
    for (const source of sources) {
      expect(source).not.toMatch(/export const LANDING_(VALUES|FAMILY|CHALLENGES|WEEKS)/u);
    }
  });

  it("`-stage` 규칙이 `position` 을 다시 쓰지 않는다", () => {
    // 고정 구간의 겉껍데기는 `.lnv2-sticky .lnv2-xxx-stage` 두 클래스를 같이 단다.
    // 특이도가 같고 `-stage` 쪽이 파일 뒤에 있어서, 거기 `position` 을 적으면
    // `position: sticky` 를 덮는다 — 실제로 3D 인체 섹션만 고정이 통째로 안 먹어
    // 5.5 화면을 스크롤하는 동안 몸이 위로 흘러가 버렸다.
    const css = readFileSync(resolve(import.meta.dirname, "landingV2.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//gu,
      "",
    );

    const offenders: string[] = [];
    for (const match of css.matchAll(/(^|[};])\s*(\.lnv2-[a-z-]*-stage)\s*\{([^}]*)\}/gu)) {
      if (/(^|[;\s])position\s*:/u.test(match[3])) offenders.push(match[2]);
    }

    expect(offenders).toEqual([]);
  });

  it("CSS 선택자가 전부 `.lnv2-` 안에 있다", () => {
    const css = readFileSync(resolve(import.meta.dirname, "landingV2.css"), "utf8")
      // 주석 안의 중괄호가 선택자로 잡히지 않게 먼저 지운다.
      .replace(/\/\*[\s\S]*?\*\//gu, "");

    const offenders: string[] = [];
    for (const match of css.matchAll(/(^|[};])([^{};]+)\{/gu)) {
      const head = match[2].trim();
      // at-rule(@media·@supports·@keyframes)과 키프레임 구간(from·to·50%)은 선택자가 아니다.
      if (head.startsWith("@")) continue;
      for (const selector of head.split(",")) {
        const one = selector.trim();
        if (!one || /^(from|to|\d+(\.\d+)?%)$/u.test(one)) continue;
        if (!one.includes(".lnv2-")) offenders.push(one);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("랜딩 v2 이야기", () => {
  it("아홉 장면이 정해진 순서로 선다", () => {
    render(
      <MemoryRouter>
        <LandingV2Page />
      </MemoryRouter>,
    );

    const headings = screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent ?? "");
    const order = [
      "검진표",
      "숫자는 어렵지만",
      "몸 위에",
      "알기만 하는",
      "작은 기록이",
      "내 건강에서",
      "물어보면",
      "오늘부터",
    ];
    for (const [index, fragment] of order.entries()) {
      expect(headings[index], `${index}번째 제목`).toContain(fragment);
    }
  });

  it("첫 화면은 큰 문장 하나와 시작하기 버튼이다", () => {
    render(
      <MemoryRouter>
        <LandingV2Page />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("건강을 기록하는 것에서");
    expect(screen.getAllByRole("link", { name: "이어봄 시작하기" }).length).toBeGreaterThan(0);
  });

  it("검진 수치와 가족 구성원이 이야기 데이터 그대로 나온다", () => {
    render(
      <MemoryRouter>
        <LandingV2Page />
      </MemoryRouter>,
    );

    // 같은 값이 OCR 장면과 해석 장면 양쪽에 있으므로 `getAllBy` 로 센다.
    for (const value of LANDING_VALUES) {
      expect(screen.getAllByText(value.label).length, value.label).toBeGreaterThan(0);
    }
    for (const member of LANDING_FAMILY) {
      expect(screen.getByRole("tab", { name: new RegExp(member.name, "u") })).toBeInTheDocument();
    }
  });

  it("진단으로 읽힐 말을 쓰지 않는다", () => {
    const { container } = render(
      <MemoryRouter>
        <LandingV2Page />
      </MemoryRouter>,
    );

    const text = container.textContent ?? "";
    // 이어봄은 의료진을 대체하지 않는다(docs/22 · 31 과 같은 선).
    for (const banned of ["AI 진단", "질환 확정", "질병 예측", "질환 발견"]) {
      expect(text, banned).not.toContain(banned);
    }
    expect(text).toContain("진단하지 않습니다");
  });

  it("모션을 끄면 3D 장면 다섯 개가 전부 글로 남는다", () => {
    // 고정 스크롤이 풀리면 장면이 더 이상 바뀌지 않는다. 그때도 활성 장면 하나만
    // 그리면 **대화 두 줄과 마지막 카피가 영영 안 보인다** — 움직임만 빼고
    // 내용은 그대로 둔다는 원칙이 v1 에서 여기서 깨졌었다.
    const original = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof window.matchMedia;

    try {
      render(
        <MemoryRouter>
          <LandingV2Page />
        </MemoryRouter>,
      );

      for (const scene of BODY_SCENES) {
        if (scene.message) {
          expect(screen.getByText(scene.message.text), scene.message.text).toBeInTheDocument();
        }
        if (scene.headline) {
          const first = scene.headline.split("\n")[0];
          expect(screen.getByText(new RegExp(first, "u")), first).toBeInTheDocument();
        }
      }
    } finally {
      window.matchMedia = original;
    }
  });

  it("3D 인체 장면의 이야기가 낭독기에도 남는다", () => {
    render(
      <MemoryRouter>
        <LandingV2Page />
      </MemoryRouter>,
    );

    // 연출(스크롤·WebGL)이 없는 환경에서도 마지막 장면의 기록이 글로 남아야 한다.
    const lastScene = BODY_SCENES[BODY_SCENES.length - 1];
    expect(lastScene.markers.length).toBeGreaterThan(0);
    expect(screen.getByText(/3D 인체 위에 기록으로 남습니다/u)).toBeInTheDocument();
  });
});
