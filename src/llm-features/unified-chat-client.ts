import { Message, Plugin, igniteEngine, loadModels, type Model, type LlmEngine } from 'multi-llm-ts';
import type { LlmPluginSettings, ModelConfiguration } from '../config/settings';
import type { Provider } from '../config/providers';
import type { ChatMessage, ChatStreamEvent, CompletionOptions, StreamingChatCompletionClient, Temperature, FunctionDefinition, FunctionCall } from '../rag/llm/common';

/**
 * Example plugin for function calling
 */
export class ObsidianPlugin extends Plugin {
  constructor() {
    super();
  }

  async searchNotes(params: { query: string }): Promise<string> {
    // This would be implemented to call the actual Obsidian search functionality
    return `Results for query "${params.query}"`;
  }

  async getNoteContent(params: { path: string }): Promise<string> {
    // This would be implemented to retrieve the actual note content
    return `Content of note at path "${params.path}"`;
  }
}

/**
 * Unified chat client using multi-llm-ts to support multiple LLM providers
 * with a consistent interface for chat completion, streaming and function calling.
 */
export class UnifiedChatClient {
  private llm: LlmEngine | null = null;
  private models: Model[] | null = null;
  private provider: Provider = 'OpenAI';

  /**
   * Initialize the chat client for a specific provider
   */
  async initialize(providerId: string, config: any): Promise<Model[]> {
    this.llm = igniteEngine(providerId, config);
    const modelsList = await loadModels(providerId, config);
    this.models = modelsList?.chat || [];
    return this.models;
  }

  /**
   * Add a plugin for function calling
   */
  addPlugin(plugin: Plugin): void {
    if (this.llm) {
      this.llm.addPlugin(plugin);
    }
  }

  /**
   * Get chat completion (non-streaming)
   */
  async complete(model: Model, messages: Message[]): Promise<string> {
    if (!this.llm) {
      throw new Error('Chat client not initialized');
    }

    const response = await this.llm.complete(model.id, messages);
    return response.content || '';
  }

  /**
   * Generate chat completion with streaming
   */
  async *generate(model: Model, messages: Message[]) {
    if (!this.llm) {
      throw new Error('Chat client not initialized');
    }

    const stream = this.llm.generate(model.id, messages);
    for await (const chunk of stream) {
      if (chunk.type === 'content') {
        yield chunk.text;
      }
    }
  }

  /**
   * Create messages from system prompt and user input
   */
  createMessages(systemPrompt: string, userPrompt: string): Message[] {
    const messages: Message[] = [];

    if (systemPrompt) {
      messages.push(new Message('system', systemPrompt));
    }

    messages.push(new Message('user', userPrompt));

    return messages;
  }

  /**
   * Find a model by name
   */
  findModel(modelName: string): Model | undefined {
    if (!this.models) return undefined;
    return this.models.find((model: Model) => model.id === modelName);
  }

  /**
   * Get the provider ID
   */
  getProvider(): Provider {
    return this.provider;
  }

  /**
   * Initialize chat client from plugin settings and model configuration
   */
  static async fromSettings(
    settings: LlmPluginSettings,
    modelConfig: ModelConfiguration
  ): Promise<UnifiedChatClient> {
    const client = new UnifiedChatClient();
    let providerId: string;
    let config: any;

    // Map provider to multi-llm-ts provider ID
    switch (modelConfig.provider) {
      case 'OpenAI':
        providerId = 'openai';
        config = {
          apiKey: settings.providerSettings.openai.apiKey
        };
        client.provider = 'OpenAI';
        break;
      case 'Anthropic':
        providerId = 'anthropic';
        config = {
          apiKey: settings.providerSettings.anthropic.apiKey
        };
        client.provider = 'Anthropic';
        break;
      case 'Ollama':
        providerId = 'ollama';
        config = {
          baseUrl: settings.providerSettings.ollama.url || 'http://localhost:11434'
        };
        client.provider = 'Ollama';
        break;
      default:
        throw new Error(`Unsupported provider: ${modelConfig.provider}`);
    }

    await client.initialize(providerId, config);
    return client;
  }
}

/**
 * Adapter that bridges UnifiedChatClient to the existing StreamingChatCompletionClient interface
 */
export class UnifiedChatClientAdapter implements StreamingChatCompletionClient {
  constructor(
    private unifiedClient: UnifiedChatClient,
    private modelName: string
  ) {}

  get displayName(): string {
    return `${this.unifiedClient.getProvider()} (${this.modelName})`;
  }

  private convertChatMessages(messages: ChatMessage[]): Message[] {
    return messages.map(msg => {
      if (msg.role === 'function') {
        // Skip function role messages for now as multi-llm-ts doesn't support them
        return new Message('user', msg.content);
      }
      return new Message(msg.role as any, msg.content);
    });
  }

  private mapTemperature(temp: Temperature): number {
    switch (temp) {
      case 'precise': return 0.1;
      case 'balanced': return 0.7;
      case 'creative': return 0.9;
      default: return 0.7;
    }
  }

  async createChatCompletion(messages: ChatMessage[], options: CompletionOptions): Promise<ChatMessage> {
    const model = this.unifiedClient.findModel(this.modelName);
    if (!model) {
      throw new Error(`Model ${this.modelName} not found`);
    }

    const mlMessages = this.convertChatMessages(messages);
    const response = await this.unifiedClient.complete(model, mlMessages);
    
    return {
      role: 'assistant',
      content: response,
      attachedContent: []
    };
  }

  async createJSONCompletion<T>(
    systemPrompt: string,
    userPrompt: string,
    options: CompletionOptions,
  ): Promise<T> {
    const messages = this.unifiedClient.createMessages(systemPrompt, userPrompt);
    const model = this.unifiedClient.findModel(this.modelName);
    if (!model) {
      throw new Error(`Model ${this.modelName} not found`);
    }

    const response = await this.unifiedClient.complete(model, messages);
    return JSON.parse(response);
  }

  async createFunctionCallingCompletion(
    messages: ChatMessage[],
    functions: FunctionDefinition[],
    options: CompletionOptions
  ): Promise<FunctionCall | null> {
    // TODO: Implement function calling when multi-llm-ts supports it
    throw new Error('Function calling not yet implemented in unified client');
  }

  async *createStreamingChatCompletion(
    messages: ChatMessage[],
    options: CompletionOptions,
  ): AsyncGenerator<ChatStreamEvent> {
    const model = this.unifiedClient.findModel(this.modelName);
    if (!model) {
      throw new Error(`Model ${this.modelName} not found`);
    }

    const mlMessages = this.convertChatMessages(messages);
    
    yield { type: 'start' };
    
    for await (const chunk of this.unifiedClient.generate(model, mlMessages)) {
      if (chunk && typeof chunk === 'string') {
        yield { type: 'delta', content: chunk };
      }
    }
    
    yield { 
      type: 'stop',
      temperature: this.mapTemperature(options.temperature)
    };
  }
}