import { beforeEach, describe, expect, it, vi } from "vitest"
import type { FunctionDefinition } from "./common"
import { OpenAIChatCompletionClient } from "./openai"

// Mock OpenAI
vi.mock("openai", () => ({
    default: vi.fn().mockImplementation(() => ({
        chat: {
            completions: {
                create: vi.fn()
            }
        }
    }))
}))

describe("OpenAIChatCompletionClient function calling", () => {
    let client: OpenAIChatCompletionClient
    let mockOpenAI: any

    beforeEach(async () => {
        const OpenAI = (await import("openai")).default
        mockOpenAI = {
            chat: {
                completions: {
                    create: vi.fn()
                }
            }
        }
        vi.mocked(OpenAI).mockReturnValue(mockOpenAI)

        client = new OpenAIChatCompletionClient("test-api-key", "gpt-4")
    })

    describe("createFunctionCallingCompletion", () => {
        it("should call OpenAI with correct function format", async () => {
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
                choices: [{
                    message: {
                        tool_calls: [{
                            function: {
                                name: "semantic_search",
                                arguments: JSON.stringify({ query: "test search" })
                            }
                        }]
                    }
                }]
            }

            mockOpenAI.chat.completions.create.mockResolvedValue(mockResponse)

            const result = await client.createFunctionCallingCompletion(
                [
                    { role: "system", content: "You are helpful", attachedContent: [] },
                    { role: "user", content: "Search for something", attachedContent: [] }
                ],
                functions,
                { temperature: "balanced", maxTokens: 1000 }
            )

            expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
                model: "gpt-4",
                messages: [
                    { role: "system", content: "You are helpful" },
                    { role: "user", content: "Search for something" }
                ],
                tools: [{
                    type: 'function',
                    function: {
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
                }],
                tool_choice: 'auto',
                temperature: 0.5,
                max_completion_tokens: 1000
            })

            expect(result).toEqual({
                name: "semantic_search",
                arguments: JSON.stringify({ query: "test search" })
            })
        })

        it("should return null when no function is called", async () => {
            const mockResponse = {
                choices: [{
                    message: {
                        content: "Regular response without function call"
                    }
                }]
            }

            mockOpenAI.chat.completions.create.mockResolvedValue(mockResponse)

            const result = await client.createFunctionCallingCompletion(
                [{ role: "user", content: "Hello", attachedContent: [] }],
                [],
                { temperature: "balanced", maxTokens: 1000 }
            )

            expect(result).toBeNull()
        })

        it("should handle multiple tool calls and return the first one", async () => {
            const mockResponse = {
                choices: [{
                    message: {
                        tool_calls: [
                            {
                                function: {
                                    name: "semantic_search",
                                    arguments: JSON.stringify({ query: "first search" })
                                }
                            },
                            {
                                function: {
                                    name: "semantic_search",
                                    arguments: JSON.stringify({ query: "second search" })
                                }
                            }
                        ]
                    }
                }]
            }

            mockOpenAI.chat.completions.create.mockResolvedValue(mockResponse)

            const result = await client.createFunctionCallingCompletion(
                [{ role: "user", content: "Search", attachedContent: [] }],
                [],
                { temperature: "balanced", maxTokens: 1000 }
            )

            expect(result).toEqual({
                name: "semantic_search",
                arguments: JSON.stringify({ query: "first search" })
            })
        })

        it("should throw error when API key is not set", async () => {
            const clientWithoutKey = new OpenAIChatCompletionClient("", "gpt-4")

            await expect(
                clientWithoutKey.createFunctionCallingCompletion(
                    [{ role: "user", content: "Test", attachedContent: [] }],
                    [],
                    { temperature: "balanced", maxTokens: 1000 }
                )
            ).rejects.toThrow("OpenAI API key is not set")
        })

        it("should handle temperature conversion correctly", async () => {
            const mockResponse = {
                choices: [{
                    message: {
                        content: "Response"
                    }
                }]
            }

            mockOpenAI.chat.completions.create.mockResolvedValue(mockResponse)

            await client.createFunctionCallingCompletion(
                [{ role: "user", content: "Test", attachedContent: [] }],
                [],
                { temperature: "precise", maxTokens: 1000 }
            )

            expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    temperature: 0.2
                })
            )
        })
    })
})