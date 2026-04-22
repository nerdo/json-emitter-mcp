import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createJsonEmitterServer } from "./server.ts";

async function connectClient() {
  const server = createJsonEmitterServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);

  return { server, client };
}

function firstTextBlock(content: unknown): string {
  const arr = content as Array<{ type: string; text: string }>;
  return arr[0]?.text ?? "";
}

describe("createJsonEmitterServer", () => {
  test("exposes emit_json tool with a description and no isError language", async () => {
    const { client } = await connectClient();

    const { tools } = await client.listTools();

    const emitJsonTool = tools.find((t) => t.name === "emit_json");
    expect(emitJsonTool).toBeDefined();
    const desc = emitJsonTool?.description ?? "";
    expect(desc.length).toBeGreaterThan(50);
    // The tool no longer signals failure via isError — it raises errors.
    expect(desc).not.toContain("isError");
  });

  test("success: content text is the bare JSON (no envelope), compact by default", async () => {
    const { client } = await connectClient();

    const result = await client.callTool({
      name: "emit_json",
      arguments: { yaml: "foo: bar\nnum: 1" },
    });

    // No isError to check; result has no isError field on success
    expect(result.isError).toBeFalsy();
    const text = firstTextBlock(result.content);
    expect(text).toBe('{"foo":"bar","num":1}');
  });

  test("success with options.pretty=true: content text is indented JSON", async () => {
    const { client } = await connectClient();

    const result = await client.callTool({
      name: "emit_json",
      arguments: { yaml: "foo: bar\nnum: 1", options: { pretty: true } },
    });

    expect(result.isError).toBeFalsy();
    const text = firstTextBlock(result.content);
    expect(text).toBe('{\n  "foo": "bar",\n  "num": 1\n}');
  });

  test("parse failure: callTool rejects with a message naming the phase and location", async () => {
    const { client } = await connectClient();

    await expect(
      client.callTool({
        name: "emit_json",
        arguments: { yaml: 'foo: "unterminated' },
      }),
    ).rejects.toThrow(/YAML parse error.*line 1.*column/s);
  });

  test("validate failure: callTool rejects with per-issue path and keyword in the message", async () => {
    const { client } = await connectClient();

    await expect(
      client.callTool({
        name: "emit_json",
        arguments: {
          yaml: 'count: "ten"',
          jsonSchema: {
            type: "object",
            properties: { count: { type: "integer" } },
          },
        },
      }),
    ).rejects.toThrow(/JSON Schema validation failed.*\/count.*type/s);
  });

  test("schema_compile failure: callTool rejects with the ajv compile message", async () => {
    const { client } = await connectClient();

    await expect(
      client.callTool({
        name: "emit_json",
        arguments: {
          yaml: "foo: bar",
          jsonSchema: { type: "bogustype" },
        },
      }),
    ).rejects.toThrow(/JSON Schema is invalid/);
  });

  test("unknown tool call rejects", async () => {
    const { client } = await connectClient();

    await expect(
      client.callTool({ name: "not_a_tool", arguments: {} }),
    ).rejects.toThrow();
  });
});
