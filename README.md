# json-emitter

An MCP server with one tool: `emit_json(yaml, jsonSchema?, options?)`. It converts a YAML 1.2 payload to JSON, optionally validating against a JSON Schema. The response body is the JSON. Failures raise an MCP error with a message naming the phase and location. A returned response is always a valid JSON payload.

## Why

LLMs emitting JSON directly frequently drop escape-within-prose-strings at length — a stray `"` inside a long `"text"` value silently breaks the whole document (e.g. `SyntaxError at position 12021`). YAML block scalars (`|`, `>`) eliminate the context switch: inside `|`, quotes/colons/pipes/asterisks are just prose.

The tool returns the JSON as the response body rather than wrapping it in an envelope, and raises errors rather than returning them as data. Callers work with the JSON directly; whatever processing they do with it afterwards is their call.

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

From npm (once published):

```json
{
  "mcpServers": {
    "json-emitter": {
      "command": "npx",
      "args": ["-y", "json-emitter"]
    }
  }
}
```

From a local checkout:

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

The tool returns with `content[0].text` set to the JSON — literally, with no envelope:

```
{"text":"TI-13196 has been \"explore\" status...","count":3}
```

Default output is compact. Pass `options: {pretty: true}` for 2-space indentation.

### Failure

The tool raises an MCP error. MCP clients surface it as an exception from `callTool(...)`; LLMs see an error in the tool result. The error message names the phase and location.

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

That's the response body — already valid JSON, already compact, the contract's output.

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
