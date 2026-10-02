import { SessionDelivery } from "./session/owned-subscriptions/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server as HTTPServer } from "http";
import type pino from "pino";
import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import type { DownloadTokenStore } from "./file-download/token-store.js";
import type { DaemonConfigStore } from "./daemon-config-store.js";
import type { ScheduleService } from "./schedule/service.js";
import type { CheckoutDiffManager } from "./checkout-diff-manager.js";
import type { PluginNotification } from "@getpaseo/plugin/server";
import type { SessionOptions } from "./session.js";
import { asInternals, createStub } from "./test-utils/class-mocks.js";
import { createProviderSnapshotManagerStub } from "./test-utils/session-stubs.js";
import type { PushNotificationSender, PushPayload } from "./push/index.js";
import type { WorkspaceAutoName } from "./workspace-auto-name.js";

const wsModuleMock = vi.hoisted(() => {
  class MockWebSocketServer {
    readonly handlers = new Map<string, (...args: unknown[]) => void>();

    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, handler);
      return this;
    }

    close() {
      // no-op
    }
  }

  return { MockWebSocketServer };
});

vi.mock("ws", () => ({
  WebSocketServer: wsModuleMock.MockWebSocketServer,
}));

vi.mock("./session.js", () => ({
  Session: function Session() {
    return {};
  },
}));

import { VoiceAssistantWebSocketServer } from "./websocket-server.js";

class RecordingPushNotificationSender implements PushNotificationSender {
  readonly sent: PushPayload[] = [];

  async send(payload: PushPayload): Promise<void> {
    this.sent.push(payload);
  }
}

