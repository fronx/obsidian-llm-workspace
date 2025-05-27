import { Plugin, type PluginParameter } from 'multi-llm-ts';
import { get } from 'svelte/store';
import { appStore, cachedReadContentWithoutFrontmatter } from 'src/utils/obsidian';

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
        const content = await cachedReadContentWithoutFrontmatter(app.vault, file);
        return `Found daily note "${file.basename}":\n\n${content}`;
      }

      return `No daily note found for ${dateStr}`;
    } catch (error) {
      return `Error finding daily note: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }
}