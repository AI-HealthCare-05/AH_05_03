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
export const DataManagementPage = lazy(() =>
  import("../features/data/DataManagementPage").then((m) => ({ default: m.DataManagementPage })),
);
export const UiPreviewPage = lazy(() =>
  import("../features/ui-preview/UiPreviewPage").then((m) => ({ default: m.UiPreviewPage })),
);
export const AccountPage = lazy(() =>
  import("../features/account/AccountPage").then((m) => ({ default: m.AccountPage })),
);
