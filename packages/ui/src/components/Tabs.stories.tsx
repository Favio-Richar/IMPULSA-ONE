import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Tabs } from "./Tabs.js";

const meta: Meta<typeof Tabs> = {
  title: "Componentes/Tabs",
  component: Tabs,
};
export default meta;

type Story = StoryObj<typeof Tabs>;

const TABS = [
  { value: "resumen", label: "Resumen" },
  { value: "apariencia", label: "Apariencia" },
  { value: "paginas", label: "Páginas" },
];

function Demo() {
  const [value, setValue] = useState("resumen");
  return (
    <Tabs tabs={TABS} value={value} onValueChange={setValue} label="Secciones del sitio">
      <p className="text-sm text-foreground">Contenido de «{TABS.find((tab) => tab.value === value)?.label}».</p>
    </Tabs>
  );
}

export const Basico: Story = { render: () => <Demo /> };
