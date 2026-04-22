import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { type } from "arktype";
import { EmitJsonFailure } from "../domain/errors.ts";
import { emitJson, type EmitResult } from "../domain/emitJson.ts";

const NAME = "json-emitter";
const VERSION = "0.4.0";

const INSTRUCTIONS = `emit_json converts YAML to validated JSON. Use it for authoring multi-line JSON from scratch — reach for it instead of hand-writing JSON into \`Write\` or a heredoc.
1. Emit your payload as YAML (prefer \`|\` block scalars for prose).
2. Pass a \`jsonSchema\` when the target shape exists — omitting it means only parse errors are detected.
3. Feed the returned \`json\` string directly to the next tool; do not retype or re-embed it.
On failure the structured \`phase\` (parse / schema_compile / validate) names the stage that failed.
Reference: the \`json-emitter://docs/yaml-authoring-guide\` resource covers quoting rules, block scalars, what the tool rejects, and what a \`jsonSchema\` catches.`;

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
      capabilities: { tools: {}, resources: {} },
      instructions: INSTRUCTIONS,
    },
  );

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: YAML_GUIDE_URI,
        name: YAML_GUIDE_NAME,
        description: YAML_GUIDE_DESCRIPTION,
        mimeType: "text/markdown",
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== YAML_GUIDE_URI) {
      throw new Error(`Unknown resource URI: ${request.params.uri}`);
    }
    return {
      contents: [
        {
          uri: YAML_GUIDE_URI,
          mimeType: "text/markdown",
          text: YAML_GUIDE_CONTENT,
        },
      ],
    };
  });

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

const YAML_GUIDE_URI = "json-emitter://docs/yaml-authoring-guide";
const YAML_GUIDE_NAME = "YAML Authoring Guide for emit_json";
const YAML_GUIDE_DESCRIPTION =
  "Reference for authoring YAML payloads that convert cleanly into JSON via emit_json — quoting rules, block scalars, what the tool rejects, and what a jsonSchema catches.";

const YAML_GUIDE_CONTENT = `# YAML Authoring Guide for \`emit_json\`

\`emit_json\` parses YAML 1.2 Core (strict) and returns validated JSON. This guide covers what the tool rejects, what it silently converts, and how a \`jsonSchema\` catches the residual risk.

## Quote anything that could coerce

YAML's plain scalars coerce to non-string types. Wrap these in quotes to keep them strings:

- **Version / dotted identifiers** — \`"1.10"\` (otherwise parsed as float \`1.1\`)
- **Leading-zero identifiers** — \`"007"\` (otherwise \`7\`)
- **All-digit identifiers** — git SHAs, Twitter IDs, phone numbers (silent precision loss past 2⁵³)
- **Scientific-notation-shaped strings** — \`"1e2"\` (otherwise \`100\`)
- **Hex / octal / binary literals** — \`"0x1F"\`, \`"0o755"\`, \`"0b101"\`
- **Reserved keywords** — \`"null"\`, \`"true"\`, \`"false"\`, \`"yes"\`, \`"no"\`, \`"on"\`, \`"off"\`, \`"~"\`
- **Date-shaped strings** — \`"2024-01-01"\`

YAML 1.2 Core (what this tool uses) already treats \`yes\`/\`no\`/\`on\`/\`off\` as plain strings, but quoting is portable across parsers and future-proof.

## Block scalars for prose

Multi-line prose belongs under a \`|\` block scalar. Inside \`|\`, quotes / colons / pipes / asterisks are just characters — no escaping needed.

\`\`\`yaml
description: |
  Here's some prose with "quotes", colons: in it,
  pipes | and asterisks *. None of this needs escaping.
\`\`\`

Use \`>\` if you want line folding; use \`|-\` to strip the trailing newline.

## What the tool actively rejects

These produce a \`phase: parse\` failure (the tool refuses; you fix the YAML):

- **Duplicate mapping keys** — YAML spec says they're invalid; this tool enforces it.
- **Multi-document streams** — a YAML stream with \`---\` separators cannot map to a single JSON value.
- **Tabs used for indentation** — YAML forbids them.
- **Inconsistent indentation** — mismatched columns in the same mapping/sequence.

## What passes but is lossy (avoid)

- **Non-string mapping keys** — \`42: x\` or \`true: x\` parse successfully but get stringified in JSON. Use string keys.
- **Flow sequence keys** — \`? [1, 2]\`: same story, stringified with a warning.
- **YAML anchors / aliases / merge keys** — expand manually; don't rely on them for JSON output.
- **Comments** — dropped on conversion; JSON has no comments.

## The residual risk: indentation-as-structure

The one class of silent failure no amount of discipline eliminates: a one-space indentation error that makes a child into a sibling. The document parses cleanly and produces the wrong JSON.

**The schema is the catch.** Pass a \`jsonSchema\` with \`required\` and \`additionalProperties: false\`. Structural mistakes surface as \`phase: validate\` errors with \`instancePath\` pointing at the wrong shape. Without a schema, only parse errors are detected.

## Failure phases

- **\`parse\`** — malformed YAML. Error payload includes line/column/snippet and, for common codes (duplicate keys, tabs, bad indent, multi-doc), a targeted hint.
- **\`schema_compile\`** — the supplied \`jsonSchema\` isn't valid JSON Schema. Fix the schema.
- **\`validate\`** — YAML parsed but the data doesn't match the schema. Each issue lists \`instancePath\`, \`keyword\`, and \`params\`. Fix the YAML or the schema and call again.
`;

const PARSE_ERROR_HINTS: Readonly<Record<string, string>> = {
  DUPLICATE_KEY:
    "Remove the duplicate key — YAML 1.2 mappings must have unique keys. If you need multiple values, use a sequence.",
  MULTIPLE_DOCS:
    "Emit only one document per call — YAML document separators (`---`) produce a multi-document stream which cannot be converted to a single JSON value.",
  TAB_AS_INDENT:
    "Replace the tab character with spaces — YAML forbids tabs for indentation.",
  BAD_INDENT:
    "Check indentation — every item in the same mapping or sequence must start at the same column. A one-space difference turns a child into a sibling.",
};

function formatFailureMessage(result: Extract<EmitResult, { ok: false }>): string {
  switch (result.phase) {
    case "parse": {
      const hint = result.code !== undefined ? PARSE_ERROR_HINTS[result.code] : undefined;
      const lines = [
        `YAML parse error at line ${result.line}, column ${result.column} (offset ${result.offset}):`,
        result.message,
        "",
        result.snippet,
      ];
      if (hint !== undefined) {
        lines.push("", `Hint: ${hint}`);
      }
      return lines.join("\n");
    }
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
