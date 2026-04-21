import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { runMain } from "./main.ts";

describe("runMain", () => {
  test("starts HTTP transport when settings select http and serves emit_json", async () => {
    const port = 3933;
    const handle = await runMain({
      env: { JSON_EMITTER_TRANSPORT: "http", JSON_EMITTER_HTTP_PORT: String(port) },
      argv: [],
    });

    try {
      const client = new Client({ name: "test", version: "0.0.0" });
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
      );
      await client.connect(transport);

      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("emit_json");

      await client.close();
      await transport.close();
    } finally {
      await handle.close();
    }
  });
});
