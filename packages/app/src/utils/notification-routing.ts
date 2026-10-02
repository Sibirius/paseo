import type { Href } from "expo-router";
import { buildPluginSurfaceRoute } from "@/plugins/routes";
import { buildHostRootRoute, buildHostWorkspaceOpenRoute } from "@/utils/host-routes";

type NotificationData = Record<string, unknown> | null | undefined;
type NotificationRoute = Extract<Href, string>;

function readNonEmptyString(data: NotificationData, key: string): string | null {
  const value = data?.[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveNotificationTarget(data: NotificationData): {
  serverId: string | null;
  agentId: string | null;
  workspaceId: string | null;
  terminalId: string | null;
} {
  return {
    serverId: readNonEmptyString(data, "serverId"),
    agentId: readNonEmptyString(data, "agentId"),
    workspaceId: readNonEmptyString(data, "workspaceId"),
    terminalId: readNonEmptyString(data, "terminalId"),
  };
}

function readStringRecord(data: NotificationData, key: string): Record<string, string> {
  const value = data?.[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function buildNotificationRoute(data: NotificationData): NotificationRoute {
  const { serverId, agentId, workspaceId, terminalId } = resolveNotificationTarget(data);
  const pluginId = readNonEmptyString(data, "pluginId");
  const pluginScreenId = readNonEmptyString(data, "pluginScreenId");
  if (serverId && workspaceId && agentId) {
    return buildHostWorkspaceOpenRoute(serverId, workspaceId, `agent:${agentId}`);
  }
  if (serverId && workspaceId && terminalId) {
    return buildHostWorkspaceOpenRoute(serverId, workspaceId, `terminal:${terminalId}`);
  }
  if (serverId && pluginId && pluginScreenId) {
    return buildPluginSurfaceRoute(
      serverId,
      pluginId,
      { kind: "surface", id: pluginScreenId },
      readStringRecord(data, "pluginScreenParams"),
    );
  }
  if (serverId) {
    return buildHostRootRoute(serverId);
  }
  return "/" as const;
}
