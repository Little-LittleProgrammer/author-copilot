import tseslint from "typescript-eslint";

export const baseConfig = [
  {
    name: "author-copilot/ignores",
    ignores: [
      "**/coverage/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/release/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    name: "author-copilot/base",
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports", prefer: "type-imports" },
      ],
      "@typescript-eslint/no-import-type-side-effects": "error",
      eqeqeq: ["error", "always"],
    },
  },
];

export default baseConfig;
