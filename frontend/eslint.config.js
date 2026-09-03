import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist", "coverage", "playwright-report", "test-results"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // 이 프로젝트는 IndexedDB 같은 외부 저장소를 effect에서 불러온다.
      // React 19의 권고성 compiler 규칙보다 기존 비동기 로딩 패턴을 우선한다.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      // 일부 화면 파일은 테스트 가능한 순수 헬퍼도 함께 export한다.
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: [
      "src/shared/local/**/*.{ts,tsx}",
      "src/shared/model/**/*.{ts,tsx}",
      "src/workers/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "로컬 건강정보 계층에서는 네트워크 요청을 사용할 수 없습니다.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/api/**", "@tanstack/react-query"],
              message: "Local Domain과 모델 계층은 Server API 계층을 import할 수 없습니다.",
            },
          ],
        },
      ],
    },
  },
]);
