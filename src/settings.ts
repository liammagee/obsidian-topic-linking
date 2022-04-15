import {
    App,
    PluginSettingTab,
    Setting,
  } from 'obsidian';
  
import TopicLinkingPlugin from './main';

export interface TopicLinkingSettings {
    generatedPath: string;
    pdfPath: string;
    pdfOverwrite: boolean;
    pdfExtractFileNumberLimit: number;
    pdfExtractFileSizeLimit: number;
    pdfExtractChunkIfFileExceedsLimit: boolean;
    
    pdfExtractIncludeImages: boolean;
    pdfExtractIncludePagesAsHeadings: boolean;
    pdfExtractAnnotations: boolean;
    pdfExtractAnnotationsIncludeComments: boolean;
    pdfExtractAnnotationsIncludeCommentsAsCallouts: boolean;

    bibtexPath: string;
    citeprocStyleId: string;
    citeprocLang: string;
    citeprocForceLang: boolean;
    bibliographyPath: string;

    bookmarkPath: string;
    bookmarkOverwrite: boolean;
    topicPathPattern: string;
    topicSearchPattern: string;
    topicTagPattern: string;
    numTopics: number;
    numWords: number;
    stemming: boolean;
    topicThreshold: number;
    fixedWordLength: number;
    percentageTextToScan: number;
    wordSelectionRandom: boolean;
    topicFolderName: string;
    topicOverwrite: boolean;
    topicIncludePattern: boolean;
    topicIncludeTimestamp: boolean;
    ldaIterations: number;
    ldaBurnIn: number;
    ldaThin: number;

    includeTags: boolean;
    
    templatePdfHeader: string;
    templatePdfPage: string;
    templatePdfFooter: string;
    templateTopicIndex: string;
    templateTopicIndividual: string;
    templateBibliographyIndex: string;
    templateBibliographyEntry: string;
}

export const DEFAULT_SETTINGS: TopicLinkingSettings = {
    generatedPath: 'Generated/',
    pdfPath: 'PDFs/',
    pdfOverwrite: false,
    pdfExtractFileNumberLimit: 0,
    pdfExtractFileSizeLimit: 5000,
    pdfExtractChunkIfFileExceedsLimit: true,

    pdfExtractIncludeImages: true,
    pdfExtractIncludePagesAsHeadings: true,
    pdfExtractAnnotations: true,
    pdfExtractAnnotationsIncludeComments: true,
    pdfExtractAnnotationsIncludeCommentsAsCallouts: true,

    bibtexPath: '',
    citeprocStyleId: 'apa',
    citeprocLang: 'en-US',
    citeprocForceLang: false,
    bibliographyPath: 'Bibliography/',

    bookmarkPath: 'Bookmarks/',
    bookmarkOverwrite: false,
    topicPathPattern: 'Generated/',
    topicSearchPattern: '',
    topicTagPattern: '',
    numTopics: 5,
    numWords: 5,
    stemming: false,
    topicThreshold: 0.5,
    fixedWordLength: 1000,
    percentageTextToScan: 5,
    wordSelectionRandom: true,
    topicFolderName: 'Topics',
    topicOverwrite: false,
    topicIncludePattern: false,
    topicIncludeTimestamp: false,
    ldaIterations: 1000,
    ldaBurnIn: 100,
    ldaThin: 10,

    includeTags: false,

    templatePdfHeader: '',
    templatePdfPage: '',
    templatePdfFooter: '',
    templateTopicIndex: '',
    templateTopicIndividual: '',
    templateBibliographyIndex: '',
    templateBibliographyEntry: ''


}

export class TopicLinkingSettingTab extends PluginSettingTab {
    plugin: TopicLinkingPlugin;
    styles: Record<string, string>;

