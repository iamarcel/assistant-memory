import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
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
