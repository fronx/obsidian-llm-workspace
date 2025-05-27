import { Plugin, type PluginParameter } from "multi-llm-ts";
import { get } from "svelte/store";
import { appStore, cachedReadContentWithoutFrontmatter } from "src/utils/obsidian";
import { TFile } from "obsidian";

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
