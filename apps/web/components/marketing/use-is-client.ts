import { useSyncExternalStore } from "react";

const subscribeNoop = () => () => {};
/** `true` solo en el navegador (en el servidor y en la hidratación es `false`): sin `setState` dentro de un efecto. */
export function useIsClient(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false);
}
