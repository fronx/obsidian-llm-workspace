import { Plugin, type PluginParameter } from 'multi-llm-ts';
import { get } from 'svelte/store';
import { appStore } from 'src/utils/obsidian';
import { TFile, getFrontMatterInfo } from 'obsidian';


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