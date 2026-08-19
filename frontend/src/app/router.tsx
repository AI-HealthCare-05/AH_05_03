import { createBrowserRouter } from "react-router-dom";

import { ArchitecturePage } from "../features/architecture/ArchitecturePage";
import { DataManagementPage } from "../features/data/DataManagementPage";
import { HomePage } from "../features/home/HomePage";
import { RootLayout } from "./RootLayout";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        path: "data",
        element: <DataManagementPage />,
      },
      {
        path: "dev/architecture",
        element: <ArchitecturePage />,
      },
    ],
  },
]);
