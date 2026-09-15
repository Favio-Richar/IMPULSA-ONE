import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button.js";

const meta: Meta<typeof Button> = {
  title: "Componentes/Button",
  component: Button,
  args: {
    children: "Continuar",
  },
};
export default meta;

type Story = StoryObj<typeof Button>;

export const Primary: Story = { args: { variant: "primary" } };
export const Secondary: Story = { args: { variant: "secondary" } };
export const Ghost: Story = { args: { variant: "ghost" } };
export const Destructive: Story = { args: { variant: "destructive", children: "Eliminar" } };
export const Loading: Story = { args: { loading: true, children: "Guardando…" } };
export const Disabled: Story = { args: { disabled: true } };
