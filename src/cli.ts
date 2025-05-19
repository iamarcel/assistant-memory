#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { server } from "./lib/mcp/mcp-server.js";

async function main() {
  const transport = new StdioServerTransport();
  try {
    await server.connect(transport);
    console.log("MCP server running on stdio");
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
