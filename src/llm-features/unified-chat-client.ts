import { Message, Plugin, igniteEngine, loadModels, type Model, type LlmEngine, type LlmChunk } from 'multi-llm-ts';
import type { LlmPluginSettings, ModelConfiguration } from 'src/config/settings';
import type { Provider } from 'src/config/providers';
import type { ChatMessage, ChatStreamEvent, CompletionOptions, StreamingChatCompletionClient, Temperature, FunctionDefinition, FunctionCall } from 'src/rag/llm/common';
import { ObsidianListFilesPlugin } from './plugins/obsidian-list-files-plugin';
import { ObsidianSearchPlugin } from './plugins/obsidian-search-plugin';
import { ObsidianGetNotePlugin } from './plugins/obsidian-get-note-plugin';
import { ObsidianCreateNotePlugin } from './plugins/obsidian-create-note-plugin';
import { ObsidianUpdateNotePlugin } from './plugins/obsidian-update-note-plugin';
import { ObsidianListDailyNotesPlugin } from './plugins/obsidian-list-daily-notes-plugin';
import { ObsidianFindDailyNotePlugin } from './plugins/obsidian-find-daily-note-plugin';

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
   * Add all Obsidian plugins for function calling
   */
  addObsidianPlugins(): void {
    this.addPlugin(new ObsidianSearchPlugin());
    this.addPlugin(new ObsidianGetNotePlugin());
    this.addPlugin(new ObsidianCreateNotePlugin());
    this.addPlugin(new ObsidianUpdateNotePlugin());
    this.addPlugin(new ObsidianListFilesPlugin());
    this.addPlugin(new ObsidianListDailyNotesPlugin());
    this.addPlugin(new ObsidianFindDailyNotePlugin());
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
  async *generate(model: Model, messages: Message[], enableTools: boolean = false) {
    if (!this.llm) {
      throw new Error('Chat client not initialized');
    }

    const opts = enableTools ? { tools: true } : undefined;
    const stream = this.llm.generate(model.id, messages, opts);
    for await (const chunk of stream) {
      yield chunk; // Return the raw chunk, let the adapter handle the types
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

    // Add Obsidian plugins for function calling if enabled
    if (settings.enableFunctionCalling) {
      client.addObsidianPlugins();
    }

    return client;
  }
}

/**
 * Adapter that bridges UnifiedChatClient to the existing StreamingChatCompletionClient interface
 */
export class UnifiedChatClientAdapter implements StreamingChatCompletionClient {
  private toolCallCount: number = 0;
  private awaitingPermission: boolean = false;

  constructor(
    private unifiedClient: UnifiedChatClient,
    private modelName: string,
    private enableFunctionCalling: boolean = false
  ) {}

  get displayName(): string {
    return `${this.unifiedClient.getProvider()} (${this.modelName})`;
  }

  resetToolCallCounter(): void {
    this.toolCallCount = 0;
    this.awaitingPermission = false;
  }

  private async *handleStopToolUsage(options: CompletionOptions): AsyncGenerator<ChatStreamEvent> {
    this.awaitingPermission = false;
    yield { type: 'start' };
    yield { type: 'delta', content: 'Understood. I\'ll stop using tools and provide a summary of what I\'ve found so far.' };
    yield { type: 'stop', temperature: this.mapTemperature(options.temperature) };
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
    // multi-llm-ts handles function calling automatically through plugins
    // so we implement this by checking for tool usage in a non-streaming completion
    const model = this.unifiedClient.findModel(this.modelName);
    if (!model) {
      throw new Error(`Model ${this.modelName} not found`);
    }

    const mlMessages = this.convertChatMessages(messages);
    const response = await this.unifiedClient.complete(model, mlMessages);

    // For now, we don't have direct access to function call info from complete()
    // The function calling happens automatically through the plugin system
    return null;
  }

  async *createStreamingChatCompletion(
    messages: ChatMessage[],
    options: CompletionOptions,
  ): AsyncGenerator<ChatStreamEvent> {
    const model = this.unifiedClient.findModel(this.modelName);
    if (!model) {
      throw new Error(`Model ${this.modelName} not found`);
    }

    // Check if user is responding to permission request
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    if (this.awaitingPermission && lastUserMessage) {
      // Use the model to understand the user's intent
      const interpretationMessages = [
        new Message('system', 'You are analyzing a user response to determine if they want to continue or stop tool usage. Respond with exactly "CONTINUE" if they want to proceed with tool calls, or "STOP" if they want to stop tool usage. Consider any variation of yes/no, continue/stop, proceed/halt, etc.'),
        new Message('user', `User response: "${lastUserMessage.content}"`)
      ];

      const interpretation = await this.unifiedClient.complete(model, interpretationMessages);
      const decision = interpretation.trim().toUpperCase();

      if (decision === 'CONTINUE') {
        // Reset counter and continue with tool calls
        this.toolCallCount = 0;
        this.awaitingPermission = false;
      } else if (decision === 'STOP') {
        yield* this.handleStopToolUsage(options);
        return;
      }
    }

    const mlMessages = this.convertChatMessages(messages);

    yield { type: 'start' };

    for await (const chunk of this.unifiedClient.generate(model, mlMessages, this.enableFunctionCalling)) {
      const llmChunk = chunk as LlmChunk;

      if (llmChunk.type === 'content') {
        yield { type: 'delta', content: llmChunk.text };
      } else if (llmChunk.type === 'tool') {
        // Track tool calls
        if (llmChunk.call) {
          this.toolCallCount++;

          // Check if we've hit the limit
          if (this.toolCallCount > 2) {
            this.awaitingPermission = true;
            yield { type: 'delta', content: '\n\nI\'ve made 2 tool calls so far. Continue with more tool calls?\n\n' };
            yield { type: 'stop', temperature: this.mapTemperature(options.temperature) };
            return;
          }

          const toolInfo = `🔧 Using ${llmChunk.name}(${JSON.stringify(llmChunk.call.params)})\n${llmChunk.call.result}\n\n`;
          yield { type: 'delta', content: toolInfo };
        } else if (llmChunk.status) {
          const statusInfo = `🔧 ${llmChunk.name}: ${llmChunk.status}\n`;
          yield { type: 'delta', content: statusInfo };
        }
      }
      // We could also handle 'usage' type chunks if needed
    }

    yield {
      type: 'stop',
      temperature: this.mapTemperature(options.temperature)
    };
  }
}