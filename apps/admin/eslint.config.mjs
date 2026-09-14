import nextPlugin from "eslint-config-next";
import base from "@impulza/eslint-config";

/** @type {import("eslint").Linter.Config[]} */
const config = [...base, ...nextPlugin];

export default config;
