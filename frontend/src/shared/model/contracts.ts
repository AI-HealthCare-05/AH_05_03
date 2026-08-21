export interface FoundationAssessmentInput {
  schemaVersion: 1;
  modelId: "foundation-smoke-test";
  synthetic: true;
  metrics: {
    first: number;
    second: number;
  };
}

export interface FoundationAssessmentResult {
  schemaVersion: 1;
  modelId: "foundation-smoke-test";
  modelVersion: "mock-0.1.0";
  resultCode: "LOCAL_FOUNDATION_READY";
  synthetic: true;
  checksum: number;
}

export interface AssessmentRequestMessage {
  type: "ASSESS";
  requestId: string;
  input: FoundationAssessmentInput;
}

export interface AssessmentSuccessMessage {
  type: "ASSESSMENT_COMPLETE";
  requestId: string;
  result: FoundationAssessmentResult;
}

export interface AssessmentFailureMessage {
  type: "ASSESSMENT_FAILED";
  requestId: string;
  errorCode: "INVALID_SYNTHETIC_INPUT" | "LOCAL_MODEL_FAILED";
}

export type AssessmentResponseMessage =
  | AssessmentSuccessMessage
  | AssessmentFailureMessage;
