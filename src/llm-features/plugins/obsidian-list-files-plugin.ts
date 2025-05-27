import { Plugin, type PluginParameter } from 'multi-llm-ts';
import { get } from 'svelte/store';
import { appStore } from 'src/utils/obsidian';
import { TFile } from 'obsidian';

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