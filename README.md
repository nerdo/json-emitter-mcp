# json-emitter

An MCP server with one tool: `emit_json(yaml, jsonSchema?)`. It converts a YAML 1.2 payload to JSON, optionally validating against a JSON Schema, and returns a tagged result an LLM can use to self-correct.

## Why

LLMs emitting JSON directly frequently drop escape-within-prose-strings at length — a stray `"` inside a long `"text"` value silently breaks the whole document (e.g. `SyntaxError at position 12021`). YAML block scalars (`|`, `>`) eliminate the context switch: inside `|`, quotes/colons/pipes/asterisks are just prose.

This server gives callers a safer emission surface, plus immediate pass/fail feedback when a schema is provided.

## Install & run

Local checkout (no publish):

```bash
bun install
bun run src/main.ts
```

Or build and run the bundle:

```bash
bun run build
bun dist/main.js
```

By default it listens on **stdio**. To listen on Streamable HTTP:

```bash
JSON_EMITTER_TRANSPORT=http JSON_EMITTER_HTTP_PORT=3000 bun src/main.ts
# or
bun src/main.ts --transport=http --port=3000
# then POST JSON-RPC to http://127.0.0.1:3000/mcp
```

## Using it from a Claude Code MCP config

```json
{
  "mcpServers": {
    "json-emitter": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/json-emitter-mcp/src/main.ts"]
    }
  }
}
```

## The tool

`emit_json({ yaml: string, jsonSchema?: object })` returns `{ content: [...], isError: boolean }`. The first text block is a JSON-encoded `EmitResult`:

- Success: `{ ok: true, json: "<stringified JSON>" }`
- Parse failure: `{ ok: false, phase: "parse", line, column, offset, message, snippet }`
- Bad user-supplied schema: `{ ok: false, phase: "schema_compile", message }`
- Schema validation failure: `{ ok: false, phase: "validate", errors: [{ instancePath, schemaPath, keyword, message, params }, …] }`

`isError` is `true` whenever `ok` is `false`.

## Example

Input:

```yaml
text: |
  TI-13196 has been "explore" status for a full sprint — Monday worth a check-in.
  Commits like "fix: thing" and times like 10:30am pass through intact.
count: 3
```

JSON Schema (optional):

```json
{
  "type": "object",
  "required": ["text", "count"],
  "properties": {
    "text": { "type": "string", "maxLength": 3000 },
    "count": { "type": "integer" }
  }
}
```

Result:

```json
{"ok":true,"json":"{\"text\":\"TI-13196 has been \\\"explore\\\" status for a full sprint — Monday worth a check-in.\\nCommits like \\\"fix: thing\\\" and times like 10:30am pass through intact.\\n\",\"count\":3}"}
```

If the text were >3000 characters, you'd get:

```json
{
  "ok": false,
  "phase": "validate",
  "errors": [{
    "instancePath": "/text",
    "schemaPath": "#/properties/text/maxLength",
    "keyword": "maxLength",
    "message": "must NOT have more than 3000 characters",
    "params": { "limit": 3000 }
  }]
}
```

## Authoring YAML for this tool

- Put long or multi-line text under a `|` block scalar. Inside `|`, quotes/colons/pipes/asterisks are just prose.
- Quote strings that look like booleans, numbers, dates, or null (`yes`, `on`, `12`, `2024-01-01`). YAML 1.2 Core Schema is used — the Norway problem is off (`no` stays `"no"`, not `false`), but ambiguous-looking plain scalars are still safer quoted.
- Pass the target `jsonSchema` whenever one exists. Without it, only parse errors can be caught.

## Libraries

- [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) — MCP server + stdio/Streamable HTTP transports
- [`yaml`](https://github.com/eemeli/yaml) — YAML 1.2 Core Schema, strict mode, pretty errors
- [`ajv`](https://ajv.js.org/) + [`ajv-formats`](https://github.com/ajv-validator/ajv-formats) — JSON Schema 2020-12 validation
- [`arktype`](https://arktype.io/) — input boundary validation
- [`ulid`](https://github.com/ulid/javascript) — error instance IDs

## Dev loop

```bash
bun run validate   # test → typecheck → test → build
bun run test       # just tests
bun run typecheck  # just tsc --noEmit
bun run lint       # biome lint
bun run format     # biome format --write
```

Run the Inspector against a local copy:

```bash
bunx @modelcontextprotocol/inspector bun src/main.ts
# or CLI mode:
bunx @modelcontextprotocol/inspector --cli bun src/main.ts --method tools/list
```

## License

MIT.
