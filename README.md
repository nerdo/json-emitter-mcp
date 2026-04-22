# json-emitter

An MCP server with one tool: `emit_json(yaml, jsonSchema?, options?)`. It converts a YAML 1.2 payload to JSON, optionally validating against a JSON Schema. **On success, the tool's text response IS the JSON** — callers relay it verbatim. On failure, `isError` is set and the text names the phase and location.

## Why

LLMs emitting JSON directly frequently drop escape-within-prose-strings at length — a stray `"` inside a long `"text"` value silently breaks the whole document (e.g. `SyntaxError at position 12021`). YAML block scalars (`|`, `>`) eliminate the context switch: inside `|`, quotes/colons/pipes/asterisks are just prose.

Returning the JSON directly (rather than wrapping it in a `{ok, json}` envelope) avoids a second failure mode: LLMs unwrapping and re-stringifying the inner JSON themselves. Every byte-touching step between tool output and handoff should be deterministic.

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

```
emit_json({
  yaml: string,
  jsonSchema?: object,
  options?: { pretty?: boolean }
})
```

### Success

`isError` is absent/false. `content[0].text` is the JSON — literally, with no envelope:

```
{"text":"TI-13196 has been \"explore\" status...","count":3}
```

Default output is compact. Pass `options: {pretty: true}` for 2-space indentation.

### Failure

`isError` is `true`. `content[0].text` is a formatted message naming the phase and location.

Parse failure (malformed YAML):

```
YAML parse error at line 1, column 19 (offset 18):
Missing closing "quote at line 1, column 19:

   1 | foo: "unterminated
   1 |                   ^
```

Schema-compile failure (the user-supplied `jsonSchema` itself is invalid):

```
JSON Schema is invalid and could not be compiled: schema is invalid: data/type must be equal to one of the allowed values
```

Validation failure (YAML parses, but the data doesn't match the schema):

```
JSON Schema validation failed with 1 issue(s):
  /text: must NOT have more than 3000 characters  (keyword: maxLength, params: {"limit":3000})
```

## Example

Input YAML:

```yaml
text: |
  TI-13196 has been "explore" status for a full sprint — Monday worth a check-in.
  Commits like "fix: thing" and times like 10:30am pass through intact.
count: 3
```

Optional JSON Schema:

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

Tool response content (success):

```
{"text":"TI-13196 has been \"explore\" status for a full sprint — Monday worth a check-in.\nCommits like \"fix: thing\" and times like 10:30am pass through intact.\n","count":3}
```

That text IS the answer. Callers copy those bytes through to the destination — no JSON.parse + JSON.stringify round-trip, no manual unwrapping.

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
bunx @modelcontextprotocol/inspector --cli bun src/main.ts --method tools/call --tool-name emit_json --tool-arg yaml='foo: bar'
```

## License

MIT.
