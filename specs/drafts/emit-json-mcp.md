# emit-json MCP Server

## Summary
A narrow, general-purpose MCP server exposing a single tool — `emit_json` — that accepts YAML and an optional JSON Schema, and returns either validated JSON or structured, self-correcting error feedback.

The motivating problem: LLMs emitting JSON directly frequently drop escape-within-prose-strings at length (see the byte-12021 Slack-blocks failure at the end of this spec). YAML block scalars eliminate that context switch — inside `|`, prose is prose. A narrow tool that converts YAML → validated JSON gives callers:

1. A safer emission surface for the LLM (block scalars instead of escaped JSON strings).
2. Immediate pass/fail feedback with enough detail to self-correct.
3. Zero shell-transport pain — the payload moves as a tool argument, not through pipes.

## Complexity Score
**5 / 10** — Moderate. Single responsibility per module, two well-known libraries (`yaml`, `ajv`) composed with a pure domain function, thin infrastructure shell. Not trivial because we're supporting multiple transports and producing structured errors with line/column info.

## Open Questions
### Resolved
- [x] **Q1**: Validator choice → **Ajv 2020** (`ajv/dist/2020`) with `ajv-formats`. Prime directive [Tooling Preferences](prime-directive-mcp://preferences/tooling-preferences.md) lists Ajv explicitly "for JSON Schema compliance requirements". ArkType is not a JSON Schema validator.
- [x] **Q2**: Schema parameter shape → **JSON Schema object**, not YAML-encoded. Schemas have a fixed, small vocabulary the LLM can produce reliably even as JSON.
- [x] **Q3**: Test harness → `bunx @modelcontextprotocol/inspector` during development; end-user validation with the user's live MCP client at the end.
- [x] **Q4**: Transports → **stdio default** + **Streamable HTTP**. SSE (the legacy transport) is explicitly skipped; per MCP SDK docs Streamable HTTP is the recommended remote transport.
- [x] **Q5**: Internal validation library for the MCP tool's own `inputSchema` → **ArkType** (Standard Schema compatible, preferred per prime directives).
- [x] **Q6**: Repo/server name → **`json-emitter`** (package name; the repo dir is `json-emitter-mcp`).
- [x] **Q7**: YAML version → **YAML 1.2 Core Schema, strict**. Kills Norway (`no → false`), `yes/on` booleans, octal-leading-zero ambiguity. `eemeli/yaml` defaults to this; merge-keys off.
- [x] **Q8**: What to do when the user-supplied JSON Schema is itself malformed → distinct phase `phase: "schema_compile"` with Ajv's compile error surfaced. Distinguished from `phase: "validate"` (data didn't match a valid schema).
- [x] **Q9**: "Empty YAML" behavior → `yaml.parse("")` returns `null`. That's a valid JSON document, returned as success `"null"`. The schema (if provided) decides whether `null` passes.
- [x] **Q10**: Success payload shape in MCP response → a single text content block whose body is the JSON-stringified tagged result. Callers (LLMs) re-parse it. This keeps the transport text-only and matches the existing MCP content contract.

### Unresolved
- [ ] **Q11**: Do we expose a stdin-CLI alongside the MCP server? E.g., `echo "$yaml" | json-emitter emit` for non-MCP callers. Defer — the MCP transport covers the primary use case. Revisit if user requests it post-v1.
- [ ] **Q12**: npm publish? Out of scope for v1 — the repo is local-use first, set up for `bunx github:nerdo/json-emitter-mcp` or an explicit local install. Defer.

