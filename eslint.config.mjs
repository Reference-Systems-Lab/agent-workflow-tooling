import js from "@eslint/js";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";

export default [
  {
    ignores: [
      ".vscode/",
      // TypeScript, checked by its own tsc build.
      "plugins/workflow/",
      "evals/frontend-craft/fixtures/**/dist/",
      "evals/frontend-craft/runs/",
      "evals/frontend-craft/results/",
    ],
  },
  js.configs.recommended,
  prettierRecommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: { ...globals.node, ...globals.es2021 },
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: { sourceType: "module" },
    rules: { "prettier/prettier": "off" },
  },
  {
    files: ["evals/frontend-craft/fixtures/**/*.js"],
    languageOptions: { sourceType: "module", globals: globals.browser },
  },
];
