import { Plugin, type PluginParameter } from 'multi-llm-ts';
import { get } from 'svelte/store';
import { appStore } from 'src/utils/obsidian';
import { TFile } from 'obsidian';

/**
 * Obsidian list daily notes plugin
 */
export class ObsidianListDailyNotesPlugin extends Plugin {
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
    return 'list_daily_notes';
  }

  getDescription(): string {
    return 'List all daily notes in the vault, showing their names and paths';
  }

  getParameters(): PluginParameter[] {
    return [
      {
        name: 'limit',
        type: 'number',
        description: 'Maximum number of daily notes to list (default: 30)',
        required: false
      },
      {
        name: 'sort',
        type: 'string',
        description: 'Sort order: "newest" (default) or "oldest"',
        required: false
      }
    ];
  }

  getPreparationDescription(tool: string): string {
    return 'Looking for daily notes...';
  }

  getRunningDescription(tool: string, args: any): string {
    return 'Listing daily notes...';
  }

  async execute(parameters: any): Promise<any> {
    try {
      const app = get(appStore);
      if (!app) {
        throw new Error('Obsidian app not available');
      }

      const limit = parameters.limit || 30;
      const sort = parameters.sort || 'newest';

      // Common daily note patterns
      const datePatterns = [
        /^\d{4}-\d{2}-\d{2}$/,  // YYYY-MM-DD
        /^\d{2}-\d{2}-\d{4}$/,  // MM-DD-YYYY
        /^\d{8}$/,              // YYYYMMDD
        /^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}$/, // Various date formats
      ];

      const files = app.vault.getMarkdownFiles();
      const dailyNotes = files.filter((file: TFile) => {
        // Check if the filename matches any date pattern
        return datePatterns.some(pattern => pattern.test(file.basename));
      });

      // Sort by modification time
      dailyNotes.sort((a: TFile, b: TFile) => {
        if (sort === 'newest') {
          return b.stat.mtime - a.stat.mtime;
        } else {
          return a.stat.mtime - b.stat.mtime;
        }
      });

      const limitedNotes = dailyNotes.slice(0, limit);

      if (limitedNotes.length === 0) {
        return 'No daily notes found in the vault.';
      }

      const noteList = limitedNotes.map((file: TFile) => {
        const modTime = new Date(file.stat.mtime).toLocaleDateString();
        // Use markdown links instead of wiki-style links for better compatibility
        return `[${file.basename}](obsidian://open?path=${encodeURIComponent(file.path)}) - modified ${modTime}`;
      }).join('\n');

      const total = dailyNotes.length;
      const showing = limitedNotes.length;

      let result = `Found ${total} daily notes`;
      if (showing < total) {
        result += `, showing ${showing} (${sort} first)`;
      }
      result += `:\n\n${noteList}`;

      return result;
    } catch (error) {
      return `Error listing daily notes: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }
}