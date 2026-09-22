"use client";

import { BLOCK_TYPES, type BlockType } from "@impulza/validation";
import { Button } from "@impulza/ui";
import { BLOCK_FIELD_SETS } from "../../lib/block-fields/catalog";
import { BLOCK_ICONS, BLOCK_LABELS } from "../../lib/block-fields/labels";

/** Biblioteca de bloques (F2.9): un botón por tipo del catálogo, con el mismo ícono lineal que lo
 *  representa en el lienzo — una lista de puro texto no se lee como una biblioteca. Los tipos sin
 *  `BlockFieldSet` todavía (gallery, video, contact_form, service, faq, testimonials — misma nota
 *  que `catalog.ts`) aparecen deshabilitados en vez de ocultos, para que se vea qué falta. */
export function BlockLibrary({
  onAdd,
  disabled,
}: {
  onAdd: (type: BlockType) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-foreground">Biblioteca de bloques</p>
      <ul className="flex flex-col gap-1.5">
        {BLOCK_TYPES.map((type) => {
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
  );
}
