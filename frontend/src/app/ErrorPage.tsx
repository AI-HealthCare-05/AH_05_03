import { Link, isRouteErrorResponse, useRouteError } from "react-router-dom";

/**
 * 라우터가 잡은 오류를 사용자 언어로 옮긴다.
 *
 * `errorElement` 를 안 주면 react-router 의 기본 화면이 뜬다. 거기에는
 * "Unexpected Application Error!" 와 "💿 Hey developer 👋 ... errorElement prop"
 * 이 그대로 찍힌다. 개발자에게 하는 말이 사용자 화면에 나가는 것이고,
 * 이 제품은 건강 정보를 다루므로 그 한 줄이 신뢰를 깎는다.
 *
 * 그래서 두 가지를 지킨다.
 *
 * **하나. 사용자가 할 수 있는 일을 준다.** "오류가 발생했습니다"로 끝내면
 * 화면이 막다른 길이 된다. 홈으로 가는 길과 되돌아가는 길을 항상 같이 둔다.
 *
 * **둘. 원인은 숨기되 버리지 않는다.** 상태 코드와 메시지는 접어 두고
 * 콘솔에는 원본을 남긴다 — 사용자에게 스택을 보여줄 이유는 없지만,
 * 문의가 들어왔을 때 재현할 단서까지 없애면 안 된다.
 */
export function ErrorPage() {
  const error = useRouteError();

  // 이 화면에 오는 길이 둘이다. `errorElement` 로 오면 error 가 채워져 있고,
  // catch-all 라우트(`path: "*"`)의 element 로 오면 **null 이다** — 던져진 오류가
  // 없고 그냥 주소가 안 맞은 것이기 때문이다. 그 경우를 404 로 안 치면 없는 페이지에
  // "화면을 불러오지 못했습니다" 가 떠서, 사용자는 서비스가 고장 난 줄 안다.
  const routeError = isRouteErrorResponse(error) ? error : undefined;
  const notFound = error == null || routeError?.status === 404;
  const status = routeError?.status;
  const detail = routeError
    ? routeError.statusText || routeError.data
    : error instanceof Error
      ? error.message
      : undefined;

  if (import.meta.env.DEV && error != null) {
    console.error("[router]", error);
  }

  return (
    <main className="product-page error-page">
      <p className="page-kicker">{notFound ? "페이지 없음" : "문제 발생"}</p>
      <div className="error-card">
        <h1>{notFound ? "찾으시는 페이지가 없습니다" : "화면을 불러오지 못했습니다"}</h1>
        <p className="error-lede">
          {notFound
            ? "주소가 바뀌었거나 잘못 입력됐을 수 있습니다. 기록은 그대로 기기에 남아 있습니다."
            : "잠시 후 다시 시도해 주세요. 저장된 기록에는 영향이 없습니다."}
        </p>

        <div className="error-actions">
          <Link to="/" className="error-primary">
            홈으로 가기
          </Link>
          <button type="button" onClick={() => window.history.back()}>
            이전으로
          </button>
        </div>

        {(status !== undefined || detail) && (
          <details className="error-detail">
            <summary>기술 정보</summary>
            <p>
              {status !== undefined && <code>{status}</code>}
              {detail && <span>{String(detail)}</span>}
            </p>
          </details>
        )}
      </div>
    </main>
  );
}
