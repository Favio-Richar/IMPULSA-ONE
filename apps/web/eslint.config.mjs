import nextPlugin from "eslint-config-next";
import base from "@impulza/eslint-config";

/** @type {import("eslint").Linter.Config[]} */
const config = [
  ...base,
  ...nextPlugin,
  {
    // ADR-009: three.js solo por `import("three")` dinámico dentro del cliente, nunca estático
    // (entraría en el paquete inicial). Esta regla no alcanza a `import()`, que es lo permitido.
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "three", message: "ADR-009: cargar three.js con import(\"three\") dinámico, solo en el sitio comercial." }],
          patterns: [{ group: ["three/*"], message: "ADR-009: cargar three.js con import() dinámico, solo en el sitio comercial." }],
        },
      ],
    },
  },
];

export default config;
