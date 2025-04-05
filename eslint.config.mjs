import { defineConfig } from "eslint/config";
import globals from "globals";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import drizzle from "eslint-plugin-drizzle";

export default defineConfig([
  { files: ["src/**/*.{js,mjs,cjs,ts}"] },
  {
    files: ["src/**/*.{js,mjs,cjs,ts}"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["src/**/*.{js,mjs,cjs,ts}"],
    plugins: { js },
    extends: ["js/recommended"],
  },
  tseslint.configs.recommended,
  { plugins: { drizzle } },
]);
