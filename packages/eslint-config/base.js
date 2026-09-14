// Configuración ESLint base compartida — Impulza One.
// Los paquetes/apps que no usan Next.js (api, worker, packages/*) parten de aquí.
// Las apps Next.js combinan esto con `eslint-config-next`.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** @type {import("eslint").Linter.Config[]} */
export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", ".next/**", "node_modules/**", ".turbo/**", "coverage/**"],
  },
];
