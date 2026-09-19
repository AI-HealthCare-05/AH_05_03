import { Suspense } from "react";
import { Navigate, createBrowserRouter } from "react-router-dom";

import { ErrorPage } from "./ErrorPage";
import { SignUpPage } from "../features/account/SignUpPage";
import { HomePage } from "../features/home/HomePage";
import { PageSkeleton } from "../shared/ui/Skeleton";
// 라우트 단위 코드 분할. 정적 임포트로 두면 페이지 일곱이 한 청크에 뭉쳐서,
// 홈만 보는 사용자도 판정 폼 36필드와 개발용 화면까지 받아 간다.
import {
  AccountPage,
  ArchitecturePage,
  AssessmentPage,
  ChallengePage,
  ChallengeSetupPage,
  DataManagementPage,
  HealthDataPage,
  LandingPage,
  LandingV2Page,
  PainDiaryPage,
  UiPreviewPage,
  UiPreview1Page,
  UiPreview2Page,
  UiPreview3Page,
  UiPreview4Page,
  UiPreview5Page,
  UiPreview6Page,
  UiPreview7Page,
  UiPreview8Page,
  UiPreview9Page,
  UiPreview10Page,
  UiPreview11Page,
  UiPreview12Page,
  UiPreview13Page,
  UiPreview14Page,
  UiPreview15Page,
  UiPreview16Page,
  UiPreview17Page,
  FamilyHomePage,
  HealthData3Page,
  WallOverviewPage,
  WallPairPage,
} from "./lazyRoutes";
import { RootLayout } from "./RootLayout";

