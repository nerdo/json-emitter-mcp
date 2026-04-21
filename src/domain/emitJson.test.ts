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

describe("emitJson - with schema (happy path)", () => {
  test("TC20: valid payload passes schema validation", () => {
    const yaml = 'name: "Alice"\nage: 30';
    const schema = {
      type: "object",
      required: ["name", "age"],
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
    };

    const result = emitJson(yaml, schema);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.parse(result.json)).toEqual({ name: "Alice", age: 30 });
    }
  });
});

describe("emitJson - schema validation errors", () => {
  test("TC2: type mismatch → phase:validate with instancePath and keyword:type", () => {
    const yaml = 'count: "ten"';
    const schema = {
      type: "object",
      properties: { count: { type: "integer" } },
    };

    const result = emitJson(yaml, schema);

    expect(result.ok).toBe(false);
    if (!result.ok && result.phase === "validate") {
      expect(result.errors.length).toBeGreaterThan(0);
      const typeError = result.errors.find((e) => e.keyword === "type");
      expect(typeError).toBeDefined();
      expect(typeError?.instancePath).toBe("/count");
      expect(typeError?.params).toMatchObject({ type: "integer" });
    }
  });

  test("TC3: maxLength violation → phase:validate with keyword:maxLength and params.limit", () => {
    const yaml = `text: ${"x".repeat(50)}`;
    const schema = {
      type: "object",
      properties: { text: { type: "string", maxLength: 10 } },
    };

    const result = emitJson(yaml, schema);

    expect(result.ok).toBe(false);
    if (!result.ok && result.phase === "validate") {
      const maxLenError = result.errors.find((e) => e.keyword === "maxLength");
      expect(maxLenError).toBeDefined();
      expect(maxLenError?.instancePath).toBe("/text");
      expect(maxLenError?.params).toMatchObject({ limit: 10 });
    }
  });

  test("TC4: missing required property → phase:validate with keyword:required and params.missingProperty", () => {
    const yaml = 'id: "abc"';
    const schema = {
      type: "object",
      required: ["id", "name"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
      },
    };

    const result = emitJson(yaml, schema);

    expect(result.ok).toBe(false);
    if (!result.ok && result.phase === "validate") {
      const requiredError = result.errors.find((e) => e.keyword === "required");
      expect(requiredError).toBeDefined();
      expect(requiredError?.params).toMatchObject({ missingProperty: "name" });
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
