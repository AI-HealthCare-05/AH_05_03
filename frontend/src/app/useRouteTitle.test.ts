/**
 * 탭 제목 고르기 규칙.
 *
 * **왜 이 파일이 생겼나.** 일곱 라우트가 전부 같은 탭 제목을 쓰고 있었고
 * (2026-09-10 확인), 고치면서 경로 매칭 규칙이 생겼다. 그 규칙이 조용히 틀릴 수
 * 있는 자리가 둘이다.
 *
 * 하나. **`/` 는 모든 경로의 접두사다.** 접두사 일치만 쓰면 어느 화면에서든 "가족 홈"
 * 이 이겨서, 고치기 전과 똑같이 제목이 하나로 굳는다.
 *
 * 둘. **하위 경로는 가장 긴 접두사가 이겨야 한다.** `/challenge/today` 가 "챌린지" 로
 * 읽히는 것은 맞지만, 내비에 더 구체적인 항목이 생기면 그쪽이 이겨야 한다.
 */

import { describe, expect, it } from "vitest";

import { TITLE_SUFFIX, titleForPath, type TitleRoute } from "./useRouteTitle";

const ROUTES: readonly TitleRoute[] = [
  { to: "/", label: "가족 홈" },
  { to: "/pain-diary", label: "통증 다이어리" },
  { to: "/assessment", label: "위험 판정" },
  { to: "/challenge", label: "챌린지" },
  { to: "/challenge/today", label: "오늘의 챌린지" },
  { to: "/account", label: "계정" },
];

describe("titleForPath", () => {
  it("경로마다 다른 이름을 준다 — 제목이 하나로 굳지 않는다", () => {
    const titles = ["/", "/pain-diary", "/assessment", "/account"].map((path) =>
      titleForPath(path, ROUTES),
    );

    expect(titles).toEqual(["가족 홈", "통증 다이어리", "위험 판정", "계정"]);
    // 서로 다르다는 것이 이 변경의 전부다. 같으면 고치기 전으로 돌아간 것이다.
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("`/` 는 정확히 일치할 때만 이긴다", () => {
    // 접두사 일치만 쓰면 여기서 "가족 홈" 이 나오고 제목이 다시 하나가 된다.
    expect(titleForPath("/assessment", ROUTES)).toBe("위험 판정");
    expect(titleForPath("/", ROUTES)).toBe("가족 홈");
  });

  it("하위 경로는 가장 긴 접두사가 이긴다", () => {
    expect(titleForPath("/challenge/today", ROUTES)).toBe("오늘의 챌린지");
    expect(titleForPath("/challenge", ROUTES)).toBe("챌린지");
    // 내비에 없는 하위 경로는 가장 가까운 조상의 이름을 쓴다.
    expect(titleForPath("/assessment/detail", ROUTES)).toBe("위험 판정");
  });

  it("맞는 이름이 없으면 아무것도 주지 않는다 — 훅이 서비스 이름만 남긴다", () => {
    expect(titleForPath("/signup", ROUTES)).toBeUndefined();
    expect(TITLE_SUFFIX).toBe("이어봄");
  });
});
