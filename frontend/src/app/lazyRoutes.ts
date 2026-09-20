/**
 * 라우트 단위로 쪼갠 화면들.
 *
 * `router.tsx` 에 함께 두면 `react-refresh/only-export-components` 에 걸린다 —
 * 컴포넌트와 `router` 상수를 한 파일에서 내보내기 때문이다. 규칙이 안내하는 대로
 * 나눴다.
 *
 * 홈은 여기 없다. 첫 화면이라 쪼개도 어차피 바로 받아야 한다.
 */

import { lazy } from "react";

export const ArchitecturePage = lazy(() =>
  import("../features/architecture/ArchitecturePage").then((m) => ({ default: m.ArchitecturePage })),
);
export const AssessmentPage = lazy(() =>
  import("../features/assessment/AssessmentPage").then((m) => ({ default: m.AssessmentPage })),
);
export const ChallengePage = lazy(() =>
  import("../features/challenge/ChallengePage").then((m) => ({ default: m.ChallengePage })),
);
export const ChallengeSetupPage = lazy(() =>
  import("../features/challenge/ChallengeSetupPage").then((m) => ({ default: m.ChallengeSetupPage })),
);
export const HealthDataPage = lazy(() =>
  import("../features/health-data/HealthDataPage").then((m) => ({ default: m.HealthDataPage })),
);
export const DataManagementPage = lazy(() =>
  import("../features/data/DataManagementPage").then((m) => ({ default: m.DataManagementPage })),
);
export const UiPreviewPage = lazy(() =>
  import("../features/ui-preview/UiPreviewPage").then((m) => ({ default: m.UiPreviewPage })),
);
export const UiPreview1Page = lazy(() =>
  import("../features/ui-preview/variants/UiPreview1Page").then((m) => ({ default: m.UiPreview1Page })),
);
export const UiPreview2Page = lazy(() =>
  import("../features/ui-preview/variants/UiPreview2Page").then((m) => ({ default: m.UiPreview2Page })),
);
export const UiPreview3Page = lazy(() =>
  import("../features/ui-preview/variants/UiPreview3Page").then((m) => ({ default: m.UiPreview3Page })),
);
export const UiPreview4Page = lazy(() =>
  import("../features/ui-preview/variants/UiPreview4Page").then((m) => ({ default: m.UiPreview4Page })),
);
export const UiPreview5Page = lazy(() =>
  import("../features/ui-preview/variants/UiPreview5Page").then((m) => ({ default: m.UiPreview5Page })),
);
export const UiPreview6Page = lazy(() =>
  import("../features/ui-preview/variants/UiPreview6Page").then((m) => ({ default: m.UiPreview6Page })),
);
export const UiPreview7Page = lazy(() =>
  import("../features/ui-preview/variants/UiPreview7Page").then((m) => ({ default: m.UiPreview7Page })),
);
export const UiPreview8Page = lazy(() =>
  import("../features/ui-preview/variants/UiPreview8Page").then((m) => ({ default: m.UiPreview8Page })),
);
export const UiPreview9Page = lazy(() =>
  import("../features/ui-preview/variants/UiPreview9Page").then((m) => ({ default: m.UiPreview9Page })),
);
export const UiPreview10Page = lazy(() =>
  import("../features/ui-preview/variants/UiPreview10Page").then((m) => ({ default: m.UiPreview10Page })),
);
export const UiPreview11Page = lazy(() =>
  import("../features/ui-preview/variants/UiPreview11Page").then((m) => ({ default: m.UiPreview11Page })),
);
export const UiPreview12Page = lazy(() =>
  import("../features/ui-preview/variants/UiPreview12Page").then((m) => ({ default: m.UiPreview12Page })),
);
export const UiPreview13Page = lazy(() =>
  import("../features/ui-preview/variants/UiPreview13Page").then((m) => ({ default: m.UiPreview13Page })),
);
export const UiPreview14Page = lazy(() =>
  import("../features/ui-preview/variants/UiPreview14Page").then((m) => ({ default: m.UiPreview14Page })),
);
export const UiPreview15Page = lazy(() =>
  import("../features/ui-preview/variants/UiPreview15Page").then((m) => ({ default: m.UiPreview15Page })),
);
export const UiPreview16Page = lazy(() =>
  import("../features/ui-preview/variants/UiPreview16Page").then((m) => ({ default: m.UiPreview16Page })),
);
export const UiPreview17Page = lazy(() =>
  import("../features/ui-preview/variants/UiPreview17Page").then((m) => ({ default: m.UiPreview17Page })),
);
export const FamilyHomePage = lazy(() =>
  import("../features/home/FamilyHomePage").then((m) => ({ default: m.FamilyHomePage })),
);
export const HealthData3Page = lazy(() =>
  import("../features/health-data/HealthData3Page").then((m) => ({ default: m.HealthData3Page })),
);
export const AccountPage = lazy(() =>
  import("../features/account/AccountPage").then((m) => ({ default: m.AccountPage })),
);
export const PainDiaryPage = lazy(() =>
  import("../features/pain-diary/PainDiaryPage").then((m) => ({ default: m.PainDiaryPage })),
);
/**
 * 공개 랜딩페이지. 로그인한 사람은 평생 한 번도 열지 않는 화면이라 앱 번들과
 * 같이 받으면 순수 손해다(스크롤 연출·three.js 장면이 딸려 온다).
 */
export const LandingPage = lazy(() =>
  import("../features/landing/LandingPage").then((m) => ({ default: m.LandingPage })),
);
export const WallPairPage = lazy(() =>
  import("../features/home/WallPairPage").then((m) => ({ default: m.WallPairPage })),
);
export const WallOverviewPage = lazy(() =>
  import("../features/home/WallOverviewPage").then((m) => ({ default: m.WallOverviewPage })),
);
