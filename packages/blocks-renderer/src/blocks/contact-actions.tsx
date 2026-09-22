import { Mail, Phone } from "lucide-react";
import type { ContactActionsBlockConfig } from "@impulza/validation";
import { LinkButton, type ButtonVariant } from "../ui/link-button.js";

export function ContactActionsBlock({
  config,
  buttonVariant,
}: {
  config: ContactActionsBlockConfig;
  buttonVariant: ButtonVariant;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      {config.email ? (
        <LinkButton href={`mailto:${config.email}`} variant={buttonVariant}>
          <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
          {config.emailLabel ?? config.email}
        </LinkButton>
      ) : null}
      {config.phone ? (
        <LinkButton href={`tel:${config.phone}`} variant={buttonVariant === "primary" ? "secondary" : buttonVariant}>
          <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
          {config.phoneLabel ?? config.phone}
        </LinkButton>
      ) : null}
    </div>
  );
}
