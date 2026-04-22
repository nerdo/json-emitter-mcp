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
  test("exposes emit_json tool with a description", async () => {
    const { client } = await connectClient();

    const { tools } = await client.listTools();

    const emitJsonTool = tools.find((t) => t.name === "emit_json");
    expect(emitJsonTool).toBeDefined();
    expect(emitJsonTool?.description).toBeTypeOf("string");
    expect((emitJsonTool?.description ?? "").length).toBeGreaterThan(50);
  });

  test("success: content text is the bare JSON (no envelope), compact by default", async () => {
    const { client } = await connectClient();

    const result = await client.callTool({
      name: "emit_json",
      arguments: { yaml: "foo: bar\nnum: 1" },
    });

    expect(result.isError).toBeFalsy();
    const text = firstTextBlock(result.content);
    // Bare JSON — no wrapping {ok:..., json:...} envelope
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

  test("parse failure: isError true, text describes phase + line/column + snippet", async () => {
    const { client } = await connectClient();

    const result = await client.callTool({
      name: "emit_json",
      arguments: { yaml: 'foo: "unterminated' },
    });

    expect(result.isError).toBe(true);
    const text = firstTextBlock(result.content);
    expect(text).toContain("YAML parse error");
    expect(text).toContain("line 1");
    expect(text).toMatch(/column \d+/);
    expect(text).toContain("unterminated");
    expect(text).toContain("^");
  });

  test("validate failure: isError true, text lists each issue with path and keyword", async () => {
    const { client } = await connectClient();

    const result = await client.callTool({
      name: "emit_json",
      arguments: {
        yaml: 'count: "ten"',
        jsonSchema: {
          type: "object",
          properties: { count: { type: "integer" } },
        },
      },
    });

    expect(result.isError).toBe(true);
    const text = firstTextBlock(result.content);
    expect(text).toContain("JSON Schema validation failed");
    expect(text).toContain("/count");
    expect(text).toContain("type");
  });

  test("schema_compile failure: isError true, text names the malformed schema", async () => {
    const { client } = await connectClient();

    const result = await client.callTool({
      name: "emit_json",
      arguments: {
        yaml: "foo: bar",
        jsonSchema: { type: "bogustype" },
      },
    });

    expect(result.isError).toBe(true);
    const text = firstTextBlock(result.content);
    expect(text).toContain("JSON Schema is invalid");
  });

  test("unknown tool call returns isError without crashing", async () => {
    const { client } = await connectClient();

    const result = await client.callTool({
      name: "not_a_tool",
      arguments: {},
    });

    expect(result.isError).toBe(true);
  });
});
