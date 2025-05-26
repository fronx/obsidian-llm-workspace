# Streaming Function Calling Technical Design

## Architecture

The implementation uses `multi-llm-ts` to provide a unified interface for multiple LLM providers with consistent streaming and function calling capabilities.

### Core Components

#### UnifiedChatClient

Main class that encapsulates the multi-llm-ts functionality:

```typescript
export class UnifiedChatClient {
  private llm: any;
  private models: any;
  private provider: Provider;

  async initialize(providerId: string, config: any): Promise<ChatModel[]>;
  addPlugin(plugin: Plugin): void;
  async complete(model: ChatModel, messages: Message[]): Promise<string>;
  async *generate(model: ChatModel, messages: Message[]);
  createMessages(systemPrompt: string, userPrompt: string): Message[];
  findModel(modelName: string): ChatModel | undefined;
  getProvider(): Provider;
  
  static async fromSettings(
    settings: LlmPluginSettings, 
    modelConfig: ModelConfiguration
  ): Promise<UnifiedChatClient>;
}
```

#### Function Calling Plugins

Custom plugins extend the `Plugin` class from multi-llm-ts:

```typescript
export class ObsidianPlugin extends Plugin {
  constructor() {
    super([
      {
        name: 'searchNotes',
        description: '...',
        parameters: { ... }
      },
      ...
    ]);
  }

  async searchNotes(params: { query: string }): Promise<string> { ... }
}
```

## API Usage

### Initialization

```typescript
const client = await UnifiedChatClient.fromSettings(
  settings,
  settings.questionAndAnswerModel
);

// Optional: Add function calling capabilities
client.addPlugin(new ObsidianPlugin());
```

### Non-streaming Completion

```typescript
const messages = client.createMessages(
  "You are a helpful assistant.",
  "What is the capital of France?"
);

const model = client.findModel("gpt-4.1-mini-2025-04-14");
const response = await client.complete(model, messages);
```

### Streaming Completion

```typescript
const stream = client.generate(model, messages);
for await (const chunk of stream) {
  if (chunk.type === 'content') {
    // Handle text chunk
    updateUI(chunk.content);
  }
}
```

### Function Calling

```typescript
// Handle function calling in the stream
for await (const chunk of stream) {
  if (chunk.type === 'tool') {
    // LLM has called a function
    console.log(`Tool: ${chunk.tool}, Args: ${JSON.stringify(chunk.args)}`);
    
    // For UI, show the function call is happening
    updateUI(`[Searching for "${chunk.args.query}"...]`);
  } else if (chunk.type === 'content') {
    // Regular text content
    updateUI(chunk.content);
  }
}
```

## Provider Support

The implementation supports:

1. **OpenAI**: Uses the 'openai' provider ID with OpenAI API key
2. **Anthropic**: Uses the 'anthropic' provider ID with Anthropic API key
3. **Ollama**: Uses the 'ollama' provider ID with base URL configuration

## Migration Plan

1. **Phase 1**: Implement the new `UnifiedChatClient` and example plugins
2. **Phase 2**: Integrate with one UI component (e.g., QuestionAndAnswer)
3. **Phase 3**: Extend to other UI components and add more plugins
4. **Phase 4**: Remove old provider-specific implementations