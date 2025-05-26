import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ChatStreamEvent, CompletionOptions, StreamingChatCompletionClient, FunctionCall } from "./llm/common"
import type { NodeSimilarity } from "./vectorstore"
import type { Retriever } from "./retriever"
import { DumbResponseSynthesizer } from "./synthesizer"

describe("DumbResponseSynthesizer", () => {
    let mockClient: StreamingChatCompletionClient
    let mockRetriever: Retriever
    let completionOptions: CompletionOptions
    let synthesizer: DumbResponseSynthesizer

    const mockNodes: NodeSimilarity[] = [
        {
            node: {
                content: "This is the first chunk of content",
                parent: "/path/to/file1.md",
                createdAt: Date.now()
            },
            similarity: 0.8
        },
        {
            node: {
                content: "This is the second chunk of content",
                parent: "/path/to/file1.md",
                createdAt: Date.now()
            },
            similarity: 0.6
        }
    ]

    beforeEach(() => {
        mockClient = {
            displayName: "Mock Client",
            createChatCompletion: vi.fn(),
            createJSONCompletion: vi.fn(),
            createStreamingChatCompletion: vi.fn(),
            createFunctionCallingCompletion: vi.fn()
        }

        mockRetriever = {
            retrieve: vi.fn()
        }

        completionOptions = {
            temperature: "balanced",
            maxTokens: 1000
        }

        synthesizer = new DumbResponseSynthesizer(
            mockClient,
            completionOptions,
            "You are a helpful assistant",
            null,
            mockRetriever
        )
    })

    describe("synthesize without function calling", () => {
        it("should synthesize response without function calls when no retriever is available", async () => {
            const synthesizerWithoutRetriever = new DumbResponseSynthesizer(
                mockClient,
                completionOptions,
                "You are a helpful assistant",
                null,
                null
            )

            const streamEvents: ChatStreamEvent[] = [
                { type: "start" },
                { type: "delta", content: "Hello" },
                { type: "delta", content: " world" },
                { type: "stop", temperature: 0.7 }
            ]

            const mockStreamIterator = (async function* () {
                for (const event of streamEvents) {
                    yield event
                }
            })()

            vi.mocked(mockClient.createFunctionCallingCompletion).mockResolvedValue(null)
            vi.mocked(mockClient.createStreamingChatCompletion).mockReturnValue(mockStreamIterator)

            const responses = []
            for await (const response of synthesizerWithoutRetriever.synthesize("test query", mockNodes, "test query")) {
                responses.push(response)
            }

                        // Without retriever, no function calling happens, just streaming (start, delta, delta, stop) = 4 responses
            expect(responses).toHaveLength(4)
            expect(responses[0].text).toBe("")
            expect(responses[1].text).toBe("Hello")
            expect(responses[2].text).toBe("Hello world")
            expect(responses[3].text).toBe("Hello world")
            expect(responses[3].debugInfo?.temperature).toBe(0.7)
        })

        it("should include workspace context in the prompt", async () => {
            const synthesizerWithContext = new DumbResponseSynthesizer(
                mockClient,
                completionOptions,
                "You are a helpful assistant",
                "This is workspace context",
                null
            )

            const streamEvents: ChatStreamEvent[] = [
                { type: "start" },
                { type: "stop", temperature: 0.7 }
            ]

            const mockStreamIterator = (async function* () {
                for (const event of streamEvents) {
                    yield event
                }
            })()

            vi.mocked(mockClient.createFunctionCallingCompletion).mockResolvedValue(null)
            vi.mocked(mockClient.createStreamingChatCompletion).mockReturnValue(mockStreamIterator)

            const responses = []
            for await (const response of synthesizerWithContext.synthesize("test query", mockNodes, "test query")) {
                responses.push(response)
            }

            expect(mockClient.createStreamingChatCompletion).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        role: "user",
                        content: expect.stringContaining("High-level context provided by the user: This is workspace context")
                    })
                ]),
                completionOptions
            )
        })
    })

    describe("synthesize with function calling", () => {
        it("should perform semantic search when function is called", async () => {
            const functionCall: FunctionCall = {
                name: "semantic_search",
                arguments: JSON.stringify({ query: "search for more info" })
            }

            const additionalNodes: NodeSimilarity[] = [
                {
                    node: {
                        content: "Additional relevant content",
                        parent: "/path/to/file2.md",
                        createdAt: Date.now()
                    },
                    similarity: 0.9
                }
            ]

            const streamEvents: ChatStreamEvent[] = [
                { type: "start" },
                { type: "delta", content: "Based on the context" },
                { type: "stop", temperature: 0.7 }
            ]

            const mockStreamIterator = (async function* () {
                for (const event of streamEvents) {
                    yield event
                }
            })()

            vi.mocked(mockClient.createFunctionCallingCompletion)
                .mockResolvedValueOnce(functionCall)
                .mockResolvedValueOnce(null)

            vi.mocked(mockRetriever.retrieve).mockResolvedValue({
                nodes: additionalNodes,
                improvedQuery: "search for more info"
            })

            vi.mocked(mockClient.createStreamingChatCompletion).mockReturnValue(mockStreamIterator)

            const responses = []
            for await (const response of synthesizer.synthesize("test query", mockNodes, "test query")) {
                responses.push(response)
            }

            expect(mockClient.createFunctionCallingCompletion).toHaveBeenCalledTimes(2)
            expect(mockRetriever.retrieve).toHaveBeenCalledWith("search for more info", "/path/to/file1.md")
            expect(responses[responses.length - 1].sources).toHaveLength(3) // original 2 + 1 additional
        })

        it("should handle multiple function calls", async () => {
            const firstFunctionCall: FunctionCall = {
                name: "semantic_search",
                arguments: JSON.stringify({ query: "first search" })
            }

            const secondFunctionCall: FunctionCall = {
                name: "semantic_search",
                arguments: JSON.stringify({ query: "second search" })
            }

            const firstAdditionalNodes: NodeSimilarity[] = [
                {
                    node: {
                        content: "First additional content",
                        parent: "/path/to/file2.md",
                        createdAt: Date.now()
                    },
                    similarity: 0.9
                }
            ]

            const secondAdditionalNodes: NodeSimilarity[] = [
                {
                    node: {
                        content: "Second additional content",
                        parent: "/path/to/file3.md",
                        createdAt: Date.now()
                    },
                    similarity: 0.85
                }
            ]

            const streamEvents: ChatStreamEvent[] = [
                { type: "start" },
                { type: "delta", content: "Comprehensive answer" },
                { type: "stop", temperature: 0.7 }
            ]

            const mockStreamIterator = (async function* () {
                for (const event of streamEvents) {
                    yield event
                }
            })()

            vi.mocked(mockClient.createFunctionCallingCompletion)
                .mockResolvedValueOnce(firstFunctionCall)
                .mockResolvedValueOnce(secondFunctionCall)
                .mockResolvedValueOnce(null)

            vi.mocked(mockRetriever.retrieve)
                .mockResolvedValueOnce({
                    nodes: firstAdditionalNodes,
                    improvedQuery: "first search"
                })
                .mockResolvedValueOnce({
                    nodes: secondAdditionalNodes,
                    improvedQuery: "second search"
                })

            vi.mocked(mockClient.createStreamingChatCompletion).mockReturnValue(mockStreamIterator)

            const responses = []
            for await (const response of synthesizer.synthesize("test query", mockNodes, "test query")) {
                responses.push(response)
            }

            expect(mockClient.createFunctionCallingCompletion).toHaveBeenCalledTimes(3)
            expect(mockRetriever.retrieve).toHaveBeenCalledTimes(2)
            expect(responses[responses.length - 1].sources).toHaveLength(4) // original 2 + 2 additional
        })

        it("should handle function call with invalid JSON arguments", async () => {
            const functionCall: FunctionCall = {
                name: "semantic_search",
                arguments: "invalid json"
            }

            const streamEvents: ChatStreamEvent[] = [
                { type: "start" },
                { type: "delta", content: "Error handled gracefully" },
                { type: "stop", temperature: 0.7 }
            ]

            const mockStreamIterator = (async function* () {
                for (const event of streamEvents) {
                    yield event
                }
            })()

            vi.mocked(mockClient.createFunctionCallingCompletion)
                .mockResolvedValueOnce(functionCall)
                .mockResolvedValueOnce(null)

            vi.mocked(mockClient.createStreamingChatCompletion).mockReturnValue(mockStreamIterator)

            const responses = []
            for await (const response of synthesizer.synthesize("test query", mockNodes, "test query")) {
                responses.push(response)
            }

            expect(mockRetriever.retrieve).not.toHaveBeenCalled()
            expect(responses[responses.length - 1].sources).toHaveLength(2) // only original nodes
        })

        it("should handle retriever errors gracefully", async () => {
            const functionCall: FunctionCall = {
                name: "semantic_search",
                arguments: JSON.stringify({ query: "search query" })
            }

            const streamEvents: ChatStreamEvent[] = [
                { type: "start" },
                { type: "delta", content: "Response despite error" },
                { type: "stop", temperature: 0.7 }
            ]

            const mockStreamIterator = (async function* () {
                for (const event of streamEvents) {
                    yield event
                }
            })()

            vi.mocked(mockClient.createFunctionCallingCompletion)
                .mockResolvedValueOnce(functionCall)
                .mockResolvedValueOnce(null)

            vi.mocked(mockRetriever.retrieve).mockRejectedValue(new Error("Retrieval failed"))
            vi.mocked(mockClient.createStreamingChatCompletion).mockReturnValue(mockStreamIterator)

            const responses = []
            for await (const response of synthesizer.synthesize("test query", mockNodes, "test query")) {
                responses.push(response)
            }

            expect(responses[responses.length - 1].sources).toHaveLength(2) // only original nodes
        })
    })

    describe("buildContext", () => {
        it("should build context correctly without workspace context", () => {
            const synthesizerWithoutContext = new DumbResponseSynthesizer(
                mockClient,
                completionOptions,
                "You are a helpful assistant",
                null,
                mockRetriever
            )

            // Access private method through any cast for testing
            const context = (synthesizerWithoutContext as any).buildContext(mockNodes)

            expect(context).toContain("This is the second chunk of content")
            expect(context).toContain("This is the first chunk of content")
            expect(context).not.toContain("High-level context provided by the user")
        })

        it("should build context correctly with workspace context", () => {
            const synthesizerWithContext = new DumbResponseSynthesizer(
                mockClient,
                completionOptions,
                "You are a helpful assistant",
                "Workspace context here",
                mockRetriever
            )

            // Access private method through any cast for testing
            const context = (synthesizerWithContext as any).buildContext(mockNodes)

            expect(context).toContain("This is the second chunk of content")
            expect(context).toContain("This is the first chunk of content")
            expect(context).toContain("High-level context provided by the user: Workspace context here")
        })

        it("should sort nodes by similarity (most relevant last)", () => {
            // Access private method through any cast for testing
            const context = (synthesizer as any).buildContext(mockNodes)

            const firstChunkIndex = context.indexOf("This is the first chunk of content")
            const secondChunkIndex = context.indexOf("This is the second chunk of content")

            // First chunk has higher similarity (0.8) so should come after second chunk (0.6)
            expect(firstChunkIndex).toBeGreaterThan(secondChunkIndex)
        })
    })

    describe("response structure", () => {
        it("should include all required fields in QueryResponse", async () => {
            const streamEvents: ChatStreamEvent[] = [
                { type: "start" },
                { type: "stop", temperature: 0.7, usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0 } }
            ]

            const mockStreamIterator = (async function* () {
                for (const event of streamEvents) {
                    yield event
                }
            })()

            vi.mocked(mockClient.createFunctionCallingCompletion).mockResolvedValue(null)
            vi.mocked(mockClient.createStreamingChatCompletion).mockReturnValue(mockStreamIterator)

            const responses = []
            for await (const response of synthesizer.synthesize("test query", mockNodes, "improved query")) {
                responses.push(response)
            }

            const finalResponse = responses[responses.length - 1]

            expect(finalResponse).toMatchObject({
                text: "",
                sources: mockNodes,
                retrievalDetails: {
                    originalQuery: "test query",
                    improvedQuery: "improved query"
                },
                systemPrompt: "You are a helpful assistant",
                userPrompt: expect.any(String),
                debugInfo: {
                    createdAt: expect.any(Number),
                    inputTokens: 100,
                    outputTokens: 50,
                    temperature: 0.7
                }
            })
        })
    })
})