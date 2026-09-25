import * as LabelPrimitive from "@radix-ui/react-label";
import { type TextareaHTMLAttributes, forwardRef, useId } from "react";
import { cn } from "../lib/cn.js";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  helperText?: string;
  error?: string;
}

/** Texto multilínea con la misma anatomía que `Input`: etiqueta, ayuda o error asociados por
 *  `aria-describedby`, y los mismos bordes, foco y estados. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, helperText, error, id, required, rows = 4, ...props }, ref) => {
    const generatedId = useId();
    const textareaId = id ?? generatedId;
    const helperId = `${textareaId}-helper`;
    const errorId = `${textareaId}-error`;

    return (
      <div className="flex flex-col gap-1.5">
        <LabelPrimitive.Root htmlFor={textareaId} className="text-sm font-medium text-foreground">
          {label}
          {required ? (
            <span className="text-danger" aria-hidden="true">
              {" "}
              *
            </span>
          ) : null}
        </LabelPrimitive.Root>

        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={cn(helperText && helperId, error && errorId) || undefined}
          className={cn(
            "min-h-20 rounded-md border border-border-strong bg-background px-3 py-2 text-sm leading-relaxed text-foreground",
            "placeholder:text-disabled-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            error && "border-danger focus-visible:ring-danger",
            className,
          )}
          {...props}
        />

        {error ? (
          <p id={errorId} className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : helperText ? (
          <p id={helperId} className="text-sm text-muted-foreground">
            {helperText}
          </p>
        ) : null}
      </div>
    );
  },
);
Textarea.displayName = "Textarea";
