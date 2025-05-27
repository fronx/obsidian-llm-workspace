import { Plugin, type PluginParameter } from 'multi-llm-ts';
import { get } from 'svelte/store';
import { appStore } from 'src/utils/obsidian';

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