import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

describe("stdio transport end-to-end (real subprocess)", () => {
  test("spawns the server, lists tools, calls emit_json through stdio", async () => {
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
      const content = result.content as Array<{ type: string; text: string }>;
      const body = JSON.parse(content[0]?.text ?? "{}");
      expect(body).toMatchObject({ ok: true });
      const parsed = JSON.parse(body.json) as { text: string };
      expect(parsed.text).toContain('"quotes"');
      expect(parsed.text).toContain("colons | pipes *");
    } finally {
      await client.close();
      await transport.close();
    }
  }, 15000);

  test("byte-12021 regression: long prose with quotes under block scalar round-trips", async () => {
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
      const content = result.content as Array<{ type: string; text: string }>;
      const body = JSON.parse(content[0]?.text ?? "{}");
      const parsed = JSON.parse(body.json) as { text: string };

      // Confirm none of the prose's sharp characters corrupted the JSON
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
});
