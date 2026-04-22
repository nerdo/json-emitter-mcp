#!/usr/bin/env node
import { createJsonEmitterServer } from "./infrastructure/server.ts";
import { loadSettings } from "./infrastructure/settings.ts";
import {
  startHttpTransport,
  startStdioTransport,
  type TransportHandle,
} from "./infrastructure/transports.ts";

interface RunMainInput {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly argv: ReadonlyArray<string>;
}

export async function runMain(input: RunMainInput): Promise<TransportHandle> {
  const settings = loadSettings(input);

  if (settings.transport === "stdio") {
    const server = createJsonEmitterServer();
    return startStdioTransport(server);
  }

  return startHttpTransport(createJsonEmitterServer, settings.httpPort);
}

if (import.meta.main) {
  const handle = await runMain({
    env: process.env,
    argv: process.argv.slice(2),
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.error(`\n[json-emitter] received ${signal}, shutting down…`);
    await handle.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}
