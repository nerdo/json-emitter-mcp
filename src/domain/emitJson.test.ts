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

  test("default output is compact (no whitespace between tokens)", () => {
    const result = emitJson("foo: bar\nnum: 1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.json).toBe('{"foo":"bar","num":1}');
    }
  });

  test("options.pretty=true indents with 2 spaces", () => {
    const result = emitJson("foo: bar\nnum: 1", undefined, { pretty: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.json).toBe('{\n  "foo": "bar",\n  "num": 1\n}');
    }
  });

  test("options.pretty=false is explicit compact (same as default)", () => {
    const result = emitJson("foo: bar\nnum: 1", undefined, { pretty: false });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.json).toBe('{"foo":"bar","num":1}');
    }
  });

  test("empty options object is equivalent to no options", () => {
    const a = emitJson("foo: bar", undefined, {});
    const b = emitJson("foo: bar");
    expect(a.ok && b.ok && a.json === b.json).toBe(true);
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

  test("TC5: malformed JSON Schema → phase:schema_compile with message", () => {
    const yaml = "foo: bar";
    const schema = { type: "bogustype" };

    const result = emitJson(yaml, schema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("schema_compile");
      if (result.phase === "schema_compile") {
        expect(result.message).toBeTypeOf("string");
        expect(result.message.length).toBeGreaterThan(0);
      }
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

describe("emitJson - edge cases", () => {
  test("TC10: valid JSON is valid YAML (superset) → round-trips", () => {
    const result = emitJson('{"foo": 1, "bar": [true, null]}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.parse(result.json)).toEqual({ foo: 1, bar: [true, null] });
    }
  });

  test("TC11: block scalar preserves prose punctuation (the motivating case)", () => {
    const yaml = `text: |
  TI-13196 has been "explore" status for a full sprint — Monday worth a check-in
  includes: colons, commas, "quotes", pipes | and asterisks *`;

    const result = emitJson(yaml);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.json) as { text: string };
      expect(parsed.text).toContain('"explore"');
      expect(parsed.text).toContain("— Monday");
      expect(parsed.text).toContain('"quotes"');
      expect(parsed.text).toContain("pipes |");
      expect(parsed.text).toContain("asterisks *");
    }
  });

  test("TC12: Norway problem neutralized by YAML 1.2 Core (no stays 'no')", () => {
    const result = emitJson("country: no");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.parse(result.json)).toEqual({ country: "no" });
    }
  });

  test("TC13: empty input → null", () => {
    const result = emitJson("");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.json).toBe("null");
    }
  });

  test("TC14: unicode in block scalar preserved", () => {
    const yaml = "text: |\n  🚀 emoji ünïcödé 日本語";
    const result = emitJson(yaml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.json) as { text: string };
      expect(parsed.text).toContain("🚀");
      expect(parsed.text).toContain("ünïcödé");
      expect(parsed.text).toContain("日本語");
    }
  });

  test("TC15: large payload (~100 KB) round-trips", () => {
    const chunk = "x".repeat(1000);
    const lines = Array.from({ length: 100 }, (_, i) => `  - "${chunk}-${i}"`);
    const yaml = `items:\n${lines.join("\n")}`;

    const result = emitJson(yaml);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.json) as { items: string[] };
      expect(parsed.items).toHaveLength(100);
      expect(parsed.items[0]).toBe(`${chunk}-0`);
      expect(parsed.items[99]).toBe(`${chunk}-99`);
    }
  });

  test("TC16: YAML anchors & aliases expand into concrete JSON", () => {
    const yaml = `defaults: &d
  color: blue
  size: md
variant:
  <<: *d
  color: red`;
    // merge keys are a YAML 1.1 feature; 1.2 requires plain expansion via the anchor,
    // not the << merge syntax. Use a straight anchor/alias instead to stay in Core.
    const yaml12 = `base: &b
  a: 1
  b: 2
ref: *b`;

    const result = emitJson(yaml12);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.parse(result.json)).toEqual({ base: { a: 1, b: 2 }, ref: { a: 1, b: 2 } });
    }

    // Confirm that the << merge syntax is NOT silently applied in 1.2 Core (merge off);
    // either parses as a literal "<<" key or surfaces as a value under that key.
    // We don't assert exact behavior here; we just make sure the parse doesn't blow up.
    const r2 = emitJson(yaml);
    expect(r2.ok).toBe(true);
  });
});

describe("emitJson - parser characterization (silent-semantics probes)", () => {
  // Pin behavior of the underlying `yaml` parser for edge cases that are
  // traditional sources of silent YAML→JSON coercion. If the parser's behavior
  // changes under a dependency upgrade, these tests surface it.

  test("duplicate mapping keys are rejected at parse (not silently kept)", () => {
    const result = emitJson("a: 1\na: 2\n");
    expect(result.ok).toBe(false);
    if (!result.ok && result.phase === "parse") {
      expect(result.code).toBe("DUPLICATE_KEY");
    }
  });

  test("multi-document streams are rejected at parse (not silently truncated)", () => {
    const result = emitJson("---\nfoo: 1\n---\nbar: 2\n");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("parse");
    }
  });

  test("boolean plain-scalar keys are stringified to \"true\"/\"false\" in output JSON", () => {
    const result = emitJson("true: yes-value\nfalse: no-value\n");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.parse(result.json)).toEqual({ true: "yes-value", false: "no-value" });
    }
  });

  test("integer plain-scalar keys are stringified to their decimal form", () => {
    const result = emitJson("42: fortytwo\n");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.parse(result.json)).toEqual({ "42": "fortytwo" });
    }
  });

  test("flow-sequence keys are stringified (not rejected) — documents lossy coercion", () => {
    const result = emitJson("? [1, 2]\n: listkey\n");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.json) as Record<string, string>;
      const keys = Object.keys(parsed);
      expect(keys).toHaveLength(1);
      expect(parsed[keys[0] as string]).toBe("listkey");
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
