import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function textOf(content: unknown): string {
  const arr = content as Array<{ type: string; text: string }>;
  return arr[0]?.text ?? "";
}

describe("stdio transport end-to-end (real subprocess)", () => {
  test("spawns the server, lists tools, calls emit_json through stdio; content text IS the JSON", async () => {
    const transport = new StdioClientTransport({
      command: "bun",
      args: ["src/main.ts"],
      env: { ...process.env, JSON_EMITTER_TRANSPORT: "stdio" },
      cwd: process.cwd(),
    });

    const client = new Client({ name: "stdio-e2e-test", version: "0.0.0" });
    try {
      await client.connect(transport);

      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("emit_json");

      const result = await client.callTool({
        name: "emit_json",
        arguments: {
          yaml: 'text: |\n  prose with "quotes" and: colons | pipes *',
        },
      });

      expect(result.isError).toBeFalsy();
      const text = textOf(result.content);
      // Text IS the JSON — parse it directly, no envelope to unwrap
      const parsed = JSON.parse(text) as { text: string };
      expect(parsed.text).toContain('"quotes"');
      expect(parsed.text).toContain("colons | pipes *");
    } finally {
      await client.close();
      await transport.close();
    }
  }, 15000);

  test("byte-12021 regression: long prose with quotes under block scalar round-trips as bare JSON", async () => {
    const transport = new StdioClientTransport({
      command: "bun",
      args: ["src/main.ts"],
      env: { ...process.env, JSON_EMITTER_TRANSPORT: "stdio" },
      cwd: process.cwd(),
    });
    const client = new Client({ name: "stdio-regression", version: "0.0.0" });

    try {
      await client.connect(transport);

      const longProse = [
        'TI-13196 has been "explore" status for a full sprint — Monday worth a check-in',
        'Other note: commits like "fix: thing" should stay intact; colons (e.g. at 10:30am) too',
        "Asterisks *emphasized*, pipes |a|b|, and `code snippets` all pass through",
      ].join("\n  ");

      const yaml = `text: |\n  ${longProse}`;

      const result = await client.callTool({
        name: "emit_json",
        arguments: { yaml },
      });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(textOf(result.content)) as { text: string };

      expect(parsed.text).toContain('"explore"');
      expect(parsed.text).toContain('"fix: thing"');
      expect(parsed.text).toContain("10:30am");
      expect(parsed.text).toContain("|a|b|");
      expect(parsed.text).toContain("*emphasized*");
    } finally {
      await client.close();
      await transport.close();
    }
  }, 15000);

  test("options.pretty=true returns indented JSON (still bare)", async () => {
    const transport = new StdioClientTransport({
      command: "bun",
      args: ["src/main.ts"],
      env: { ...process.env, JSON_EMITTER_TRANSPORT: "stdio" },
      cwd: process.cwd(),
    });
    const client = new Client({ name: "stdio-pretty", version: "0.0.0" });

    try {
      await client.connect(transport);

      const result = await client.callTool({
        name: "emit_json",
        arguments: {
          yaml: "foo: bar\nnum: 1",
          options: { pretty: true },
        },
      });

      expect(result.isError).toBeFalsy();
      const text = textOf(result.content);
      expect(text).toBe('{\n  "foo": "bar",\n  "num": 1\n}');
    } finally {
      await client.close();
      await transport.close();
    }
  }, 15000);

  test("parse failure: isError true, text names the phase and location", async () => {
    const transport = new StdioClientTransport({
      command: "bun",
      args: ["src/main.ts"],
      env: { ...process.env, JSON_EMITTER_TRANSPORT: "stdio" },
      cwd: process.cwd(),
    });
    const client = new Client({ name: "stdio-parse-err", version: "0.0.0" });

    try {
      await client.connect(transport);

      const result = await client.callTool({
        name: "emit_json",
        arguments: { yaml: 'foo: "unterminated' },
      });

      expect(result.isError).toBe(true);
      const text = textOf(result.content);
      expect(text).toContain("YAML parse error");
      expect(text).toContain("line 1");
    } finally {
      await client.close();
      await transport.close();
    }
  }, 15000);
});
