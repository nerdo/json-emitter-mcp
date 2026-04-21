import { type } from "arktype";

const SettingsSchema = type({
  transport: "'stdio' | 'http'",
  httpPort: "number.integer > 0",
});

export type JsonEmitterSettings = typeof SettingsSchema.infer;

interface LoadInput {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly argv: ReadonlyArray<string>;
}

export function loadSettings(input: LoadInput): JsonEmitterSettings {
  const argv = parseArgv(input.argv);

  const transportRaw = argv.transport ?? input.env.JSON_EMITTER_TRANSPORT ?? "stdio";
  const portRaw = argv.port ?? input.env.JSON_EMITTER_HTTP_PORT ?? "3000";
  const portNum = Number(portRaw);

  const candidate = {
    transport: transportRaw,
    httpPort: portNum,
  };

  const validated = SettingsSchema(candidate);
  if (validated instanceof type.errors) {
    throw new Error(`Invalid settings: ${validated.summary}`);
  }
  return validated;
}

function parseArgv(argv: ReadonlyArray<string>): {
  transport?: string;
  port?: string;
} {
  const out: { transport?: string; port?: string } = {};
  for (const arg of argv) {
    if (arg.startsWith("--transport=")) out.transport = arg.slice("--transport=".length);
    else if (arg.startsWith("--port=")) out.port = arg.slice("--port=".length);
  }
  return out;
}