## Process Flow
```
[MCP client] ──(call emit_json)──► [MCP server: registerTool handler]
                                          │
                                          ▼
                           ┌──────────────────────────────┐
                           │ ArkType boundary validation  │
                           │ (yaml: string, jsonSchema?:  │
                           │  object)                     │
                           └──────────────┬───────────────┘
                                          │
                                          ▼
                           ┌──────────────────────────────┐
                           │ emitJson(yaml, schema?)      │  ← pure domain function
                           │ 1. yaml.parse(1.2 Core)      │
                           │    ├─► YAMLParseError        │
                           │    │   → {ok:false,          │
                           │    │      phase:"parse",     │
                           │    │      line,col,snippet}  │
                           │    └─► data                  │
                           │ 2. if schema:                │
                           │    ajv.compile(schema)       │
                           │    ├─► compile throws        │
                           │    │   → {ok:false,          │
                           │    │      phase:"schema_    │
                           │    │      compile",msg}      │
                           │    └─► validator             │
                           │    validator(data)           │
                           │    ├─► false                 │
                           │    │   → {ok:false,          │
                           │    │      phase:"validate",  │
                           │    │      errors:[…]}        │
                           │    └─► true                  │
                           │ 3. JSON.stringify(data)      │
                           │    → {ok:true, json}         │
                           └──────────────┬───────────────┘
                                          │
                                          ▼
                           ┌──────────────────────────────┐
                           │ Wrap as MCP response:        │
                           │ { content:[{type:"text",     │
                           │   text:JSON.stringify(res)}],│
                           │   isError: !res.ok }         │
                           └──────────────┬───────────────┘
                                          │
                                          ▼
                                   [MCP client]
```

## Module Definitions
Inside-out architecture. Single package (`json-emitter`) with a package-owned error root (`JsonEmitterError`), because this server is a standalone library rather than part of a larger app.

Module count is intentionally small per KISS — ~6 files. No wrapper error classes for `YAMLParseError` or Ajv compile errors: those are caught inside `emitJson` and transformed directly into `EmitResult` values without ever escaping the domain function, so wrapping them in owned error classes adds indirection without buying anything (YAGNI).

### Domain Layer — `src/domain/`
| Module | Responsibility | Input | Output |
|---|---|---|---|
| `errors.ts` | Package-owned root `JsonEmitterError`. Full AppError pattern: `errorId` (ULID), `unixTimestamp` (seconds), structured fields, native `Error.cause`, `getDetails()`. Thrown for unexpected internal failures only (parse/validate failures are *values*, not exceptions). | — | — |
| `emitJson.ts` | Pure function `emitJson(yaml, schema?) → EmitResult` plus `EmitResult` and `SchemaValidationIssue` types. No I/O. | yaml string, optional schema object | `EmitResult` |

**`EmitResult`**:
```typescript
export type EmitResult =
  | { ok: true; json: string }
  | { ok: false; phase: 'parse'; line: number; column: number; offset: number; message: string; snippet: string }
  | { ok: false; phase: 'schema_compile'; message: string }
  | { ok: false; phase: 'validate'; errors: ReadonlyArray<SchemaValidationIssue> };

export interface SchemaValidationIssue {
  readonly instancePath: string;   // e.g. "/blocks/3/text/text"
  readonly schemaPath: string;     // e.g. "#/properties/blocks/items/..."
  readonly keyword: string;        // e.g. "maxLength", "required", "type"
  readonly message: string;        // Ajv-rendered human message
  readonly params: Readonly<Record<string, unknown>>;  // Ajv's params (maxLength value, etc.)
}
```

`EmitResult` is a value type, not an exception. Parse and schema failures are expected outcomes of the tool; they flow back to the caller as data so the LLM can act on them. Unexpected errors (programming bugs, OOM, etc.) throw and bubble.

### Infrastructure Layer — `src/infrastructure/`
| Module | Responsibility |
|---|---|
| `server.ts` | `createJsonEmitterServer()` factory. Returns a configured `McpServer` with `emit_json` registered (ArkType `inputSchema`), instructions set, handler wired to `emitJson`. |
| `transports.ts` | `startStdioTransport(server)` and `startHttpTransport(server, port)`. Pure wiring, no config reading. |
| `settings.ts` | Reads `process.env` and CLI args **once** — only place allowed per PD. Exposes a typed `settings` object (transport, port). |

### Entry Point — `src/main.ts`
Top-level: read settings → create server → start selected transport → install SIGINT/SIGTERM shutdown.

### Boundary Validation (ArkType schema for the tool input)
```typescript
const EmitJsonInput = type({
  yaml: 'string',
  'jsonSchema?': 'object'
});
```
`jsonSchema` is typed as `object` — we do NOT try to validate the schema's own shape here. Ajv will reject malformed schemas at compile time with a structured error we forward back.

