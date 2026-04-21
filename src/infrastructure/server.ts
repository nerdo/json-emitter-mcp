import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { type } from "arktype";
import { emitJson } from "../domain/emitJson.ts";

const NAME = "json-emitter";
const VERSION = "0.1.0";

const INSTRUCTIONS = `emit_json converts YAML to JSON with optional JSON Schema validation.
Emit your payload as YAML (prefer \`|\` block scalars for any multi-line or prose text),
pass the target JSON Schema alongside when one exists, and feed the returned \`json\` through
as your response. On failure, the structured \`phase\` tells you where to look — fix the YAML
or the content, then call again.`;

const TOOL_DESCRIPTION = `Emit validated JSON from a YAML payload. Accepts \`yaml\` (a YAML 1.2 string) and an optional \`jsonSchema\` (a JSON Schema 2020-12 object). Returns either the validated JSON string or a structured error you can use to self-correct.

Use this instead of hand-emitting JSON whenever the payload contains prose, quotes, colons, or any user-authored text — YAML block scalars (\`|\`, \`>\`) eliminate the escape-within-string context switch that causes silent JSON-string corruption at length.

Shape the input:
- Put long or multi-line text under a \`|\` block scalar. Inside \`|\`, quotes/colons/pipes/asterisks are just prose — no escaping needed.
- Quote strings that look like booleans, numbers, dates, or null (yes, on, 12, 2024-01-01). YAML 1.2 Core Schema is used; ambiguous plain scalars become strings only when quoted.
- Pass the target schema via \`jsonSchema\` whenever one exists — omitting it means the tool cannot detect shape/constraint violations.

The return is a tagged JSON object inside the content text block: \`{ok: true, json}\` on success; on failure, \`phase\` names the stage that failed ("parse", "schema_compile", or "validate") and the companion fields (line/column/snippet for parse, instancePath/message for validate) are what you use to fix the YAML and call again. isError is true whenever ok is false.`;

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
  },
  required: ["yaml"],
  additionalProperties: false,
};

/** Input boundary validator — enforces shape in case the SDK ever lets an invalid call through. */
const EmitJsonArgs = type({
  yaml: "string",
  "jsonSchema?": "object",
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
        content: [{ type: "text", text: JSON.stringify({ ok: false, phase: "input", message: validated.summary }) }],
        isError: true,
      };
    }

    const result = emitJson(validated.yaml, validated.jsonSchema);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: !result.ok,
    };
  });

  return server;
}
