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
		const systemPromptWithDateTime = systemPrompt + `\n\nCurrent date and time: ${dateTime}`
		
		const messagesSoFar: ChatMessage[] = [
			{
				role: "system",
				content: systemPromptWithDateTime,
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
							attachedContent: []
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
					case "stop":
						conversation.isLoading = false
				}
				store.set(conversation)
			}
		} catch (e) {
			logger.error("ChatClient error", "conversationStore", e)
			conversation.isLoading = false
			if (e instanceof Error && e.message === "Unexpected status code: 401") {
				conversation.error = new Error("Unauthorized. Did you set the right API key?")
			} else {
				conversation.error = e
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