    constructor(app: App, plugin: TopicLinkingPlugin, styles: Record<string, string>) {
        super(app, plugin);
        this.plugin = plugin;
        this.styles = styles;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: 'Topic Link Plugin' });


        containerEl.createEl('h3', { text: 'General' });
        new Setting(containerEl)
            .setName('Generated files')
            .setDesc('Where to output generated files')
            .addText((text) => {
                text.setPlaceholder('Generated/')
                    .setValue(this.plugin.settings.generatedPath.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.generatedPath = value;
                        await this.plugin.saveSettings();
                    });
            });

        containerEl.createEl('h3', { text: 'PDF Extraction Settings' });
        new Setting(containerEl)
            .setName('PDF files')
            .setDesc('Where to find PDF files')
            .addText((text) => {
                text.setPlaceholder('PDFs/')
                    .setValue(this.plugin.settings.pdfPath.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.pdfPath = value;
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Overwrite')
            .setDesc('Overwrite Markdown file if it already exists')
            .addToggle((toggle) => {
                // toggle.inputEl.setAttribute("type", "boolean");
                toggle.setValue(this.plugin.settings.pdfOverwrite)
                    .onChange(async (value) => {
                        this.plugin.settings.pdfOverwrite = value;
                        await this.plugin.saveSettings();
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
                        await this.plugin.saveSettings();
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
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Chunk file if size exceeds limit')
            .setDesc('Chunks, or breaks down the resulting file if it exceeds *Limit file size*.')
            .addToggle((toggle) => {
                // toggle.inputEl.setAttribute("type", "boolean");
                toggle.setValue(this.plugin.settings.pdfExtractChunkIfFileExceedsLimit)
                    .onChange(async (value) => {
                        this.plugin.settings.pdfExtractChunkIfFileExceedsLimit = value;
                        await this.plugin.saveSettings();
                    });
            });

        containerEl.createEl('h4', { text: 'Experimental' });
        new Setting(containerEl)
            .setName('Extract and Include Images')
            .setDesc('Extracts images, and inserts Markdown image references.')
            .addToggle((toggle) => {
                // toggle.inputEl.setAttribute("type", "boolean");
                toggle.setValue(this.plugin.settings.pdfExtractIncludeImages)
                    .onChange(async (value) => {
                        this.plugin.settings.pdfExtractIncludeImages = value;
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Include Pages As Headings')
            .setDesc('Inserts *Page X* headings into the generated Markdown. This can be useful for linking to specific pages.')
            .addToggle((toggle) => {
                // toggle.inputEl.setAttribute("type", "boolean");
                toggle.setValue(this.plugin.settings.pdfExtractIncludePagesAsHeadings)
                    .onChange(async (value) => {
                        this.plugin.settings.pdfExtractIncludePagesAsHeadings = value;
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Extract Annotations')
            .setDesc('Extracts annotations from PDF as highlights.')
            .addToggle((toggle) => {
                // toggle.inputEl.setAttribute("type", "boolean");
                toggle.setValue(this.plugin.settings.pdfExtractAnnotations)
                    .onChange(async (value) => {
                        this.plugin.settings.pdfExtractAnnotations = value;
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Include Comments with Annotations')
            .setDesc('Includes any comments attached to extracted annotations as endnotes.')
            .addToggle((toggle) => {
                // toggle.inputEl.setAttribute("type", "boolean");
                toggle.setValue(this.plugin.settings.pdfExtractAnnotationsIncludeComments)
                    .onChange(async (value) => {
                        this.plugin.settings.pdfExtractAnnotationsIncludeComments = value;
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName("Better Bibtex File")
            .setDesc("Add Path to the *BetterBibTex JSON* file to be imported. ")
            .addText((text) =>
                text
                    .setPlaceholder("")
                    .setValue(this.plugin.settings.bibtexPath.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.bibtexPath = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Citation Style")
            .setDesc("Citation Style")
            .addDropdown((dropdown) => 
                dropdown
                    .addOptions(this.styles)
                    .setValue(this.plugin.settings.citeprocStyleId.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.citeprocStyleId = value;
                        await this.plugin.saveSettings();
                    })                    
            );
        new Setting(containerEl)
            .setName("Citation Location")
            .setDesc("Citation Location")
            .addText((text) =>
                text
                    .setPlaceholder("en-US")
                    .setValue(this.plugin.settings.citeprocLang.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.citeprocLang = value;
                        await this.plugin.saveSettings();
                    })
            );
        new Setting(containerEl)
            .setName("Citation - Force Language")
            .setDesc("Citation - Force Language")
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.citeprocForceLang)
                    .onChange(async (value) => {
                        this.plugin.settings.citeprocForceLang = value;
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Bibliography Path')
            .setDesc('Where to output the bibliography.')
            .addText((text) => {
                text.setPlaceholder('Bibliography/')
                    .setValue(this.plugin.settings.bibliographyPath.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.bibliographyPath = value;
                        await this.plugin.saveSettings();
                    });
            });


        containerEl.createEl('h3', { text: 'Bookmark Extraction Settings' });
        new Setting(containerEl)
            .setName('Bookmark files')
            .setDesc('Where to find Bookmark files')
            .addText((text) => {
                text.setPlaceholder('Bookmarks/')
                    .setValue(this.plugin.settings.bookmarkPath.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.bookmarkPath = value;
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Overwrite')
            .setDesc('Overwrite Markdown file if it already exists')
            .addToggle((toggle) => {
                // toggle.inputEl.setAttribute("type", "boolean");
                toggle.setValue(this.plugin.settings.bookmarkOverwrite)
                    .onChange(async (value) => {
                        this.plugin.settings.bookmarkOverwrite = value;
                        await this.plugin.saveSettings();
                    });
            });

        containerEl.createEl('h3', { text: 'Topic Linking Settings' });
        containerEl.createEl('h4', { text: 'General Parameters' });

        new Setting(containerEl)
            .setName('Number of topics')
            .setDesc('Enter the number of topics to generate.')
            .addText((text) => {
                text.inputEl.setAttribute("type", "number");
                text.setPlaceholder('1-10')
                    .setValue(this.plugin.settings.numTopics.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.numTopics = Math.min(Math.max(parseInt(value), 1), 10);
                        await this.plugin.saveSettings();
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
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Stemming')
            .setDesc('Select whether tokens should be stemmed before analysis.')
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.stemming)
                    .onChange(async (value) => {
                        this.plugin.settings.stemming = value;
                        await this.plugin.saveSettings();
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
                        await this.plugin.saveSettings();
                    });
            });

        containerEl.createEl('h4', { text: 'Conditions' });
        new Setting(containerEl)
            .setName('Topc extraction file match')
            .setDesc('Enter a pattern to match Markdown files for topic extraction.')
            .addText((text) => {
                text.setPlaceholder('Generated/')
                    .setValue(this.plugin.settings.topicPathPattern.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.topicPathPattern = value;
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Topc extraction search match')
            .setDesc('Enter a search expression that files must contain to be included in topic extraction.')
            .addText((text) => {
                text.setPlaceholder('')
                    .setValue(this.plugin.settings.topicSearchPattern.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.topicSearchPattern = value;
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Topc extraction tag match')
            .setDesc('Enter a series of tags (in the format "#fashion #photography") which must be included at least once in matching files.')
            .addText((text) => {
                text.setPlaceholder('')
                    .setValue(this.plugin.settings.topicTagPattern.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.topicTagPattern = value;
                        await this.plugin.saveSettings();
                    });
            });

        containerEl.createEl('h4', { text: 'Source Text Filtering' });

        new Setting(containerEl)
            .setName('Fixed number of words')
            .setDesc('Enter the number of words to extract from the text. Overrides \'Percentage of Total Text\' below. Enter 0 to disable.')
            .addText((text) => {
                text.inputEl.setAttribute("type", "number");
                text.setPlaceholder('0-5000')
                    .setValue(this.plugin.settings.fixedWordLength.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.fixedWordLength = Math.min(Math.max(parseInt(value), 0), 5000);
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Percentage of total text')
            .setDesc('Enter the percentage of the total text to scan. Enter 0 to disable.')
            .addText((text) => {
                text.inputEl.setAttribute("type", "number");
                text.setPlaceholder('0-100')
                    .setValue(this.plugin.settings.percentageTextToScan.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.percentageTextToScan = Math.min(Math.max(parseInt(value), 0), 100);
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Randomise text')
            .setDesc('Select whether the text selection should be randomised ("false" means the text is scanned from the beginning).')
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.wordSelectionRandom)
                    .onChange(async (value) => {
                        this.plugin.settings.wordSelectionRandom = value;
                        await this.plugin.saveSettings();
                    });
            });

        containerEl.createEl('h4', { text: 'Topic Folder Naming' });
        new Setting(containerEl)
            .setName('Topic files')
            .setDesc('Where to output topic files')
            .addText((text) => {
                text.setPlaceholder('Topics')
                    .setValue(this.plugin.settings.topicFolderName.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.topicFolderName = value;
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Topic folder pattern')
            .setDesc('Select whether the topic folder should include the Markdown search pattern.')
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.topicIncludePattern)
                    .onChange(async (value) => {
                        this.plugin.settings.topicIncludePattern = value;
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Overwrite topics')
            .setDesc('Select whether existing topic notes should be deleted.')
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.topicOverwrite)
                    .onChange(async (value) => {
                        this.plugin.settings.topicOverwrite = value;
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Topic folder timestamp')
            .setDesc('Select whether the topic folder should have a timestamp included (note this can lead to a large number of "Topic-YYYYMMSShhmmss" folders).')
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.topicIncludeTimestamp)
                    .onChange(async (value) => {
                        this.plugin.settings.topicIncludeTimestamp = value;
                        await this.plugin.saveSettings();
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
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('LDA burn in')
            .setDesc('Enter the number of estimates to discard at the first iteration')
            .addText((text) => {
                text.inputEl.setAttribute("type", "number");
                text.setPlaceholder('10-500')
                    .setValue(this.plugin.settings.ldaBurnIn.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.ldaBurnIn = Math.min(Math.max(parseInt(value), 10), 500);
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('LDA thin')
            .setDesc('Enter the number of estimates to discard at every other iteration')
            .addText((text) => {
                text.inputEl.setAttribute("type", "number");
                text.setPlaceholder('1-100')
                    .setValue(this.plugin.settings.ldaThin.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.ldaThin = Math.min(Math.max(parseInt(value), 1), 100);
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Include tags in output')
            .setDesc('Select whether tags should be included in the topic output files.')
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.includeTags)
                    .onChange(async (value) => {
                        this.plugin.settings.includeTags = value;
                        await this.plugin.saveSettings();
                    });
            });

        containerEl.createEl('h4', { text: 'Templates' });
        new Setting(containerEl)
            .setName('PDF Header Template')
            .setDesc('Location of a Markdown template to use for PDF header rendering (overrides the default)')
            .addText((text) => {
                text.setPlaceholder('')
                    .setValue(this.plugin.settings.templatePdfHeader.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.templatePdfHeader = value;
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('PDF Page Template')
            .setDesc('Location of a Markdown template to use for PDF page rendering (overrides the default)')
            .addText((text) => {
                text.setPlaceholder('')
                    .setValue(this.plugin.settings.templatePdfPage.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.templatePdfPage = value;
                        await this.plugin.saveSettings();
                    });
            });
            new Setting(containerEl)
            .setName('PDF Footer Template')
            .setDesc('Location of a Markdown template to use for PDF footer rendering (overrides the default)')
            .addText((text) => {
                text.setPlaceholder('')
                    .setValue(this.plugin.settings.templatePdfFooter.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.templatePdfFooter = value;
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Topic Index Page Template')
            .setDesc('Location of a Markdown template to use for the Topic Index page (overrides the default)')
            .addText((text) => {
                text.setPlaceholder('')
                    .setValue(this.plugin.settings.templateTopicIndex.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.templateTopicIndex = value;
                        await this.plugin.saveSettings();
                    });
            });
            new Setting(containerEl)
            .setName('Topic Individual Page Template')
            .setDesc('Location of a Markdown template to use for the individual Topic page (overrides the default)')
            .addText((text) => {
                text.setPlaceholder('')
                    .setValue(this.plugin.settings.templateTopicIndividual.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.templateTopicIndividual = value;
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Bibliography IndexTemplate')
            .setDesc('Location of a Markdown template to use for the bibliography index (overrides the default)')
            .addText((text) => {
                text.setPlaceholder('')
                    .setValue(this.plugin.settings.templateBibliographyIndex.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.templateBibliographyIndex = value;
                        await this.plugin.saveSettings();
                    });
            });
        new Setting(containerEl)
            .setName('Bibliography Entry Template')
            .setDesc('Location of a Markdown template to use for the bibliography entries (overrides the default)')
            .addText((text) => {
                text.setPlaceholder('')
                    .setValue(this.plugin.settings.templateBibliographyEntry.toString())
                    .onChange(async (value) => {
                        this.plugin.settings.templateBibliographyEntry = value;
                        await this.plugin.saveSettings();
                    });
            });

   }
}