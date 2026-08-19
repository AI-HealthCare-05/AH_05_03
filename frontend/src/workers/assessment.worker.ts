/// <reference lib="webworker" />

import type {
  AssessmentRequestMessage,
  AssessmentResponseMessage,
} from "../shared/model/contracts";
import { runFoundationAssessment } from "../shared/model/mockAssessmentEngine";

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<AssessmentRequestMessage>) => {
  const request = event.data;

  if (request.type !== "ASSESS") {
    return;
  }

  let response: AssessmentResponseMessage;

  try {
    response = {
      type: "ASSESSMENT_COMPLETE",
      requestId: request.requestId,
      result: runFoundationAssessment(request.input),
    };
  } catch {
    response = {
      type: "ASSESSMENT_FAILED",
      requestId: request.requestId,
      errorCode: "INVALID_SYNTHETIC_INPUT",
    };
  }

  workerScope.postMessage(response);
};
