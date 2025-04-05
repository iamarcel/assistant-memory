import { getTransport } from "~/lib/mcp";

export default defineEventHandler(async (event) => {
  const sessionId = getQuery(event)["sessionId"].toString();
  const transport = getTransport(sessionId);
  if (transport) {
    await transport.handlePostMessage(event);
  } else {
    throw createError({
      status: 400,
      statusMessage: `No transport found for sessionId: ${sessionId}`,
      message: "No transport found",
    });
  }
});
