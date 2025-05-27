import { Message, Plugin, igniteEngine, loadModels, type Model, type LlmEngine, type PluginParameter, type LlmChunk } from 'multi-llm-ts';
import type { LlmPluginSettings, ModelConfiguration } from '../config/settings';
import type { Provider } from '../config/providers';
import type { ChatMessage, ChatStreamEvent, CompletionOptions, StreamingChatCompletionClient, Temperature, FunctionDefinition, FunctionCall } from '../rag/llm/common';
import { TFile, getFrontMatterInfo } from 'obsidian';
import { appStore, pluginStore, cachedReadContentWithoutFrontmatter } from '../utils/obsidian';
import { get } from 'svelte/store';
import { performSemanticSearch, formatSearchResults } from '../rag/semantic-search';
import { isLlmWorkspace } from '../utils/obsidian';
import OpenAI from 'openai';
import type { EmbeddingClient, QueryEmbedding } from '../rag/llm/common';
import type { Node } from '../rag/node';
import { nodeRepresentation } from '../rag/node';
import type { NodeSimilarity } from '../rag/vectorstore';

/**
 * Apply smart cutoff to search results based on similarity score distribution
 * Returns results that are within the 80th percentile of the best match
 * and have at least 30% similarity
 */
function applySmartCutoff(nodes: NodeSimilarity[], maxNodes: number): NodeSimilarity[] {
  if (nodes.length === 0) return [];

  // Sort by similarity (highest first)
  const sorted = [...nodes].sort((a, b) => b.similarity - a.similarity);

  // Apply minimum relevance threshold of 30%
  const minRelevance = 0.3;
  let filtered = sorted.filter(node => node.similarity >= minRelevance);

  // If we have fewer nodes than the max after minimum filtering, return all
  if (filtered.length <= maxNodes) return filtered;

  // Calculate the 80th percentile threshold
  // The best match has the highest similarity
  const bestSimilarity = filtered[0].similarity;
  const percentileThreshold = bestSimilarity * 0.8; // 80% of the best match

  // Apply the more restrictive threshold
  const threshold = Math.max(percentileThreshold, minRelevance);
  filtered = filtered.filter(node => node.similarity >= threshold);

  // Return up to maxNodes results
  return filtered.slice(0, maxNodes);
}

/**
 * Minimal embedding client that skips query improvement for tool-based search
 */
class SimpleEmbeddingClient implements EmbeddingClient {
  private openaiClient: OpenAI;
  private embeddingModel: string;

  constructor(apiKey: string, embeddingModel: string) {
    this.openaiClient = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
    this.embeddingModel = embeddingModel;
  }

  async embedNode(node: Node): Promise<number[]> {
    const response = await this.openaiClient.embeddings.create({
      input: nodeRepresentation(node),
      model: this.embeddingModel,
    });
    return response.data[0].embedding;
  }

  async embedQuery(query: string): Promise<QueryEmbedding> {
    const response = await this.openaiClient.embeddings.create({
      input: query,
      model: this.embeddingModel,
    });
    return {
      originalQuery: query,
      improvedQuery: query, // No improvement, just use original
      embedding: response.data[0].embedding,
    };
  }
}

/**
 * Obsidian search functionality plugin
 */
export class ObsidianSearchPlugin extends Plugin {
  constructor() {
    super();
  }

  isEnabled(): boolean {
    return true;
  }

  serializeInTools(): boolean {
    return true;
  }

  getName(): string {
    return 'search_notes';
  }

  getDescription(): string {
    return 'Search through notes using semantic search (finds conceptually similar content)';
  }

  getParameters(): PluginParameter[] {
    return [
      {
        name: 'query',
        type: 'string',
        description: 'The search query to find relevant notes',
        required: true
      }
    ];
  }

  getPreparationDescription(tool: string): string {
    return 'Preparing to search notes...';
  }

  getRunningDescription(tool: string, args: any): string {
    return 'Searching through notes...';
  }

