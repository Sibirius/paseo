import { expect, test } from "vitest";
import { resolveCompactWorkspaceBack } from "./compact-workspace-back";

test("Back from a chat opens the workspace list", () => {
  expect(resolveCompactWorkspaceBack("agent")).toBe("agent-list");
});

test("Back from the file explorer returns to the chat", () => {
  expect(resolveCompactWorkspaceBack("file-explorer")).toBe("agent");
});

test("Back from the workspace list is left to the system", () => {
  expect(resolveCompactWorkspaceBack("agent-list")).toBeNull();
});