### Tool Description (Gen-3, per MCP Authoring Skill)
```
Emit validated JSON from a YAML payload. Accepts `yaml` (a YAML 1.2 string) and an optional
`jsonSchema` (a JSON Schema 2020-12 object). Returns either the validated JSON string or a
structured error you can use to self-correct.

Use this instead of hand-emitting JSON whenever the payload contains prose, quotes, colons,
or any user-authored text — YAML block scalars (`|`, `>`) eliminate the escape-within-string
context switch that causes silent JSON-string corruption at length.

Shape the input:
- Put long or multi-line text under a `|` block scalar. Inside `|`, quotes/colons/pipes/asterisks
  are just prose — no escaping needed.
- Quote strings that look like booleans, numbers, dates, or null (yes, on, 12, 2024-01-01).
  YAML 1.2 Core Schema is used; ambiguous plain scalars become strings only when quoted.
- Pass the target schema via `jsonSchema` whenever one exists — omitting it means the tool
  cannot detect shape/constraint violations.

The return is a tagged object: `{ok: true, json}` on success; on failure, `phase` names the
stage that failed ("parse", "schema_compile", or "validate") and the companion fields
(line/column/snippet for parse, instancePath/message for validate) are what you use to fix
the YAML and call again.
```

### Server Instructions Field
Short workflow summary, per MCP Authoring Skill:
```
emit_json converts YAML to JSON with optional JSON Schema validation. Emit your payload as
YAML (prefer `|` block scalars for any multi-line or prose text), pass the target JSON Schema
alongside when one exists, and feed the returned `json` through as your response. On failure,
the structured `phase` tells you where to look — fix the YAML or the content, then call
again.
```

## Validation Boundaries
| Boundary | Direction | Mechanism |
|---|---|---|
| MCP tool call → handler | External → Domain | ArkType `EmitJsonInput` schema. Rejects non-string yaml, non-object jsonSchema. Produces ArkType issues. |
| Parsed YAML → JSON data | Internal | `yaml.parse` with `{ version: '1.2', schema: 'core', strict: true }`. Throws `YAMLParseError` we catch and transform. |
| User-supplied JSON Schema → Ajv | External → Internal | `ajv.compile(schema)`. Throws on malformed schema — caught and transformed to `phase: "schema_compile"` result. |
| Validator over data | Internal | `validator(data)` — false-returning path produces `phase: "validate"` result with Ajv's `errors` transformed. |
| Server args → Settings | External → Internal | `Settings` module is the only reader of `process.env`/CLI; everything else reads the typed `settings` object. |

## Test Cases
Guards-first ordering per specs skill.

### Error Scenarios (Guards)
- [ ] **TC1 — Malformed YAML**: unterminated string, missing colon, bad indentation
  - **Given**: `yaml: "foo: bar\n  bad: indent"` (or similar structural break)
  - **When**: `emit_json` called
  - **Then**: `{ok: false, phase: "parse", line: N, column: N, offset: N, message: <yaml lib message>, snippet: <line with caret>}`
- [ ] **TC2 — Type mismatch vs schema**: `{ok: false, phase: "validate"}` with `instancePath: "/count"` and `keyword: "type"`
  - **Given**: yaml `count: "ten"`, schema requires `count: {type: integer}`
  - **When**: `emit_json` called
  - **Then**: `phase: "validate"`, at least one issue with `instancePath: "/count"`, `keyword: "type"`, params `{type: "integer"}`
- [ ] **TC3 — maxLength violation**: the concrete motivating Slack failure
  - **Given**: yaml with a section `text` > 3000 chars, schema enforces `maxLength: 3000`
  - **When**: `emit_json` called
  - **Then**: `phase: "validate"`, issue with `keyword: "maxLength"`, `params: {limit: 3000}`, `instancePath` pointing at the offending node
- [ ] **TC4 — Missing required property**: `{ok: false, phase: "validate", keyword: "required"}`
  - **Given**: schema requires `{id, name}`, yaml omits `name`
  - **When**: `emit_json` called
  - **Then**: issue with `keyword: "required"`, `params: {missingProperty: "name"}`
- [ ] **TC5 — Malformed user-supplied schema**: not a valid JSON Schema
  - **Given**: `jsonSchema: {type: "bogustype"}`
  - **When**: `emit_json` called
  - **Then**: `{ok: false, phase: "schema_compile", message: <ajv compile error>}`
