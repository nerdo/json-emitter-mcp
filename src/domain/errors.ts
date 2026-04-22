import { ulid } from "ulid";

/** Unix timestamp in seconds since epoch */
export type UnixTimestamp = number;

/** ULID-formatted entity identifier */
export type EntityId = string;

export interface ErrorMetadata {
  readonly errorId: EntityId;
  readonly unixTimestamp: UnixTimestamp;
  readonly requestId?: string;
  readonly userId?: string;
}

type JsonEmitterErrorOptions = {
  cause?: unknown;
  metadata?: Partial<Omit<ErrorMetadata, "errorId" | "unixTimestamp">>;
};

const RESERVED_KEYS = new Set(["name", "message", "stack", "metadata", "cause"]);

/**
 * Package-owned root error for json-emitter.
 * Subclasses must call `super(options)` and `setMessage(...)` in their constructor.
 *
 * Every AppError-style invariant required by the prime directives:
 *   - errorId (ULID) + unixTimestamp auto-captured
 *   - native Error.cause chain via { cause }
 *   - getDetails() serializes public readonly fields for logging/response bodies
 */
export abstract class JsonEmitterError extends Error {
  public readonly metadata: ErrorMetadata;

  protected constructor(options?: JsonEmitterErrorOptions) {
    super("", options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = this.constructor.name;
    this.metadata = {
      errorId: ulid(),
      unixTimestamp: Math.floor(Date.now() / 1000),
      ...options?.metadata,
    };
  }

  protected setMessage(message: string): void {
    this.message = message;
  }

  getDetails(): Record<string, unknown> {
    const details: Record<string, unknown> = {};
    for (const key of Object.keys(this)) {
      if (!RESERVED_KEYS.has(key)) {
        details[key] = (this as unknown as Record<string, unknown>)[key];
      }
    }
    return details;
  }
}

export type EmitJsonFailurePhase = "parse" | "schema_compile" | "validate";

/**
 * Thrown from the emit_json MCP handler when the tool cannot produce valid JSON.
 * Crossing the MCP boundary, the SDK serializes this into a JSON-RPC error; the
 * client's callTool() rejects with the message preserved. The `phase` field is
 * present for internal (non-MCP) callers that want to branch on failure type.
 */
export class EmitJsonFailure extends JsonEmitterError {
  public readonly phase: EmitJsonFailurePhase;

  constructor(params: { phase: EmitJsonFailurePhase; message: string; cause?: unknown }) {
    super({ cause: params.cause });
    this.phase = params.phase;
    this.setMessage(params.message);
  }
}
