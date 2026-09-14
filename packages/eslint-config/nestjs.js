// Variante para apps/paquetes NestJS — Impulza One.
import base from "./base.js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...base,
  {
    rules: {
      // Los decoradores de Nest (constructor injection, providers vacíos) son un patrón normal.
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
    },
  },
];
