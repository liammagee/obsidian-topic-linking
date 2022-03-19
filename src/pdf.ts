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
                const textContent = await page.getTextContent();
                const operators = await page.getOperatorList();
                const annotations = await page.getAnnotations();
                const objs = page.commonObjs._objs;
    
                pages.push( { textContent: textContent, commonObjs: objs, annotations: annotations } );
            }
        }
        catch (err) {
            console.log(`Error ${err} loading ${file.path}.`)
        }
        return pages;
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
        let leftMarginL = 0;
        let yCoordL = 0, yCoordLL = 0;
        let strLL = '', widthLL = 0, heightLL = 0, transformLL : string[] = [], fontNameLL = '', hasEOLLL = false;
        let pageCounter = 0;
        
        let footnoteCounter = 1;
        let footnotes : Record<number, string> = {};

        // Make a parameter
        let includePageNumbersInFootnotes = true;
        let annotationQuads = [];

        for (let j = 0; j < pages.length; j++) {
            const page = pages[j];
            const textContent = page.textContent;
            const commonObjs = page.commonObjs;
            const annotations = page.annotations;

            let inCode = false;
            let newLine = true;
            let blockquote = false;

            // Make this a parameter perhaps
            const treatEOLasNewLine = false;

            for (let i = 0; i < textContent.items.length; i++) {
                const item = textContent.items[i];
                let markdownText = '';
                let { str } = item;
                const { dir, width, height, transform, fontName, hasEOL } = item;

                // Do check for whether any annotation bounding boxes overlap with this item
                // TODO: Refactor to a function

                // Handle annotations - highlight and comments as footnotes
                let highlightStart = false, highlightEnd = false;
                let highlightL = 0.0, highlightR = 1.0;
                let comment = false;
                let commentText = '';
                let parentID = undefined;

                let tp0 = { x: transform[4], y: transform[5] + height };
                let tp1 = { x: transform[4] + width, y: transform[5] + height };
                let tp2 = { x: transform[4], y: transform[5] };
                let tp3 = { x: transform[4] + width, y: transform[5] };

                // Allows for a gap between annotation and text boxes
                const Y_FUDGE = 2.0;
                for (let annotation of annotations) {
                    if (annotation.quadPoints !== undefined) {
                        for (let qi = 0; qi < annotation.quadPoints.length; qi++) {
                            const quad = annotation.quadPoints[qi];
                            // Do bounding box test
                            const p0 = quad[0];
                            const p1 = quad[1];
                            const p2 = quad[2];
                            const p3 = quad[3];

                            // if (p0.x < tp0.x && p0.y > tp0.y - Y_FUDGE && p3.x > tp3.x && p3.y < tp3.y) {
                            if (p0.y > tp0.y - Y_FUDGE && p3.y < tp3.y) {
                                if (qi == 0) {
                                    highlightStart = true;
                                    if (p0.x > tp0.x) {
                                        highlightL = ((p0.x - tp0.x) / (tp3.x - tp0.x));
                                    }
                                }
                                // Only set the parent ID if this is the last quad
                                // Because it is only then that we want to 
                                // [1] flag any comments
                                // [2] insert a footnote or attach comments to the text
                                if (qi == annotation.quadPoints.length - 1) {
                                    if (p3.x < tp3.x) {
                                        highlightR = ((p3.x - tp0.x) / (tp3.x - tp0.x));
                                    }
                                    parentID = annotation.id;
                                    highlightEnd = true;
                                    if (annotation.contents.trim().length > 0) {
                                        comment = true;

                                        if (includePageNumbersInFootnotes && commentText === '') {
                                            commentText = `[from page ${pageCounter + 1}] - `;
                                        }

                                        commentText += annotation.contents;
                                    }
                                }
                            }
                        }
                    }
                    else if (parentID !== undefined) {
                        if (annotation.parentID == parentID) {
                            if (annotation.type == 'Highlight') {
                                // highlightStart = true;
                            }
                            else if (annotation.type == 'Comment') {
                                comment = true;
                                commentText += annotation.contents;
                            }
                        }
                        else if (annotation.inReplyTo == parentID) {
                            comment = true;
                            commentText += annotation.contents;
                        }
                    }
                }

                let leftMargin = parseFloat(transform[4]);
                let yCoord = parseFloat(transform[5]);
                let italicised = false, bolded = false;
                const font = commonObjs[fontName];
                if (font) {
                    const fontDataName = font.data.name;
                    italicised = fontDataName.indexOf('Italic') > -1;
                    bolded = fontDataName.indexOf('Bold') > -1;
                }
                const leadingSpace = str.startsWith(' ') ? ' ' : '';
                const trailingSpace = str.endsWith(' ') ? ' ' : '';
                if (italicised && str.trim().length > 0)
                    str = `*${str.trim()}*${trailingSpace}`;
                else if (bolded && str.trim().length > 0)
                    str = `**${str.trim()}**${trailingSpace}`;


                // Handle any highlighting
                ({ str, footnoteCounter } = this.processHighlights(highlightStart, str, highlightL, highlightEnd, highlightR, comment, footnoteCounter, footnotes, commentText));

                    
                let yDiff = 0;
                let yDiff2 = 0;
                if (transformL.length > 0) 
                    yDiff = yCoordL - yCoord;
                if (transformLL.length > 0) 
                    yDiff2 = yCoordLL - yCoord;

                // If there's a change in height, a new line and an indentation, treat as a blockquote
                if (height > 0 && height < meanH && i > 0 && leftMargin > leftMarginL) {
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
                else if (strL.trim() != '' && hasEOLL && heightL == height) {
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

                            let lines = Math.floor(yDiff  / height);
                            lines = lines < 1 ? 1 : lines;
                            let linePadding = '\n'.repeat(lines);
                            // If the line is indented, add another line
                            if (lines > 0 && leftMargin > leftMarginL) 
                                linePadding += '\n';
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
                // In this (default) case we assume a new line
                else {
                    /*
                    In Case 1: 
                     - two items back has text at a certain y coordinate
                     - one line back has a zero-length string, and is an EOL marker
                     - this line has a y coordinate that is greater than twice the current line height apart from the previous text coordinate
                     */
                    if (hasEOLL && strL.trim() === "" && yDiff2 > height * 2) {   
                        let lines = Math.floor(yDiff2  / height);
                        lines = lines < 1 ? 1 : lines;
                        const linePadding = '\n'.repeat(lines);
                        markdownStrings[counter - 2] = markdownStrings[counter - 2] + (inCode ? "`" : "") + linePadding;
                    }
                    /*
                    In Case 2: 
                     - two items back has text at a certain y coordinate
                     - one line back has a zero-length string, and is an EOL marker
                     - this line has a y coordinate that is greater than twice the current line height apart from the previous text coordinate
                     */
                    else if (hasEOLL && strL.trim() === "" && yDiff > height) {   
                        let lines = Math.floor(yDiff  / height);
                        lines = lines < 1 ? 1 : lines;
                        const linePadding = '\n' + '\n'.repeat(lines);
                        markdownStrings[counter - 1] = markdownStrings[counter - 1] + (inCode ? "`" : "") + linePadding;
                    }
                    /*
                    Case 3: New page - add a trailing space to the last line
                    */
                    else if (i === 0) {
                        markdownStrings[counter - 1] = strL + (strL.endsWith(" ") ? "" : " ");
                    }

                    inCode = false;
                    newLine = true;

                    // Treat as a heading, and calculate the heading size by the height of the line
                    let heading = '';
                    let headingPadding = '';
                    let headingTrail = '';
                    if (height > meanH) {
                        const diffH = height / meanH - 1;
                        const headingSize = Math.ceil(0.5 / diffH);
                        if (headingSize <= 6) {
                            heading = "#".repeat(headingSize) + ' ';
                            headingPadding = "\n".repeat(7 - headingSize);
                            headingTrail = "\n".repeat(2);
                        }
                    }
                
                    markdownText += headingPadding;
                    markdownText += heading;
                    markdownText += str;
                    markdownText += headingTrail;
                }

                // Important! Escape all double brackets, and double spaces with single spaces
                markdownText = markdownText.replaceAll('[[', `\\[\\[`).replaceAll('  ', ' ');

                counter++;
                markdownStrings.push(markdownText);

                // Copy second last line
                strLL = strL;
                widthLL = widthL;
                heightLL = heightL;
                transformLL = transformL;
                fontNameLL = fontNameL;
                hasEOLLL = hasEOLL;
                yCoordLL = yCoordL;

                // If the current item is on the same line, don't update the left margin value
                if (transform[5] !== transformL[5] && str !== '')
                    leftMarginL = leftMargin;

                // Copy last line
                strL = markdownText;
                widthL = width;
                heightL = height;
                transformL = transform;
                fontNameL = fontName;
                hasEOLL = hasEOL;
                yCoordL = yCoord;

            }
            pageCounter++;
        }

        let markdownContents = markdownStrings.join('');
        markdownContents = `Source file: [[${file.path}]]\n\n${markdownContents}`;

        // Add any footnotes 
        for (let footnoteID in footnotes) {
            let footnoteText = footnotes[footnoteID];
            markdownContents += `\n\n[^${footnoteID}]: ${footnoteText}`;
        }

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
    
    private processHighlights(highlightStart: boolean, str: any, highlightL: number, highlightEnd: boolean, highlightR: number, comment: boolean, footnoteCounter: number, footnotes: Record<number, string>, commentText: string) {
        if (highlightStart) {
            let sl = str.length;
            if (sl > 0) {
                let hl = Math.floor(sl * highlightL);
                if (hl > 0 && str.charAt(hl) === ' ')
                    hl += 1;
                let highlightText1 = str.substr(0, hl);
                let highlightText2 = str.substr(hl);

                str = highlightText1 + `==${highlightText2}`;
            }
        }
        if (highlightEnd) {
            let sl = str.length;
            if (sl > 0) {
                let hr = Math.ceil(sl * highlightR);
                // Add the two highlight characters if part of the same block
                if (highlightStart)
                    hr += 2;
                let highlightText1 = str.substr(0, hr);
                let highlightText2 = str.substr(hr);

                // Add the footnote marker here
                if (comment) {
                    highlightText1 += `[^${footnoteCounter}]`;
                    footnotes[footnoteCounter] = commentText;
                    footnoteCounter++;
                }

                str = highlightText1 + `==${highlightText2}`;
            }
        }
        return { str, footnoteCounter };
    }

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