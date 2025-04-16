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

/**
 * Formats nodes for inclusion in the LLM prompt
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

  const nodesJson = existingNodes.map((node) => ({
    id: node.tempId,
    type: node.type,
    label: node.label,
    description: node.description || "",
  }));

  return `
<nodes>
${JSON.stringify(nodesJson, null, 2)}
</nodes>
`;
}
