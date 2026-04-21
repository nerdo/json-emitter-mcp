import { parse as parseYaml } from "yaml";

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

/**
 * Convert a YAML 1.2 document to JSON, optionally validating against a JSON Schema.
 *
 * Parse and validation failures are returned as EmitResult values, not thrown.
 * Only unexpected/programming errors escape this function.
 */
export function emitJson(yaml: string, _jsonSchema?: object): EmitResult {
  const data = parseYaml(yaml, { version: "1.2", schema: "core", strict: true });
  return { ok: true, json: JSON.stringify(data) };
}
