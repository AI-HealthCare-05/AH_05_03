import { createBrowserRouter } from "react-router-dom";

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
  },
  {
    path: "/",
    element: <RootLayout />,
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
    ],
  },
]);
