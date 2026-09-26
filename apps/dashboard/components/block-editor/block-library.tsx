"use client";

import { BLOCK_TYPES, type BlockType } from "@impulza/validation";
import { Button } from "@impulza/ui";
import { BLOCK_FIELD_SETS } from "../../lib/block-fields/catalog";
import { BLOCK_ICONS, BLOCK_LABELS } from "../../lib/block-fields/labels";

/**
 * Biblioteca de bloques (F2.9). Desde PP8 en dos grupos: primero lo que forma una página de enlaces
 * —perfil, enlaces, redes, WhatsApp—, que es el uso principal; después el resto (portada, galería,
 * formulario, servicios…), opcional. Cada botón lleva el mismo ícono lineal que el bloque en el
 * lienzo. Los tipos sin `BlockFieldSet` todavía aparecen deshabilitados en vez de ocultos, para que
 * se vea qué falta.
 */
const GROUPS: ReadonlyArray<{ title: string; types: readonly BlockType[] }> = [
  { title: "Tu página de enlaces", types: ["profile", "link", "social", "whatsapp", "contact_actions"] },
  {
    title: "Más bloques",
    types: BLOCK_TYPES.filter((type) => !["profile", "link", "social", "whatsapp", "contact_actions"].includes(type)),
  },
];

export function BlockLibrary({
  onAdd,
  disabled,
}: {
  onAdd: (type: BlockType) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-medium text-foreground">Biblioteca de bloques</p>
      {GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.title}</p>
          <ul className="flex flex-col gap-1.5">
            {group.types.map((type) => {
              const available = Boolean(BLOCK_FIELD_SETS[type]);
              const Icon = BLOCK_ICONS[type];
              return (
                <li key={type}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-full justify-start gap-2.5"
                    disabled={!available || disabled}
                    title={available ? undefined : "Todavía no disponible en el constructor."}
                    onClick={() => onAdd(type)}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    {BLOCK_LABELS[type]}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
