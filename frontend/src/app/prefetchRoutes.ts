/**
 * 주 메뉴가 갈 만한 화면의 청크를 미리 받아 둔다.
 *
 * **왜 필요한가.** 라우트는 청크로 쪼개져 있어(`lazyRoutes.ts`) 그 화면에 처음 갈 때
 * 한 번은 받아야 한다. 누른 뒤에 받기 시작하면 그 왕복이 고스란히 스켈레톤을 보는
 * 시간이 되지만, 한가할 때·손이 닿았을 때 미리 받아 두면 누르는 순간에는 이미 있어서
 * **폴백을 지나치고 바로 그려진다.**
 *
 * `import()` 는 모듈 레지스트리가 이미 받은 것을 다시 받지 않으므로 몇 번 불러도
 * 그물망 왕복은 한 번뿐이다. 그래서 따로 호출 여부를 기록하지 않는다.
 */

type Loader = () => Promise<unknown>;

/** 주소 앞부분 → 그 화면 청크를 받는 함수. `lazyRoutes.ts` 와 같은 경로를 쓴다. */
const ROUTE_LOADERS: ReadonlyArray<readonly [prefix: string, load: Loader]> = [
  ["/assessment", () => import("../features/assessment/AssessmentPage")],
  ["/pain-diary", () => import("../features/pain-diary/PainDiaryPage")],
  ["/health-data", () => import("../features/health-data/HealthDataPage")],
  ["/account", () => import("../features/account/AccountPage")],
  ["/challenge", () => import("../features/challenge/ChallengeSetupPage")],
  ["/data", () => import("../features/data/DataManagementPage")],
];

/** 주 메뉴에 실제로 서 있는 넷. 한가할 때 이만큼만 미리 받는다. */
const NAVIGATION_PREFIXES = ["/assessment", "/pain-diary", "/health-data", "/account"] as const;

function loaderFor(pathname: string): Loader | undefined {
  return ROUTE_LOADERS.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1];
}

/** 링크에 손이 닿았을 때(hover·focus·터치) 그 화면 청크부터 받는다. */
export function prefetchRouteFor(pathname: string): void {
  // 받다 실패해도 사용자가 볼 일은 없다 — 실제 이동에서 다시 받으면 된다.
  void loaderFor(pathname)?.().catch(() => undefined);
}

/**
 * 첫 화면이 다 그려지고 **한가해진 뒤** 주 메뉴 넷을 받아 둔다.
 *
 * 첫 화면과 경쟁시키지 않는 것이 핵심이다. `requestIdleCallback` 이 없는 브라우저
 * (사파리)는 `setTimeout` 으로 미룬다. 데이터 아끼는 설정(`saveData`)이나 느린
 * 회선에서는 아예 하지 않는다 — 안 볼 수도 있는 화면을 위해 남의 데이터를 쓰지 않는다.
 */
export function prefetchNavigationRoutes(): () => void {
  if (typeof window === "undefined") return () => undefined;

  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (connection?.saveData) return () => undefined;
  if (connection?.effectiveType && /(^|-)2g$/u.test(connection.effectiveType)) return () => undefined;

  const run = () => {
    for (const prefix of NAVIGATION_PREFIXES) prefetchRouteFor(prefix);
  };

  const idle = (window as Window & typeof globalThis & { requestIdleCallback?: typeof requestIdleCallback })
    .requestIdleCallback;
  if (typeof idle === "function") {
    const handle = idle(run, { timeout: 3000 });
    return () => {
      (
        window as Window & typeof globalThis & { cancelIdleCallback?: typeof cancelIdleCallback }
      ).cancelIdleCallback?.(handle);
    };
  }

  const timer = window.setTimeout(run, 1200);
  return () => window.clearTimeout(timer);
}
