import { afterAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createJsonEmitterServer } from "./server.ts";
import { startHttpTransport } from "./transports.ts";

describe("startHttpTransport", () => {
  const port = 3921;
  const handle = startHttpTransport(createJsonEmitterServer, port);

  afterAll(async () => {
    await handle.close();
  });

  test("end-to-end: client can callTool emit_json over Streamable HTTP", async () => {
    const client = new Client({ name: "test-http-client", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
    await client.connect(transport);

    const result = await client.callTool({
      name: "emit_json",
      arguments: { yaml: "hello: world" },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    // Content text IS the JSON — no envelope to unwrap
    expect(JSON.parse(content[0]?.text ?? "")).toEqual({ hello: "world" });

    await client.close();
    await transport.close();
  });
});
