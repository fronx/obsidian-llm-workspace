import { Plugin, type PluginParameter } from 'multi-llm-ts';
import { performSemanticSearch, formatSearchResults } from 'src/rag/semantic-search';
import { get } from 'svelte/store';
import { appStore, pluginStore, isLlmWorkspace } from 'src/utils/obsidian';
import type { NodeSimilarity } from 'src/rag/vectorstore';
import type { EmbeddingClient, QueryEmbedding } from 'src/rag/llm/common';
import { nodeRepresentation } from 'src/rag/node';
import { OpenAI } from 'openai';
import type { Node } from 'src/rag/node';


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
    return 'Search through notes using semantic search. Returns ONLY short previews (150 chars) of matching content, NOT full note content. Users must manually attach notes to share full content.';
  }

  getParameters(): PluginParameter[] {
    return [
      {
        name: 'query',
        type: 'string',
        description: 'The search query to find relevant notes. Note: This will only return short previews (150 chars), not full note content.',
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
