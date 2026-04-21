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

## Libraries

- `@modelcontextprotocol/sdk` — MCP server
- `yaml` (eemeli/yaml) — YAML 1.2 Core Schema, strict
- `ajv` (`ajv/dist/2020`) + `ajv-formats` — JSON Schema validation
- `arktype` — input boundary validation for the MCP tool
- `ulid` — errorId generation
