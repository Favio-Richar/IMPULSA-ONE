import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button.js";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./Card.js";

const meta: Meta<typeof Card> = {
  title: "Componentes/Card",
  component: Card,
};
export default meta;

type Story = StoryObj<typeof Card>;

export const Default: Story = {
  render: () => (
    <Card className="w-96">
      <CardHeader>
        <CardTitle>Organización</CardTitle>
        <CardDescription>Datos básicos de tu espacio de trabajo.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Nombre, slug y plan actual se configuran aquí.
        </p>
      </CardContent>
      <CardFooter>
        <Button size="sm">Guardar</Button>
        <Button size="sm" variant="ghost">
          Cancelar
        </Button>
      </CardFooter>
    </Card>
  ),
};
