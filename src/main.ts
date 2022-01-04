import { Plugin } from 'obsidian';

// Internal imports
import { TopicLinkingSettings, TopicLinkingSettingTab, DEFAULT_SETTINGS } from './settings';
import { PDFContentExtractor } from './pdf';
import { BookmarkContentExtractor } from './bookmark';
import { TopicLinker } from './topic';

export default class TopicLinkingPlugin extends Plugin {
    settings: TopicLinkingSettings;

    async onload() {
        await this.loadSettings();

        // This adds a status bar item to the bottom of the app. Does not work on mobile apps.
        const statusBarItemEl = this.addStatusBarItem();

        // This command extracts PDFs to Markdown
        this.addCommand({
            id: 'extract-pdf-command',
            name: 'Extract PDF',
            hotkeys: [{ modifiers: ["Mod", "Shift"], key: "a" }],
            callback: async () => {

                const { vault } = this.app;

                new PDFContentExtractor().extract(vault, this.settings, statusBarItemEl);

            }
        });

        this.addCommand({
            id: 'extract-from-bookmarks-command',
            name: 'Extract from Bookmarks',
            hotkeys: [{ modifiers: ["Mod", "Shift"], key: "x" }],
            callback: async () => {

                const { vault } = this.app;

                new BookmarkContentExtractor().extract(vault, this.settings, statusBarItemEl);

            }
        });

        // Generates topics and links to associated documents
        this.addCommand({
            id: 'link-topics-command',
            name: 'Link Topics',
            hotkeys: [{ modifiers: ["Mod", "Shift"], key: "z" }],
            callback: async () => {

                new TopicLinker().link(this.app, this.settings, statusBarItemEl);
            }
        });

        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(new TopicLinkingSettingTab(this.app, this));

	}

    onunload() {
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

