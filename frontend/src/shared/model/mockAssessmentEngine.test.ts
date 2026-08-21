import { describe, expect, it } from "vitest";

import { runFoundationAssessment } from "./mockAssessmentEngine";

describe("runFoundationAssessment", () => {
  it("합성 입력에 대해 결정적인 결과를 반환한다", () => {
    const result = runFoundationAssessment({
      schemaVersion: 1,
      modelId: "foundation-smoke-test",
      synthetic: true,
      metrics: {
        first: 17,
        second: 25,
      },
    });

    expect(result).toEqual({
      schemaVersion: 1,
      modelId: "foundation-smoke-test",
      modelVersion: "mock-0.1.0",
      resultCode: "LOCAL_FOUNDATION_READY",
      synthetic: true,
      checksum: 42,
    });
  });

  it("유한하지 않은 숫자를 거절한다", () => {
    expect(() =>
      runFoundationAssessment({
        schemaVersion: 1,
        modelId: "foundation-smoke-test",
        synthetic: true,
        metrics: {
          first: Number.NaN,
          second: 25,
        },
      }),
    ).toThrow("유한한 숫자");
  });
});
