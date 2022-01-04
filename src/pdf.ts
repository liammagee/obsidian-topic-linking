import { 
    Vault, 
    TFile, 
	debounce, 
    normalizePath,
    loadPdfJs } from 'obsidian';
import { TopicLinkingSettings } from './settings';


export class PDFContentExtractor {
    pdfjs: any;
    generatedPath: string;
    pdfPath: string;

    /**
     * Extracts text from a PDF file.
     */
    getContent = async (vault: Vault, file : TFile, counter : number) => {

        let pages = [];
        try {

            let buffer = await vault.readBinary(file);
            const pdf = await this.pdfjs.getDocument(buffer).promise;
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
    subPathFactory = (file : TFile, offset : number) => {
        if (file.path.length > offset && file.path.lastIndexOf('/') > -1)
            return file.path.substring(0, file.path.lastIndexOf('/') + 1).substring(offset);
        else
            return '';
    };

    /**
     * Makes a set of folders under the 'Generated/' folder, based on the file name.
     * @param file
     */
    makeSubFolders = (vault: Vault, files : Array<TFile>) => {
        files.map(async (file) => {
            const subPath = this.subPathFactory(file, this.pdfPath.length);
            if (subPath.length > 0) {
                try {
                    const folderLoc = normalizePath(`${this.generatedPath}${subPath}`);
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
    chunkSubstring = (str : string, num : number) => {
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
    processPDF = async (vault: Vault, settings: TopicLinkingSettings, file : TFile, fileCounter : number) => {

        const pages: Array<any> = await this.getContent(vault, file, fileCounter);

        let subPath = this.subPathFactory(file, this.pdfPath.length);
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

        let fileName: string = normalizePath(`${this.generatedPath}${subPath}${file.basename}.md`);
        const byteLength = Buffer.byteLength(markdownContents, 'utf-8');
        const kb = Math.ceil(byteLength / 1024);
        if (kb > settings.pdfExtractFileSizeLimit && settings.pdfExtractFileSizeLimit > 0 && settings.pdfExtractChunkIfFileExceedsLimit === true) {
            // Create a chunk size approximately half the maximum size
            let chunkNum = Math.ceil(byteLength / (settings.pdfExtractFileSizeLimit * 1024 * 0.5));
            // Split the contents into approximately equal segments
            const segments = this.chunkSubstring(markdownContents, chunkNum);
            for (let i = 0; i < segments.length; i++) {
                const segmentPath = normalizePath(`${this.generatedPath}${subPath}${file.basename}_${i+1}.md`);
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
    
    async extract(vault: Vault, settings: TopicLinkingSettings, statusBarItemEl: HTMLElement) {
        
        // Load PdfJs
		this.pdfjs = await loadPdfJs();

        statusBarItemEl.setText(`Extracting Markdown text from PDF files...`);

        this.generatedPath = settings.generatedPath;
        this.pdfPath = settings.pdfPath;
        const fileNumberLimit = settings.pdfExtractFileNumberLimit;
        const fileSizeLimit = settings.pdfExtractFileSizeLimit;
        const chunkIfFileExceedsLimit = settings.pdfExtractChunkIfFileExceedsLimit;
        const pdfOverwrite = settings.pdfOverwrite === true;
        console.log(`File number limit: ${fileNumberLimit}`);
        console.log(`File size limit: ${fileSizeLimit}`);
        console.log(`Chunk if file exceeds limit: ${chunkIfFileExceedsLimit}`);
        console.log(`Overwrite exising files: ${pdfOverwrite}`);

        // Obtain a set of PDF files - don't include those that have already been generated
        let files: TFile[] = vault.getFiles().filter((file) => {
            let matches = false;
            if (file.extension === 'pdf' && file.path.indexOf(this.pdfPath) > -1) {
                if (chunkIfFileExceedsLimit === false && fileSizeLimit > 0 && file.stat.size * 1024 > fileSizeLimit)
                    matches = false;
                else if (!pdfOverwrite) {
                    let subPath = this.subPathFactory(file, this.pdfPath.length);
                    let mdFile = normalizePath(`${this.generatedPath}${subPath}${file.basename}.md`);
                    let mdVersion = vault.getAbstractFileByPath(mdFile);
                    if (mdVersion === null) {
                        if (chunkIfFileExceedsLimit === true) {
                            // 2nd check - for large files that may have been chunked down
                            mdFile = normalizePath(`${this.generatedPath}${subPath}${file.basename}_1.md`);
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


        this.makeSubFolders(vault, files);

        files.map(async (file : TFile, index : number) => {
            const delayedProcessing = debounce((fileToProcess : TFile, i : number) => {
                this.processPDF(vault, settings, fileToProcess, i);
            }, 100, true);
            await delayedProcessing(file, index + 1);
        });

        statusBarItemEl.setText('All done!');

    }

}