- [ ] **TC6 — Both YAML invalid AND schema would fail**: parse wins
  - **Given**: invalid yaml + valid schema
  - **When**: `emit_json` called
  - **Then**: `phase: "parse"` (schema never runs)
- [ ] **TC7 — Non-string yaml argument**: boundary rejection
  - **Given**: call tool with `yaml: 42` (somehow bypassing typed client)
  - **When**: MCP handler processes
  - **Then**: ArkType boundary validation fails; MCP returns `isError: true` with a structured validation issue

### Recovery Paths
- [ ] **TC8 — Parse-error retry**: LLM uses `line`/`column`/`snippet` to locate the YAML issue and resubmits corrected yaml
  - **Given**: a parse_error result from TC1
  - **When**: LLM fixes the indicated line and retries
  - **Then**: success on second call (covered by an integration test simulating this loop)
- [ ] **TC9 — Validation-error retry**: LLM uses `instancePath` to locate the offending field and resubmits
  - **Given**: validate result from TC3
  - **When**: LLM shortens the text under the flagged `instancePath`
  - **Then**: success on second call

### Edge Cases
- [ ] **TC10 — JSON-as-YAML**: YAML 1.2 is a superset of JSON
  - **Given**: yaml string is literal JSON (`'{"foo": 1}'`)
  - **When**: `emit_json` called with no schema
  - **Then**: `{ok: true, json: '{"foo":1}'}` (semantically equivalent; exact formatting up to `JSON.stringify`)
- [ ] **TC11 — Block scalar preserves prose punctuation**: the entire point of the format
  - **Given**: yaml `text: |\n  TI-13196 has been "explore" status for a full sprint — Monday worth a check-in`
  - **When**: `emit_json` called
  - **Then**: `ok: true`; the resulting JSON contains the full prose value with quotes properly escaped in JSON output, no truncation, no corruption
- [ ] **TC12 — Norway problem neutralized**: `no` plain scalar stays a string in Core schema
  - **Given**: yaml `country: no` (unquoted)
  - **When**: `emit_json` called
  - **Then**: `ok: true`, `json` contains `"country":"no"` (not `false`) — because we use Core (not yaml-1.1) schema
- [ ] **TC13 — Empty input**: `yaml: ""` → `null`
  - **Given**: yaml is empty string
  - **When**: `emit_json` called with no schema
  - **Then**: `{ok: true, json: "null"}`
