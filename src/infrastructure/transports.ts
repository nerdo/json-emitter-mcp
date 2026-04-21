import { createServer, type Server as HttpServer } from "node:http";
import type { Server as McpServerInstance } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export interface TransportHandle {
  close(): Promise<void>;
}

export async function startStdioTransport(server: McpServerInstance): Promise<TransportHandle> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return {
    close: async () => {
      await transport.close();
    },
  };
}

/**
 * Stateless Streamable HTTP transport at `/mcp` on the given port.
 *
 * A fresh Server + transport is created per request. That avoids the
 * "already connected" error from reusing a single Server across connections,
 * and matches the spirit of stateless mode — every emit_json call is an
 * isolated, pure data transform.
 *
 * Caller passes a factory so the per-request Server can re-register the
 * emit_json tool cleanly each time.
 */
export function startHttpTransport(
  serverFactory: () => McpServerInstance,
  port: number,
): TransportHandle & { readonly httpServer: HttpServer } {
  const httpServer = createServer(async (req, res) => {
    if (req.url !== "/mcp" || req.method !== "POST") {
      res.statusCode = 404;
      res.end();
      return;
    }

    const server = serverFactory();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
    }
  });

  httpServer.listen(port);

  return {
    httpServer,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
