import type { Node } from "../node"

export interface EmbeddingClient {
	embedNode(node: Node): Promise<number[]>
	embedQuery(query: string): Promise<QueryEmbedding>
}

export type Role = "system" | "user" | "assistant" | "function"

export interface ChatMessage {
	content: string
	role: Role
	attachedContent: Node[]
	toolOutputs?: string[]
}

export interface ChatStartEvent {
	type: "start"
	// Placeholder for now, we could add non-content fields here
}

export interface ChatDeltaEvent {
	type: "delta"
	content: string
}

export interface ChatStopEvent {
	type: "stop"
	usage?: Usage
	// Implementation-specific temp number for debugging purposes
	temperature: number
}

export interface ChatToolOutputEvent {
	type: "tool_output"
	content: string
}

export interface Usage {
	inputTokens: number
	outputTokens: number
	cachedInputTokens: number
}

export type ChatStreamEvent = ChatStartEvent | ChatDeltaEvent | ChatStopEvent | ChatToolOutputEvent

// Temperature is defined as an enum and then mapped to provider-specific values
export type Temperature = "balanced" | "creative" | "precise"

export interface CompletionOptions {
	temperature: Temperature
	// Note: as of May 2025:
	// OpenAI doesn't require this param
	// Anthropic requires it
	// Ollama doesn't require it
	maxTokens: number
}

export interface FunctionDefinition {
	name: string;
	description: string;
	parameters: {
		type: "object";
		properties: Record<string, {
			type: string;
			description: string;
		}>;
		required?: string[];
	};
}

export interface FunctionCall {
	name: string;
	arguments: string; // JSON string
}

export interface ChatCompletionClient {
	get displayName(): string
	createChatCompletion(messages: ChatMessage[], options: CompletionOptions): Promise<ChatMessage>
	createJSONCompletion<T>(
		systemPrompt: string,
		userPrompt: string,
		options: CompletionOptions,
	): Promise<T>
	createFunctionCallingCompletion(
		messages: ChatMessage[],
		functions: FunctionDefinition[],
		options: CompletionOptions
	): Promise<FunctionCall | null>
}

export type StreamingChatCompletionClient = ChatCompletionClient & {
	createStreamingChatCompletion: (
		messages: ChatMessage[],
		options: CompletionOptions,
	) => AsyncGenerator<ChatStreamEvent>
}

export interface QueryEmbedding {
	originalQuery: string
	improvedQuery: string
	embedding: number[]
}
