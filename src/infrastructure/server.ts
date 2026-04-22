import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { type } from "arktype";
import { emitJson, type EmitResult } from "../domain/emitJson.ts";

const NAME = "json-emitter";
const VERSION = "0.2.0";

const INSTRUCTIONS = `emit_json converts YAML to JSON, optionally validating against a JSON Schema.
Emit your payload as YAML (prefer \`|\` block scalars for any multi-line or prose text) and pass
the target JSON Schema alongside when one exists. On success the tool's text content IS the final
JSON — emit it verbatim as your response; do NOT re-wrap, re-stringify, or re-indent it. On
failure the response has \`isError: true\` and the text names the phase and location so you can
fix the YAML (or the content) and call again. Compact by default; pass \`options: {pretty: true}\`
for indented output.`;

const TOOL_DESCRIPTION = `Emit validated JSON from a YAML payload. Accepts \`yaml\` (YAML 1.2 string), optional \`jsonSchema\` (JSON Schema 2020-12 object), and optional \`options\` (e.g. \`{pretty: true}\` for indented output; compact by default).

Use this instead of hand-emitting JSON whenever the payload contains prose, quotes, colons, or any user-authored text — YAML block scalars (\`|\`, \`>\`) eliminate the escape-within-string context switch that causes silent JSON-string corruption at length.

Shape the input:
- Put long or multi-line text under a \`|\` block scalar. Inside \`|\`, quotes/colons/pipes/asterisks are just prose — no escaping needed.
- Quote strings that look like booleans, numbers, dates, or null (yes, on, 12, 2024-01-01). YAML 1.2 Core Schema is used; ambiguous plain scalars become strings only when quoted.
- Pass the target schema via \`jsonSchema\` whenever one exists — omitting it means the tool cannot detect shape/constraint violations.

On success, the tool's text content IS the JSON. Relay it verbatim as your response — do not unwrap, re-stringify, re-indent, or reformat it. The bytes the tool returns are the bytes you should hand off.

On failure, \`isError\` is true and the text content names the phase and location: "parse" (with line/column/snippet), "schema_compile" (with the ajv message for a malformed JSON Schema), or "validate" (with per-issue instancePath/keyword/message). Read it, fix the YAML or the content, and call again.`;

const EMIT_JSON_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    yaml: {
      type: "string",
      description: "YAML 1.2 source to convert. Prefer `|` block scalars for multi-line or prose text.",
    },
    jsonSchema: {
      type: "object",
      description: "Optional JSON Schema (2020-12) to validate the parsed payload against.",
      additionalProperties: true,
    },
    options: {
      type: "object",
      description: "Optional output formatting. Currently supports {pretty: boolean}; defaults to compact.",
      properties: {
        pretty: {
          type: "boolean",
          description: "If true, indent the JSON output with 2 spaces. Default false.",
        },
      },
      additionalProperties: false,
    },
  },
  required: ["yaml"],
  additionalProperties: false,
};

/** Input boundary validator — enforces shape in case the SDK ever lets an invalid call through. */
const EmitJsonArgs = type({
  yaml: "string",
  "jsonSchema?": "object",
  "options?": {
    "pretty?": "boolean",
  },
});

export function createJsonEmitterServer(): Server {
  const server = new Server(
    { name: NAME, version: VERSION },
    {
      capabilities: { tools: {} },
      instructions: INSTRUCTIONS,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "emit_json",
        title: "Emit JSON",
        description: TOOL_DESCRIPTION,
        inputSchema: EMIT_JSON_INPUT_SCHEMA,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "emit_json") {
      return {
        content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
        isError: true,
      };
    }

    const validated = EmitJsonArgs(request.params.arguments);
    if (validated instanceof type.errors) {
      return {
        content: [{ type: "text", text: `emit_json: invalid arguments — ${validated.summary}` }],
        isError: true,
      };
    }

    const result = emitJson(validated.yaml, validated.jsonSchema, validated.options);

    if (result.ok) {
      return { content: [{ type: "text", text: result.json }] };
    }

    return {
      content: [{ type: "text", text: formatError(result) }],
      isError: true,
    };
  });

  return server;
}

function formatError(result: Extract<EmitResult, { ok: false }>): string {
  switch (result.phase) {
    case "parse":
      return [
        `YAML parse error at line ${result.line}, column ${result.column} (offset ${result.offset}):`,
        result.message,
        "",
        result.snippet,
      ].join("\n");
    case "schema_compile":
      return `JSON Schema is invalid and could not be compiled: ${result.message}`;
    case "validate": {
      const header = `JSON Schema validation failed with ${result.errors.length} issue(s):`;
      const lines = result.errors.map((issue) => {
        const path = issue.instancePath || "/";
        const paramsPreview = JSON.stringify(issue.params);
        return `  ${path}: ${issue.message}  (keyword: ${issue.keyword}, params: ${paramsPreview})`;
      });
      return [header, ...lines].join("\n");
    }
  }
}
