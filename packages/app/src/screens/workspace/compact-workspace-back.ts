import type { MobilePanelView } from "@/stores/panel-store";

/**
 * The panel Android Back shows in a compact workspace, given the one on screen, or null
 * to leave Back to the system. Back from a chat opens the workspace list, and Back from
 * the file explorer returns to the chat. From the workspace list, Back leaves the app,
 * as it does from the conversation list in other chat apps.
 */
export function resolveCompactWorkspaceBack(current: MobilePanelView): MobilePanelView | null {
  switch (current) {
    case "agent":
      return "agent-list";
    case "file-explorer":
      return "agent";
    case "agent-list":
      return null;
  }
}
