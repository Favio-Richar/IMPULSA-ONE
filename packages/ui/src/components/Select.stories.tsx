import type { Meta, StoryObj } from "@storybook/react-vite";
import { Select } from "./Select.js";

const OPTIONS = [
  { value: "corte", label: "Corte" },
  { value: "color", label: "Color" },
  { value: "peinado", label: "Peinado" },
];

const meta: Meta<typeof Select> = {
  title: "Componentes/Select",
  component: Select,
  args: {
    label: "Servicio",
    options: OPTIONS,
    placeholder: "— Sin elegir —",
  },
};
export default meta;

type Story = StoryObj<typeof Select>;

export const Default: Story = {};
export const Required: Story = { args: { required: true } };
export const WithHelperText: Story = {
  args: { helperText: "Puedes cambiarlo más tarde." },
};
export const WithError: Story = {
  args: { error: "Elige una opción.", placeholder: undefined },
};
export const Disabled: Story = { args: { disabled: true, defaultValue: "corte" } };
