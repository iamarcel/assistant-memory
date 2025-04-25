import { TypeId } from "~/types/typeid";

interface Message {
  content: string;
  role: string;
  name?: string | undefined;
  timestamp: string;
}

/**
 * Converts conversation messages to an XML-like format for LLM processing
 */
export function formatConversationAsXml(messages: Message[]): string {
  return messages
    .map(
      (message, index) =>
        `<message id="${index}" role="${message.role}" ${message.name ? `name="${message.name}"` : ""} timestamp="${message.timestamp}>
      <content>${message.content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</content>
    </message>`,
    )
    .join("\n");
}

/** Escape special characters for XML */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Converts nodes to XML-like format for LLM prompts
 */
export function formatNodesForPrompt(
  existingNodes: Array<{
    id: TypeId<"node">;
    type: string;
    label: string;
    description: string | null;
    tempId: string;
  }>,
): string {
  if (existingNodes.length === 0) {
    return "";
  }

  const xmlItems = existingNodes
    .map(
      (
        node,
      ) => `<node id="${escapeXml(node.tempId)}" type="${escapeXml(node.type)}">
  <label>${escapeXml(node.label)}</label>
  <description>${node.description || ""}</description>
</node>`,
    )
    .join("\n");
  return `<nodes>
${xmlItems}
</nodes>`;
}

/**
 * Formats a list of label/description pairs as XML
 */
export function formatLabelDescList(
  items: Array<{ label?: string | null; description?: string | null }>,
): string {
  if (items.length === 0) {
    return "";
  }

  const xmlItems = items
    .map(
      (item) => `<item label="${escapeXml(item.label ?? "Unnamed")}"
>${item.description ?? ""}</item>`,
    )
    .join("\n");
  return `<items>
${xmlItems}
</items>`;
}