- [ ] **TC14 — Unicode in block scalar**: preserved verbatim
  - **Given**: yaml block scalar containing emoji / non-ASCII characters
  - **When**: `emit_json` called
  - **Then**: `ok: true`, JSON string preserves characters (JSON's default ASCII-safe escaping is acceptable)
- [ ] **TC15 — Large payload (~64KB)**: should work
  - **Given**: yaml producing a ~64KB object
  - **When**: `emit_json` called
  - **Then**: `ok: true`, `json` parseable as JSON, round-trip matches
- [ ] **TC16 — YAML anchors/aliases**: work via the library (don't need to test the library itself, but confirm a simple anchor case survives the round-trip)
  - **Given**: yaml with `&ref` and `*ref`
  - **When**: `emit_json` called
  - **Then**: anchors expanded into concrete JSON structure

### Happy Paths
- [ ] **TC17 — Simple object**: `foo: bar\nnum: 1` → `{"foo":"bar","num":1}`
- [ ] **TC18 — Nested object**: 2+ level nesting round-trips
- [ ] **TC19 — Array**: `- a\n- b\n- c` → `["a","b","c"]`
- [ ] **TC20 — Valid payload with schema**: yaml valid, schema satisfied
  - **Given**: yaml `{name: "Alice", age: 30}`, schema `{type: object, required: [name, age]}`
  - **When**: `emit_json` called
  - **Then**: `{ok: true, json: '{"name":"Alice","age":30}'}`

### UX Validation (MCP end-to-end via Inspector & live client)
- [ ] **UX1 — Inspector round-trip**: server boots, tool discoverable, call with TC17 inputs returns the success result shape
  - **Given**: `bunx @modelcontextprotocol/inspector bun src/cli/main.ts`
  - **When**: tool list fetched, `emit_json` invoked with `{yaml: "foo: bar"}`
  - **Then (Experience)**: Inspector shows the tool, a call returns structured text content
  - **Then (Technical)**: content body parses as `{ok: true, json: "..."}` with `isError: false`
- [ ] **UX2 — Self-correcting failure**: a schema-failing call returns a result the LLM could act on
  - **Given**: Inspector, `emit_json` called with `yaml`+`jsonSchema` from TC3
  - **When**: call issued
  - **Then (Experience)**: Inspector shows the text content and `isError: true`
  - **Then (Technical)**: parsed body has `phase: "validate"`, `errors[0].instancePath` is non-empty, `errors[0].keyword: "maxLength"`
- [ ] **UX3 — byte-12021 regression**: the original Slack-blocks failure, solved via YAML emission
  - **Given**: the actual failure payload (user's Week 16 analysis) re-expressed as YAML with `|` block scalars, plus the Slack Block Kit JSON Schema
  - **When**: `emit_json` called
  - **Then (Experience)**: succeeds — caller receives valid Slack-blocks JSON
  - **Then (Technical)**: the JSON is bytewise-parseable with `JSON.parse`, includes the prose verbatim
- [ ] **UX4 — End-user MCP client validation**: user plugs the server into their MCP client of choice and confirms it's usable (validation performed by user at the end)

## Implementation Plan (TDD Order)
Each phase is RED → GREEN → REFACTOR on a vertical slice. One test, one implementation, one pass through typecheck + test + build before moving on.

### Phase 0 — Bootstrap
1. `bun init -y`, wire `package.json` to preferences (bun, biome, typescript, testing cycle scripts, `validate` script per tooling preferences).
2. Install: `@modelcontextprotocol/sdk`, `yaml`, `ajv`, `ajv-formats`, `arktype`. Dev: `@biomejs/biome`, `typescript`, `@types/bun`.
3. `tsconfig.json` strict, ESM.
4. `biome.json` with the four filenaming cases per PD.
5. Commit: `chore: scaffold bun + ts + biome + jj colocated`.

### Phase 1 — Domain: Error Tree
1. RED: `errors.test.ts` — constructor creates an error with `errorId` (ULID string, length 26), `unixTimestamp: number > 0`, `getDetails()` returns public `readonly` fields (excluding name/message/stack/metadata/cause), `cause` preserved via native `Error.cause`.
2. GREEN: implement `JsonEmitterError` extending `Error` with the AppError-like pattern required by [Error Handling Standards](prime-directive-mcp://standards/error-handling.md). Use `ulid()` for `errorId` per [Data Standards: Time-sortable IDs](prime-directive-mcp://standards/data.md).
3. Commit: `feat(domain): add package-owned JsonEmitterError root`.

### Phase 2 — Domain: `emitJson` happy path
1. RED: `emitJson.test.ts` — TC17 (simple object round-trip).
2. GREEN: implement `emitJson(yaml: string, schema?: object): EmitResult` — just `yaml.parse` + `JSON.stringify`, wrapped in `{ok: true, json}`.
3. Commit: `feat(domain): emitJson converts YAML to JSON`.

### Phase 3 — Domain: YAML parse error
1. RED: TC1 (malformed yaml).
2. GREEN: catch `YAMLParseError`, extract `linePos`, build `phase: "parse"` result with line/column/snippet.
3. Commit: `feat(domain): structured parse_error result for malformed YAML`.

### Phase 4 — Domain: schema validation
1. RED: TC20 (happy schema).
2. GREEN: compile schema with Ajv2020 + addFormats, run validator, success path only.
3. Commit: `feat(domain): schema validation via ajv 2020`.
4. RED: TC2 (type mismatch).
5. GREEN: extract Ajv errors into `SchemaValidationIssue[]`, return `phase: "validate"` result.
6. Commit: `feat(domain): validate_error result with ajv error mapping`.
7. RED: TC3, TC4 — additional Ajv error keywords.
8. GREEN: ensure mapping handles each; refactor extraction helper if repetition emerges.
9. Commit: `test(domain): coverage for maxLength and required keywords`.

### Phase 5 — Domain: schema compile error
1. RED: TC5 (malformed schema).
2. GREEN: wrap `ajv.compile` in try/catch, produce `phase: "schema_compile"` result.
3. Commit: `feat(domain): schema_compile error for malformed JSON Schema`.

### Phase 6 — Domain: edge cases
1. RED → GREEN → Commit for each: TC10 (JSON-as-YAML), TC11 (block scalar preserves punctuation — this is the motivating test), TC12 (Norway), TC13 (empty), TC14 (unicode), TC15 (size), TC16 (anchors).

### Phase 7 — Infrastructure: Settings
1. RED: `Settings.test.ts` — reads `JSON_EMITTER_TRANSPORT` and `JSON_EMITTER_HTTP_PORT` from env, validates via ArkType, defaults to `stdio` + port `3000`.
2. GREEN: implement.
3. Commit: `feat(infra): settings module for transport + port`.

### Phase 8 — Infrastructure: MCP server factory
1. RED: `JsonEmitterServer.test.ts` — factory creates an `McpServer` with the expected name, version, instructions; tool is registered; calling the handler with TC17 input returns the success shape in an MCP text content block with `isError: false`.
2. GREEN: implement using `@modelcontextprotocol/sdk` `McpServer.registerTool` with ArkType `inputSchema`.
3. Commit: `feat(infra): MCP server factory with emit_json tool`.
4. RED: error-shape integration test — TC3 through the handler, assert MCP response has `isError: true` + expected JSON body.
5. GREEN: implement error path in the handler (set `isError` based on `result.ok`).
6. Commit: `feat(infra): error paths flow through MCP response with isError`.

### Phase 9 — Infrastructure: transports
1. RED: `stdio.test.ts` — constructor wires a `StdioServerTransport` and `server.connect` is called. (Use the MCP client/server pair to round-trip a single call, per SDK testing guidance.)
2. GREEN: implement stdio entry path.
3. Commit: `feat(infra): stdio transport`.
4. RED: `http.test.ts` — HTTP Streamable transport serves the same tool; end-to-end call via `StreamableHTTPClientTransport`.
5. GREEN: implement HTTP path.
6. Commit: `feat(infra): streamable HTTP transport`.

### Phase 10 — CLI entry
1. RED: `main.test.ts` — CLI selects transport based on settings, starts the server, tears down on SIGTERM.
2. GREEN: implement.
3. Commit: `feat(cli): main entry point with graceful shutdown`.

### Phase 11 — UX Validation
1. Run Inspector, execute UX1–UX3. Screenshot/capture results.
2. Re-run the real byte-12021 failure payload through `emit_json` as proof (UX3).
3. If any test reveals a gap → reproduce with an automated test, fix, repeat until clean.
4. Commit: `test(ux): inspector round-trip + byte-12021 regression`.

### Phase 12 — Documentation
1. README: install, run, example call, error shapes. Short; no AI-gen filler.
2. Commit: `docs: README with install and example`.

## Open Coverage Gaps / Risks
- **Ajv 2020 strict mode** may reject common draft-2019-09 or older patterns. We accept the risk; if it surfaces in UX3, relax `strict: false` and note it here.
- **Streamable HTTP transport is still evolving** in the SDK; if v1 targets a version whose API is unstable, we fall back to stdio-only and file a follow-up.
- **Input validation of `jsonSchema`** — we trust Ajv to reject malformed schemas at compile. If a genuinely broken schema crashes the process rather than throwing, we'll need a wrapper test-and-transform.

## Appendix — The Motivating Failure (byte-12021)
Raw error from the n8n `Convert to Slack Blocks` parser:
```
Error: Failed to parse JSON array: Expected ',' or '}' after property value in JSON at
position 12021 (line 1 column 12022). Raw: [{"blocks":[{"type":"header","text":
{"type":"plain_text","text":"Week 16 Friday PM Pacing Analysis"}},{"type":"section",
"text":{"type":"mrkdwn","text":"What We're Working On :large_green_circle: don...
```
The cause, at byte 12021: an unescaped `"` inside a JSON string value:
```
...TI-13196 has been "explore" status for a full sprint...
```
This is precisely what YAML block scalars make impossible — inside `|`, quote characters are just quote characters.