  async execute(parameters: any): Promise<any> {
    try {
      const app = get(appStore);
      const plugin = get(pluginStore);

      if (!app) {
        throw new Error('Obsidian app not available');
      }
      if (!plugin || !plugin.db) {
        throw new Error('Plugin database not available');
      }

      // Create simple embedding client (only OpenAI supported for now)
      const settings = plugin.settings;
      const modelConfig = settings.embeddingModel;

      if (modelConfig.provider !== "OpenAI") {
        return `Semantic search currently only supports OpenAI embeddings. Please configure OpenAI in settings.`;
      }

      const embedding = new SimpleEmbeddingClient(
        settings.providerSettings.openai.apiKey,
        modelConfig.model
      );

      const query = parameters.query;
      if (!query) {
        throw new Error('Query parameter is required');
      }

      // Find all workspace files
      const files = app.vault.getMarkdownFiles();
      const workspaceFiles = files.filter(file => {
        const metadata = app.metadataCache.getFileCache(file);
        return isLlmWorkspace(metadata);
      });

      if (workspaceFiles.length === 0) {
        return `No LLM workspaces found. Please create a workspace note first.`;
      }

      // Use the first workspace for semantic search
      const workspaceFile = workspaceFiles[0];

      const searchResult = await performSemanticSearch(
        query,
        workspaceFile.path,
        plugin.db,
        embedding,
        settings.retrievedNodeCount * 2 // Get more candidates for filtering
      );

      // Apply smart cutoff based on similarity scores
      const nodes = applySmartCutoff(searchResult.nodes, settings.retrievedNodeCount);

      return formatSearchResults(nodes);
    } catch (error) {
      return `Error searching notes: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }
}

/**
 * Obsidian note content retrieval plugin
 */
export class ObsidianGetNotePlugin extends Plugin {
  constructor() {
    super();
  }

  isEnabled(): boolean {
    return true;
  }

  serializeInTools(): boolean {
    return true;
  }

  getName(): string {
    return 'get_note_content';
  }

  getDescription(): string {
    return 'Get the content of a specific note by its path or name';
  }

  getParameters(): PluginParameter[] {
    return [
      {
        name: 'path',
        type: 'string',
        description: 'The path or name of the note to retrieve',
        required: true
      }
    ];
  }

  getPreparationDescription(tool: string): string {
    return 'Preparing to read note...';
  }

  getRunningDescription(tool: string, args: any): string {
    return 'Reading note content...';
  }

  async execute(parameters: any): Promise<any> {
    try {
      const app = get(appStore);
      if (!app) {
        throw new Error('Obsidian app not available');
      }

      const path = parameters.path;
      if (!path) {
        throw new Error('Path parameter is required');
      }

      // Try to find the file by exact path first
      let file = app.vault.getAbstractFileByPath(path);

      // If not found by path, try to find by name
      if (!file) {
        const files = app.vault.getMarkdownFiles();
        file = files.find((f: TFile) =>
          f.basename === path ||
          f.name === path ||
          f.path === path
        ) || null;
      }

      if (!file || !(file instanceof TFile)) {
        return `Note not found: "${path}"`;
      }

      const content = await cachedReadContentWithoutFrontmatter(app.vault, file);
      return `Content of "${file.basename}":\n\n${content}`;
    } catch (error) {
      return `Error reading note: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }
}

/**
 * Obsidian note creation plugin
 */
export class ObsidianCreateNotePlugin extends Plugin {
  constructor() {
    super();
  }

  isEnabled(): boolean {
    return true;
  }

  serializeInTools(): boolean {
    return true;
  }

  getName(): string {
    return 'create_note';
  }

  getDescription(): string {
    return 'Create a new note with the specified name and content';
  }

  getParameters(): PluginParameter[] {
    return [
      {
        name: 'name',
        type: 'string',
        description: 'The name of the new note',
        required: true
      },
      {
        name: 'content',
        type: 'string',
        description: 'The content to write to the new note',
        required: false
      },
      {
        name: 'folder',
        type: 'string',
        description: 'The folder to create the note in (optional)',
        required: false
      }
    ];
  }

  getPreparationDescription(tool: string): string {
    return 'Preparing to create note...';
  }

  getRunningDescription(tool: string, args: any): string {
    return 'Creating new note...';
  }

