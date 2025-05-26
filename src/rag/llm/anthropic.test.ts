import { beforeEach, describe, expect, it, vi } from "vitest"
import type { FunctionDefinition } from "./common"
import { AnthropicChatCompletionClient } from "./anthropic"

// Mock Obsidian
vi.mock("obsidian", () => ({
    requestUrl: vi.fn()
}))

// Mock node utils
vi.mock("src/utils/node", () => ({
    nodeStreamingFetch: vi.fn()
}))

// Mock SSE utils
vi.mock("src/utils/sse", () => ({
    iterSSEMessages: vi.fn()
}))

describe("AnthropicChatCompletionClient function calling", () => {
    let client: AnthropicChatCompletionClient
    let mockRequestUrl: any

    beforeEach(async () => {
        const { requestUrl } = await import("obsidian")
        mockRequestUrl = vi.mocked(requestUrl)
        mockRequestUrl.mockClear()

        client = new AnthropicChatCompletionClient("test-api-key", "claude-3-sonnet-20240229")
    })

    describe("createFunctionCallingCompletion", () => {
        it("should format functions in system prompt for Claude", async () => {
            const functions: FunctionDefinition[] = [
                {
                    name: "semantic_search",
                    description: "Search for relevant content",
                    parameters: {
                        type: "object",
                        properties: {
                            query: {
                                type: "string",
                                description: "The search query"
                            }
                        },
                        required: ["query"]
                    }
                }
            ]

            const mockResponse = {
                status: 200,
                text: "success",
                json: {
                    content: [{
                        type: "text",
                        text: "{\"name\": \"semantic_search\", \"arguments\": \"{\\\"query\\\": \\\"test search\\\"}\"}"
                    }]
                }
            }

            mockRequestUrl.mockResolvedValue(mockResponse)

            const result = await client.createFunctionCallingCompletion(
                [
                    { role: "system", content: "You are helpful", attachedContent: [] },
                    { role: "user", content: "Search for something", attachedContent: [] }
                ],
                functions,
                { temperature: "balanced", maxTokens: 1000 }
            )

            expect(mockRequestUrl).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: "https://api.anthropic.com/v1/messages",
                    method: "POST",
                    headers: expect.objectContaining({
                        "anthropic-version": "2023-06-01",
                        "x-api-key": "test-api-key"
                    }),
                    body: expect.stringContaining("semantic_search: Search for relevant content")
                })
            )

            expect(result?.name).toBe("semantic_search")
            expect(JSON.parse(result?.arguments || "{}")).toEqual({ query: "test search" })
        })

        it("should return null when no function call is detected", async () => {
            const mockResponse = {
                status: 200,
                text: "success",
                json: {
                    content: [{
                        type: "text",
                        text: "This is a regular response without any function calls."
                    }]
                }
            }

            mockRequestUrl.mockResolvedValue(mockResponse)

            const result = await client.createFunctionCallingCompletion(
                [{ role: "user", content: "Hello", attachedContent: [] }],
                [],
                { temperature: "balanced", maxTokens: 1000 }
            )

            expect(result).toBeNull()
        })

        it("should parse function call with proper JSON format", async () => {
            const mockResponse = {
                status: 200,
                text: "success",
                json: {
                    content: [{
                        type: "text",
                        text: "{\"name\": \"semantic_search\", \"arguments\": \"{\\\"query\\\": \\\"complex search with spaces\\\"}\"}"
                    }]
                }
            }

            mockRequestUrl.mockResolvedValue(mockResponse)

            const result = await client.createFunctionCallingCompletion(
                [{ role: "user", content: "Search", attachedContent: [] }],
                [],
                { temperature: "balanced", maxTokens: 1000 }
            )

            expect(result?.name).toBe("semantic_search")
            expect(JSON.parse(result?.arguments || "{}")).toEqual({ query: "complex search with spaces" })
        })

        it("should handle malformed function call gracefully", async () => {
            const mockResponse = {
                status: 200,
                text: "success",
                json: {
                    content: [{
                        type: "text",
                        text: "invalid json response"
                    }]
                }
            }

            mockRequestUrl.mockResolvedValue(mockResponse)

            const result = await client.createFunctionCallingCompletion(
                [{ role: "user", content: "Search", attachedContent: [] }],
                [],
                { temperature: "balanced", maxTokens: 1000 }
            )

            expect(result).toBeNull()
        })

        it("should handle incomplete function call", async () => {
            const mockResponse = {
                status: 200,
                text: "success",
                json: {
                    content: [{
                        type: "text",
                        text: "{\"name\": \"semantic_search\"}"
                    }]
                }
            }

            mockRequestUrl.mockResolvedValue(mockResponse)

            const result = await client.createFunctionCallingCompletion(
                [{ role: "user", content: "Search", attachedContent: [] }],
                [],
                { temperature: "balanced", maxTokens: 1000 }
            )

            expect(result).toBeNull()
        })

        it("should throw error when API key is not set", async () => {
            const clientWithoutKey = new AnthropicChatCompletionClient("", "claude-3-sonnet-20240229")

            await expect(
                clientWithoutKey.createFunctionCallingCompletion(
                    [{ role: "user", content: "Test", attachedContent: [] }],
                    [],
                    { temperature: "balanced", maxTokens: 1000 }
                )
            ).rejects.toThrow("Anthropic API key is not set")
        })

        it("should include function descriptions in system prompt", async () => {
            const functions: FunctionDefinition[] = [
                {
                    name: "search_files",
                    description: "Search through files in the workspace",
                    parameters: {
                        type: "object",
                        properties: {
                            query: {
                                type: "string",
                                description: "Search query"
                            },
                            limit: {
                                type: "number",
                                description: "Maximum number of results"
                            }
                        },
                        required: ["query"]
                    }
                }
            ]

            const mockResponse = {
                status: 200,
                text: "success",
                json: {
                    content: [{
                        type: "text",
                        text: "Regular response"
                    }]
                }
            }

            mockRequestUrl.mockResolvedValue(mockResponse)

            await client.createFunctionCallingCompletion(
                [
                    { role: "system", content: "You are helpful", attachedContent: [] },
                    { role: "user", content: "Search", attachedContent: [] }
                ],
                functions,
                { temperature: "balanced", maxTokens: 1000 }
            )

            expect(mockRequestUrl).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: "https://api.anthropic.com/v1/messages",
                    body: expect.stringContaining("search_files: Search through files in the workspace")
                })
            )

            const requestBody = JSON.parse(mockRequestUrl.mock.calls[0][0].body)
            expect(requestBody.system).toContain("search_files: Search through files in the workspace")
            expect(requestBody.system).toContain("query")
            expect(requestBody.system).toContain("limit")
        })
    })
})