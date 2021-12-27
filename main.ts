
const { Plugin,
    PluginSettingTab,
    Setting,
    debounce,
	request,
	loadPdfJs,
    htmlToMarkdown } = require('obsidian');

const roundn = require('@stdlib/math-base-special-roundn');
const stopwords = require('@stdlib/datasets-stopwords-en');
const lda = require('@stdlib/nlp-lda');
const micromatch = require('micromatch');

// For GPT-3, & web links, HTML to Markdown conversion
const got = require('got');

// Load porter stemmer V2
const stem = require('wink-porter2-stemmer');


// Remember to rename these classes and interfaces!

interface TopicLinkingPluginSettings {
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

const DEFAULT_SETTINGS: TopicLinkingPluginSettings = {
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


export default class TopicLinkingPlugin extends Plugin {
    settings: TopicLinkingPluginSettings;

    async onload() {
        await this.loadSettings();

        // This creates an icon in the left ribbon.
        const ribbonIconEl = this.addRibbonIcon('dice', 'Topic Linking Plugin', (evt: MouseEvent) => {
            // Called when the user clicks the icon.
            this.scrollCommand();
        });

        // Perform additional things with the ribbon
        ribbonIconEl.addClass('my-plugin-ribbon-class');

        // This adds a status bar item to the bottom of the app. Does not work on mobile apps.
        const statusBarItemEl = this.addStatusBarItem();

		const pdfjs = await loadPdfJs();

        // PDF Extraction
        async function getContent(vault, file, counter) {
            let pages = [];
            try {

                let buffer = await vault.readBinary(file);
                const pdf = await pdfjs.getDocument(buffer).promise;
                console.log(`Loading file num ${counter} at ${file.basename}, with: ${pdf.numPages} pages and size: ${file.stat.size / 1000}KB.`);
                for (let i = 0; i < pdf.numPages; i++) {
                    const page = await pdf.getPage(i + 1);
                    let text = await page.getTextContent();
                    pages.push(text);
                }
            }
            catch (err) {
                console.log(`Error ${err} loading ${file.path}.`)
            }
            return pages;
        }

        // This command extracts PDFs to Markdown
        this.addCommand({
            id: 'extract-pdf-command',
            name: 'Extract PDF',
            hotkeys: [{ modifiers: ["Mod", "Shift"], key: "a" }],
            callback: async () => {

                const { vault } = this.app;
                statusBarItemEl.setText(`Extracting Markdown text from PDF files...`);

                const fileNumberLimit = this.settings.pdfExtractFileNumberLimit;
                const fileSizeLimit = this.settings.pdfExtractFileSizeLimit;
                const pdfOverwrite = this.settings.pdfOverwrite === true;
                console.log(`File number limit: ${fileNumberLimit}`);
                console.log(`File size limit: ${fileSizeLimit}`);
                console.log(`Overwrite exising files: ${pdfOverwrite}`);
                
                const subPathFactory = (file, offset) => {
                    if (file.path.length > offset && file.path.lastIndexOf("/") > -1)
                        return file.path.substring(0, file.path.lastIndexOf("/") + 1).substring(offset);
                    else
                        return "";
                };
          
                // Obtain a set of PDF files - don't include those that have already been generated
                let files: TFile[] = vault.getFiles().filter((file) => {
                    let matches = false;
                    if (file.extension === 'pdf' && file.path.indexOf('PDFs/') > -1) {
                        // if (file.extension === 'pdf') {
                        if (fileSizeLimit > 0 && file.stat.size * 1000 > fileSizeLimit)
                            matches = false;
                        else if (!pdfOverwrite) {
                            let subPath = subPathFactory(file, "PDFs/".length);
                            let mdFile = `Generated/${subPath}${file.basename}.md`;
                            let mdVersion = vault.getAbstractFileByPath(mdFile);
                            if (mdVersion === null)
                                matches = true;
                        }
                        else
                            matches = true;
                    }
                    return matches;
                });

				if (fileNumberLimit > 0)
                    files = files.slice(0, fileNumberLimit);

                files.map(async (file) => {
                    const subPath = subPathFactory(file, "PDFs/".length);
                    if (subPath.length > 0) {
                        try {
                            const folderLoc = "Generated/" + subPath;
                            await vault.createFolder(folderLoc);
                        } 
                        catch (err) { // Ignore errors here - no way of testing for existing files
                        }
                    }
                });

                const processFile = async (file : TFile, fileCounter : number) => {
                    const pages: string = await getContent(vault, file, fileCounter);

                    let subPath = subPathFactory(file, "PDFs/".length);
                    let minH = -1, maxH = -1, totalH = 0, counterH = 0, meanH = 0;
                    pages.forEach((page) => {
                      page.items.forEach((item) => {
                        const { str, dir, width, height, transform, fontName, hasEOL } = item;
                        if (str.trim().length > 0) {
                          if (height > maxH)
                            maxH = height;
                          if (height < minH || minH == -1)
                            minH = height;
                          totalH += height;
                          counterH++;
                        }
                      });
                    });
                    meanH = totalH / counterH;
                    let markdownStrings = [];
                    let counter = 0;
                    let strL = '', dirL = '', widthL = 0, heightL = 0, transformL = {}, fontNameL = '', hasEOLL = false;
                    let strLL = '', dirLL = '', widthLL = 0, heightLL = 0, transformLL = {}, fontNameLL = '', hasEOLLL = false;
					let pageCounter = 0;
                    pages.forEach((page) => {
                        let inCode: boolean = false;
                        let newLine: boolean = true;
                        let italicised: boolean = false;
                        page.items.forEach((item) => {
                            let markdownText = '';
                            const { str, dir, width, height, transform, fontName, hasEOL } = item;

                            // Rules for handling 'code'-like strings. The main purpose here is to escape link-like syntax ('[[', ']]')
                            if ((str.indexOf('//=>') == 0 ||
                                str.indexOf('=>') == 0 ||
                                str.indexOf('>>') == 0) && !inCode && newLine) {
                                markdownText += '`' + str;
                                inCode = true;
                                newLine = false;
                            }
                            else if (strL != '' && hasEOLL && fontNameL == fontName && heightL == height) {
                                // If the last character was a hyphen, remove it
                                if (strL.endsWith('-')) {
                                    markdownStrings[counter] = strL.substring(0, strL.length - 1);
                                    newLine = false;
                                }
                                // In this case, assume a new line
                                else if (Math.floor(widthL) != Math.floor(width) && strL.substring(strL.length - 1).match(/[\?\.:-]/) != null) {
                                    // markdownStrings[counter] = strL + (inCode ? "`" : "") + "\n\n";
                                    markdownStrings[counter] = strL + '\n\n';
                                    inCode = false;
                                    newLine = true;
                                }
                                // Otherwise, do not create a new line. Just append the text
                                else {
                                    markdownStrings[counter] = strL + (strL.endsWith(" ") ? "" : " ");
                                    markdownText += ' ';
                                    newLine = false;
                                }
                                markdownText += str;
                            }
                            // On the same line - assume the text might be italicised
                            else if (transform[5] == transformL[5]) {
                                // Hack. A better way would be to look up the font properties formally
                                if (!italicised && !inCode && fontNameL != fontName && fontNameLL != fontName) {
                                    markdownText += `*${str}*`;
                                    italicised = true;
                                }
                                else {
                                    markdownText += str;
                                    italicised = false;
                                }
                                newLine = false;
                            }
                            else if (transform[5] > transformL[5] && pageCounter > 0) {
                                markdownText += "[" + str + "]";
                              } 
                            else if (transform[5] == transformLL[5]) {
                                markdownText += str;
                            } 
                            else {
                                markdownStrings[counter] = strL + (inCode ? "`" : "") + "\n\n";
                                inCode = false;
                                newLine = true;
                                if (height > meanH) {
                                    const diffH = height / meanH - 1;
                                    const headingSize = Math.ceil(0.5 / diffH);
                                    if (headingSize <= 6) {
                                        const heading = "#".repeat(headingSize);
                                        markdownText += heading + " ";
                                    }
                                }
                                markdownText += str;
                            }
                            // Important! Escape all double brackets
                            markdownText = markdownText.replace('[[', `\\[\\[`);
                            counter++;
                            markdownStrings.push(markdownText);

                            // Copy second last line
                            strLL = strL;
                            dirLL = dirL;
                            widthLL = widthL;
                            heightLL = heightL;
                            transformLL = transformL;
                            fontNameLL = fontNameL;
                            hasEOLLL = hasEOLL;

                            // Copy last line
                            strL = markdownText;
                            dirL = dir;
                            widthL = width;
                            heightL = height;
                            transformL = transform;
                            fontNameL = fontName;
                            hasEOLL = hasEOL;

                            pageCounter++;
                        })
                    });

                    let markdownContents = markdownStrings.join('');
                    markdownContents = `Source file: [[${file.path}]]\n\n${markdownContents}`;

                    // console.log(markdownContents.substring(0, 500));
                    let fileName: string = `Generated/${subPath}${file.basename}.md`;
                    let newFile: TFile = vault.getAbstractFileByPath(fileName);
                    // console.log(fileName);
                    if (newFile !== null)
                        await vault.modify(newFile, markdownContents);
                    else
                        await vault.create(fileName, markdownContents);
                };

                files.map(async (file : TFile, index : number) => {
                    const delayedProcessing = debounce((fileToProcess, i) => {
                        processFile(fileToProcess, i);
                    }, 100, true);
                    await delayedProcessing(file, index + 1);
                });

                statusBarItemEl.setText('All done!');

            }
        });

        this.addCommand({
            id: 'extract-html',
            name: 'Extract HTML',
            hotkeys: [{ modifiers: ["Mod", "Shift"], key: "y" }],
            callback: async () => {

                const { vault } = this.app;

                statusBarItemEl.setText('Retrieve web content as markdown...');

                if (this.settings.bookmarkOverwrite) {
                    let filesToDelete: TFile[] = vault.getFiles().filter((file) => file.path.indexOf('Generated-Bookmarks/') > -1 && file.extension === 'md');
                    for (let i = 0; i < filesToDelete.length; i++) {
                        let file = filesToDelete[i];
                        vault.delete(file);
                    }
                }

                const files: TFile[] = vault.getMarkdownFiles().filter((file) => file.path.indexOf('Bookmarks/') > -1);
                const fileContents: string[] = await Promise.all(files.map((file) => vault.cachedRead(file)));
                fileContents.forEach((contents) => {
                    let links: string[] = contents.match(/https*\:\/\/[^ \)]*/g);
                    if (links != null) {
                        let pdfLinks = links.filter(link => link.endsWith('.pdf'));
                        console.log("Ignoring the following files - download these manually to add them to your repository.")
                        pdfLinks.forEach(link => console.log(link));

                        links = links.filter(link => !link.endsWith('.pdf') && !link.endsWith('.jpg'));
                        let i = 0;
                        links.forEach(async (link) => {
                            // Get web contents...
                            console.log(link)
                            try {
                                const response = await got(link);
                                const htmlContents = response.body;
                                let title = htmlContents.match(/<title>([^<]*)<\/title>/i);
                                if (title === null)
                                    title = link;
                                else
                                    title = title[1];
                                title = title.trim().replace(/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,\/:;<=>?@\[\]^`{|}~]/g, '-');

                                // let md = NodeHtmlMarkdown.translate(htmlContents);
                                let md = htmlToMarkdown(htmlContents);
                                md = `${link}\n\n${md}`;

                                let fileName: string = "Generated/" + title + ".md";
                                let file: TFile = vault.getAbstractFileByPath(fileName);
                                if (this.settings.bookmarkOverwrite) {
                                    vault.delete(file);
                                }
                                else {
                                    if (file !== null)
                                        vault.modify(file, md);
                                    else
                                        vault.create(fileName, md);
                                }
                                i++;
                            }
                            catch (err) {
                                console.log(err);
                            }

                        });

                    }
                })

                statusBarItemEl.setText('All done!');

            }
        });

        // Generates topics and links to associated documents
        this.addCommand({
            id: 'link-topics-command',
            name: 'Link Topics',
            hotkeys: [{ modifiers: ["Mod", "Shift"], key: "z" }],
            callback: async () => {

                const { vault } = this.app;

                console.log(`Number of topics: ${this.settings.numTopics}`);
                console.log(`Number of words: ${this.settings.numWords}`);
                console.log(`Topic threshold: ${this.settings.topicThreshold}`);
                console.log(`Percentage of text: ${this.settings.percentageTextToScan}`);
                let topicPathPattern = this.settings.topicPathPattern;
                console.log(`Topic file pattern: ${topicPathPattern}`);
                console.log(`Fixed word length: ${this.settings.fixedWordLength}`);
                console.log(`Text percentage: ${this.settings.percentageTextToScan}`);
                console.log(`Word selection: ${this.settings.wordSelectionRandom}`);

                statusBarItemEl.setText(`Extracting Markdown file contents at ${this.settings.percentageTextToScan}%...`);

                let files: TFile[] = vault.getMarkdownFiles().filter((file) => micromatch([file.path], ['*' + topicPathPattern + '*']).length > 0);

                // Get PDF names for later matching
                let pdfNames = vault.getFiles().filter(file => { return file.extension === 'pdf' }).map(file => file.basename);
                // TODO: Add weblinks here...

                // Add stop words
                let words = stopwords();
                for (let i = 0; i < words.length; i++) {
                    words[i] = new RegExp('\\b' + words[i] + '\\b', 'gi');
                }
                // Add other stop words
                let extendedStops = ['©', 'null', 'obj', 'pg', 'de', 'et', 'la', 'le', 'el', 'que', 'dont', 'flotr2', 'mpg', 'ibid', 'pdses'];
                for (let i = 0; i < extendedStops.length; i++) {
                    words.push(new RegExp('\\b' + extendedStops[i] + '\\b', 'gi'));
                }

                // Retrieve all file contents
                const fileContents: string[] = await Promise.all(files.map((file) => vault.cachedRead(file)));

                // Produce word sequences for set text amounts, without stopwords or punctuation.
                let documents: string[] = fileContents.map((document) => {

                    // Handle fixed number of words
                    if (this.settings.fixedWordLength > 0) {
                        let totalWords = document.split(' ');
                        let wordLength = totalWords.length;
                        let scanEnd = (wordLength > this.settings.fixedWordLength) ? this.settings.fixedWordLength : wordLength;
                        let scanStart = 0;
                        if (this.settings.wordSelectionRandom)
                            scanStart = Math.floor(Math.random() * (wordLength - scanEnd));
                        document = totalWords.slice(scanStart, scanStart + scanEnd).join(' ');

                    }
                    else if (this.settings.percentageTextToScan > 0 && this.settings.percentageTextToScan < 100) {
                        let scanEnd = document.length * (this.settings.percentageTextToScan / 100);
                        let scanStart = 0;
                        if (this.settings.wordSelectionRandom)
                            scanStart = Math.floor(Math.random() * (100 - scanEnd));
                        document = document.substring(scanStart, scanEnd);
                    }

                    document = document.toLowerCase()
                        .replace(/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()\*+,\-.\/:;<=>?@\[\]^_`{|}~]/g, '')
                        .replace(/\b\d{1,}\b/g, '')
                    for (let j = 0; j < words.length; j++) {
                        document = document.replace(words[j], '');
                    }
                    document = document.replace(/\s{2,}/g, ' ');

                    if (this.settings.stemming)
                        document = document.split(' ').map(word => stem(word)).join(' ');

                    return document.trim();
                });
                // console.log(documents[0].substring(0, 1000));

                // Do the LDA model fitting
                let num_topics = this.settings.numTopics;
                let num_words = this.settings.numWords;
                let threshold = this.settings.topicThreshold;
                let iterations = this.settings.ldaIterations;
                let burnin = this.settings.ldaBurnIn;
                let thin = this.settings.ldaThin;

                statusBarItemEl.setText('Finding ' + num_topics + ' topics to meet ' + threshold + '...');

                const lda_model = lda(documents, num_topics);
                lda_model.fit(iterations, burnin, thin);

                // Create an array of topics with links to documents that meet the threshold
                let topicDocs = new Array(num_topics);
                for (var j = 0; j < num_topics; j++) {
                    for (var i = 0; i < documents.length; i++) {
                        let score = roundn(lda_model.avgTheta.get(i, j), -3);
                        if (score > threshold) {
                            if (topicDocs[j] === undefined)
                                topicDocs[j] = [];
                            topicDocs[j].push({ doc: files[i].basename, score: score });
                        }
                    }
                }

                // Generate the list of topic strings
                let topicStrings = [];
                for (var j = 0; j < num_topics; j++) {
                    let terms = lda_model.getTerms(j, num_words);
                    let topicString = `Topic ${j + 1} - ${terms.map(t => t.word).join('-')}`;
                    topicStrings.push(topicString);
                }

                statusBarItemEl.setText(`Creating topic files with ${num_words} per topic...`);


                let topicDir = `Topics`;
                if (this.settings.topicIncludePattern)
                    topicDir += `-${topicPathPattern.replace(/[\*\/\.\ ]/g, '-').replace(/--/, '-')}`;
                if (this.settings.topicIncludeTimestamp)
                    topicDir += `-${moment().format('YYYYMMDDhhmmss')}`;

                try {
                    await vault.createFolder(topicDir);
                }
                catch (err) {
                    // Already exists? continue on
                }

                // Create the topic files
                for (var j = 0; j < num_topics; j++) {

                    let terms = lda_model.getTerms(j, num_words);
                    // No associated terms - move on
                    if (terms[0].word === undefined)
                        continue;
                    let fileName: string = `${topicDir}/${topicStrings[j]}.md`;

                    let fileText: string = `# Topic ${j + 1}\n\n`;
                    fileText += `Return to [[Topic Index]]\n\n`;
                    // fileText += `Return to [[${topicDir}/Topic Index]]\n\n`;
                    fileText += '## Keywords \n\n';

                    fileText += '#### Tags \n\n';

                    for (var k = 0; k < terms.length; k++) {
                        let { word, prob } = terms[k];
                        fileText += `#${word} `;
                    }

                    fileText += '\n\n#### Topic-Word Relevance \n\n';

                    fileText += `| ${'Word'.padEnd(20)} | Probability  |\n`
                    fileText += `| :${'-'.repeat(19)} | ${'-'.repeat(11)}: |\n`
                    for (var k = 0; k < terms.length; k++) {
                        let { word, prob } = terms[k];
                        fileText += `| **${word.padEnd(20)}** | ${prob.toPrecision(2).padEnd(11)} |\n`;
                    }

                    fileText += `\n\n`;

                    fileText += `## Links \n\n`;
                    let thisTopicDocs = topicDocs[j];
                    if (thisTopicDocs !== undefined) {
                        thisTopicDocs.sort((td1, td2) => { return (td1.score > td2.score ? -1 : (td1.score < td2.score ? 1 : 0)) })
                        for (var k = 0; k < thisTopicDocs.length; k++) {
                            let { doc, score } = thisTopicDocs[k];
                            fileText += ` - [[${doc}]] [relevance: ${score.toPrecision(2)}]`;
                            // Add checks for source of text. Hard-coded to PDF for now
                            if (pdfNames.indexOf(doc) > -1)
                                fileText += ` ([[${doc}.pdf|PDF]])`;
                            fileText += `\n`;
                        }
                    }

                    try {
                        let file: TFile = vault.getAbstractFileByPath(fileName);
                        if (file !== undefined && file !== null)
                            vault.modify(file, fileText);
                        else
                            vault.create(fileName, fileText);
                    }
                    catch (err) {
                        console.log(err);
                    }
                }

                // Create the index file
                let topicFileName: string = `${topicDir}/Topic Index.md`;
                let topicFileText: string = `# Topic Index\n\n`;
                topicFileText += `Results based on scanning files that match: *${topicPathPattern}*.\n\n`;
                topicFileText += `## Topics \n\n`;
                for (var j = 0; j < num_topics; j++) {
                    topicFileText += ` - [[${topicStrings[j]}]]\n`;
                    // topicFileText += ` - [[${topicDir}/${topicStrings[j]}]]\n`;
                }
                topicFileText += `\n## Reading List\n\n`;
                topicFileText += `**Note:** to retain this list, copy to another location or check the 'Topic Folder Timestamp' option under 'Settings'.\n\n`;

                let fileNames = files.map(file => file.basename).sort();
                for (var j = 0; j < fileNames.length; j++) {
                    topicFileText += `- [ ] [[${fileNames[j]}]]\n`;
                }


                let topicFile: TFile = vault.getAbstractFileByPath(topicFileName);
                if (topicFile !== undefined && topicFile !== null)
                    vault.modify(topicFile, topicFileText);
                else
                    vault.create(topicFileName, topicFileText);
            }
        });


        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(new TopicLinkingSettingTab(this.app, this));


        // When registering intervals, this function will automatically clear the interval when the plugin is disabled.
        this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
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


class TopicLinkingSettingTab extends PluginSettingTab {
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
                    .onChange(async (value) => {
                        this.plugin.settings.pdfExtractFileNumberLimit = Math.min(Math.max(value, 0), 1000);
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
                    .onChange(async (value) => {
                        this.plugin.settings.pdfExtractFileSizeLimit = Math.min(Math.max(value, 0), 100000);
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
                        this.plugin.settings.numTopics = Math.min(Math.max(value, 1), 10);
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
                        this.plugin.settings.numWords = Math.min(Math.max(value, 1), 20);
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
                        this.plugin.settings.topicThreshold = Math.min(Math.max(value, 0), 1);
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
                        this.plugin.settings.fixedWordLength = Math.min(Math.max(value, 0), 5000);
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
                        this.plugin.settings.percentageTextToScan = Math.min(Math.max(value, 1), 100);
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
                        this.plugin.settings.ldaIterations = Math.min(Math.max(value, 100), 5000);
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
                        this.plugin.settings.ldaBurnIn = Math.min(Math.max(value, 10), 500);
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
                        this.plugin.settings.ldaThin = Math.min(Math.max(value, 1), 100);
                        await await this.plugin.saveSettings();
                    });
            });
    }
}