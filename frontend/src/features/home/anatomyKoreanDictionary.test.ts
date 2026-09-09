import { describe, expect, it } from "vitest";

import { resolveAnatomyDisplayInfo } from "./anatomyKoreanDictionary";

describe("anatomyKoreanDictionary", () => {
  it("Fascia lata.l 메쉬명을 좌측 대퇴근막 및 라틴어 병기 레이블로 해석한다", () => {
    const info = resolveAnatomyDisplayInfo("Fascia lata.l");

    expect(info.koreanName).toBe("좌측 대퇴근막");
    expect(info.canonicalName).toBe("Fascia lata (Left)");
    expect(info.fullBilingualLabel).toBe("좌측 대퇴근막 (Fascia lata L)");
    expect(info.side).toBe("left");
    expect(info.systemKorean).toBe("근육·결합조직계");
    expect(info.description).toContain("허벅지 바깥쪽");
  });

  it("Rectus_femoris_r 메쉬명을 우측 대퇴직근으로 해석한다", () => {
    const info = resolveAnatomyDisplayInfo("Rectus_femoris_r");

    expect(info.koreanName).toBe("우측 대퇴직근");
    expect(info.canonicalName).toBe("Rectus femoris (Right)");
    expect(info.fullBilingualLabel).toBe("우측 대퇴직근 (Rectus femoris R)");
    expect(info.side).toBe("right");
    expect(info.systemKorean).toBe("근육계");
  });

  it("방향성이 없는 골격 patella를 슬개골로 해석한다", () => {
    const info = resolveAnatomyDisplayInfo("patella");

    expect(info.koreanName).toBe("슬개골");
    expect(info.canonicalName).toBe("Patella");
    expect(info.fullBilingualLabel).toBe("슬개골 (Patella)");
    expect(info.systemKorean).toBe("골격계");
  });

  it("사전에 없는 신규 구조도 좌우 방향성과 적절한 기본값을 부여한다", () => {
    const info = resolveAnatomyDisplayInfo("unknown_flexor.l", "muscular");

    expect(info.koreanName).toBe("좌측 Unknown Flexor");
    expect(info.canonicalName).toBe("Unknown Flexor (Left)");
    expect(info.fullBilingualLabel).toBe("좌측 Unknown Flexor (Unknown Flexor L)");
    expect(info.side).toBe("left");
  });
});
