# Unified Streaming and Function Calling Design

## Overview

This document outlines the design for migrating to `multi-llm-ts` to create a unified interface for chat completion, streaming, and function calling across multiple LLM backends.

## Key Components

1. **UnifiedChatClient**: The main class that provides a consistent interface for different LLM providers
2. **ObsidianPlugin**: A function calling plugin that allows models to interact with Obsidian notes

## Example Usage

Here's a simple example of how to use the new `UnifiedChatClient`:

```typescript
import { UnifiedChatClient, ObsidianPlugin } from '../src/llm-features/unified-chat-client';
import { Message } from 'multi-llm-ts';

// Initialize chat client from settings
const client = await UnifiedChatClient.fromSettings(
  plugin.settings,
  plugin.settings.questionAndAnswerModel
);

// Add function calling capabilities
client.addPlugin(new ObsidianPlugin());

// Create messages
const messages = [
  new Message('system', 'You are an assistant that helps with searching and retrieving information from Obsidian notes.'),
  new Message('user', 'Find notes related to machine learning')
];

// Find the model to use
const model = client.findModel(plugin.settings.questionAndAnswerModel.model);
if (!model) {
  throw new Error(`Model ${plugin.settings.questionAndAnswerModel.model} not found`);
}

// Stream the response
const stream = client.generate(model, messages);
for await (const chunk of stream) {
  if (chunk.type === 'content') {
    // Handle regular text content
    console.log(chunk.content);
  } else if (chunk.type === 'tool') {
    // Handle function calling events
    console.log(`Tool called: ${chunk.tool}`);
    console.log(`Arguments: ${JSON.stringify(chunk.args)}`);
  }
}
```

## Migration Strategy

1. Start by implementing the new client alongside the existing code
2. Gradually replace calls very close to the UI components
3. Avoid creating adapters for existing code - prefer direct replacement

## Benefits

- **Unified API**: Consistent interface across different LLM providers
- **Simplified Streaming**: Easy-to-use streaming API
- **Function Calling**: Standardized approach to function calling across providers
- **Flexibility**: Support for multiple providers without provider-specific code