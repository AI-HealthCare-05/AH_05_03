import type {
  AssessmentRequestMessage,
  AssessmentResponseMessage,
  FoundationAssessmentInput,
  FoundationAssessmentResult,
} from "./contracts";

const WORKER_TIMEOUT_MS = 5_000;

export async function runAssessmentInWorker(
  input: FoundationAssessmentInput,
): Promise<FoundationAssessmentResult> {
  const worker = new Worker(new URL("../../workers/assessment.worker.ts", import.meta.url), {
    type: "module",
    name: "ieobom-local-assessment",
  });
  const requestId = crypto.randomUUID();
  const request: AssessmentRequestMessage = {
    type: "ASSESS",
    requestId,
    input,
  };

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("로컬 모델 실행 시간이 초과되었습니다."));
    }, WORKER_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<AssessmentResponseMessage>) => {
      if (event.data.requestId !== requestId) {
        return;
      }

      window.clearTimeout(timeoutId);
      worker.terminate();

      if (event.data.type === "ASSESSMENT_COMPLETE") {
        resolve(event.data.result);
        return;
      }

      reject(new Error(event.data.errorCode));
    };

    worker.onerror = () => {
      window.clearTimeout(timeoutId);
      worker.terminate();
      reject(new Error("로컬 모델 worker 실행에 실패했습니다."));
    };

    worker.postMessage(request);
  });
}
