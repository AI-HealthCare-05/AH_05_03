import { Navigate, createBrowserRouter } from "react-router-dom";

import { ErrorPage } from "./ErrorPage";
import { SignUpPage } from "../features/account/SignUpPage";
import { HomePage } from "../features/home/HomePage";
// 라우트 단위 코드 분할. 정적 임포트로 두면 페이지 일곱이 한 청크에 뭉쳐서,
// 홈만 보는 사용자도 판정 폼 36필드와 개발용 화면까지 받아 간다.
import {
  AccountPage,
  ArchitecturePage,
  AssessmentPage,
  ChallengePage,
  ChallengeSetupPage,
  HealthDataPage,
  InsightsPage,
  PainDiaryPage,
  UiPreviewPage,
} from "./lazyRoutes";
import { RootLayout } from "./RootLayout";

export const router = createBrowserRouter([
  {
    // **관문 밖에 있는 유일한 화면.** 로그인 관문은 `RootLayout` 이 `Outlet` 대신
    // 그리는 것이라 주소가 없는데, 가입은 사람에게 링크로 건네야 해서 주소가
    // 필요하다. 밖에 둘 수 있는 조건은 하나 — 기기 안 건강기록을 읽지 않을 것.
    // `SignUpPage` 는 `useLocalDomain` 을 쓰지 않고, 로그인한 사람이 오면 스스로
    // 비킨다. 이 예외가 하나뿐이라는 것은 `router.test.tsx` 가 지킨다.
    path: "/signup",
    element: <SignUpPage />,
    errorElement: <ErrorPage />,
  },
  {
    path: "/",
    element: <RootLayout />,
    // 이게 없으면 react-router 기본 화면이 뜬다 — "Unexpected Application Error!"
    // 와 "💿 Hey developer 👋 ... errorElement prop" 이 사용자에게 그대로 나간다.
    errorElement: <ErrorPage />,
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        path: "members/:profileId",
        element: <HomePage />,
      },
      {
        path: "members/:profileId/records",
        element: <HomePage />,
      },
      {
        path: "members/:profileId/records/:recordId",
        element: <HomePage />,
      },
      {
        path: "members/:profileId/family-history",
        element: <HomePage />,
      },
      {
        // 판정 화면. 검진표를 옆에 두고 수치를 고쳐 예측까지 한 화면에서 한다.
        path: "assessment",
        element: <AssessmentPage />,
      },
      {
        // 통증 다이어리. 매일의 통증 기록과 캘린더 조회/수정 및 AI 툴콜링 연동.
        path: "pain-diary",
        element: <PainDiaryPage />,
      },
      {
        // 생활습관 챌린지. Talos 필수 셋 중 마지막으로 비어 있던 칸 (docs/37 §14~§16).
        // `/challenge` 는 셋업(모드·주간 목표·재는 날)이고, 한 번 고른 뒤에는
        // `/challenge/today` 로 넘어간다.
        path: "challenge",
        element: <ChallengeSetupPage />,
      },
      {
        path: "challenge/today",
        element: <ChallengePage />,
      },
      {
        // 챌린지와 판정 수치를 모아 보는 곳. 가족 홈이 "관리", 여기가 "현황" 이다.
        path: "insights",
        element: <InsightsPage />,
      },
      {
        // 건강기록 자체를 기간별로 훑는 곳. `insights` 와 겹쳐 보이지만 원천이 다르다 —
        // 여기는 기기 안 `healthRecords`, `insights` 는 판정 스냅샷이다. 한쪽을 지우면
        // 검사 지표 추이나 챌린지 달성 둘 중 하나가 갈 곳을 잃는다.
        path: "health-data",
        element: <HealthDataPage />,
      },
      {
        // 계정 화면으로 합쳤다. 주소는 살려 둔다 — 북마크와 지난 링크가 404 가
        // 되면 사용자는 기능이 사라진 줄 안다.
        path: "data",
        element: <Navigate to="/account" replace />,
      },
      {
        path: "account",
        element: <AccountPage />,
      },
      {
        path: "dev/architecture",
        element: <ArchitecturePage />,
      },
      {
        // **`RootLayout` 밖에 있었다.** 그래서 로그인 관문을 거치지 않았는데,
        // 이 화면은 `useLocalDomain()` 으로 기기 안 프로필과 건강기록을 읽는다 —
        // 로그인하지 않은 사람이 주소만 치면 그게 그대로 보였다. 내비게이션에서
        // 링크를 뺐어도 주소는 살아 있으므로 링크를 빼는 것으로는 막히지 않는다.
        path: "ui-preview",
        element: <UiPreviewPage />,
      },
      // 레이아웃 안에서 잡는 404. 헤더와 내비게이션이 남아 있어야 사용자가
      // 막다른 길에 서지 않는다. 주소를 잘못 친 경우도 여기로 온다.
      {
        path: "*",
        element: <ErrorPage />,
      },
    ],
  },
]);
