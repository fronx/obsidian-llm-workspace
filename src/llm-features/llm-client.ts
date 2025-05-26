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
	// Initialize the unified client synchronously 
	let unifiedClientAdapter: UnifiedChatClientAdapter | null = null
	let initPromise: Promise<void> | null = null

	const ensureInitialized = async (): Promise<UnifiedChatClientAdapter> => {
		if (unifiedClientAdapter) {
			return unifiedClientAdapter
		}
		
		if (!initPromise) {
			initPromise = UnifiedChatClient.fromSettings(settings, modelConfig).then(client => {
				unifiedClientAdapter = new UnifiedChatClientAdapter(client, modelConfig.model, settings.enableFunctionCalling)
			}).catch(error => {
				console.error('Failed to initialize unified client:', error)
				throw error
			})
		}
		
		await initPromise
		
		if (!unifiedClientAdapter) {
			throw new Error('Failed to initialize unified client')
		}
		
		return unifiedClientAdapter
	}

	// Return a proxy that delegates to the appropriate client
	return {
		get displayName() {
			return unifiedClientAdapter?.displayName || `${modelConfig.provider} (${modelConfig.model}) - Loading...`
		},
		
		async createChatCompletion(messages, options) {
			const adapter = await ensureInitialized()
			return adapter.createChatCompletion(messages, options)
		},

		async createJSONCompletion(systemPrompt, userPrompt, options) {
			const adapter = await ensureInitialized()
			return adapter.createJSONCompletion(systemPrompt, userPrompt, options)
		},

		async createFunctionCallingCompletion(messages, functions, options) {
			const adapter = await ensureInitialized()
			return adapter.createFunctionCallingCompletion(messages, functions, options)
		},

		async *createStreamingChatCompletion(messages, options) {
			const adapter = await ensureInitialized()
			yield* adapter.createStreamingChatCompletion(messages, options)
		}
	}
}
