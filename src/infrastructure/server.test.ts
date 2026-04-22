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

  test("parse failure message includes a targeted hint for duplicate keys", async () => {
    const { client } = await connectClient();

    await expect(
      client.callTool({
        name: "emit_json",
        arguments: { yaml: "a: 1\na: 2\n" },
      }),
    ).rejects.toThrow(/Hint:.*duplicate/i);
  });

  test("parse failure message includes a targeted hint for multi-document streams", async () => {
    const { client } = await connectClient();

    await expect(
      client.callTool({
        name: "emit_json",
        arguments: { yaml: "---\nfoo: 1\n---\nbar: 2\n" },
      }),
    ).rejects.toThrow(/Hint:.*one document/i);
  });

  test("parse failure message includes a targeted hint for tab indentation", async () => {
    const { client } = await connectClient();

    await expect(
      client.callTool({
        name: "emit_json",
        arguments: { yaml: "foo:\n\tbar: 1\n" },
      }),
    ).rejects.toThrow(/Hint:.*tab/i);
  });

  test("parse failure message includes a targeted hint for bad indentation", async () => {
    const { client } = await connectClient();

    await expect(
      client.callTool({
        name: "emit_json",
        arguments: { yaml: "a:\n  b: 1\n c: 2" },
      }),
    ).rejects.toThrow(/Hint:.*indent/i);
  });

  test("parse failure for unknown error code omits the Hint line", async () => {
    const { client } = await connectClient();

    // Unterminated quote → MISSING_CHAR; we deliberately don't ship a hint for
    // this code (the snippet already carries the signal), so no "Hint:" should appear.
    await expect(
      client.callTool({
        name: "emit_json",
        arguments: { yaml: 'foo: "unterminated\nbar: ok' },
      }),
    ).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringMatching(/Hint:/i) }),
    );
  });

  test("exposes a yaml-authoring-guide resource", async () => {
    const { client } = await connectClient();

    const { resources } = await client.listResources();

    const guide = resources.find((r) => r.uri === "json-emitter://docs/yaml-authoring-guide");
    expect(guide).toBeDefined();
    expect(guide?.mimeType).toBe("text/markdown");
    expect(guide?.name?.length ?? 0).toBeGreaterThan(0);
    expect(guide?.description?.length ?? 0).toBeGreaterThan(0);
  });

  test("reads the yaml-authoring-guide resource as markdown", async () => {
    const { client } = await connectClient();

    const result = await client.readResource({
      uri: "json-emitter://docs/yaml-authoring-guide",
    });

    expect(result.contents.length).toBeGreaterThan(0);
    const first = result.contents[0];
    expect(first?.uri).toBe("json-emitter://docs/yaml-authoring-guide");
    expect(first?.mimeType).toBe("text/markdown");
    const text = first !== undefined && "text" in first && typeof first.text === "string"
      ? first.text
      : "";
    expect(text.length).toBeGreaterThan(200);
    // Content sanity — must cover the pillars the guide promises
    expect(text).toMatch(/block scalar/i);
    expect(text).toMatch(/quote/i);
    expect(text).toMatch(/schema/i);
  });

  test("reading an unknown resource URI rejects", async () => {
    const { client } = await connectClient();

    await expect(
      client.readResource({ uri: "json-emitter://docs/does-not-exist" }),
    ).rejects.toThrow();
  });

  test("unknown tool call rejects", async () => {
    const { client } = await connectClient();

    await expect(
      client.callTool({ name: "not_a_tool", arguments: {} }),
    ).rejects.toThrow();
  });
});
