import { Mail, Phone } from "lucide-react";
import type { ContactActionsBlockConfig } from "@impulza/validation";
import type { ButtonVariant } from "../ui/link-button.js";
import { StackButtonContent, stackButtonClass } from "../ui/stack-button.js";

/** Correo y teléfono como botones de la pila de enlaces (PP8): uno debajo del otro, mismo alto. */
export function ContactActionsBlock({
  config,
  buttonVariant,
}: {
  config: ContactActionsBlockConfig;
  buttonVariant: ButtonVariant;
}) {
  return (
    <div className="flex flex-col gap-3">
      {config.email ? (
        <a href={`mailto:${config.email}`} className={stackButtonClass(buttonVariant)}>
          <StackButtonContent icon={<Mail className="h-5 w-5 shrink-0" aria-hidden="true" />} label={config.emailLabel ?? config.email} />
        </a>
      ) : null}
      {config.phone ? (
        <a href={`tel:${config.phone}`} className={stackButtonClass(buttonVariant === "primary" ? "secondary" : buttonVariant)}>
          <StackButtonContent icon={<Phone className="h-5 w-5 shrink-0" aria-hidden="true" />} label={config.phoneLabel ?? config.phone} />
        </a>
      ) : null}
    </div>
  );
}
