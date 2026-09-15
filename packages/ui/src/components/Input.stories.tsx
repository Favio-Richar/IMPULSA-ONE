import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "./Input.js";

const meta: Meta<typeof Input> = {
  title: "Componentes/Input",
  component: Input,
  args: {
    label: "Correo electrónico",
    placeholder: "tu@empresa.com",
  },
};
export default meta;

type Story = StoryObj<typeof Input>;

export const Default: Story = {};
export const Required: Story = { args: { required: true } };
export const WithHelperText: Story = {
  args: { helperText: "Nunca lo compartiremos con terceros." },
};
export const WithError: Story = {
  args: { error: "Ingresa un correo válido.", defaultValue: "no-es-un-correo" },
};
export const Disabled: Story = { args: { disabled: true, defaultValue: "no-editable@empresa.com" } };
