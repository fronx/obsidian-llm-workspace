/* eslint-disable @typescript-eslint/no-explicit-any */
import { get } from "svelte/store"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ChatStreamEvent, StreamingChatCompletionClient } from "../rag/llm/common"
import type { Node } from "../rag/node"
import { conversationStore } from "./conversation"

// Mock the .last() method on Array prototype for testing
declare global {
	interface Array<T> {
		last(): T | undefined
	}
}

Array.prototype.last = function <T>(this: T[]): T | undefined {
	return this[this.length - 1]
}

describe("conversationStore", () => {
	let mockChatClient: StreamingChatCompletionClient
	let mockCompletionOptions: any

	beforeEach(() => {
		mockChatClient = {
			createStreamingChatCompletion: vi.fn(),
			createChatCompletion: vi.fn(),
			createJSONCompletion: vi.fn(),
			createFunctionCallingCompletion: vi.fn(),
			displayName: "Mock Client",
		}

		mockCompletionOptions = {
			temperature: "balanced" as const,
			maxTokens: 1000,
			systemPrompt: "You are helpful",
		}
	})

	describe("resetConversation", () => {
		it("should reset the conversation to null", () => {
			const store = conversationStore(mockChatClient, mockCompletionOptions)

			store.resetConversation()

			expect(get(store)).toBeNull()
		})
	})

	describe("submitMessage", () => {
		it("should handle first message with streaming response", async () => {
			// Mock streaming response
			const streamEvents: ChatStreamEvent[] = [
				{ type: "start" },
				{ type: "delta", content: "This is" },
				{ type: "delta", content: " the response" },
				{ type: "stop", temperature: 0.7 },
			]

			const mockStreamIterator = (async function* () {
				for (const event of streamEvents) {
					yield event
				}
			})()

			vi.mocked(mockChatClient.createStreamingChatCompletion).mockReturnValue(
				mockStreamIterator,
			)

			const store = conversationStore(mockChatClient, mockCompletionOptions)
			const attachedContent: Node[] = []

			await store.submitMessage("What is the answer?", attachedContent)

			const conversation = get(store)
			expect(conversation).toEqual({
				initialUserQuery: "",
				queryResponse: null,
				additionalMessages: [
					{
						role: "user",
						content: "What is the answer?",
						attachedContent: attachedContent,
					},
					{
						role: "assistant",
						content: "This is the response",
						attachedContent: [],
					},
				],
				isLoading: false,
				error: null,
			})

			expect(mockChatClient.createStreamingChatCompletion).toHaveBeenCalledWith(
				[
					{
						role: "system",
						content: "You are helpful",
						attachedContent: [],
					},
					{
						role: "user",
						content: "What is the answer?",
						attachedContent: attachedContent,
					},
				],
				mockCompletionOptions,
			)
		})

		it("should handle follow-up messages", async () => {
			// Set up initial conversation with first message
			const store = conversationStore(mockChatClient, mockCompletionOptions)
			
			// Mock streaming response for first message
			const firstStreamEvents: ChatStreamEvent[] = [
				{ type: "start" },
				{ type: "delta", content: "Initial response" },
				{ type: "stop", temperature: 0.7 },
			]

			const mockFirstStreamIterator = (async function* () {
				for (const event of firstStreamEvents) {
					yield event
				}
			})()

			vi.mocked(mockChatClient.createStreamingChatCompletion).mockReturnValueOnce(
				mockFirstStreamIterator,
			)
			
			await store.submitMessage("What is the answer?", [])

			// Mock streaming response for follow-up
			const streamEvents: ChatStreamEvent[] = [
				{ type: "start" },
				{ type: "delta", content: "Follow" },
				{ type: "delta", content: "-up response" },
				{ type: "stop", temperature: 0.7 },
			]

			const mockStreamIterator = (async function* () {
				for (const event of streamEvents) {
					yield event
				}
			})()

			vi.mocked(mockChatClient.createStreamingChatCompletion).mockReturnValue(
				mockStreamIterator,
			)

			// Submit follow-up message
			await store.submitMessage("Tell me more", [])

			const conversation = get(store)
			expect(conversation?.additionalMessages).toHaveLength(4) // 2 user + 2 assistant
			expect(conversation?.additionalMessages[0]).toEqual({
				role: "user",
				content: "What is the answer?",
				attachedContent: [],
			})
			expect(conversation?.additionalMessages[1]).toEqual({
				role: "assistant",
				content: "Initial response",
				attachedContent: [],
			})
			expect(conversation?.additionalMessages[2]).toEqual({
				role: "user",
				content: "Tell me more",
				attachedContent: [],
			})
			expect(conversation?.additionalMessages[3]).toEqual({
				role: "assistant",
				content: "Follow-up response",
				attachedContent: [],
			})
			expect(conversation?.isLoading).toBe(false)

			// Verify chat client was called with correct message history for second call
			expect(mockChatClient.createStreamingChatCompletion).toHaveBeenLastCalledWith(
				[
					{
						role: "system",
						content: "You are helpful",
						attachedContent: [],
					},
					{
						role: "user",
						content: "What is the answer?",
						attachedContent: [],
					},
					{
						role: "assistant",
						content: "Initial response",
						attachedContent: [],
					},
					{
						role: "user",
						content: "Tell me more",
						attachedContent: [],
					},
				],
				mockCompletionOptions,
			)
		})

		it("should handle streaming errors with 401 status", async () => {
			const unauthorizedError = new Error("Unexpected status code: 401")
			// eslint-disable-next-line require-yield
			const mockStreamIterator = (async function* (): AsyncGenerator<ChatStreamEvent> {
				throw unauthorizedError
			})()

			vi.mocked(mockChatClient.createStreamingChatCompletion).mockReturnValue(
				mockStreamIterator,
			)

			const store = conversationStore(mockChatClient, mockCompletionOptions)

			await store.submitMessage("What is the answer?", [])

			const conversation = get(store)
			expect(conversation?.error?.message).toBe(
				"Unauthorized. Did you set the right API key?",
			)
			expect(conversation?.isLoading).toBe(false)
		})

		it("should handle generic streaming errors", async () => {
			const genericError = new Error("Network error")
			// eslint-disable-next-line require-yield
			const mockStreamIterator = (async function* (): AsyncGenerator<ChatStreamEvent> {
				throw genericError
			})()

			vi.mocked(mockChatClient.createStreamingChatCompletion).mockReturnValue(
				mockStreamIterator,
			)

			const store = conversationStore(mockChatClient, mockCompletionOptions)

			await store.submitMessage("What is the answer?", [])

			const conversation = get(store)
			expect(conversation?.error).toBe(genericError)
			expect(conversation?.isLoading).toBe(false)
		})

		it("should handle attached content", async () => {
			const streamEvents: ChatStreamEvent[] = [
				{ type: "start" },
				{ type: "delta", content: "Response with context" },
				{ type: "stop", temperature: 0.7 },
			]

			const mockStreamIterator = (async function* () {
				for (const event of streamEvents) {
					yield event
				}
			})()

			vi.mocked(mockChatClient.createStreamingChatCompletion).mockReturnValue(
				mockStreamIterator,
			)

			const store = conversationStore(mockChatClient, mockCompletionOptions)
			const attachedContent: Node[] = [
				{
					content: "Attached document content",
					parent: "doc.md",
					createdAt: Date.now(),
				},
			]

			await store.submitMessage("Analyze this", attachedContent)

			const conversation = get(store)
			expect(conversation?.additionalMessages[0].attachedContent).toEqual(attachedContent)

			expect(mockChatClient.createStreamingChatCompletion).toHaveBeenCalledWith(
				[
					{
						role: "system",
						content: "You are helpful",
						attachedContent: [],
					},
					{
						role: "user",
						content: "Analyze this",
						attachedContent: attachedContent,
					},
				],
				mockCompletionOptions,
			)
		})
	})

	describe("store subscription", () => {
		it("should allow subscribing to conversation updates", () => {
			const store = conversationStore(mockChatClient, mockCompletionOptions)
			const mockSubscriber = vi.fn()

			const unsubscribe = store.subscribe(mockSubscriber)
			store.resetConversation()

			expect(mockSubscriber).toHaveBeenCalledWith(null)
			unsubscribe()
		})
	})
})