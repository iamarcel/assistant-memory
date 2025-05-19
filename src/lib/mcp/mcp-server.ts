import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { saveMemory } from "~/lib/ingestion/save-document";
import { queryDayMemories } from "~/lib/query/day";
import { searchMemory } from "~/lib/query/search";
import {
  ingestDocumentRequestSchema,
  type IngestDocumentRequest,
} from "~/lib/schemas/ingest-document-request";
import {
  queryDayRequestSchema,
  type QueryDayRequest,
} from "~/lib/schemas/query-day";
import {
  querySearchRequestSchema,
  type QuerySearchRequest,
} from "~/lib/schemas/query-search";
import { z } from "zod";
import { SSEServerTransport } from "./sse";

const transports: { [sessionId: string]: SSEServerTransport } = {};

// Create an MCP server
export const server = new McpServer({
  name: "Demo",
  version: "1.0.0",
});

// Add an addition tool
server.tool("add", { a: z.number(), b: z.number() }, async ({ a, b }) => ({
  content: [{ type: "text", text: String(a + b) }],
}));

// Add a dynamic greeting resource
server.resource(
  "greeting",
  new ResourceTemplate("greeting://{name}", { list: undefined }),
  async (uri, { name }) => ({
    contents: [
      {
        uri: uri.href,
        text: `Hello, ${name}!`,
      },
    ],
  })
);

// Expose ingest document functionality as "save memory"
server.tool(
  "save memory",
  ingestDocumentRequestSchema,
  async ({ userId, document }: IngestDocumentRequest) => {
    await saveMemory({ userId, document });
    return {
      content: [{ type: "text", text: "Memory saved" }],
    };
  },
);

// Expose search as "search memory"
server.tool(
  "search memory",
  querySearchRequestSchema,
  async ({ userId, query, limit, excludeNodeTypes }: QuerySearchRequest) => {
    const { formattedResult } = await searchMemory({
      userId,
      query,
      limit,
      excludeNodeTypes,
    });

    return {
      content: [{ type: "text", text: formattedResult }],
    };
  },
);

// Expose day query as "retrieve memories relevant for today"
server.tool(
  "retrieve memories relevant for today",
  queryDayRequestSchema,
  async ({ userId, date }: QueryDayRequest) => {
    const { formattedResult } = await queryDayMemories({
      userId,
      date,
      includeFormattedResult: true,
    });
    return {
      content: [{ type: "text", text: formattedResult ?? "" }],
    };
  },
);

export const addTransport = (transport: SSEServerTransport) => {
  transports[transport.sessionId] = transport;
};

export const removeTransport = (transport: SSEServerTransport) => {
  delete transports[transport.sessionId];
};

export const getTransport = (sessionId: string) => {
  return transports[sessionId];
};

export default server;
