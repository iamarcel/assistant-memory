import McpServer, { addTransport, removeTransport } from "~/lib/mcp-server.js";
import { SSEServerTransport } from "~/lib/sse";

export default defineEventHandler(async (event) => {
  setResponseStatus(event, 200);
  setResponseHeaders(event, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  console.log("Creating event stream");
  const eventStream = createEventStream(event, { autoclose: true });

  console.log("Creating transport");
  const transport = new SSEServerTransport("/messages", eventStream);

  eventStream.onClosed(() => {
    removeTransport(transport);
  });
  addTransport(transport);

  const res = eventStream.send();

  console.log("Connecting transport");
  await McpServer.connect(transport);

  console.log("Returning event stream");
  return res;
});
