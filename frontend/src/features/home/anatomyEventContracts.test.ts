import { describe, expect, it } from "vitest";

import {
  createAnatomyEvent,
  parseBodySide,
  validateAnatomyEvent,
} from "./anatomyEventContracts";

describe("AnatomyEvent contracts and validation", () => {
  it("올바른 파라미터로 AnatomyEvent를 생성하고 검증을 통과한다", () => {
    const event = createAnatomyEvent({
      atlas: {
        id: "vanatome-male-reference",
        version: "1.0.0",
        referenceSex: "male",
      },
      concept: {
        canonicalConceptId: "fma:pectoralis-major-right",
        sourceKey: "vanatome:male:1.0:pectoralis_major_r",
        sourceMeshId: "VH_M_pectoralis_major_r",
        label: "대흉근 (오른쪽)",
        system: "muscular",
        mappingStatus: "canonical",
      },
      geometry: {
        coordinateSpace: "world",
        point: [0.12, 1.45, 0.22],
        normal: [0.1, 0.2, 0.9],
        faceIndex: 1042,
      },
      inputSource: "tap",
      state: "confirmed",
    });

    expect(event.schemaVersion).toBe("1.0.0");
    expect(event.concept.side).toBe("right");
    expect(event.geometry?.point).toEqual([0.12, 1.45, 0.22]);

    const result = validateAnatomyEvent(event);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("구조물 명칭과 키에서 신체 기준 좌우를 올바르게 판정한다", () => {
    expect(parseBodySide("대흉근 (왼쪽)")).toBe("left");
    expect(parseBodySide("대퇴사두근 (우측)")).toBe("right");
    expect(parseBodySide("경추 (중앙)")).toBe("midline");
    expect(parseBodySide("deltoid", "deltoid_l")).toBe("left");
    expect(parseBodySide("biceps", "biceps_r")).toBe("right");
    expect(parseBodySide("heart", "heart")).toBe("unknown");
  });

  it("필수 항목이 누락되거나 비정상 데이터인 경우 검증 오류를 반환한다", () => {
    const invalidEvent = {
      schemaVersion: "0.9.0", // 버전 불일치
      eventId: "test",
      atlas: { id: "test" }, // version, referenceSex 누락
      concept: { label: "미상" }, // canonicalConceptId 누락
      inputSource: "unknown-source",
      state: "invalid-state",
      recordedAt: "invalid-date",
    };

    const result = validateAnatomyEvent(invalidEvent);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(4);
  });

  it("P0-4, P0-5, P0-6: 다중 선택 relatedConcepts 보존 및 mappingStatus, 유효 coverage 검증", () => {
    const multiEvent = createAnatomyEvent({
      atlas: {
        id: "vanatome-male-reference",
        version: "1.0.0",
        referenceSex: "male",
      },
      concept: {
        canonicalConceptId: "fma:trapezius-left",
        sourceKey: "vanatome:male:1.0:trapezius_l",
        sourceMeshId: "VH_M_trapezius_l",
        label: "승모근 (왼쪽)",
        system: "muscular",
        mappingStatus: "canonical",
        side: "left",
      },
      relatedConcepts: [
        {
          canonicalConceptId: "VH_M_levator_scapulae_l",
          sourceKey: "vanatome:male:1.0:levator_scapulae_l",
          sourceMeshId: "VH_M_levator_scapulae_l",
          label: "견갑거근 (왼쪽)",
          system: "muscular",
          mappingStatus: "source_fallback",
          side: "left",
        },
      ],
      coverage: {
        radius: 0.18,
        sampleCount: 12,
      },
      inputSource: "brush",
      state: "confirmed",
    });

    expect(multiEvent.concept.canonicalConceptId).toBe("fma:trapezius-left");
    expect(multiEvent.concept.mappingStatus).toBe("canonical");
    expect(multiEvent.relatedConcepts).toHaveLength(1);
    expect(multiEvent.relatedConcepts?.[0].canonicalConceptId).toBe("VH_M_levator_scapulae_l");
    expect(multiEvent.relatedConcepts?.[0].mappingStatus).toBe("source_fallback");
    expect(multiEvent.coverage?.radius).toBe(0.18);
    expect(multiEvent.coverage?.sampleCount).toBe(12);

    const validation = validateAnatomyEvent(multiEvent);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });
});
