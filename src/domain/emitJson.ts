import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse as parseYaml, YAMLParseError } from "yaml";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats.default(ajv);

export interface SchemaValidationIssue {
  readonly instancePath: string;
  readonly schemaPath: string;
  readonly keyword: string;
  readonly message: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export type EmitResult =
  | { readonly ok: true; readonly json: string }
  | {
      readonly ok: false;
      readonly phase: "parse";
      readonly line: number;
      readonly column: number;
      readonly offset: number;
      readonly message: string;
      readonly snippet: string;
      readonly code?: string;
    }
  | {
      readonly ok: false;
      readonly phase: "schema_compile";
      readonly message: string;
    }
  | {
      readonly ok: false;
      readonly phase: "validate";
      readonly errors: ReadonlyArray<SchemaValidationIssue>;
    };

export interface EmitJsonOptions {
  /** If true, pretty-print the JSON with 2-space indentation. Default false (compact). */
  readonly pretty?: boolean;
}

/**
 * Convert a YAML 1.2 document to JSON, optionally validating against a JSON Schema.
 *
 * Parse and validation failures are returned as EmitResult values, not thrown.
 * Only unexpected/programming errors escape this function.
 *
 * Default output is compact (no whitespace). Pass `{pretty: true}` for indented output.
 */
export function emitJson(
  yaml: string,
  jsonSchema?: object,
  options?: EmitJsonOptions,
): EmitResult {
  let data: unknown;
  try {
    data = parseYaml(yaml, {
      version: "1.2",
      schema: "core",
      strict: true,
      prettyErrors: true,
    });
  } catch (error) {
    if (error instanceof YAMLParseError) {
      return buildParseResult(error, yaml);
    }
    throw error;
  }

  if (jsonSchema !== undefined) {
    let validator: ValidateFunction;
    try {
      validator = ajv.compile(jsonSchema);
    } catch (error) {
      return {
        ok: false,
        phase: "schema_compile",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    if (!validator(data)) {
      return buildValidateResult(validator.errors ?? []);
    }
  }

  const indent = options?.pretty === true ? 2 : undefined;
  return { ok: true, json: JSON.stringify(data, null, indent) };
}

function buildValidateResult(errors: ReadonlyArray<ErrorObject>): EmitResult {
  return {
    ok: false,
    phase: "validate",
    errors: errors.map((e) => ({
      instancePath: e.instancePath,
      schemaPath: e.schemaPath,
      keyword: e.keyword,
      message: e.message ?? "",
      params: e.params as Readonly<Record<string, unknown>>,
    })),
  };
}

function buildParseResult(error: YAMLParseError, source: string): EmitResult {
  const pos = error.linePos?.[0];
  const line = pos?.line ?? 1;
  const column = pos?.col ?? 1;
  const offset = error.pos[0];
  const headline = extractHeadline(error.message);
  const snippet = buildSnippet(source, line, column);

  return {
    ok: false,
    phase: "parse",
    line,
    column,
    offset,
    message: headline,
    snippet,
    code: error.code,
  };
}

function extractHeadline(message: string): string {
  const firstBlankLine = message.indexOf("\n\n");
  if (firstBlankLine === -1) {
    const firstNewline = message.indexOf("\n");
    return firstNewline === -1 ? message : message.slice(0, firstNewline);
  }
  return message.slice(0, firstBlankLine);
}

function buildSnippet(source: string, line: number, column: number): string {
  const lines = source.split("\n");
  const lineIdx = line - 1;
  const parts: string[] = [];

  if (lineIdx > 0) {
    parts.push(formatSnippetLine(line - 1, lines[lineIdx - 1] ?? ""));
  }
  parts.push(formatSnippetLine(line, lines[lineIdx] ?? ""));
  parts.push(buildCaret(line, column));
  if (lineIdx + 1 < lines.length) {
    parts.push(formatSnippetLine(line + 1, lines[lineIdx + 1] ?? ""));
  }
  return parts.join("\n");
}

function formatSnippetLine(lineNumber: number, content: string): string {
  return `${String(lineNumber).padStart(4, " ")} | ${content}`;
}

function buildCaret(line: number, column: number): string {
  return `${String(line).padStart(4, " ")} | ${" ".repeat(Math.max(0, column - 1))}^`;
}
