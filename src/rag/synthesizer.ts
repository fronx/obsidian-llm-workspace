import { CONTEXT_SEPARATOR, defaultSynthesisUserPrompt } from "src/config/prompts"
import type { CompletionOptions, StreamingChatCompletionClient } from "./llm/common"
import { nodeRepresentation } from "./node"
import type { NodeSimilarity } from "./vectorstore"
import type { Retriever } from "./retriever"
import type { FunctionDefinition, ChatMessage } from "./llm/common"

export interface QueryResponse {
	text: string

	sources: NodeSimilarity[]
	retrievalDetails?: RetrievalDetails // null when it's not in workspace RAG mode

	systemPrompt: string
	userPrompt: string

	// Debug info is not yet available while the response is being streamed
	debugInfo?: DebugInfo
}

export interface RetrievalDetails {
	originalQuery: string
	improvedQuery: string
}

// TODO: add response string
// TODO: add response time
export interface DebugInfo {
	createdAt: number
	inputTokens?: number
	cachedInputTokens?: number
	outputTokens?: number
	temperature: number
}

export interface ResponseSynthesizer {
	synthesize(
		query: string,
		nodes: NodeSimilarity[],
		improvedQuery: string,
	): AsyncGenerator<QueryResponse>
}

export class DumbResponseSynthesizer implements ResponseSynthesizer {
	private completionClient: StreamingChatCompletionClient
	private completionOptions: CompletionOptions
	private systemPrompt: string
	private workspaceContext: string | null
	private retriever: Retriever | null

	constructor(
		completionClient: StreamingChatCompletionClient,
		completionOptions: CompletionOptions,
		systemPrompt: string,
		workspaceContext: string | null = null,
		retriever: Retriever | null = null
	) {
		this.completionClient = completionClient
		this.completionOptions = completionOptions
		this.systemPrompt = systemPrompt
		this.workspaceContext = workspaceContext
		this.retriever = retriever
	}

	private async handleSemanticSearch(query: string, workspaceFilePath: string): Promise<NodeSimilarity[]> {
		if (!this.retriever) {
			throw new Error("Retriever not available for semantic search")
		}
		const result = await this.retriever.retrieve(query, workspaceFilePath)
		return result.nodes
	}

	private buildContext(nodes: NodeSimilarity[]): string {
		let context = nodes
			.sort((a, b) => a.similarity - b.similarity) // put the most relevant nodes towards the end of context
			.map((n) => nodeRepresentation(n.node))
			.join(`\n\n${CONTEXT_SEPARATOR}\n\n`)

		if (this.workspaceContext) {
			context += `\n\n${CONTEXT_SEPARATOR}\n\n`
			context += "High-level context provided by the user: "
			context += this.workspaceContext
		}

		return context
	}

	async *synthesize(
		query: string,
		nodes: NodeSimilarity[],
		improvedQuery: string,
	): AsyncGenerator<QueryResponse> {
		let context = this.buildContext(nodes)
		let userPrompt = defaultSynthesisUserPrompt(context, query)
		const systemPrompt = this.systemPrompt

		const semanticSearchFunction: FunctionDefinition = {
			name: "semantic_search",
			description: "Search for relevant content in the workspace using semantic similarity",
			parameters: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "The search query to find relevant content"
					}
				},
				required: ["query"]
			}
		}

		const messages: ChatMessage[] = [
			{ role: "system", content: systemPrompt, attachedContent: [] },
			{ role: "user", content: userPrompt, attachedContent: [] }
		]

		// Only do function calling if we have a retriever
		if (this.retriever) {
			let shouldContinue = true
			while (shouldContinue) {
				const functionCall = await this.completionClient.createFunctionCallingCompletion(
					messages,
					[semanticSearchFunction],
					this.completionOptions
				)

				if (functionCall) {
					try {
						const args = JSON.parse(functionCall.arguments)
						const newNodes = await this.handleSemanticSearch(args.query, nodes[0].node.parent)
						const newContext = newNodes
							.map((n) => nodeRepresentation(n.node))
							.join(`\n\n${CONTEXT_SEPARATOR}\n\n`)

						messages.push({
							role: "function",
							content: `Found additional context:\n${newContext}`,
							attachedContent: []
						})
						nodes = [...nodes, ...newNodes]

						// Update the user message with all accumulated context
						context = this.buildContext(nodes)
						userPrompt = defaultSynthesisUserPrompt(context, query)
						messages[1].content = userPrompt
					} catch (e) {
						messages.push({
							role: "function",
							content: `Error performing semantic search: ${e}`,
							attachedContent: []
						})
					}
				} else {
					shouldContinue = false
				}
			}
		}

		// For the final streaming response, we only use the system prompt and final user message with all context
		const stream = this.completionClient.createStreamingChatCompletion(
			[
				{ role: "system", content: systemPrompt, attachedContent: [] },
				{ role: "user", content: userPrompt, attachedContent: [] }
			],
			this.completionOptions
		)

		let aggregatedText = ""
		const createResponse = (debugInfo?: DebugInfo): QueryResponse => ({
			text: aggregatedText,
			sources: nodes,
			retrievalDetails: {
				originalQuery: query,
				improvedQuery: improvedQuery,
			},
			systemPrompt: systemPrompt,
			userPrompt: userPrompt,
			...(debugInfo && { debugInfo })
		})

		for await (const event of stream) {
			switch (event.type) {
				case "start":
					yield createResponse()
					break
				case "delta":
					aggregatedText += event.content
					yield createResponse()
					break
				case "stop":
					yield createResponse({
						createdAt: Date.now(),
						inputTokens: event.usage?.inputTokens,
						cachedInputTokens: event.usage?.cachedInputTokens,
						outputTokens: event.usage?.outputTokens,
						temperature: event.temperature,
					})
			}
		}
	}
}
