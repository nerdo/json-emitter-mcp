import { describe, expect, test } from "bun:test";
import { EmitJsonFailure, JsonEmitterError } from "./errors.ts";

class TestError extends JsonEmitterError {
  constructor(
    public readonly subject: string,
    options?: { cause?: unknown },
  ) {
    super(options);
    this.setMessage(`test error: ${subject}`);
  }
}

describe("JsonEmitterError", () => {
  test("constructor sets a 26-char ULID errorId", () => {
    const err = new TestError("x");
    expect(err.metadata.errorId).toBeTypeOf("string");
    expect(err.metadata.errorId).toHaveLength(26);
  });

  test("constructor sets unixTimestamp as positive integer seconds", () => {
    const before = Math.floor(Date.now() / 1000);
    const err = new TestError("x");
    const after = Math.floor(Date.now() / 1000);

    expect(err.metadata.unixTimestamp).toBeGreaterThanOrEqual(before);
    expect(err.metadata.unixTimestamp).toBeLessThanOrEqual(after);
    expect(Number.isInteger(err.metadata.unixTimestamp)).toBe(true);
  });

  test("name is the subclass name, not 'Error'", () => {
    const err = new TestError("x");
    expect(err.name).toBe("TestError");
  });

  test("setMessage drives the message via subclass", () => {
    const err = new TestError("bar");
    expect(err.message).toBe("test error: bar");
  });

  test("getDetails returns public readonly fields, excluding name/message/stack/metadata/cause", () => {
    const err = new TestError("hello");
    const details = err.getDetails();

    expect(details).toEqual({ subject: "hello" });
    expect(details).not.toHaveProperty("name");
    expect(details).not.toHaveProperty("message");
    expect(details).not.toHaveProperty("stack");
    expect(details).not.toHaveProperty("metadata");
    expect(details).not.toHaveProperty("cause");
  });

  test("cause is preserved via native Error.cause", () => {
    const original = new Error("underlying");
    const err = new TestError("x", { cause: original });

    expect(err.cause).toBe(original);
  });

  test("each instance gets a distinct errorId", () => {
    const a = new TestError("a");
    const b = new TestError("b");
    expect(a.metadata.errorId).not.toBe(b.metadata.errorId);
  });

  test("is an instanceof Error (so existing catch-Error code still works)", () => {
    const err = new TestError("x");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(JsonEmitterError);
  });
});

describe("EmitJsonFailure", () => {
  test("is a JsonEmitterError with phase + message", () => {
    const err = new EmitJsonFailure({
      phase: "parse",
      message: "YAML parse error at line 1, column 19:\n...snippet...",
    });
    expect(err).toBeInstanceOf(JsonEmitterError);
    expect(err).toBeInstanceOf(Error);
    expect(err.phase).toBe("parse");
    expect(err.message).toContain("YAML parse error");
  });

  test("phase is readonly and one of the three allowed values", () => {
    const phases = ["parse", "schema_compile", "validate"] as const;
    for (const p of phases) {
      const err = new EmitJsonFailure({ phase: p, message: "x" });
      expect(err.phase).toBe(p);
    }
  });

  test("name is 'EmitJsonFailure'", () => {
    const err = new EmitJsonFailure({ phase: "validate", message: "x" });
    expect(err.name).toBe("EmitJsonFailure");
  });

  test("getDetails includes the phase", () => {
    const err = new EmitJsonFailure({ phase: "schema_compile", message: "x" });
    expect(err.getDetails()).toEqual({ phase: "schema_compile" });
  });
});
