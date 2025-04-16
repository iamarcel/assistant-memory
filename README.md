# Assistant Memory

_Give your assistant perfect memory, and still own the data._

This project is a web server you can use to augment any LLM assistant with permanent memory. It's supposed to be deployed in the backend of your application (eg., in a private network of a docker-compose application).

Here's how it works:

- Use the `/ingest/*` endpoints to add information
- Use the `/query/*` endpoints to retrieve information

There are different kinds of information that can be ingested and different ways to query it.

## How is the information stored and organized?

All the information that's ingested is ran through an LLM to extract the most important information, and stored in a graph-based database. Entities, events, people, dates, etc., are stored and linked in the graph.

## How does querying work?

The `search` query endpoint queries nodes based on vector similarity, and returns some context based on the graph relations.

This is useful to add inside of the chat loop with an assistant: right before sending the messages to the LLM, insert some context retrieved from this endpoint.

The `day` query endpoint is purely graph-based and returns a context description based on the nodes linked to a specific day.

This can be used, for example, in the first message with an assistant so it knows what's been happening today and yesterday.

## MCP Server

An MCP server is also exposed so the assistant can explicitly query for data as well.
