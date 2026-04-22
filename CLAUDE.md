# json-emitter

MCP server that converts YAML to validated JSON. Single tool: `emit_json(yaml, jsonSchema?)`.

## Before working on this project

Consult the Prime Directive MCP — `initialize_session`, then triage for each concern area — before planning, deciding, or writing code. User guidance there takes precedence over defaults.

## Architecture

See [`specs/in-progress/executing-emit-json-mcp.md`](specs/in-progress/executing-emit-json-mcp.md) for the spec driving implementation. Inside-out: domain (`src/domain/`) is pure; infrastructure (`src/infrastructure/`) wires the MCP server and transports.

## Toolchain

- Runtime & package manager: **bun**
- Tests: `bun test` (native)
- Typecheck: `tsc --noEmit`
- Lint/format: **biome**
- Version control: **jj** colocated with git
- Dev loop: `bun run validate` (test → typecheck → test → build)

## Testing this MCP server

Two layers, both part of regular testing:

1. **Automated suite** (`bun run validate`) — unit + in-memory MCP client tests covering handler logic.
2. **Inspector smoke check** — verifies the stdio wire path and real MCP framing before shipping or when changing handler registration / capabilities / transport:

   ```bash
   bunx @modelcontextprotocol/inspector --cli bun src/main.ts --method tools/list
   bunx @modelcontextprotocol/inspector --cli bun src/main.ts --method resources/list
   bunx @modelcontextprotocol/inspector --cli bun src/main.ts --method resources/read --uri json-emitter://docs/yaml-authoring-guide
   bunx @modelcontextprotocol/inspector --cli bun src/main.ts --method tools/call --tool-name emit_json --tool-arg 'yaml=a: 1
   a: 2'
   ```

   Run these any time server registration, capabilities, tool surface, or resource surface change — the in-memory tests do not exercise stdio framing or real client↔server process bootstrap.

## Convention: use the dev server for this project's MCP work

When the user refers to "the MCP server" in this project — invoking it, testing a tool, reading a resource — use the **`json-emitter-dev`** instance registered by `.mcp.json`, not any separately-installed `json-emitter` server. Tool calls are namespaced as `mcp__json-emitter-dev__<tool>`; resource URIs are the same, accessed through the `json-emitter-dev` server.

## Libraries

- `@modelcontextprotocol/sdk` — MCP server
- `yaml` (eemeli/yaml) — YAML 1.2 Core Schema, strict
- `ajv` (`ajv/dist/2020`) + `ajv-formats` — JSON Schema validation
- `arktype` — input boundary validation for the MCP tool
- `ulid` — errorId generation
