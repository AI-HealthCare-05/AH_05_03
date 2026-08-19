import { useMemo, useState } from "react";

import { detectLocalCapabilities } from "../../shared/local/capabilities";
import type { FoundationAssessmentResult } from "../../shared/model/contracts";
import { runAssessmentInWorker } from "../../shared/model/assessmentWorkerClient";

const SYNTHETIC_INPUT = {
  schemaVersion: 1,
  modelId: "foundation-smoke-test",
  synthetic: true,
  metrics: {
    first: 17,
    second: 25,
  },
} as const;

export function HomePage() {
  const capabilities = useMemo(() => detectLocalCapabilities(), []);
  const [result, setResult] = useState<FoundationAssessmentResult>();
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);

  async function runLocalCheck() {
    setRunning(true);
    setResult(undefined);
    setError(undefined);

    try {
      setResult(await runAssessmentInWorker(SYNTHETIC_INPUT));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "로컬 실행에 실패했습니다.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <section className="hero">
        <div className="content-width hero-grid">
          <div>
            <p className="eyebrow">LOCAL-FIRST FOUNDATION</p>
            <h1>
              건강정보가 서버로 가지 않는
              <br />
              프론트엔드 기반
            </h1>
            <p className="hero-copy">
              이어봄은 계정 메타데이터와 건강정보를 분리합니다. 현재 화면은 브라우저
              저장소와 로컬 모델 실행 경계를 검증하는 기초 구현입니다.
            </p>
            <div className="hero-actions">
              <button
                className="primary-button"
                type="button"
                onClick={runLocalCheck}
                disabled={running}
              >
                {running ? "로컬 worker 확인 중…" : "합성 데이터로 로컬 실행 확인"}
              </button>
              <span className="privacy-label">이 동작은 /api 요청을 만들지 않습니다.</span>
            </div>

            {result ? (
              <div className="result-banner" role="status" data-testid="local-result">
                <strong>{result.resultCode}</strong>
                <span>worker checksum {result.checksum}</span>
              </div>
            ) : null}
            {error ? (
              <div className="error-banner" role="alert">
                {error}
              </div>
            ) : null}
          </div>

          <aside className="boundary-card" aria-label="데이터 처리 경계">
            <p className="card-kicker">처리 위치</p>
            <h2>사용자 브라우저</h2>
            <ul className="plain-list">
              <li>가족 구성원 로컬 프로필</li>
              <li>건강기록·가족력·원본 서류</li>
              <li>OCR·규칙 평가·예측 결과</li>
            </ul>
            <div className="boundary-divider" />
            <p className="card-kicker">원격 서버</p>
            <p className="muted-copy">계정·구독·초대와 불투명 연결정보만 처리</p>
          </aside>
        </div>
      </section>

      <section className="content-section">
        <div className="content-width">
          <div className="section-heading">
            <p className="eyebrow">BROWSER CAPABILITIES</p>
            <h2>이 브라우저의 로컬 기능</h2>
          </div>

          <div className="capability-grid">
            {capabilities.map((capability) => (
              <article className="capability-card" key={capability.id}>
                <span
                  className={capability.supported ? "status-dot is-ready" : "status-dot"}
                  aria-hidden="true"
                />
                <div>
                  <h3>{capability.label}</h3>
                  <p>
                    {capability.supported ? "사용 가능" : "현재 브라우저에서 지원되지 않음"}
                    {capability.requiredNow ? " · 초기 필수" : " · 후순위"}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="content-section is-tinted">
        <div className="content-width">
          <div className="section-heading">
            <p className="eyebrow">CURRENT SCOPE</p>
            <h2>지금 구현한 것과 아직 구현하지 않은 것</h2>
          </div>
          <div className="scope-grid">
            <article>
              <h3>현재 기반</h3>
              <ul>
                <li>React·TypeScript SPA와 반응형 레이아웃</li>
                <li>서버 상태와 화면 상태 provider 분리</li>
                <li>암호문 전용 IndexedDB 저장소 계약</li>
                <li>합성 입력 전용 Web Worker 모델 경계</li>
              </ul>
            </article>
            <article>
              <h3>후속 구현</h3>
              <ul>
                <li>실제 암호화 키 복구·백업 정책</li>
                <li>건강기록 입력과 OPFS 원본 파일</li>
                <li>검증된 TypeScript·Rust/WASM·ONNX 모델</li>
                <li>모델 버전 전환과 복구 UI</li>
              </ul>
            </article>
          </div>
        </div>
      </section>
    </>
  );
}
