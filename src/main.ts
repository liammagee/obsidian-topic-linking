import { Plugin, 
    TFile, 
    normalizePath, } from 'obsidian';

// Internal imports
import { TopicLinkingSettings, TopicLinkingSettingTab, DEFAULT_SETTINGS } from './settings';
import { PDFContentExtractor } from './pdf';
import { BookmarkContentExtractor } from './bookmark';
import { TopicLinker } from './topic';
import { BibtexParser } from './bibtex';
import { CiteprocFactory } from './citeproc';
import { formatBibtexAsMetadata } from './utils';

export default class TopicLinkingPlugin extends Plugin {
    settings: TopicLinkingSettings;
    metadata: Record<string, any>;
    citeproc: CSLGenerator;

    async onload() {
        await this.loadSettings();

        // This adds a status bar item to the bottom of the app. Does not work on mobile apps.
        const statusBarItemEl = this.addStatusBarItem();

        let metadata = {};
        if (this.settings.bibPath.trim() !== '') {
            metadata = await new BibtexParser().parse(this.app, this.settings);
        }
        let factory = new CiteprocFactory();
        await factory.initEngine(metadata, this.settings);
        let styles = await factory.wrapper.getStyles();

        // This command generates citeproc content
        this.addCommand({
            id: 'make-bibliography',
            name: 'Make Bibliography',
            hotkeys: [{ modifiers: ["Mod", "Shift"], key: "a" }],
            callback: async () => {

                if (this.settings.bibPath.trim() === '') {
                    console.log('Must specific bibliography path');
                    return;
                }

                const { vault } = this.app;

                const keys = Object.keys(metadata);
                let bibliography = '# Bibliography\n\n';
                for (let key in metadata) {
                    let itemMeta = metadata[key];
                    let bibtex = '---';
                    bibtex += formatBibtexAsMetadata(itemMeta);
                    bibtex += '\n---\n';
                    const bib : string = factory.makeBibliography([key]);
                    bibtex += bib;

                    bibliography += `[[${key}]]\n`;
                    bibliography += `${bib}\n\n`;
                    const fileName: string = normalizePath(`Bibliography/${key}.md`);
                    const newFile = <TFile> vault.getAbstractFileByPath(fileName);
                    if (newFile !== null)
                        await vault.modify(newFile, bibtex);
                    else
                        await vault.create(fileName, bibtex);
                }   

                const bibFileName: string = normalizePath(`Bibliography/bibliography.md`);
                const bibFile = <TFile> vault.getAbstractFileByPath(bibFileName);
                if (bibFile !== null)
                    await vault.modify(bibFile, bibliography);
                else
                    await vault.create(bibFileName, bibliography);

            }
        });

        // This command extracts PDFs to Markdown
        this.addCommand({
            id: 'extract-md-from-pdfs-command',
            name: 'Extract Markdown from PDFs',
            // hotkeys: [{ modifiers: ["Mod", "Shift"], key: "a" }],
            callback: async () => {

                const { vault } = this.app;

                new PDFContentExtractor().extract(vault, this.settings, statusBarItemEl, metadata, factory);

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

