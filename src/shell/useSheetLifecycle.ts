import { useCallback, useEffect, useState } from "react";

/**
 * Keeps a native sheet mounted while it slides away.
 *
 * The parent used to render `<Sheet visible={open} />` behind a conditional, so
 * closing unmounted the whole subtree in the same commit that set
 * `isPresented = false` — the system had nothing left to animate, and the drawer
 * vanished instead of closing. Here the component mounts on the first `true` and
 * only unmounts when the native side reports that the dismissal finished.
 */
export function useSheetLifecycle(visible: boolean) {
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
    }
  }, [visible]);

  /** Call from `onIsPresentedChange(false)`, i.e. after the close animation. */
  const finish = useCallback(() => setMounted(false), []);

  return { mounted, finish };
}
