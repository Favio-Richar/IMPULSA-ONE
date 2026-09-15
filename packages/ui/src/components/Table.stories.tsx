import type { Meta, StoryObj } from "@storybook/react-vite";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./Table.js";

const meta: Meta<typeof Table> = {
  title: "Componentes/Table",
  component: Table,
};
export default meta;

type Story = StoryObj<typeof Table>;

const rows = [
  { name: "Ana Torres", role: "OWNER", status: "Activo" },
  { name: "Bruno Díaz", role: "EDITOR", status: "Invitado" },
  { name: "Camila Rojas", role: "ANALYST", status: "Activo" },
];

export const Default: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nombre</TableHead>
          <TableHead>Rol</TableHead>
          <TableHead>Estado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.name}>
            <TableCell>{row.name}</TableCell>
            <TableCell>{row.role}</TableCell>
            <TableCell>{row.status}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};
