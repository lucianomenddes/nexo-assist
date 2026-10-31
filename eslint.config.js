import { config as baseConfig } from "@repo/eslint-config/base";
import globals from "globals";

export default [
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
  },
  ...baseConfig,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-undef": "off",
    },
  },
  {
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**"],
  },
];
