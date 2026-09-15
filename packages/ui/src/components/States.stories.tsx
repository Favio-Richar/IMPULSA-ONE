import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button.js";
import { EmptyState, ErrorState, LoadingState, OfflineState } from "./States.js";

const meta: Meta = {
  title: "Componentes/Estados",
};
export default meta;

export const Empty: StoryObj<typeof EmptyState> = {
  render: () => (
    <EmptyState
      title="Todavía no tienes contactos"
      description="Los contactos aparecen aquí cuando alguien complete un formulario en tu sitio."
      action={<Button size="sm">Crear formulario</Button>}
    />
  ),
};

export const Loading: StoryObj<typeof LoadingState> = {
  render: () => <LoadingState />,
};

export const ErrorRecoverable: StoryObj<typeof ErrorState> = {
  render: () => <ErrorState onRetry={() => undefined} />,
};

export const Offline: StoryObj<typeof OfflineState> = {
  render: () => <OfflineState onRetry={() => undefined} />,
};
