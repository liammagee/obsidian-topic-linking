import { 
    Vault, 
    TFile, 
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

        const pages : any[] = [];
        try {

            const buffer = await vault.readBinary(file);
            const pdf = await this.pdfjs.getDocument(buffer).promise;
            console.log(`Loading file num ${counter} at ${file.basename}, with: ${pdf.numPages} pages and size: ${file.stat.size / 1000}KB.`);
            for (let i = 0; i < pdf.numPages; i++) {
                const page = await pdf.getPage(i + 1);
                // const text = await page.getTextContent();
                const textContent = await page.getTextContent();
                const operators = await page.getOperatorList();
                const objs = page.commonObjs._objs;
    
                pages.push( { textContent: textContent, commonObjs: objs } );
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

        const subPath = this.subPathFactory(file, this.pdfPath.length);
        let minH = -1, maxH = -1, totalH = 0, counterH = 0, meanH = 0;
        pages.forEach( (page) => {
            const textContent = page.textContent;
            const commonObja = page.commonObjs;
            textContent.items.forEach((item:any) => {
                const { str, height } = item;
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
        const markdownStrings : string[] = [];
        let counter = 0;
        let strL = '', widthL = 0, heightL = 0, transformL : string[] = [], fontNameL = '', hasEOLL = false;
        let pageCounter = 0;

        for (let j = 0; j < pages.length; j++) {
            const page = pages[j];
            const textContent = page.textContent;
            const commonObjs = page.commonObjs;

            let inCode = false;
            let newLine = true;
            let blockquote = false;

            // Make this a parameter perhaps
            const treatEOLasNewLine = true;
            
            for (let i = 0; i < textContent.items.length; i++) {
                const item = textContent.items[i];
                let markdownText = '';
                let { str } = item;
                const { dir, width, height, transform, fontName, hasEOL } = item;
                let italicised = false, bolded = false;
                const font = commonObjs[fontName];
                if (font) {
                    const fontDataName = font.data.name;
                    italicised = fontDataName.indexOf('Italic') > -1;
                    bolded = fontDataName.indexOf('Bold') > -1;
                }
                const leadingSpace = str.startsWith(' ') ? ' ' : '';
                const trailingSpace = ' ';
                if (italicised && str.trim().length > 0)
                    str = `*${str.trim()}*${trailingSpace}`;
                else if (bolded && str.trim().length > 0)
                    str = `**${str.trim()}**${trailingSpace}`;

                let yDiff = 0;
                if (transformL.length > 0) 
                    yDiff = parseFloat(transformL[5]) - parseFloat(transform[5]);

                // If there's a change in height and a new line, treat as a blockquote
                if (height > 0 && height < meanH && i > 0) {
                    const diffH = height / meanH - 1;
                    if (hasEOLL) {
                        if (diffH < -0.2 && !blockquote) {
                            blockquote = true;
                            markdownText += `\n\n> `;
                        }
                    }
                    // Treat as a footnote subscript, if this is not the first line (in which case it's likely a continuation)
                    else if (!blockquote) {
                        str = `${leadingSpace}[${str.trim()}]${trailingSpace}`;
                    }
                }
                else if (blockquote && str.trim().length > 0 && strL.trim().length === 0) {
                    blockquote = false;
                    markdownText += `\n\n`;
                }

                // Rules for handling 'code'-like strings. The main purpose here is to escape link-like syntax ('[[', ']]')
                if ((str.indexOf('//=>') == 0 ||
                    str.indexOf('=>') == 0 ||
                    str.indexOf('>>') == 0) && !inCode && newLine) {
                    markdownText += '`' + str;
                    inCode = true;
                    newLine = false;
                }
                // Non-newline conditions
                else if (strL != '' && hasEOLL && heightL == height) {
                    // If the last character was a hyphen, remove it
                    if (strL.endsWith('-')) {
                        // Removes hyphens - this is not usually the right behaviour though
                        // markdownStrings[counter] = strL.substring(0, strL.length - 1);
                        newLine = false;
                    }
                    // In this case, assume a new line
                    else if (!blockquote && Math.floor(widthL) != Math.floor(width) && 
                        ((treatEOLasNewLine && hasEOL) || 
                        strL.substring(strL.length - 1).match(/[\u{2019}?.:-]/u) != null)) {
                        // For the very last line (i.e. indicated by the current counter being the first line of a new page), do not add new lines
                        if (blockquote) {
                            markdownStrings[counter - 1] = markdownStrings[counter - 1] + '\n';
                        }
                        else if (i > 0) {
                            const lines = Math.floor(yDiff  / heightL);
                            const linePadding = '\n' + '\n'.repeat(lines);
                            markdownStrings[counter - 1] = markdownStrings[counter - 1] + linePadding;
                            newLine = true;
                        }
                        inCode = false;
                    }
                    // Otherwise, do not create a new line. Just append the text, with a trailing space
                    else {
                        markdownStrings[counter - 1] = strL + (strL.endsWith(" ") ? "" : " ");
                        newLine = false;
                    }
                    markdownText += str;
                }
                // else if (transform[5] > transformL[5] && pageCounter > 0) {
                //     if (i == 0) {
                //         markdownText += '\n\n';

                //     }
                //     markdownText += `[${str}]\n\n`;
                // } 
                // In this (default) case we assume a new line
                else {
                    if (hasEOL && str === "" && heightL > (meanH * 1.1)) {
                        const lines = Math.floor(yDiff  / heightL);
                        const linePadding = '\n'.repeat(lines);
                        markdownStrings[counter - 1] = markdownStrings[counter - 1] + (inCode ? "`" : "") + linePadding;
                    }
                    // New page - add a trailing space to the last line
                    else if (i === 0) {
                        markdownStrings[counter - 1] = strL + (strL.endsWith(" ") ? "" : " ");
                    }
                    inCode = false;
                    newLine = true;
                    if (height > meanH) {
                        const diffH = height / meanH - 1;
                        const headingSize = Math.ceil(0.5 / diffH);
                        if (headingSize <= 6) {
                            const heading = "#".repeat(headingSize);
                            markdownText += `\n\n${heading} `;
                        }
                    }
                    markdownText += str;
                }
                if (pageCounter < 10) {
                    console.log(item)
                }
                
                // Important! Escape all double brackets
                markdownText = markdownText.replace('[[', `\\[\\[`).replace('  ', ' ');
                counter++;
                markdownStrings.push(markdownText);

                // Copy last line
                strL = markdownText;
                widthL = width;
                heightL = height;
                transformL = transform;
                fontNameL = fontName;
                hasEOLL = hasEOL;

            }
            pageCounter++;
        }

        let markdownContents = markdownStrings.join('');
        markdownContents = `Source file: [[${file.path}]]\n\n${markdownContents}`;

        const fileName: string = normalizePath(`${this.generatedPath}${subPath}${file.basename}.md`);
        const byteLength = Buffer.byteLength(markdownContents, 'utf-8');
        const kb = Math.ceil(byteLength / 1024);
        if (kb > settings.pdfExtractFileSizeLimit && settings.pdfExtractFileSizeLimit > 0 && settings.pdfExtractChunkIfFileExceedsLimit === true) {
            // Create a chunk size approximately half the maximum size
            const chunkNum = Math.ceil(byteLength / (settings.pdfExtractFileSizeLimit * 1024 * 0.5));
            // Split the contents into approximately equal segments
            const segments = this.chunkSubstring(markdownContents, chunkNum);
            for (let i = 0; i < segments.length; i++) {
                const segmentPath = normalizePath(`${this.generatedPath}${subPath}${file.basename}_${i+1}.md`);
                const newSegmentFile = <TFile> vault.getAbstractFileByPath(segmentPath);
                if (newSegmentFile !== null)
                    await vault.modify(newSegmentFile, segments[i]);
                else
                    await vault.create(segmentPath, segments[i]);
            }
        }
        else {
            const newFile = <TFile> vault.getAbstractFileByPath(fileName);
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
                    const subPath = this.subPathFactory(file, this.pdfPath.length);
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

        let index = 0;
        for (let file of files) {
            await this.processPDF(vault, settings, file, index++);
        }

        statusBarItemEl.setText('All done!');

    }

}