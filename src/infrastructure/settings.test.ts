import { describe, expect, test } from "bun:test";
import { loadSettings } from "./settings.ts";

describe("loadSettings", () => {
  test("defaults to stdio transport with port 3000 when nothing is set", () => {
    const settings = loadSettings({ env: {}, argv: [] });
    expect(settings.transport).toBe("stdio");
    expect(settings.httpPort).toBe(3000);
  });

  test("reads transport from env JSON_EMITTER_TRANSPORT", () => {
    const settings = loadSettings({
      env: { JSON_EMITTER_TRANSPORT: "http" },
      argv: [],
    });
    expect(settings.transport).toBe("http");
  });

  test("reads port from env JSON_EMITTER_HTTP_PORT", () => {
    const settings = loadSettings({
      env: { JSON_EMITTER_TRANSPORT: "http", JSON_EMITTER_HTTP_PORT: "8080" },
      argv: [],
    });
    expect(settings.httpPort).toBe(8080);
  });

  test("--transport argv flag overrides env", () => {
    const settings = loadSettings({
      env: { JSON_EMITTER_TRANSPORT: "http" },
      argv: ["--transport=stdio"],
    });
    expect(settings.transport).toBe("stdio");
  });

  test("--port argv flag overrides env", () => {
    const settings = loadSettings({
      env: { JSON_EMITTER_HTTP_PORT: "3000" },
      argv: ["--transport=http", "--port=9001"],
    });
    expect(settings.httpPort).toBe(9001);
  });

  test("throws on invalid transport value", () => {
    expect(() =>
      loadSettings({ env: { JSON_EMITTER_TRANSPORT: "carrier-pigeon" }, argv: [] }),
    ).toThrow();
  });

  test("throws on non-numeric port", () => {
    expect(() =>
      loadSettings({
        env: { JSON_EMITTER_TRANSPORT: "http", JSON_EMITTER_HTTP_PORT: "not-a-number" },
        argv: [],
      }),
    ).toThrow();
  });
});
