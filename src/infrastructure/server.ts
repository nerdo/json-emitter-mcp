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

const INSTRUCTIONS = `emit_json converts YAML to JSON, optionally validating against a JSON Schema.
A successful call returns the JSON as the tool's text content — the tool has already parsed the
YAML, produced syntactically valid JSON, and (if a jsonSchema was supplied) confirmed the data
satisfies it. Relay the bytes of \`content[0].text\` verbatim; do NOT re-parse, re-validate,
re-stringify, pipe through jq, or otherwise reprocess. If the tool raises an error, the message
names the phase (parse / schema_compile / validate) and location so you can fix the YAML or the
content and call again. Compact by default; pass \`options: {pretty: true}\` for indented output.`;

const TOOL_DESCRIPTION = `Emit JSON from a YAML payload, validated against an optional JSON Schema. Accepts \`yaml\` (YAML 1.2 string), optional \`jsonSchema\` (JSON Schema 2020-12 object), and optional \`options\` (e.g. \`{pretty: true}\` for indented output; compact by default).

**A successful call returns the JSON directly.** The tool has already: parsed the YAML successfully, produced syntactically valid JSON, and — if a \`jsonSchema\` was supplied — confirmed the data satisfies the schema. If any of those had failed, the tool would have raised an error instead of returning. Do not re-parse, re-validate, re-stringify, pipe through jq as a safety check, or otherwise reprocess a successful result. Relay the bytes of the returned text verbatim as your response — the bytes the tool returns are the bytes you should hand off.

**On failure the tool raises an error.** The error message names the phase and location:
- "parse" — malformed YAML; message includes line/column/snippet
- "schema_compile" — the \`jsonSchema\` you supplied is not a valid JSON Schema; message is the ajv compile error
- "validate" — YAML parsed but the data doesn't match the schema; message lists each issue's instancePath/keyword/params

Read the error message, fix the YAML or the content, and call again. There is no intermediate "ok:false" return — a returned response is always a valid JSON payload.

Use this instead of hand-emitting JSON whenever the payload contains prose, quotes, colons, or any user-authored text — YAML block scalars (\`|\`, \`>\`) eliminate the escape-within-string context switch that causes silent JSON-string corruption at length.

Shape the input:
- Put long or multi-line text under a \`|\` block scalar. Inside \`|\`, quotes/colons/pipes/asterisks are just prose — no escaping needed.
- Quote strings that look like booleans, numbers, dates, or null (yes, on, 12, 2024-01-01). YAML 1.2 Core Schema is used; ambiguous plain scalars become strings only when quoted.
- Pass the target schema via \`jsonSchema\` whenever one exists — omitting it means the tool cannot detect shape/constraint violations (only YAML parse errors are caught).`;

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
