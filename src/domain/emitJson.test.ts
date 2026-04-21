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
