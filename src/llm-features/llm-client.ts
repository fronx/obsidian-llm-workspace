import type { LlmPluginSettings } from "src/config/settings"
import { OllamaClient } from "src/rag/llm/ollama/client"
import { derived, type Writable } from "svelte/store"
import { AnthropicChatCompletionClient } from "../rag/llm/anthropic"
import type { StreamingChatCompletionClient } from "../rag/llm/common"
import { OpenAIChatCompletionClient } from "../rag/llm/openai"
import { settingsStore } from "../utils/obsidian"
import { UnifiedChatClient, UnifiedChatClientAdapter } from "./unified-chat-client"

export const llmClient = derived<Writable<LlmPluginSettings>, StreamingChatCompletionClient>(
	settingsStore,
	($settingsStore) => {
		const modelConfig = $settingsStore.questionAndAnswerModel
		const provider = modelConfig.provider

		// Use unified client if enabled
		if ($settingsStore.useUnifiedClient) {
			return createUnifiedClient($settingsStore, modelConfig)
		}

		// Fall back to old implementations
		switch (provider) {
			case "OpenAI":
				return new OpenAIChatCompletionClient(
					$settingsStore.providerSettings.openai.apiKey,
					modelConfig.model,
				)
			case "Anthropic":
				return new AnthropicChatCompletionClient(
					$settingsStore.providerSettings.anthropic.apiKey,
					modelConfig.model,
				)
			case "Ollama":
				return new OllamaClient(
					$settingsStore.providerSettings.ollama.url,
					modelConfig.model,
				)
			default:
				throw new Error("Unrecognized provider: " + provider)
		}
	},
)

function createUnifiedClient(settings: LlmPluginSettings, modelConfig: any): StreamingChatCompletionClient {
	// Create a placeholder that will be replaced with the actual unified client when initialized
	let unifiedClientAdapter: UnifiedChatClientAdapter | null = null
	
	// Initialize the unified client asynchronously
	UnifiedChatClient.fromSettings(settings, modelConfig).then(client => {
		unifiedClientAdapter = new UnifiedChatClientAdapter(client, modelConfig.model)
	}).catch(error => {
		console.error('Failed to initialize unified client:', error)
	})

	// Return a proxy that delegates to the appropriate client
	return {
		get displayName() {
			return unifiedClientAdapter?.displayName || `${modelConfig.provider} (${modelConfig.model}) - Loading...`
		},
		
		async createChatCompletion(messages, options) {
			if (!unifiedClientAdapter) {
				throw new Error('Unified client not yet initialized')
			}
			return unifiedClientAdapter.createChatCompletion(messages, options)
		},

		async createJSONCompletion(systemPrompt, userPrompt, options) {
			if (!unifiedClientAdapter) {
				throw new Error('Unified client not yet initialized')
			}
			return unifiedClientAdapter.createJSONCompletion(systemPrompt, userPrompt, options)
		},

		async createFunctionCallingCompletion(messages, functions, options) {
			if (!unifiedClientAdapter) {
				throw new Error('Unified client not yet initialized')
			}
			return unifiedClientAdapter.createFunctionCallingCompletion(messages, functions, options)
		},

		async *createStreamingChatCompletion(messages, options) {
			if (!unifiedClientAdapter) {
				throw new Error('Unified client not yet initialized')
			}
			yield* unifiedClientAdapter.createStreamingChatCompletion(messages, options)
		}
	}
}
