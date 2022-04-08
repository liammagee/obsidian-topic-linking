import { Vault, Plugin, TFile, normalizePath, } from 'obsidian';

// Internal imports
import { TopicLinkingSettings, TopicLinkingSettingTab, DEFAULT_SETTINGS } from './settings';
import { PDFContentExtractor } from './pdf';
import { BookmarkContentExtractor } from './bookmark';
import { TopicLinker } from './topic';
import { BibtexParser } from './bibtex';
import { CiteprocFactory, createBibliography } from './bibliography';

export default class TopicLinkingPlugin extends Plugin {
    settings: TopicLinkingSettings;

    async onload() {
        await this.loadSettings();

        // This adds a status bar item to the bottom of the app. Does not work on mobile apps.
        const statusBarItemEl = this.addStatusBarItem();

        let metadataBibtex : any = {}, metadataCSL = {};
        let bibtexParser = new BibtexParser();
        if (this.settings.bibtexPath.trim() !== '') {
            metadataBibtex = await bibtexParser.parseBibtexJSON(this.app, this.settings);
            metadataCSL = bibtexParser.convertToCSLJSON(metadataBibtex);
        }
        let factory = new CiteprocFactory();
        await factory.initEngine(metadataCSL, this.settings);
        const styles = await factory.wrapper.getStyles();

        // This command extracts PDFs to Markdown
        this.addCommand({
            id: 'extract-md-from-pdfs-command',
            name: 'Extract Markdown from PDFs',
            hotkeys: [{ modifiers: ["Mod", "Shift"], key: "a" }],
            callback: async () => {

                const { vault } = this.app;

                new PDFContentExtractor().extract(vault, this.settings, statusBarItemEl, metadataBibtex, factory);

            }
        });

        // This command generates citeproc content
        this.addCommand({
            id: 'make-bibliography',
            name: 'Make Bibliography',
            callback: async () => {

                if (this.settings.bibtexPath.trim() === '') {
                    console.log('Must specific bibliography path');
                    return;
                }

                const { vault } = this.app;

                // Reload the CSL engine, in case the metadata has updated
                await createBibliography(vault, this.settings);

            }
        });

        // This command extracts PDFs to Markdown
        this.addCommand({
            id: 'extract-md-from-pdfs-command',
            name: 'Extract Markdown from PDFs',
            // hotkeys: [{ modifiers: ["Mod", "Shift"], key: "a" }],
            callback: async () => {

                const { vault } = this.app;
                console.time('pdfProcessing')
                await new PDFContentExtractor().extract(vault, this.settings, statusBarItemEl, metadataBibtex, factory);
                
                console.timeEnd('pdfProcessing')

            }
        });

        this.addCommand({
            id: 'extract-md-from-bookmarks-command',
            name: 'Extract Markdown from Bookmarks',
            // hotkeys: [{ modifiers: ["Mod", "Shift"], key: "b" }],
            callback: async () => {

                const { vault } = this.app;

                new BookmarkContentExtractor().extract(vault, this.settings, statusBarItemEl);

            }
        });

        // Generates topics and links to associated documents
        this.addCommand({
            id: 'link-topics-command',
            name: 'Link Topics',
            // hotkeys: [{ modifiers: ["Mod", "Shift"], key: "s" }],
            callback: async () => {

                new TopicLinker().link(this.app, this.settings, statusBarItemEl);
            }
        });

        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(new TopicLinkingSettingTab(this.app, this, styles));

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


