import { describe, expect, test } from "bun:test";
import { emitJson } from "./emitJson.ts";

describe("emitJson - happy path (no schema)", () => {
  test("TC17: simple object → JSON object", () => {
    const result = emitJson("foo: bar\nnum: 1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.parse(result.json)).toEqual({ foo: "bar", num: 1 });
    }
  });
});

describe("emitJson - parse errors", () => {
  test("TC1: malformed YAML returns phase:parse with line/column/offset/message/snippet", () => {
    // Unterminated double-quoted scalar — a clean structural parse failure
    const yaml = 'foo: "unterminated\nbar: ok';
    const result = emitJson(yaml);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("parse");
      if (result.phase === "parse") {
        expect(result.line).toBeGreaterThanOrEqual(1);
        expect(result.column).toBeGreaterThanOrEqual(1);
        expect(result.offset).toBeGreaterThanOrEqual(0);
        expect(result.message).toBeTypeOf("string");
        expect(result.message.length).toBeGreaterThan(0);
        expect(result.snippet).toBeTypeOf("string");
        expect(result.snippet.length).toBeGreaterThan(0);
      }
    }
  });

  test("parse error on YAML that is empty-after-content gibberish", () => {
    // Tab characters in indentation context (YAML forbids tabs for indent)
    const yaml = "foo:\n\tbar: 1";
    const result = emitJson(yaml);

    expect(result.ok).toBe(false);
    if (!result.ok && result.phase === "parse") {
      expect(result.line).toBeGreaterThanOrEqual(1);
    }
  });
});
