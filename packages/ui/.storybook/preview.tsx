import type { Preview } from "@storybook/react-vite";
import "../src/styles/globals.css";

// Dirección visual obligatoria: fondo blanco/muy claro siempre (CLAUDE.md). Sin modo oscuro.
const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "background",
      values: [{ name: "background", value: "#ffffff" }],
    },
    a11y: {
      test: "error",
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
