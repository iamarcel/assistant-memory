# Assistant Memory

_Give all your AI assistants **combined, long-term** memory while keeping full control of your data._

Assistant Memory is a lightweight memory service built around the **Model Context Protocol (MCP)**. It speaks MCP over HTTP today (stdio support is on the way) and also exposes classic REST endpoints. Store conversations and documents and let any MCP‑enabled assistant recall them when needed.

## Model Context Protocol

The integrated MCP server provides tools for saving memories, performing searches and retrieving day summaries. Because it follows the MCP standard, any compliant client can plug in and exchange messages seamlessly.

## Recommended usage

Run ingestion and queries in the background as your chat happens:

1. **Ingest** every message to keep the graph up to date.
2. **Query** for relevant memories just before each LLM call and merge the results into your prompt.

This background workflow is independent of MCP and works with any LLM‑based assistant.

## HTTP API

- `POST /ingest/conversation` and `POST /ingest/document` – send new information to be stored.
- `POST /query/search` – vector search to retrieve relevant nodes.
- `POST /query/day` – get a quick summary of a particular day.
- `GET /sse` and `POST /messages` – MCP over HTTP using Server‑Sent Events.

## Why use it?

- Keep sensitive data on your own servers.
- Turn large transcripts and documents into a searchable graph.
- Drop in as a microservice alongside your existing assistant.

---

Spin it up with `docker-compose up` and start talking. Your assistant will finally remember everything.