  async execute(parameters: any): Promise<any> {
    try {
      const app = get(appStore);
      if (!app) {
        throw new Error('Obsidian app not available');
      }

      const name = parameters.name;
      if (!name) {
        throw new Error('Name parameter is required');
      }

      let path = name;
      if (!path.endsWith('.md')) {
        path += '.md';
      }

      if (parameters.folder) {
        path = `${parameters.folder}/${path}`;
      }

      // Check if file already exists
      const existingFile = app.vault.getAbstractFileByPath(path);
      if (existingFile) {
        return `Note "${path}" already exists`;
      }

      const content = parameters.content || '';
      const file = await app.vault.create(path, content);

      return `Created note "${file.basename}" at ${file.path}`;
    } catch (error) {
      return `Error creating note: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }
}

/**
 * Obsidian update note plugin
 */
export class ObsidianUpdateNotePlugin extends Plugin {
  constructor() {
    super();
  }

  isEnabled(): boolean {
    return true;
  }

  serializeInTools(): boolean {
    return true;
  }

  getName(): string {
    return 'update_note';
  }

  getDescription(): string {
    return 'Update the content of an existing note by appending, prepending, or replacing content';
  }

  getParameters(): PluginParameter[] {
    return [
      {
        name: 'path',
        type: 'string',
        description: 'The path or name of the note to update',
        required: true
      },
      {
        name: 'content',
        type: 'string',
        description: 'The content to add or use for replacement',
        required: true
      },
      {
        name: 'mode',
        type: 'string',
        description: 'How to update the note: "append" (add to end), "prepend" (add to beginning), or "replace" (replace entire content)',
        required: false
      }
    ];
  }

  getPreparationDescription(tool: string): string {
    return 'Preparing to update note...';
  }

  getRunningDescription(tool: string, args: any): string {
    return 'Updating note content...';
  }

  async execute(parameters: any): Promise<any> {
    try {
      const app = get(appStore);
      if (!app) {
        throw new Error('Obsidian app not available');
      }

      const path = parameters.path;
      if (!path) {
        throw new Error('Path parameter is required');
      }

      const content = parameters.content;
      if (content === undefined || content === null) {
        throw new Error('Content parameter is required');
      }

      const mode = parameters.mode || 'append';
      if (!['append', 'prepend', 'replace'].includes(mode)) {
        throw new Error('Mode must be "append", "prepend", or "replace"');
      }

      // Try to find the file by exact path first
      let file = app.vault.getAbstractFileByPath(path);

      // If not found by path, try to find by name
      if (!file) {
        const files = app.vault.getMarkdownFiles();
        file = files.find((f: TFile) =>
          f.basename === path ||
          f.name === path ||
          f.path === path
        ) || null;
      }

      if (!file || !(file instanceof TFile)) {
        return `Note not found: "${path}"`;
      }

      // Read current content
      const currentContent = await app.vault.read(file);

      // Parse frontmatter info
      const { contentStart, exists: hasFrontmatter } = getFrontMatterInfo(currentContent);

      // Separate frontmatter and content
      const frontmatter = hasFrontmatter ? currentContent.slice(0, contentStart) : '';
      const mainContent = currentContent.slice(contentStart);

      // Update content based on mode (only modify the main content, not frontmatter)
      let newMainContent: string;
      switch (mode) {
        case 'append':
          newMainContent = mainContent + (mainContent.endsWith('\n') ? '' : '\n') + content;
          break;
        case 'prepend':
          newMainContent = content + (content.endsWith('\n') ? '' : '\n') + mainContent;
          break;
        case 'replace':
          newMainContent = content;
          break;
        default:
          throw new Error(`Invalid mode: ${mode}`);
      }

      // Combine frontmatter with updated content
      const newContent = frontmatter + newMainContent;

      // Write updated content
      await app.vault.modify(file, newContent);

      return `Updated note "${file.basename}" (${mode} mode)`;
    } catch (error) {
      return `Error updating note: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }
}

/**
 * Obsidian list files plugin
 */
export class ObsidianListFilesPlugin extends Plugin {
  constructor() {
    super();
  }

