import {
    App,
    Modal,
    PluginSettingTab,
    Setting,
    ToggleComponent,
  } from 'obsidian';
  
import TopicLinkingPlugin from './main';

export interface TopicLinkingSettings {
    pdfOverwrite: boolean;
    pdfExtractFileNumberLimit: number;
    pdfExtractFileSizeLimit: number;
    bookmarkOverwrite: boolean;
    topicPathPattern: string;
    numTopics: number;
    numWords: number;
    stemming: boolean;
    topicThreshold: number;
    fixedWordLength: number;
    percentageTextToScan: number;
    wordSelectionRandom: boolean;
    topicIncludePattern: boolean;
    topicIncludeTimestamp: boolean;
    ldaIterations: number;
    ldaBurnIn: number;
    ldaThin: number;
    bookmarks: Object;
}

export const DEFAULT_SETTINGS: TopicLinkingSettings = {
    pdfOverwrite: false,
    pdfExtractFileNumberLimit: 0,
    pdfExtractFileSizeLimit: 0,
    bookmarkOverwrite: false,
    topicPathPattern: 'Generated/',
    numTopics: 5,
    numWords: 5,
    stemming: false,
    topicThreshold: 0.5,
    fixedWordLength: 1000,
    percentageTextToScan: 5,
    wordSelectionRandom: false,
    topicIncludePattern: false,
    topicIncludeTimestamp: false,
    ldaIterations: 1000,
    ldaBurnIn: 100,
    ldaThin: 10,
    bookmarks: {}
}

export class TopicLinkingSettingTab extends PluginSettingTab {
    plugin: TopicLinkingPlugin;

