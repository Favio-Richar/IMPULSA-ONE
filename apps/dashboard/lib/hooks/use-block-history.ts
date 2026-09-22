import { useCallback, useEffect, useRef, useState } from "react";

export type BlockChange =
  | { kind: "config"; blockId: string; before: unknown; after: unknown }
  | { kind: "visible"; blockId: string; before: boolean; after: boolean }
  | { kind: "reorder"; before: string[]; after: string[] };

/**
 * Deshacer/rehacer de contenido (F2.9) — deliberadamente acotado a cambios sobre bloques que ya
 * existen: editar un campo, ocultar/mostrar, reordenar. Agregar/eliminar/duplicar un bloque
 * **limpia el historial** en vez de entrar en él — el id de un bloque lo asigna el servidor al
 * crearlo, así que "rehacer un agregado" no puede recrear el mismo id, y cualquier cambio
 * posterior de ese historial que todavía apuntara a ese id quedaría roto. No es un recorte de
 * pereza: es la frontera real hasta donde un historial de comandos con ids del servidor puede ser
 * correcto sin una capa aparte de identidad estable del lado del cliente.
 */
export function useBlockHistory(apply: (change: BlockChange, direction: "undo" | "redo") => Promise<void>) {
  const [past, setPast] = useState<BlockChange[]>([]);
  const [future, setFuture] = useState<BlockChange[]>([]);
  const [isApplying, setIsApplying] = useState(false);
  const [hasError, setHasError] = useState(false);

  // "Última versión conocida" en refs, sincronizados por efecto (no durante el render, que React
  // Compiler rechaza) — así `undo`/`redo` siempre disparan contra el estado y el callback más
  // recientes sin tener que llevarlos en sus propias dependencias.
  const pastRef = useRef(past);
  const futureRef = useRef(future);
  const applyRef = useRef(apply);
  const isApplyingRef = useRef(isApplying);
  useEffect(() => {
    pastRef.current = past;
  }, [past]);
  useEffect(() => {
    futureRef.current = future;
  }, [future]);
  useEffect(() => {
    applyRef.current = apply;
  }, [apply]);
  useEffect(() => {
    isApplyingRef.current = isApplying;
  }, [isApplying]);

  // Índice del último cambio de tipo "config" en `past`, mientras siga siendo el tope de la pila
  // — permite que los autoguardados sucesivos de una misma sesión de edición reemplacen esa
  // entrada en vez de apilar un paso de deshacer por cada tecleo.
  const activeConfigRef = useRef<{ blockId: string; index: number } | null>(null);

  const push = useCallback((change: BlockChange) => {
    activeConfigRef.current = null;
    setPast((prev) => [...prev, change]);
    setFuture([]);
  }, []);

  const commitConfigChange = useCallback((blockId: string, before: unknown, after: unknown) => {
    setPast((prev) => {
      const active = activeConfigRef.current;
      if (active && active.blockId === blockId && active.index === prev.length - 1) {
        const next = prev.slice();
        next[active.index] = { kind: "config", blockId, before, after };
        return next;
      }
      const next = [...prev, { kind: "config", blockId, before, after } as BlockChange];
      activeConfigRef.current = { blockId, index: next.length - 1 };
      return next;
    });
    setFuture([]);
  }, []);

  const clear = useCallback(() => {
    activeConfigRef.current = null;
    setPast([]);
    setFuture([]);
  }, []);

  const undo = useCallback(async () => {
    const change = pastRef.current[pastRef.current.length - 1];
    if (!change || isApplyingRef.current) {
      return;
    }
    activeConfigRef.current = null;
    setIsApplying(true);
    setHasError(false);
    try {
      await applyRef.current(change, "undo");
      setPast((prev) => prev.slice(0, -1));
      setFuture((prev) => [...prev, change]);
    } catch {
      setHasError(true);
    } finally {
      setIsApplying(false);
    }
  }, []);

  const redo = useCallback(async () => {
    const change = futureRef.current[futureRef.current.length - 1];
    if (!change || isApplyingRef.current) {
      return;
    }
    activeConfigRef.current = null;
    setIsApplying(true);
    setHasError(false);
    try {
      await applyRef.current(change, "redo");
      setFuture((prev) => prev.slice(0, -1));
      setPast((prev) => [...prev, change]);
    } catch {
      setHasError(true);
    } finally {
      setIsApplying(false);
    }
  }, []);

  return {
    push,
    commitConfigChange,
    clear,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    isApplying,
    hasError,
  };
}
