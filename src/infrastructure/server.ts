import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { type } from "arktype";
import { EmitJsonFailure } from "../domain/errors.ts";
import { emitJson, type EmitResult } from "../domain/emitJson.ts";

const NAME = "json-emitter";
const VERSION = "0.3.0";

const INSTRUCTIONS = `emit_json converts YAML to validated JSON. Use it for authoring multi-line JSON from scratch — reach for it instead of hand-writing JSON into \`Write\` or a heredoc.
1. Emit your payload as YAML (prefer \`|\` block scalars for prose).
2. Pass a \`jsonSchema\` when the target shape exists — omitting it means only parse errors are detected.
3. Feed the returned \`json\` string directly to the next tool; do not retype or re-embed it.
On failure the structured \`phase\` (parse / schema_compile / validate) names the stage that failed.`;

const TOOL_DESCRIPTION = `Use when authoring multi-line JSON from scratch — OpenAPI specs, fixtures, config files, API request bodies, anything strict-schema. Reach for this instead of \`Write\` with a \`.json\` path or a heredoc of JSON: authoring in YAML avoids the quote/escape/trailing-comma traps, and the returned bytes are validated-by-construction before they touch disk. Pass the returned \`json\` string directly to the next tool (\`Write\`, another MCP, a shell pipe) — do not retype or re-embed it.

Accepts \`yaml\` (YAML 1.2 string), optional \`jsonSchema\` (JSON Schema 2020-12 object), and optional \`options\` (e.g. \`{pretty: true}\` for indented output; compact by default). A successful return means the YAML parsed, the result is syntactically valid JSON, and — if a \`jsonSchema\` was supplied — the data satisfies that schema. Anything short of that raises an error; nothing is returned.

Input shape tips:
- Long or multi-line text belongs under a \`|\` block scalar. Inside \`|\`, quotes/colons/pipes/asterisks are just prose — no escaping needed.
- Strings that look like booleans, numbers, dates, or null (yes, on, 12, 2024-01-01) should be quoted. YAML 1.2 Core Schema is used; ambiguous plain scalars become strings only when quoted.
- Omitting \`jsonSchema\` means only parse errors are detected, not shape/constraint violations.

Failure modes:
- "parse" — malformed YAML; error message includes line/column/snippet.
- "schema_compile" — the supplied \`jsonSchema\` is not a valid JSON Schema; error message is the ajv compile error.
- "validate" — YAML parsed but the data doesn't match the schema; error message lists each issue's instancePath, keyword, and params. Fix the YAML or the schema and call again.`;

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
      throw new Error(`Unknown tool: ${request.params.name}`);
    }

    const validated = EmitJsonArgs(request.params.arguments);
    if (validated instanceof type.errors) {
      throw new EmitJsonFailure({
        phase: "parse",
        message: `emit_json: invalid arguments — ${validated.summary}`,
      });
    }

    const result = emitJson(validated.yaml, validated.jsonSchema, validated.options);

    if (!result.ok) {
      throw new EmitJsonFailure({
        phase: result.phase,
        message: formatFailureMessage(result),
      });
    }

    return { content: [{ type: "text", text: result.json }] };
  });

  return server;
}

function formatFailureMessage(result: Extract<EmitResult, { ok: false }>): string {
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
