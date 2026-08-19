import { useAccountSummaryQuery } from "../../shared/api/serviceMetadataClient";

export function ArchitecturePage() {
  const accountQuery = useAccountSummaryQuery();

  return (
    <section className="content-section architecture-page">
      <div className="content-width">
        <div className="section-heading">
          <p className="eyebrow">DATA BOUNDARY</p>
          <h1>서버 상태와 로컬 건강정보를 분리합니다</h1>
          <p>
            같은 React 화면에서도 데이터의 성격에 따라 서로 다른 경로를 사용합니다.
          </p>
        </div>

        <div className="flow-grid">
          <article className="flow-card local-flow">
            <span>LOCAL</span>
            <h2>건강정보 기능</h2>
            <ol>
              <li>React UI</li>
              <li>Local Domain API</li>
              <li>Web Crypto</li>
              <li>IndexedDB·OPFS</li>
            </ol>
            <strong>네트워크 요청 없음</strong>
          </article>
          <article className="flow-card server-flow">
            <span>SERVER</span>
            <h2>서비스 메타데이터</h2>
            <ol>
              <li>React UI</li>
              <li>TanStack Query</li>
              <li>Server API Client</li>
              <li>FastAPI·PostgreSQL</li>
            </ol>
            <strong>건강정보 포함 금지</strong>
          </article>
        </div>

        <article className="server-check-card">
          <div>
            <p className="card-kicker">명시적 서버 요청 예시</p>
            <h2>서비스 계정 메타데이터</h2>
            <p>
              아래 버튼만 TanStack Query를 통해 서버 API를 호출합니다. 로그인하지 않은
              개발 환경에서는 실패할 수 있습니다.
            </p>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void accountQuery.refetch()}
            disabled={accountQuery.isFetching}
          >
            {accountQuery.isFetching ? "확인 중…" : "계정 상태 확인"}
          </button>
          {accountQuery.isSuccess ? (
            <p role="status">계정 상태: {accountQuery.data.account.status}</p>
          ) : null}
          {accountQuery.isError ? (
            <p className="muted-copy" role="alert">
              서버 연결 또는 인증이 필요합니다.
            </p>
          ) : null}
        </article>
      </div>
    </section>
  );
}
