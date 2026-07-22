import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["node_modules/**"]
  },
  {
    files: ["src/**/*.js"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./jsconfig.json"
      },
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.serviceworker,
        ...globals.worker
      }
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin
    },
    rules: {
      ...js.configs.recommended.rules,
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          "ignoreVoid": false
        }
      ]
    }
  }
];
