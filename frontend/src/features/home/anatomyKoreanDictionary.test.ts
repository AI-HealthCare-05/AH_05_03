import { describe, expect, it } from "vitest";

import { getUnregisteredAnatomyList, resolveAnatomyDisplayInfo } from "./anatomyKoreanDictionary";

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

  it("경추 C3와 C4 메쉬명을 각각 고유한 경추 번호로 분리하여 해석한다", () => {
    const c3 = resolveAnatomyDisplayInfo("skeleton-vertebra-c3__Vertebra_C3");
    const c4 = resolveAnatomyDisplayInfo("skeleton-vertebra-c4__Vertebra_C4");

    expect(c3.koreanName).toBe("경추 3번");
    expect(c3.canonicalName).toBe("Vertebra C3");
    expect(c3.fullBilingualLabel).toBe("경추 3번 (Vertebra C3)");
    expect(c3.systemKorean).toBe("골격계");

    expect(c4.koreanName).toBe("경추 4번");
    expect(c4.canonicalName).toBe("Vertebra C4");
    expect(c4.fullBilingualLabel).toBe("경추 4번 (Vertebra C4)");
    expect(c4.systemKorean).toBe("골격계");

    // 두 경추의 고유 레이블이 서로 달라야 함
    expect(c3.fullBilingualLabel).not.toBe(c4.fullBilingualLabel);
  });

  it("갈비뼈 메쉬명에서 서수/기수 늑골 번호와 좌우 방향성을 보존한다", () => {
    const rib8Left = resolveAnatomyDisplayInfo("skeleton-eighth-rib-left");
    expect(rib8Left.koreanName).toBe("좌측 갈비뼈 8번 (제8늑골)");
    expect(rib8Left.canonicalName).toBe("Rib 8 (Left)");
    expect(rib8Left.fullBilingualLabel).toBe("좌측 갈비뼈 8번 (Rib 8 L)");
    expect(rib8Left.side).toBe("left");
  });

  it("Z-Anatomy 원문 계층 메쉬명(Capitate, Lunate, Scaphoid, Hip bone)을 대한해부학회 표준 한글명으로 정확히 파싱한다", () => {
    const capitate = resolveAnatomyDisplayInfo("Appendicular Skeleton Capitate Bone Left Capitate Bonel");
    expect(capitate.koreanName).toBe("좌측 유두골 (알머리뼈)");
    expect(capitate.canonicalName).toBe("Capitate bone (Left)");
    expect(capitate.side).toBe("left");
    expect(capitate.systemKorean).toBe("골격계");

    const lunate = resolveAnatomyDisplayInfo("Appendicular Skeleton Lunate Bone Left Lunate Bonel");
    expect(lunate.koreanName).toBe("좌측 월상골 (반달뼈)");
    expect(lunate.canonicalName).toBe("Lunate bone (Left)");
    expect(lunate.side).toBe("left");

    const scaphoid = resolveAnatomyDisplayInfo("Appendicular Skeleton Scaphoid Bone Left Scaphoid Bonel");
    expect(scaphoid.koreanName).toBe("좌측 주상골 (손배뼈)");
    expect(scaphoid.canonicalName).toBe("Scaphoid bone (Left)");
    expect(scaphoid.side).toBe("left");

    const hip = resolveAnatomyDisplayInfo("Skeleton Hip Bone Left Hip Bonel");
    expect(hip.koreanName).toBe("좌측 관골 (볼기뼈 / 골반골)");
    expect(hip.canonicalName).toBe("Hip bone (Coxal bone) (Left)");
    expect(hip.side).toBe("left");
  });

  it("사전에 없는 미등록 부위가 감지되면 unregisteredAnatomyRegistry에 등록되고 정돈된 학명으로 폴백된다", () => {
    const unknownRaw = "Appendicular Skeleton Exotic Test Bone Left Exotic Bonel";
    const result = resolveAnatomyDisplayInfo(unknownRaw);

    expect(result.koreanName).toBe("좌측 Exotic Test Bone");
    expect(result.canonicalName).toBe("Exotic Test Bone (Left)");
    expect(result.side).toBe("left");

    // 미등록 레지스트리에 원문이 기록되었는지 확인
    const list = getUnregisteredAnatomyList();
    expect(list).toContain(unknownRaw);
  });
});


