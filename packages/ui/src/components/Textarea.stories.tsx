import type { Meta, StoryObj } from "@storybook/react-vite";
import { Textarea } from "./Textarea.js";

const meta: Meta<typeof Textarea> = {
  title: "Componentes/Textarea",
  component: Textarea,
  args: {
    label: "Detalle",
    placeholder: "Cuéntanos qué pasó y qué esperabas que pasara.",
  },
};
export default meta;

type Story = StoryObj<typeof Textarea>;

export const Default: Story = {};
export const Required: Story = { args: { required: true } };
export const WithHelperText: Story = { args: { helperText: "Sin datos de tarjetas ni contraseñas." } };
export const WithError: Story = { args: { error: "Cuéntanos un poco más.", defaultValue: "ayuda" } };
export const Disabled: Story = { args: { disabled: true, defaultValue: "Solicitud cerrada." } };
