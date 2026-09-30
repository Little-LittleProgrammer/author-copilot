import type {
  AiChatHistoryMessage,
  Conversation,
  ConversationMessage,
  ConversationSummary,
} from "@author-copilot/contracts";

export function summarizeConversation(
  conversation: Conversation,
): ConversationSummary {
  const { messages, ...summary } = conversation;
  return {
    ...summary,
    taskIds: messages.flatMap((message) =>
      message.taskId ? [message.taskId] : [],
    ),
  };
}

// Keep complete turns only, and leave space for the current request and context.
export function conversationHistory(
  messages: readonly ConversationMessage[],
): AiChatHistoryMessage[] {
  const turns: AiChatHistoryMessage[][] = [];
  for (let index = 0; index < messages.length - 1; index++) {
    const user = messages[index];
    const assistant = messages[index + 1];
    if (
      user?.role !== "user" ||
      assistant?.role !== "assistant" ||
      assistant.status !== "complete"
    )
      continue;
    if (!user.content.trim() || !assistant.content.trim()) continue;
    turns.push([
      { role: "user", content: user.content.slice(-8_000) },
      {
        role: "assistant",
        content:
          `${assistant.content}${assistant.resolution === "undone" ? "\n[The user undid these file changes.]" : ""}`.slice(
            -8_000,
          ),
      },
    ]);
    index++;
  }
  return turns.slice(-6).flat();
}
