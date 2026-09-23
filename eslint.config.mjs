import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // fetch-on-mount 已改為在 effect 內以非同步回呼 setState（0 warning），恢復為 error 防止回歸
      "react-hooks/set-state-in-effect": "error",
      // 允許 _ 前綴的未使用參數
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-test/**",
    // 其他 distDir（NEXT_DIST_DIR=.next-test-<port>、.next-<agent>）與測試輸出
    ".next-*/**",
    "test-results/**",
    "playwright-report/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
