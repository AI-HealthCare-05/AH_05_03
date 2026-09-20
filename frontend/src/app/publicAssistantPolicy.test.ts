/**
 * 봄이 플로팅 런처는 인증된 제품 화면에만 둔다.
 *
 * 공개 랜딩·로그인·가입·벽 페어링에 다시 붙이면 로그아웃 경로에서 캐릭터가
 * 되살아난다. 페이지가 런처를 import 하는지를 원문에서 막는다.
 */

/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const publicScreens = [
  "../features/landing/LandingPage.tsx",
  "../features/account/SignInPage.tsx",
  "../features/account/SignUpPage.tsx",
  "../features/home/WallPairPage.tsx",
  "./router.tsx",
].map((relative) => resolve(import.meta.dirname, relative));

describe("공개·인증 화면의 봄이", () => {
  it("플로팅 런처를 import 하지 않는다", () => {
    for (const file of publicScreens) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/\bLandingAssistant\b/u);
      expect(source, file).not.toMatch(/\bAssistantLauncherV2\b/u);
    }
  });
});
