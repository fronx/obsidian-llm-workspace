import type { EmbeddingClient } from "./llm/common"
import type { NodeSimilarity } from "./vectorstore"
import { VectorStoreIndex } from "./vectorstore"
import type { LlmDexie } from "../storage/db"
import type { FilePath } from "../utils/obsidian"
import { EmbeddingVectorRetriever } from "./retriever"

export interface SemanticSearchResult {
    nodes: NodeSimilarity[]
    improvedQuery: string
}

/**
 * Performs semantic search across indexed notes in a workspace
 * Used by ObsidianSearchPlugin for semantic note search
 */
export async function performSemanticSearch(
    query: string,
    workspaceFilePath: FilePath,
    db: LlmDexie,
    embeddingClient: EmbeddingClient,
    limit: number = 10
): Promise<SemanticSearchResult> {
    const vectorStoreIndex = new VectorStoreIndex(db);
    const retriever = new EmbeddingVectorRetriever(
        vectorStoreIndex,
        embeddingClient,
        { limit }
    );
    
    const result = await retriever.retrieve(query, workspaceFilePath);
    
    return {
        nodes: result.nodes,
        improvedQuery: result.improvedQuery
    };
}

/**
 * Format search results for display with clickable links
 */
export function formatSearchResults(nodes: NodeSimilarity[]): string {
    if (nodes.length === 0) {
        return "No relevant notes found."
    }
    
    // Group results by file to show chunk information
    const fileGroups = new Map<string, NodeSimilarity[]>()
    nodes.forEach(node => {
        const filePath = node.node.parent
        if (!fileGroups.has(filePath)) {
            fileGroups.set(filePath, [])
        }
        fileGroups.get(filePath)!.push(node)
    })
    
    const results = nodes
        .map((node, index) => {
            const filePath = node.node.parent
            const fileName = filePath.split('/').pop()?.replace('.md', '') || filePath
            const similarity = (node.similarity * 100).toFixed(1)
            
            // Format as Obsidian link
            const link = `[[${filePath}|${fileName}]]`
            
            // Include chunk information if multiple chunks from same file
            const chunks = fileGroups.get(filePath)!
            const chunkInfo = chunks.length > 1 
                ? ` (chunk ${chunks.indexOf(node) + 1} of ${chunks.length} from this note)`
                : ''
            
            // Include the full chunk content
            const content = node.node.content.trim()
            
            return `${index + 1}. ${link} (${similarity}% match)${chunkInfo}\n   ${content}`
        })
        .join('\n\n')
    
    return `Found ${nodes.length} relevant chunks across ${fileGroups.size} notes:\n\n${results}`
}