export const router = createBrowserRouter([
  {
    // **관문 밖에 있는 화면.** 로그인 관문은 `RootLayout` 이 `Outlet` 대신
    // 그리는 것이라 주소가 없는데, 가입은 사람에게 링크로 건네야 해서 주소가
    // 필요하다. 밖에 둘 수 있는 조건은 하나 — 기기 안 건강기록을 읽지 않을 것.
    // `SignUpPage` 는 `useLocalDomain` 을 쓰지 않고, 로그인한 사람이 오면 스스로
    // 비킨다. 이 예외가 하나뿐이라는 것은 `router.test.tsx` 가 지킨다.
    path: "/signup",
    element: <SignUpPage />,
    errorElement: <ErrorPage />,
  },
  {
    // **관문 밖에 있는 둘째 화면 — 공개 소개 페이지.** 가입과 같은 조건을 지켜서
    // 밖에 세운다: `useLocalDomain()` 도 `serverApiClient` 도 부르지 않고, 화면에
    // 나오는 수치는 `features/landing/landingStory.ts` 의 예시 시나리오 하나뿐이다
    // (그 사실은 `features/landing/LandingPage.test.tsx` 가 지킨다).
    //
    // 주소가 필요한 이유도 가입과 같다 — 서비스를 아직 모르는 사람에게 링크로
    // 건네는 화면이라 로그인 뒤에만 열리면 쓸모가 없다.
    path: "/landing",
    element: (
      // 이 라우트는 `RootLayout` 밖이라 그쪽의 Suspense 경계를 못 쓴다. 폴백이
      // 없으면 지연 청크를 받는 동안 React 가 그대로 던진다.
      <Suspense fallback={<PageSkeleton />}>
        <LandingPage />
      </Suspense>
    ),
    errorElement: <ErrorPage />,
  },
  {
    // **관문 밖에 있는 셋째 화면 — 소개 페이지의 대안 디자인 시안(v2).**
    // 자격은 `/landing` 과 한 글자도 다르지 않다: `features/landing-v2` 는
    // `useLocalDomain` 도 `serverApiClient` 도 부르지 않고, 화면의 수치는 v1 과
    // **같은** `features/landing/landingStory.ts` 의 예시 시나리오다
    // (`features/landing-v2/LandingV2Page.test.tsx` 가 지킨다).
    //
    // 주소를 따로 둔 이유는 견주기 위해서다. 로그아웃 상태의 `/` 는 여전히
    // `/landing`(v1)로 간다 — 어느 쪽을 정본으로 세울지는 디자인 결정이고,
    // 그 결정 전에 기본 동작을 바꾸지 않는다.
    path: "/landing-v2",
    element: (
      <Suspense fallback={<PageSkeleton />}>
        <LandingV2Page />
      </Suspense>
    ),
    errorElement: <ErrorPage />,
  },
  {
    // 공용 벽. 마스터 로그인 세션 없이 기기 토큰만 쓴다. 건강 수치·로컬 정본을 읽지 않는다.
    path: "/wall/pair",
    element: (
      <Suspense fallback={<PageSkeleton />}>
        <WallPairPage />
      </Suspense>
    ),
    errorElement: <ErrorPage />,
  },
  {
    path: "/wall",
    element: (
      <Suspense fallback={<PageSkeleton />}>
        <WallOverviewPage />
      </Suspense>
    ),
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
        element: <FamilyHomePage />,
      },
      {
        // 랜딩의 「로그인」이 가리키는 주소. 로그아웃 상태에서 `/` 는 소개로 비키므로
        // 로그인 폼을 보려면 여기로 와야 한다. 이미 들어와 있으면 홈으로 보낸다.
        path: "signin",
        element: <Navigate to="/" replace />,
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
        // **2026-09-10 `insights` 를 여기로 합쳤다.** 판정 스냅샷 추이와 기기 안
        // `healthRecords` 추이가 화면 둘로 갈려 있었다 — 검사 수치를 보려면 어느
        // 화면에 있는지 먼저 알아야 했다. 챌린지 카드(`ChallengeDashboardCard`)는
        // `insights` 에만 있던 유일한 자리라 같이 옮겼다.
        path: "health-data",
        element: <HealthDataPage />,
      },
      {
        path: "health-data3",
        element: <HealthData3Page />,
      },
      {
        // 옛 주소. 북마크·지난 링크가 404 가 되면 사용자는 기능이 사라진 줄 안다
        // (아래 `/data` 와 같은 이유).
        path: "insights",
        element: <Navigate to="/health-data" replace />,
      },
      {
        // **2026-09-11 계정 화면으로 합쳤다가 도로 뺐다.** 백업·복구·건강자료
        // 관리가 계정 화면 안에 얹히니 그 화면 하나가 너무 길고 무거워졌다
        // (구독·가정·초대·연결·탈퇴 사이에 다른 무게의 화면이 끼어든 셈).
        // 자기 주소로 되돌린다 — `lazyRoutes.ts` 의 지연 로드는 합칠 때도
        // 지우지 않아 그대로 남아 있었다.
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
      {
        // **`RootLayout` 밖에 있었다.** 그래서 로그인 관문을 거치지 않았는데,
        // 이 화면은 `useLocalDomain()` 으로 기기 안 프로필과 건강기록을 읽는다 —
        // 로그인하지 않은 사람이 주소만 치면 그게 그대로 보였다. 내비게이션에서
        // 링크를 뺐어도 주소는 살아 있으므로 링크를 빼는 것으로는 막히지 않는다.
        path: "ui-preview",
        element: <UiPreviewPage />,
      },
      {
        path: "ui-preview1",
        element: <UiPreview1Page />,
      },
      {
        path: "ui-preview2",
        element: <UiPreview2Page />,
      },
      {
        path: "ui-preview3",
        element: <UiPreview3Page />,
      },
      {
        path: "ui-preview4",
        element: <UiPreview4Page />,
      },
      {
        path: "ui-preview5",
        element: <UiPreview5Page />,
      },
      {
        path: "ui-preview6",
        element: <UiPreview6Page />,
      },
      {
        path: "ui-preview7",
        element: <UiPreview7Page />,
      },
      {
        path: "ui-preview8",
        element: <UiPreview8Page />,
      },
      {
        path: "ui-preview9",
        element: <UiPreview9Page />,
      },
      {
        path: "ui-preview10",
        element: <UiPreview10Page />,
      },
      {
        path: "ui-preview11",
        element: <UiPreview11Page />,
      },
      {
        path: "ui-preview12",
        element: <UiPreview12Page />,
      },
      {
        path: "ui-preview13",
        element: <UiPreview13Page />,
      },
      {
        path: "ui-preview14",
        element: <UiPreview14Page />,
      },
      {
        path: "ui-preview15",
        element: <UiPreview15Page />,
      },
      {
        path: "ui-preview16",
        element: <UiPreview16Page />,
      },
      {
        path: "ui-preview17",
        element: <UiPreview17Page />,
      },
      {
        path: "ui-preview18",
        element: <Navigate to="/" replace />,
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
