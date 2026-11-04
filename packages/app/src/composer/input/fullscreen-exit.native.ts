import { useEffect } from "react";
import { systemBackPress } from "@/components/ui/isolated-bottom-sheet-modal/back-press";

/** The hardware back button leaves fullscreen instead of the screen. */
export function useComposerFullscreenExit(
  active: boolean,
  onExit: () => void,
): ((node: unknown) => void) | undefined {
  useEffect(() => {
    if (!active) return;
    return systemBackPress.subscribe(() => {
      onExit();
      return true;
    });
  }, [active, onExit]);
  return undefined;
}
