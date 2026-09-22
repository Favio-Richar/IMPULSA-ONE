"use client";

import LinkExtension from "@tiptap/extension-link";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Check, Heading2, Italic, Link as LinkIcon, List, ListOrdered, Quote, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@impulza/ui";

/**
 * Editor de texto enriquecido para los campos `richtext` del catálogo de bloques (F2.4/F2.9). Lo
 * que produce (`getHTML()`) pasa igual por la validación y el saneo del servidor al guardar — este
 * editor no es la autoridad de qué HTML es válido, solo la comodidad de escribirlo sin HTML a mano.
 * Lista de marcas deliberadamente acotada (negrita, cursiva, títulos, listas, cita, enlace) para
 * quedar cerca de `RICH_TEXT_ALLOWED_TAGS` — no hay nada acá que el servidor vaya a descartar.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      LinkExtension.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      }),
    ],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor: instance }) => onChange(instance.getHTML()),
    editorProps: {
      attributes: {
        class: "prose-content min-h-24 px-3 py-2 text-sm focus:outline-none",
        ...(placeholder ? { "data-placeholder": placeholder } : {}),
      },
    },
  });

  const [linkPromptOpen, setLinkPromptOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  if (!editor) {
    return <div className="h-32 animate-pulse rounded-md border border-border-strong bg-surface" />;
  }

  function openLinkPrompt() {
    setLinkUrl(editor!.getAttributes("link").href ?? "");
    setLinkPromptOpen(true);
  }

  function confirmLink() {
    const url = linkUrl.trim();
    if (url) {
      editor!.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    } else {
      editor!.chain().focus().extendMarkRange("link").unsetLink().run();
    }
    setLinkPromptOpen(false);
  }

  return (
    <div className="rounded-md border border-border-strong bg-background">
      <div className="flex flex-wrap items-center gap-1 border-b border-border p-1">
        <ToolbarButton label="Negrita" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Cursiva" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Título"
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Lista"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Lista numerada"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Cita"
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Enlace" active={editor.isActive("link")} onClick={openLinkPrompt}>
          <LinkIcon className="size-4" />
        </ToolbarButton>
      </div>
      {linkPromptOpen ? (
        <div className="flex items-center gap-1 border-b border-border p-1">
          <input
            autoFocus
            type="url"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                confirmLink();
              }
              if (event.key === "Escape") {
                setLinkPromptOpen(false);
              }
            }}
            placeholder="https://…"
            className="h-8 flex-1 rounded-md border border-border-strong bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <ToolbarButton label="Confirmar enlace" active={false} onClick={confirmLink}>
            <Check className="size-4" />
          </ToolbarButton>
          <ToolbarButton label="Cancelar" active={false} onClick={() => setLinkPromptOpen(false)}>
            <X className="size-4" />
          </ToolbarButton>
        </div>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="sm"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
