
import { 
    TFile, 
    TAbstractFile, 
    Plugin,
    PluginSettingTab,
    Setting,
    debounce,
	request,
	loadPdfJs,
    htmlToMarkdown,
    moment } from 'obsidian';

// For LDA
import roundn from '@stdlib/math-base-special-roundn';
import stopwords from '@stdlib/datasets-stopwords-en';
import lda from '@stdlib/nlp-lda';
import porterStemmer from  '@stdlib/nlp-porter-stemmer' ;

// For File matching
import micromatch from 'micromatch';

// Internal imports
import { TopicLinkingSettings, TopicLinkingSettingTab, DEFAULT_SETTINGS } from './settings';


export default class TopicLinkingPlugin extends Plugin {
    settings: TopicLinkingSettings;

    async onload() {
        await this.loadSettings();

		// Load PdfJs
		const pdfjs = await loadPdfJs();
		
        // This adds a status bar item to the bottom of the app. Does not work on mobile apps.
        const statusBarItemEl = this.addStatusBarItem();

		/**
		 * Extracts text from a PDF file.
		 */
        const getContent = async (file : TFile, counter : number) => {

			const { vault } = this.app;

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

		/**
		 * Returns parts of the path between an offset and the file name.
		 * (e.g. PDFs/path/to/file.pdf -> path/to/)
		 * @param file 
		 * @param offset 
		 * @returns 
		 */
		const subPathFactory = (file : TFile, offset : number) => {
			if (file.path.length > offset && file.path.lastIndexOf("/") > -1)
				return file.path.substring(0, file.path.lastIndexOf("/") + 1).substring(offset);
			else
				return "";
		};

		/**
		 * Makes a set of folders under the 'Generated/' folder, based on the file name.
		 * @param file
		 */
		const makeSubFolders = (files : Array<TFile>) => {

            const { vault } = this.app;

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
		};

        
        /**
         * Taken (and inverted) from https://stackoverflow.com/questions/7033639/split-large-string-in-n-size-chunks-in-javascript/29202760#29202760
         * @param str
         * @param size 
         * @returns 
         */
        const chunkSubstring = (str : string, num : number) => {
            const sizeChunks = Math.ceil(str.length / num);
            const chunks = new Array(num);
          
            for (let i = 0, o = 0; i < num; ++i, o += sizeChunks) {
              chunks[i] = str.substring(o, o+sizeChunks);
            }
          
            return chunks;
        }

        /**
         * Processess a single PDF file, by page and item, and extracts Markdown text based on a series of basic heuristics.
         * @param file 
         * @param fileCounter 
         */
		const processPDF = async (file : TFile, fileCounter : number) => {

            const { vault } = this.app;

			const pages: Array<any> = await getContent(file, fileCounter);

			let subPath = subPathFactory(file, "PDFs/".length);
			let minH = -1, maxH = -1, totalH = 0, counterH = 0, meanH = 0;
			pages.forEach((page) => {
			  page.items.forEach((item:any) => {
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
			let markdownStrings : string[] = [];
			let counter = 0;
			let strL = '', dirL = '', widthL = 0, heightL = 0, transformL : string[] = [], fontNameL = '', hasEOLL = false;
			let strLL = '', dirLL = '', widthLL = 0, heightLL = 0, transformLL : string[] = [], fontNameLL = '', hasEOLLL = false;
			let pageCounter = 0;
			pages.forEach((page) => {
				let inCode: boolean = false;
				let newLine: boolean = true;
				let italicised: boolean = false;
				page.items.forEach((item:any) => {
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

			let fileName: string = `Generated/${subPath}${file.basename}.md`;
            const byteLength = Buffer.byteLength(markdownContents, 'utf-8');
            const kb = Math.ceil(byteLength / 1024);
            if (kb > this.settings.pdfExtractFileSizeLimit && this.settings.pdfExtractFileSizeLimit > 0 && this.settings.pdfExtractChunkIfFileExceedsLimit === true) {
                // Create a chunk size approximately half the maximum size
                let chunkNum = Math.ceil(byteLength / (this.settings.pdfExtractFileSizeLimit * 1024 * 0.5));
                // Split the contents into approximately equal segments
                const segments = chunkSubstring(markdownContents, chunkNum);
                for (let i = 0; i < segments.length; i++) {
                    const segmentPath = `Generated/${subPath}${file.basename}_${i+1}.md`;
                    let newSegmentFile: any = vault.getAbstractFileByPath(segmentPath);
                    if (newSegmentFile !== null)
                        await vault.modify(newSegmentFile, segments[i]);
                    else
                        await vault.create(segmentPath, segments[i]);
                }
            }
            else {
                let newFile: any = vault.getAbstractFileByPath(fileName);
                if (newFile !== null)
                    await vault.modify(newFile, markdownContents);
                else
                    await vault.create(fileName, markdownContents);
            }
		};

  
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
                const chunkIfFileExceedsLimit = this.settings.pdfExtractChunkIfFileExceedsLimit;
                const pdfOverwrite = this.settings.pdfOverwrite === true;
                console.log(`File number limit: ${fileNumberLimit}`);
                console.log(`File size limit: ${fileSizeLimit}`);
                console.log(`Chunk if file exceeds limit: ${chunkIfFileExceedsLimit}`);
                console.log(`Overwrite exising files: ${pdfOverwrite}`);

                // Obtain a set of PDF files - don't include those that have already been generated
                let files: TFile[] = vault.getFiles().filter((file) => {
                    let matches = false;
                    if (file.extension === 'pdf' && file.path.indexOf('PDFs/') > -1) {
                        if (chunkIfFileExceedsLimit === false && fileSizeLimit > 0 && file.stat.size * 1024 > fileSizeLimit)
                            matches = false;
                        else if (!pdfOverwrite) {
                            let subPath = subPathFactory(file, "PDFs/".length);
                            let mdFile = `Generated/${subPath}${file.basename}.md`;
                            let mdVersion = vault.getAbstractFileByPath(mdFile);
                            if (mdVersion === null) {
                                if (chunkIfFileExceedsLimit === true) {
                                    // 2nd check - for large files that may have been chunked down
                                    mdFile = `Generated/${subPath}${file.basename}_1.md`;
                                    mdVersion = vault.getAbstractFileByPath(mdFile);
                                    if (mdVersion === null) 
                                        matches = true;
                                }
                                else
                                    matches = true;
                            }
                        }
                        else
                            matches = true;
                    }
                    return matches;
                });

				if (fileNumberLimit > 0)
                    files = files.slice(0, fileNumberLimit);

				makeSubFolders(files);

                files.map(async (file : TFile, index : number) => {
                    const delayedProcessing = debounce((fileToProcess : TFile, i : number) => {
                        processPDF(fileToProcess, i);
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
                    let filesToDelete: TFile[] = vault.getFiles().filter((file : TFile) => file.path.indexOf('Generated-Bookmarks/') > -1 && file.extension === 'md');
                    for (let i = 0; i < filesToDelete.length; i++) {
                        let file = filesToDelete[i];
                        vault.delete(file);
                    }
                }

                const files : TFile[] = vault.getMarkdownFiles().filter((file : TFile) => file.path.indexOf('Bookmarks/') > -1);
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
                                const htmlContents = await request({url: link});
                                let titleMatch = htmlContents.match(/<title>([^<]*)<\/title>/i);
                                let title : string = link;
                                if (titleMatch !== null)
                                    title = titleMatch[1];
                                title = title.trim().replace(/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,\/:;<=>?@\[\]^`{|}~]/g, '-');

                                // let md = NodeHtmlMarkdown.translate(htmlContents);
                                let md = htmlToMarkdown(htmlContents);
                                md = `${link}\n\n${md}`;

                                let fileName: string = "Generated/Bookmarks/" + title + ".md";
                                let file : any = vault.getAbstractFileByPath(fileName);
                                if (file !== null) {
                                    if (this.settings.bookmarkOverwrite)
                                        vault.modify(file, md);
                                }
                                else
                                    vault.create(fileName, md);
                                i++;
                            }
                            catch (err) {
                                // console.log(err);
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

				if (files.length === 0) {
					statusBarItemEl.setText('No Markdown files found!');
					return;
				}

                // Get PDF names for later matching
                let pdfNames = vault.getFiles().filter(file => { return file.extension === 'pdf' }).map(file => file.basename);
                // TODO: Add weblinks here...

                // Add stop words
                let words : string[] = stopwords();
                let wordRegexes : RegExp[] = words.map(word => { return new RegExp('\\b' + word + '\\b', 'gi'); });

                // Add other stop words
                let extendedStops = ['©', 'null', 'obj', 'pg', 'de', 'et', 'la', 'le', 'el', 'que', 'dont', 'flotr2', 'mpg', 'ibid', 'pdses'];
                extendedStops.forEach(word => { wordRegexes.push(new RegExp('\\b' + word + '\\b', 'gi')) });

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
                        .replace(/\b\d{1,}\b/g, '');
                    wordRegexes.forEach(word => { document = document.replace(word, '') });
                    document = document.replace(/\s{2,}/g, ' ');

                    if (this.settings.stemming)
                        document = document.split(' ').map(word => porterStemmer(word)).join(' ');

                    return document.trim();
                });

                // Do the LDA model fitting
                const numTopics = this.settings.numTopics;
                const numWords = this.settings.numWords;
                const threshold = this.settings.topicThreshold;
                const iterations = this.settings.ldaIterations;
                const burnin = this.settings.ldaBurnIn;
                const thin = this.settings.ldaThin;

                statusBarItemEl.setText('Finding ' + numTopics + ' topics to meet ' + threshold + '...');

                const ldaModel : any = lda(documents, numTopics);
                ldaModel.fit(iterations, burnin, thin);

                // Create an array of topics with links to documents that meet the threshold
                let topicDocs = new Array(numTopics);
                for (var j = 0; j < numTopics; j++) {
                    for (var i = 0; i < documents.length; i++) {
                        let score = roundn(ldaModel.avgTheta.get(i, j), -3);
                        if (score > threshold) {
                            if (topicDocs[j] === undefined)
                                topicDocs[j] = [];
                            topicDocs[j].push({ doc: files[i].basename, score: score });
                        }
                    }
                }

                // Generate the list of topic strings
                let topicStrings = [];
                for (var j = 0; j < numTopics; j++) {
                    let terms = ldaModel.getTerms(j, numWords);
                    let topicString = `Topic ${j + 1} - ${terms.map((t : any) => t.word).join('-')}`;
                    topicStrings.push(topicString);
                }

                statusBarItemEl.setText(`Creating topic files with ${numWords} per topic...`);


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
                for (var j = 0; j < numTopics; j++) {

                    let terms = ldaModel.getTerms(j, numWords);
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
                        thisTopicDocs.sort((td1 : any, td2 : any) => { return (td1.score > td2.score ? -1 : (td1.score < td2.score ? 1 : 0)) })
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
                        let file : any = vault.getAbstractFileByPath(fileName);
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
                for (var j = 0; j < numTopics; j++) {
                    topicFileText += ` - [[${topicStrings[j]}]]\n`;
                    // topicFileText += ` - [[${topicDir}/${topicStrings[j]}]]\n`;
                }
                topicFileText += `\n## Reading List\n\n`;
                topicFileText += `**Note:** to retain this list, copy to another location or check the 'Topic Folder Timestamp' option under 'Settings'.\n\n`;

                let fileNames = files.map(file => file.basename).sort();
                for (var j = 0; j < fileNames.length; j++) {
                    topicFileText += `- [ ] [[${fileNames[j]}]]\n`;
                }

                let topicFile : any = vault.getAbstractFileByPath(topicFileName);
                if (topicFile !== undefined && topicFile !== null)
                    vault.modify(topicFile, topicFileText);
                else
                    vault.create(topicFileName, topicFileText);

                    statusBarItemEl.setText(`All done!`);
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

