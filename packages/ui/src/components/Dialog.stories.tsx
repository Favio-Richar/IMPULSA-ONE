import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "./Button.js";
import { Dialog } from "./Dialog.js";

const meta: Meta<typeof Dialog> = {
  title: "Componentes/Dialog",
  component: Dialog,
};
export default meta;

type Story = StoryObj<typeof Dialog>;

function Demo({ size }: { size?: "md" | "lg" }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Abrir</Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        size={size}
        title="Elegir imagen"
        description="De tu biblioteca o sube una nueva."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => setOpen(false)}>Usar imagen</Button>
          </>
        }
      >
        <p className="text-sm text-foreground">Contenido del diálogo.</p>
      </Dialog>
    </>
  );
}

export const Default: Story = { render: () => <Demo /> };
export const Large: Story = { render: () => <Demo size="lg" /> };