  isEnabled(): boolean {
    return true;
  }

  serializeInTools(): boolean {
    return true;
  }

  getName(): string {
    return 'list_files';
  }

  getDescription(): string {
    return 'List markdown files in the vault or a specific folder';
  }

  getParameters(): PluginParameter[] {
    return [
      {
        name: 'folder',
        type: 'string',
        description: 'The folder to list files from (optional, lists all if not specified)',
        required: false
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Maximum number of files to list (default: 20)',
        required: false
      }
    ];
  }

  getPreparationDescription(tool: string): string {
    return 'Preparing to list files...';
  }

  getRunningDescription(tool: string, args: any): string {
    return 'Listing files...';
  }

  async execute(parameters: any): Promise<any> {
    try {
      const app = get(appStore);
      if (!app) {
        throw new Error('Obsidian app not available');
      }

      const limit = parameters.limit || 20;
      let files = app.vault.getMarkdownFiles();

      if (parameters.folder) {
        files = files.filter((file: TFile) => file.path.startsWith(parameters.folder!));
      }

      files = files.slice(0, limit);

      if (files.length === 0) {
        return parameters.folder
          ? `No files found in folder "${parameters.folder}"`
          : 'No markdown files found in vault';
      }

      const fileList = files.map((file: TFile) => `📄 ${file.basename} (${file.path})`).join('\n');
      const total = app.vault.getMarkdownFiles().length;
      const showing = files.length;

      return `Showing ${showing} of ${total} files:\n${fileList}`;
    } catch (error) {
      return `Error listing files: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }
}

/**
 * Obsidian find daily note plugin
 */
export class ObsidianFindDailyNotePlugin extends Plugin {
  constructor() {
    super();
  }

  isEnabled(): boolean {
    return true;
  }

  serializeInTools(): boolean {
    return true;
  }

  getName(): string {
    return 'find_daily_note';
  }

  getDescription(): string {
    return 'Find a daily note for a specific date. Automatically detects common daily note naming patterns.';
  }

  getParameters(): PluginParameter[] {
    return [
      {
        name: 'date',
        type: 'string',
        description: 'Date in YYYY-MM-DD format (e.g., "2025-05-27"). Use "today" for current date.',
        required: true
      }
    ];
  }

  getPreparationDescription(tool: string): string {
    return 'Looking for daily note...';
  }

  getRunningDescription(tool: string, args: any): string {
    return 'Finding daily note...';
  }

  async execute(parameters: any): Promise<any> {
    try {
      const app = get(appStore);
      if (!app) {
        throw new Error('Obsidian app not available');
      }

      let dateStr = parameters.date;
      if (dateStr === 'today') {
        dateStr = new Date().toISOString().split('T')[0];
      }

      const files = app.vault.getMarkdownFiles();
      const file = files.find(f => f.basename === dateStr);

      if (file) {
        const content = await app.vault.read(file);
        return `Found daily note "${file.basename}":\n\n${content}`;
      }

      return `No daily note found for ${dateStr}`;
    } catch (error) {
      return `Error finding daily note: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
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
   * Add all Obsidian plugins for function calling
   */
  addObsidianPlugins(): void {
    this.addPlugin(new ObsidianSearchPlugin());
    this.addPlugin(new ObsidianGetNotePlugin());
    this.addPlugin(new ObsidianCreateNotePlugin());
    this.addPlugin(new ObsidianUpdateNotePlugin());
    this.addPlugin(new ObsidianListFilesPlugin());
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
  constructor(
    private unifiedClient: UnifiedChatClient,
    private modelName: string,
    private enableFunctionCalling: boolean = false
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

    const mlMessages = this.convertChatMessages(messages);

    yield { type: 'start' };

    for await (const chunk of this.unifiedClient.generate(model, mlMessages, this.enableFunctionCalling)) {
      const llmChunk = chunk as LlmChunk;

      if (llmChunk.type === 'content') {
        yield { type: 'delta', content: llmChunk.text };
      } else if (llmChunk.type === 'tool') {
        // Handle tool calls by yielding them as content for now
        // This allows users to see what functions are being called
        if (llmChunk.call) {
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