import type {
  FoundationAssessmentInput,
  FoundationAssessmentResult,
} from "./contracts";

export function runFoundationAssessment(
  input: FoundationAssessmentInput,
): FoundationAssessmentResult {
  if (input.synthetic !== true || input.modelId !== "foundation-smoke-test") {
    throw new Error("기초 worker는 합성 입력만 처리할 수 있습니다.");
  }

  const values = [input.metrics.first, input.metrics.second];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("합성 입력은 유한한 숫자여야 합니다.");
  }

  return {
    schemaVersion: 1,
    modelId: "foundation-smoke-test",
    modelVersion: "mock-0.1.0",
    resultCode: "LOCAL_FOUNDATION_READY",
    synthetic: true,
    checksum: values.reduce((sum, value) => sum + value, 0),
  };
}