function createLogger() {
  const logger = {
    child: vi.fn(() => logger),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return logger;
}

function createWorkspaceAutoNameStub(): WorkspaceAutoName {
  return createStub<WorkspaceAutoName>({
    scheduleForWorktree: () => {},
    scheduleForDirectory: () => {},
  });
}

type NotificationListener = (pluginId: string, notification: PluginNotification) => void;

function createPluginRuntime() {
  const listeners = new Set<NotificationListener>();
  const runtime = createStub<NonNullable<SessionOptions["pluginRuntime"]>>({
    subscribeNotifications: vi.fn((listener: NotificationListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  });
  function notify(pluginId: string, notification: PluginNotification): void {
    for (const listener of listeners) listener(pluginId, notification);
  }
  return { runtime, notify };
}

function createServer(pluginRuntime: NonNullable<SessionOptions["pluginRuntime"]>) {
  const pushNotifications = new RecordingPushNotificationSender();
  const agentManager = {
    setAgentAttentionCallback: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    getAgent: vi.fn(() => null),
    getLastAssistantMessage: vi.fn(async () => null),
  };
  const daemonConfigStore = {
    onApply: vi.fn(() => () => {}),
    onChange: vi.fn(() => () => {}),
  };

  const server = new VoiceAssistantWebSocketServer(
    createStub<HTTPServer>({}),
    createStub<pino.Logger>(createLogger()),
    "srv-test",
    createStub<AgentManager>(agentManager),
    createStub<AgentStorage>({}),
    createStub<DownloadTokenStore>({}),
    "/tmp/paseo-test",
    createStub<DaemonConfigStore>(daemonConfigStore),
    null,
    { allowedOrigins: new Set() },
    createWorkspaceAutoNameStub(),
    undefined,
    undefined,
    undefined,
    undefined,
    "1.2.3-test",
    undefined,
    undefined,
    undefined,
    createStub<ScheduleService>({}),
    createStub<CheckoutDiffManager>({
      subscribe: vi.fn(),
      scheduleRefreshForCwd: vi.fn(),
      dispose: vi.fn(),
    }),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    pushNotifications,
    createProviderSnapshotManagerStub().manager,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    pluginRuntime,
  );

  return { server, pushNotifications };
}

function createOpenSocket() {
  return {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
  };
}

function connectClient(
  server: VoiceAssistantWebSocketServer,
  options: { subscribed?: boolean; lastActivityAt?: Date | null } = {},
) {
  const ws = createOpenSocket();
  const delivery = new SessionDelivery(() => {});
  delivery.attach(ws, false);
  const lastActivityAt = options.lastActivityAt ?? null;
  asInternals<{ sessions: Map<unknown, unknown> }>(server).sessions.set(ws, {
    kind: "trusted",
    session: {
      delivery,
      wantsSourceEvent: () => options.subscribed ?? true,
      wantsSourceNotification: () => true,
      getClientActivity: vi.fn(() =>
        lastActivityAt
          ? {
              appVisible: true,
              focusedAgentId: null,
              focusedTerminalId: null,
              lastActivityAt,
            }
          : null,
      ),
    },
    clientId: "client-test",
    appVersion: null,
    connectionLogger: createLogger(),
    sockets: new Set([ws]),
    externalDisconnectCleanupTimeout: null,
  });
  return ws;
}

interface PluginAttentionPayload {
  serverId: string;
  pluginId: string;
  title: string;
  body: string;
  screen?: { screenId: string; params?: Record<string, string> };
  shouldNotify: boolean;
}

function sentPluginAttentionMessages(ws: ReturnType<typeof createOpenSocket>) {
  return ws.send.mock.calls
    .map(([rawMessage]) => JSON.parse(String(rawMessage)))
    .filter(
      (message) =>
        message.type === "session" && message.message.type === "plugin_attention_required",
    )
    .map((message) => message.message.payload as PluginAttentionPayload);
}

const NOTIFICATION: PluginNotification = {
  title: "getpaseo/paseo#1",
  body: "A maintainer replied",
  screen: { screenId: "board", params: { thread: "getpaseo/paseo#1" } },
};

describe("VoiceAssistantWebSocketServer plugin attention notifications", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("pushes a plugin notification when no client is present", () => {
    const plugins = createPluginRuntime();
    const { server, pushNotifications } = createServer(plugins.runtime);
    const ws = connectClient(server);

    plugins.notify("github-inbox", NOTIFICATION);

    expect(pushNotifications.sent).toEqual([
      {
        title: "getpaseo/paseo#1",
        body: "A maintainer replied",
        data: {
          serverId: "srv-test",
          pluginId: "github-inbox",
          pluginScreenId: "board",
          pluginScreenParams: { thread: "getpaseo/paseo#1" },
        },
      },
    ]);
    expect(sentPluginAttentionMessages(ws)).toEqual([
      {
        serverId: "srv-test",
        pluginId: "github-inbox",
        title: "getpaseo/paseo#1",
        body: "A maintainer replied",
        screen: { screenId: "board", params: { thread: "getpaseo/paseo#1" } },
        shouldNotify: false,
      },
    ]);
  });

  it("notifies the most recently active client in the app instead of pushing", () => {
    const plugins = createPluginRuntime();
    const { server, pushNotifications } = createServer(plugins.runtime);
    const earlier = connectClient(server, {
      lastActivityAt: new Date(Date.now() - 60_000),
    });
    const latest = connectClient(server, { lastActivityAt: new Date() });

    plugins.notify("github-inbox", { title: "Needs you", body: "1 thread" });

    expect(pushNotifications.sent).toHaveLength(0);
    expect(sentPluginAttentionMessages(earlier).map((p) => p.shouldNotify)).toEqual([false]);
    expect(sentPluginAttentionMessages(latest).map((p) => p.shouldNotify)).toEqual([true]);
    expect(sentPluginAttentionMessages(latest)[0]).not.toHaveProperty("screen");
  });

  it("sends nothing to clients that did not subscribe", () => {
    const plugins = createPluginRuntime();
    const { server } = createServer(plugins.runtime);
    const ws = connectClient(server, {
      subscribed: false,
      lastActivityAt: new Date(),
    });

    plugins.notify("github-inbox", NOTIFICATION);

    expect(sentPluginAttentionMessages(ws)).toHaveLength(0);
  });
});
