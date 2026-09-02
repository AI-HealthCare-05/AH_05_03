import { createBrowserRouter } from "react-router-dom";

import { ErrorPage } from "./ErrorPage";
import { HomePage } from "../features/home/HomePage";
// 라우트 단위 코드 분할. 정적 임포트로 두면 페이지 일곱이 한 청크에 뭉쳐서,
// 홈만 보는 사용자도 판정 폼 36필드와 개발용 화면까지 받아 간다.
import {
  AccountPage,
  ArchitecturePage,
  AssessmentPage,
  ChallengePage,
  ChallengeSetupPage,
  DataManagementPage,
  InsightsPage,
  UiPreviewPage,
} from "./lazyRoutes";
import { RootLayout } from "./RootLayout";

export const router = createBrowserRouter([
  {
    path: "/ui-preview",
    element: <UiPreviewPage />,
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
        // 챌린지와 수치를 모아 보는 곳. 가족 홈이 "관리", 여기가 "현황" 이다.
        path: "insights",
        element: <InsightsPage />,
      },
      {
        path: "data",
        element: <DataManagementPage />,
      },
      {
        path: "account",
        element: <AccountPage />,
      },
      {
        path: "dev/architecture",
        element: <ArchitecturePage />,
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
