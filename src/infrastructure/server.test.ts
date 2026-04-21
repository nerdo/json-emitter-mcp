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

describe("createJsonEmitterServer", () => {
  test("exposes emit_json tool with a description", async () => {
    const { client } = await connectClient();

    const { tools } = await client.listTools();

    const emitJsonTool = tools.find((t) => t.name === "emit_json");
    expect(emitJsonTool).toBeDefined();
    expect(emitJsonTool?.description).toBeTypeOf("string");
    expect((emitJsonTool?.description ?? "").length).toBeGreaterThan(50);
  });

  test("emit_json returns successful result for valid YAML without schema", async () => {
    const { client } = await connectClient();

    const result = await client.callTool({
      name: "emit_json",
      arguments: { yaml: "foo: bar\nnum: 1" },
    });

    expect(result.isError).toBeFalsy();
    expect(Array.isArray(result.content)).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    const body = JSON.parse(content[0]?.text ?? "{}");
    expect(body).toMatchObject({ ok: true });
    expect(JSON.parse(body.json)).toEqual({ foo: "bar", num: 1 });
  });

  test("emit_json sets isError: true and returns validate-shape on schema failure", async () => {
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
    const content = result.content as Array<{ type: string; text: string }>;
    const body = JSON.parse(content[0]?.text ?? "{}");
    expect(body).toMatchObject({ ok: false, phase: "validate" });
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.errors[0].instancePath).toBe("/count");
  });

  test("emit_json sets isError: true and returns parse-shape on malformed YAML", async () => {
    const { client } = await connectClient();

    const result = await client.callTool({
      name: "emit_json",
      arguments: { yaml: 'foo: "unterminated' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    const body = JSON.parse(content[0]?.text ?? "{}");
    expect(body).toMatchObject({ ok: false, phase: "parse" });
    expect(typeof body.line).toBe("number");
    expect(typeof body.column).toBe("number");
    expect(typeof body.snippet).toBe("string");
  });

  test("unknown tool call returns isError without crashing", async () => {
    const { client } = await connectClient();

    const result = await client.callTool({
      name: "not_a_tool",
      // arguments optional, but some clients require an object
      arguments: {},
    });

    expect(result.isError).toBe(true);
  });
});
