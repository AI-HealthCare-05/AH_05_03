import { createBrowserRouter } from "react-router-dom";

import { ErrorPage } from "./ErrorPage";
import { ArchitecturePage } from "../features/architecture/ArchitecturePage";
import { DataManagementPage } from "../features/data/DataManagementPage";
import { HomePage } from "../features/home/HomePage";
import { UiPreviewPage } from "../features/ui-preview/UiPreviewPage";
import { AccountPage } from "../features/account/AccountPage";
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
      // 막다른 길에 서지 않는다. `/demo` 처럼 서버 쪽 경로를 잘못 친 경우도 여기로 온다.
      {
        path: "*",
        element: <ErrorPage />,
      },
    ],
  },
]);
