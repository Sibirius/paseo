import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, onTestFinished, test } from "vitest";
import { resolveDaemonVersion } from "../daemon-version.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

test("a plugin's notification reaches clients that subscribed to plugin attention", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-notify-plugin-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "paseo-plugin.json"),
    JSON.stringify({
      id: "notifier",
      requirements: { paseo: `>=${resolveDaemonVersion(import.meta.url)}` },
    }),
  );
  await writeFile(
    path.join(directory, "index.server.ts"),
    `
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
export default function contribute(server) {
  server.handle(defineRpc({ name: "notify", input: z.object({ title: z.string() }), output: z.object({}) }), ({ title }) => {
    server.notify({ title, body: "From a plugin", screen: { screenId: "main", params: { id: "1" } } });
    return {};
  });
  return () => {};
}`,
  );
  const daemon = await createTestPaseoDaemon();
  onTestFinished(() => daemon.close());
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  const legacy = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    capabilities: {
      selective_agent_timeline: false,
      explicit_event_subscriptions: false,
      provider_snapshot_references: false,
    },
  });
  onTestFinished(() => Promise.all([client.close(), legacy.close()]));
  const legacyTypes: string[] = [];
  legacy.subscribeRawMessages((message) => legacyTypes.push(message.type));
  await client.connect();
  await legacy.connect();
  await client.patchDaemonConfig({ pluginsEnabled: true });
  await client.installDirectoryPlugin(directory);

  const received: unknown[] = [];
  const observation = client.observeEvents(["plugin_attention_required"], {
    notifications: true,
  });
  observation.subscribe({
    snapshot: () => {},
    update: (message) => {
      if (message.type === "plugin_attention_required") received.push(message.payload);
    },
  });
  await observation.ready;

  await client.invokePluginRpc("notifier", "notify", { title: "Hello" });
  await expect
    .poll(() => received)
    .toEqual([
      expect.objectContaining({
        pluginId: "notifier",
        title: "Hello",
        body: "From a plugin",
        screen: { screenId: "main", params: { id: "1" } },
      }),
    ]);

  await expect(client.invokePluginRpc("notifier", "notify", { title: "" })).rejects.toThrow();
  await legacy.getDaemonConfig();
  expect(legacyTypes).not.toContain("plugin_attention_required");
  expect(received).toHaveLength(1);
});
