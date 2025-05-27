import { get, writable, type Readable } from "svelte/store"
import type { Conversation } from "../rag/conversation"
import type {
	ChatMessage,
	CompletionOptions,
	StreamingChatCompletionClient,
} from "../rag/llm/common"
import type { Node } from "src/rag/node"
import { logger } from "src/utils/logger"

export type ConversationStore = Readable<Conversation | null> & {
	submitMessage: (newMessage: string, attachedContent: Node[]) => Promise<void>
	resetConversation: () => void
}

export const conversationStore = (
	chatClient: StreamingChatCompletionClient,
	completionOptions: CompletionOptions,
): ConversationStore => {
	const store = writable<Conversation | null>(null)

	const resetConversation = () => store.set(null)

	const submitMessage = async (newMessage: string, attachedContent: Node[]) => {
		let conversation = get(store)

		if (!conversation) {
			// Initialize conversation
			conversation = {
				initialUserQuery: "",
				queryResponse: null,
				additionalMessages: [],
				isLoading: false,
				error: null,
			}
		}

		// Add user message
		conversation.additionalMessages.push({
			role: "user",
			content: newMessage,
			attachedContent: attachedContent,
		})
		conversation.isLoading = true
		store.set(conversation)

		// Build message history with current date/time
		const now = new Date()
		const dateTime = now.toLocaleString('en-US', {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			timeZoneName: 'short'
		})

		const systemPrompt = (completionOptions as any).systemPrompt || ""
		const systemPromptWithInstructions = systemPrompt + `\n\nCurrent date and time: ${dateTime}\n\nImportant capabilities and limitations:
- You can SEARCH notes using semantic search, which searches through content chunks (portions of notes split by the chunk size setting)
- Search results may show multiple chunks from the same note if different sections match your query
- Each search result shows the full matching chunk to provide complete context to you. The user doesn't see those tool outputs unless they click a button to expand the details, so you might want to give them a summary of the results or answer their question based on the results.
- You CANNOT read the full content of arbitrary notes (except daily notes for editing purposes)
- Users must manually attach notes using the "Add context" button to share full note content with you
- You can read and edit daily notes when asked to add entries or modify them
- When referencing Obsidian notes, always use Obsidian-style links [[note name]] instead of just mentioning the note title. This makes the references clickable for the user.`

		const messagesSoFar: ChatMessage[] = [
			{
				role: "system",
				content: systemPromptWithInstructions,
				attachedContent: []
			},
			...conversation.additionalMessages,
		]

		try {
			const stream = chatClient.createStreamingChatCompletion(messagesSoFar, completionOptions)
			for await (const event of stream) {
				switch (event.type) {
					case "start":
						conversation.isLoading = true
						conversation.additionalMessages.push({
							role: "assistant",
							content: "",
							attachedContent: [],
							toolOutputs: []
						})
						break
					case "delta":
						conversation.isLoading = true
						if (
							conversation.additionalMessages.length > 0 &&
							conversation.additionalMessages.last()!.role === "assistant"
						) {
							conversation.additionalMessages.last()!.content += event.content
						}
						break
					case "tool_output":
						conversation.isLoading = true
						if (
							conversation.additionalMessages.length > 0 &&
							conversation.additionalMessages.last()!.role === "assistant"
						) {
							const lastMsg = conversation.additionalMessages.last()!
							if (!lastMsg.toolOutputs) {
								lastMsg.toolOutputs = []
							}
							lastMsg.toolOutputs.push(event.content)
						}
						break
					case "stop":
						conversation.isLoading = false
				}
				store.set(conversation)
			}
		} catch (e) {
			logger.error("ChatClient error", "conversationStore", e)
			conversation.isLoading = false

			// Ensure the assistant message contains the error instead of being empty
			if (conversation.additionalMessages.length > 0 &&
				conversation.additionalMessages.last()!.role === "assistant" &&
				conversation.additionalMessages.last()!.content === "") {

				let errorMessage = "An error occurred while processing your request: ";
				if (e instanceof Error && e.message === "Unexpected status code: 401") {
					errorMessage += "Unauthorized. Did you set the right API key?";
					conversation.error = new Error("Unauthorized. Did you set the right API key?")
				} else if (e instanceof Error) {
					errorMessage += e.message;
					conversation.error = e
				} else {
					errorMessage += "Unknown error";
					conversation.error = e
				}

				conversation.additionalMessages.last()!.content = errorMessage;
			}

			store.set(conversation)
		}
	}

	return {
		subscribe: store.subscribe,
		submitMessage,
		resetConversation,
	}
}