    constructor(app: App, plugin: TopicLinkingPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: 'Topic Link Plugin' });

        containerEl.createEl('h3', { text: 'PDF Extraction Settings' });
        new Setting(containerEl)
            .setName('Overwrite')
            .setDesc('Overwrite Markdown file if it already exists')
            .addToggle((toggle) => {
                // toggle.inputEl.setAttribute("type", "boolean");
                toggle.setValue(this.plugin.settings.pdfOverwrite)
                    .onChange(async (value) => {
                        this.plugin.settings.pdfOverwrite = value;
                        await await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Limit file number')
            .setDesc('Enter the number of files to limit PDF extraction (use when \'PDF Overwrite\' is false). \'0\' means no limit.')
            .addText((text) => {
                text.inputEl.setAttribute("type", "number");
                text.setPlaceholder('0-100')
                    .setValue(this.plugin.settings.pdfExtractFileNumberLimit.toString())
                    .onChange(async (value : string) => {
                        this.plugin.settings.pdfExtractFileNumberLimit = Math.min(Math.max(parseInt(value), 0), 1000);
                        await await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Limit file size')
            .setDesc('Enter the maximum file size (in KB) to process (0 means any size).')
            .addText((text) => {
                text.inputEl.setAttribute("type", "number");
                text.setPlaceholder('0-100000')
                    .setValue(this.plugin.settings.pdfExtractFileSizeLimit.toString())
                    .onChange(async (value : string) => {
                        this.plugin.settings.pdfExtractFileSizeLimit = Math.min(Math.max(parseInt(value), 0), 100000);
                        await await this.plugin.saveSettings();
                    });
            });

        containerEl.createEl('h3', { text: 'Bookmark Extraction Settings' });
        new Setting(containerEl)
            .setName('Overwrite')
            .setDesc('Overwrite Markdown file if it already exists')
            .addToggle((toggle) => {
                // toggle.inputEl.setAttribute("type", "boolean");
                toggle.setValue(this.plugin.settings.bookmarkOverwrite)
                    .onChange(async (value) => {
                        this.plugin.settings.bookmarkOverwrite = value;
                        await await this.plugin.saveSettings();
                    });
            });

        containerEl.createEl('h3', { text: 'Topic Linking Settings' });
        containerEl.createEl('h4', { text: 'General Parameters' });

        new Setting(containerEl)
            .setName('Topc extraction file match')
            .setDesc('Enter a pattern to match Markdown files for topic extraction.')
            .addText((text) => {
                text.setPlaceholder('Genenerated/')
                    .setValue(this.plugin.settings.topicPathPattern.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.topicPathPattern = value;
                        await await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Number of topics')
            .setDesc('Enter the number of topics to generate.')
            .addText((text) => {
                text.inputEl.setAttribute("type", "number");
                text.setPlaceholder('1-10')
                    .setValue(this.plugin.settings.numTopics.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.numTopics = Math.min(Math.max(parseInt(value), 1), 10);
                        await await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Number of words')
            .setDesc('Enter the number of words per topic to capture.')
            .addText((text) => {
                text.inputEl.setAttribute("type", "number");
                text.setPlaceholder('1-20')
                    .setValue(this.plugin.settings.numWords.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.numWords = Math.min(Math.max(parseInt(value), 1), 20);
                        await await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Stemming')
            .setDesc('Select whether tokens should be stemmed before analysis.')
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.stemming)
                    .onChange(async (value) => {
                        this.plugin.settings.stemming = value;
                        await await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Topic threshold')
            .setDesc('Enter the threshold (between 0 and 1) for a document to be relevant to a topic')
            .addText((text) => {
                text.inputEl.setAttribute("type", "number");
                text.setPlaceholder('0.0-1.0')
                    .setValue(this.plugin.settings.topicThreshold.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.topicThreshold = Math.min(Math.max(parseFloat(value), 0), 1);
                        await await this.plugin.saveSettings();
                    });
            });

        containerEl.createEl('h4', { text: 'Source Text Filtering' });

        new Setting(containerEl)
            .setName('Fixed Number of Words')
            .setDesc('Enter the number of words to extract from the text. Overrides \'Percentage of Total Text\' below.')
            .addText((text) => {
                text.inputEl.setAttribute("type", "number");
                text.setPlaceholder('0-5000')
                    .setValue(this.plugin.settings.fixedWordLength.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.fixedWordLength = Math.min(Math.max(parseInt(value), 0), 5000);
                        await await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Percentage of Total Text')
            .setDesc('Enter the percentage of the total text to scan. ')
            .addText((text) => {
                text.inputEl.setAttribute("type", "number");
                text.setPlaceholder('1-100')
                    .setValue(this.plugin.settings.percentageTextToScan.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.percentageTextToScan = Math.min(Math.max(parseInt(value), 1), 100);
                        await await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Randomise text')
            .setDesc('Select whether the text selection should be randomised ("false" means the text is scanned from the beginning).')
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.wordSelectionRandom)
                    .onChange(async (value) => {
                        this.plugin.settings.wordSelectionRandom = value;
                        await await this.plugin.saveSettings();
                    });
            });

        containerEl.createEl('h4', { text: 'Topic Folder Naming' });
        new Setting(containerEl)
            .setName('Topic folder pattern')
            .setDesc('Select whether the topic folder should include the Markdown search pattern.')
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.topicIncludePattern)
                    .onChange(async (value) => {
                        this.plugin.settings.topicIncludePattern = value;
                        await await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Topic folder timestamp')
            .setDesc('Select whether the topic folder should have a timestamp included (note this can lead to a large number of "Topic-YYYYMMSShhmmss" folders).')
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.topicIncludeTimestamp)
                    .onChange(async (value) => {
                        this.plugin.settings.topicIncludeTimestamp = value;
                        await await this.plugin.saveSettings();
                    });
            });

        containerEl.createEl('h4', { text: 'LDA (Latent Dirichet Allocation) Parameters' });
        // Include this: https://github.com/stdlib-js/nlp-lda
        new Setting(containerEl)
            .setName('LDA iterations')
            .setDesc('Enter the number of iterations to fit the LDA model')
            .addText((text) => {
                text.inputEl.setAttribute("type", "number");
                text.setPlaceholder('100-5000')
                    .setValue(this.plugin.settings.ldaIterations.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.ldaIterations = Math.min(Math.max(parseInt(value), 100), 5000);
                        await await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('LDA Burn In')
            .setDesc('Enter the number of estimates to discard at the first iteration')
            .addText((text) => {
                text.inputEl.setAttribute("type", "number");
                text.setPlaceholder('10-500')
                    .setValue(this.plugin.settings.ldaBurnIn.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.ldaBurnIn = Math.min(Math.max(parseInt(value), 10), 500);
                        await await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('LDA Thin')
            .setDesc('Enter the number of estimates to discard at every other iteration')
            .addText((text) => {
                text.inputEl.setAttribute("type", "number");
                text.setPlaceholder('1-100')
                    .setValue(this.plugin.settings.ldaThin.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.ldaThin = Math.min(Math.max(parseInt(value), 1), 100);
                        await await this.plugin.saveSettings();
                    });
            });
    }
}