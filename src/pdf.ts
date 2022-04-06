import { 
    Vault, 
    TFile, 
    normalizePath,
    loadPdfJs } from 'obsidian';
import { TopicLinkingSettings } from './settings';
import { CiteprocFactory } from './citeproc';
import { formatBibtexAsMetadata } from './bibtex';
import { encode } from 'fast-png';
import datasets from '@stdlib/datasets/docs/types';

// From pdf.js src/shared/utils.js
const ImageKind = {
    GRAYSCALE_1BPP: 1,
    RGB_24BPP: 2,
    RGBA_32BPP: 3
  };

const DEBUG_PAGE : number = 0;

export class PDFContentExtractor {
    pdfjs: any;
    generatedPath: string;
    pdfPath: string;
    metadata: Record<string,any>;
    citeproc: CiteprocFactory;


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
     * Calculate mean text height across all pages. Used to determine if a given text block is a heading (if its text height is 
     * well above the mean).
     * @param pages of the PDF file
     */
    // calculateMeanTextHeight = (pages: Array<any>) => {
    calculateMeanTextHeight = async (pdf: any) => {
        let minH = -1, maxH = -1, totalH = 0, counterH = 0;
        for (let j = 0; j < pdf.numPages; j++) {
            const page = await pdf.getPage(j + 1);
            const textContent = await page.getTextContent();
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

            // Release page resources.
            page.cleanup();

        }

        return totalH / counterH;
    };

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
                const opList = await page.getOperatorList();
                const annotations = await page.getAnnotations();
                const commonObjs = page.commonObjs._objs;
                const objs = page.objs;

                for (let j = 0; j < opList.fnArray.length; j++) {
                    if (opList.fnArray[j] === this.pdfjs.OPS.paintImageXObject) {
                        let img : any = page.objs.get(opList.argsArray[j][0])
                        // Convert and save image to a PNG
                        if (img.kind === ImageKind.RGB_24BPP) { 
                            const imgSize : number = img.data.length;
                            const imgSizeNew = imgSize / 3 * 4;
                            let imgDataNew : number[] = new Array<number>(imgSizeNew);
                            for (let k = 0, l = 0; k < imgSize; k++, l++) {
                                imgDataNew[l] = img.data[k];
                                if (k % 3 == 2) {
                                    imgDataNew[(l++)+1] = 255;
                                }
                            }
                            const buffer = Buffer.from(imgDataNew);
                            const pngInput = { data: buffer, width: img.width, height: img.height };
                            const png = await encode(pngInput);
                            let bn = '';
                            if (file !== null)
                                bn = file.basename;
                            const imagePath = normalizePath(`${this.generatedPath}${bn}_${i+1}_${j+1}.png`);
                            const imageFile = <TFile> vault.getAbstractFileByPath(imagePath);
                            if (imageFile != null) 
                                await vault.delete(imageFile);
                            await vault.createBinary(imagePath, png);
                        }
                    }
                }
    
                pages.push( { textContent: textContent, opList: opList, commonObjs: commonObjs, annotations: annotations } );
                // Release page resources.
                page.cleanup();
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

        // const pages: Array<any> = await this.getContent(vault, file, fileCounter);
        const buffer = await vault.readBinary(file);
        let pdf = null;
        try {
            pdf = await this.pdfjs.getDocument(buffer).promise;
        }
        catch (e) {
            console.log(`Error loading ${file.path}: ${e}`);
            return;
        }
        
        console.log(`Loading file num ${fileCounter} at ${file.basename}, with: ${pdf.numPages} pages and size: ${file.stat.size / 1000}KB.`);

        const subPath = this.subPathFactory(file, this.pdfPath.length);
        const fileName: string = normalizePath(`${this.generatedPath}${subPath}${file.basename}.md`);
        let newFile = <TFile> vault.getAbstractFileByPath(fileName);
        if (newFile !== null)
            await vault.modify(newFile, '');
        else 
            newFile = await vault.create(fileName, '');

        class ObjectPosition {
            x: number;
            y: number;
            width: number; 
            height: number;
            obj: any;
            constructor(obj:any, x: number, y: number, width: number, height: number) {
                this.obj = obj;
                this.x = x;
                this.y = y;
                this.width = width;
                this.height = height;
            }
            format() {
                let str : string = this.obj;
                str = str.trimStart();
                return str;
            }
            copy() {
                return new ObjectPosition(this.obj, this.x, this.y, this.width, this.height);
            }
        }

        
        // ANNOTATION DATA
        // For footnotes
        let footnoteCounter = 1;
        let footnotes : Record<number, string> = {};
        // For annotation metadata
        let annotationMetadata : any[] = [];

        let pageCounter = 0;
        let annotatedObjs : any = {};


        pageCounter = 0;
        let leftMarginsOdd : Record<number, number> = {},
            leftMarginsEven : Record<number, number> = {};
        let totalH = 0, counterH = 0;
        let fontScale : number = 1;

        for (let j = 1; j <= pdf.numPages; j++) {
            const page = await pdf.getPage(j);
            const textContent = await page.getTextContent();
            const opList = await page.getOperatorList();
            const annotations = await page.getAnnotations();
            const commonObjs = page.commonObjs._objs;

            // For highlights
            let highlightAccumulate : boolean = false;
            let highlightAccumulator : string = '';

            if (j == DEBUG_PAGE) {
                // console.log(page)
                for (let i = 0; i < opList.fnArray.length; i++) {
                    const fnType : any = opList.fnArray[i];
                    const args : any = opList.argsArray[i];
                    console.log(fnType, args)
                }
            }

            for (let i = 0; i < textContent.items.length; i++) {
                const item = textContent.items[i];
                
                let { str } = item;
                const { dir, width, height, transform, fontName, hasEOL } = item;
                const x = item.transform[4];
                const y = item.transform[5];
                const obj = new ObjectPosition(str, x, y, width, height);
                
                const pseudoKey = Math.round(j * x * y);
                annotatedObjs[pseudoKey] = item;


                // Do check for whether any annotation bounding boxes overlap with this item
                // Handle annotations - highlight and comments as footnotes
                let { highlightStart, highlightEnd, highlightL, highlightR, isComment, commentRef, commentText} = this.applyAnnotations(
                                                        item, 
                                                        annotations, 
                                                        j);
                if (highlightStart) {
                    highlightAccumulate = true;
                    highlightAccumulator = '';
                }

                // Handle any highlighting
                ({ str, highlightAccumulate, highlightAccumulator, footnoteCounter, footnotes, annotationMetadata } = this.highlightHandler(
                                                        str, 
                                                        footnoteCounter, 
                                                        highlightStart, 
                                                        highlightL, 
                                                        highlightEnd, 
                                                        highlightR, 
                                                        isComment, 
                                                        footnotes, 
                                                        commentRef, 
                                                        commentText, 
                                                        highlightAccumulate, 
                                                        highlightAccumulator, 
                                                        annotationMetadata, 
                                                        pageCounter));

            }

            for (let i = 0; i < opList.fnArray.length; i++) {
                const fnType : any = opList.fnArray[i];
                const args : any = opList.argsArray[i];
                if (fnType === this.pdfjs.OPS.setTextMatrix) {
                    fontScale = args[0];
                    let yScale = args[3];
                    const x : number = args[4];
                    const y : number = args[5];
                    if (j % 2 === 0) {
                        leftMarginsEven[x] = (leftMarginsEven[x] === undefined) ? 1 : leftMarginsEven[x] + 1;
                    }
                    else {
                        leftMarginsOdd[x] = (leftMarginsOdd[x] === undefined) ? 1 : leftMarginsOdd[x] + 1;
                    }
                }
                else if(fnType === this.pdfjs.OPS.setFont) {
                    let fontSize : number = parseFloat(args[1]);
                    if (fontSize > 0) {
                        totalH += fontSize * fontScale;
                        counterH++;
                    }
                }
            }


            pageCounter++;

            page.cleanup();
        }

        // Calculate odd and even margins, average text height
        let leftMarginOddLikely : number = 1000, leftMarginOddLikelyCounter : number = 0;
        for (let key in leftMarginsOdd) {
            if (leftMarginsOdd[key] > leftMarginOddLikelyCounter) {
                leftMarginOddLikelyCounter = leftMarginsOdd[key];
                leftMarginOddLikely = parseFloat(key);
            } 
        }
        let leftMarginEvenLikely : number = 1000, leftMarginEvenLikelyCounter : number = 0;
        for (let key in leftMarginsEven) {
            if (leftMarginsEven[key] > leftMarginEvenLikelyCounter) {
                leftMarginEvenLikelyCounter = leftMarginsEven[key];
                leftMarginEvenLikely = parseFloat(key);
            }
        }
        let meanTextHeight : number = totalH / (counterH * 0.9);        

        let metadataContents = ``;
        if (this.metadata !== undefined && this.metadata[file.basename] !== undefined) {
            const itemMeta = this.metadata[file.basename];
            metadataContents += `---`;
            metadataContents += formatBibtexAsMetadata(itemMeta);
            metadataContents += `\n---`;
            const bib : string = this.citeproc.makeBibliography([itemMeta.citationKey]);
            metadataContents += `\n${bib}`;
            metadataContents += `\n[Open in Zotero](${itemMeta.select})`;
        }
        metadataContents += `\nSource: [[${file.path}]]`;
        if (annotationMetadata.length > 0) {
            metadataContents += `\n\n### Annotations\n`;
            for (let annotation of annotationMetadata) {
                metadataContents += `\n - "${annotation.highlightText.trim()}" [[#Page ${annotation.page}]]`;
                if (annotation.commentText !== '')
                    metadataContents += ` - **${annotation.commentText.trim()}**`;
                else
                    metadataContents += `.`;
            }
            
        }
        metadataContents += `\n\n`;
        await vault.append(newFile, metadataContents);


        let inBibliography : boolean = false;

        // Main loop through content
        footnoteCounter = 1;
        footnotes = {};

        for (let j = 1; j <= pdf.numPages; j++) {

            const page = await pdf.getPage(j);
            const opList = await page.getOperatorList();
            const annotations = await page.getAnnotations();
            const commonObjs = page.commonObjs._objs;

            let counter = 0;
            let inCode = false;

            // For highlights
            let highlightAccumulate : boolean = false;
            let highlightAccumulator : string = '';

            // Save images
            let displayCounter : number = 0;
            let imagePaths : Record<number, string> = [];

            const LINE_HEIGHT_MIN = -1.0;
            const LINE_HEIGHT_MAX = -1.5;

            let objPositions : ObjectPosition[] = [];
            let runningText : string = '';
            let positionRunningText : ObjectPosition = null;
            let positionImg : ObjectPosition = null;
            
            let processingText : boolean = false;

            let xScale : number = 0, yScale : number = 0;
            let xSpaces : number = 0;
            let xl = 0, yl = 0;
            let xOffset = 0, yOffset = 0;
            let xll = j % 2 == 1 ? leftMarginOddLikely : leftMarginEvenLikely;

            let italic : boolean = false, bold : boolean = false;
            let subscript : boolean = false, superscript : boolean = false;
            let newLine : boolean = false;

            let fontSize : number = 1;
            let fontScale : number = 1, lastFontScale : number = 1;


            // Helper functions
            const bounds = (test:number, min:number, max:number) =>  (test >= min && test <= max);

            const completeObject = (xn : number, yn: number, width: number, height: number) => {
                if (runningText.trim() !== '') {
                    if (runningText === 'BIBLIOGRAPHY')
                        inBibliography = true;

                    // Treat as a heading, and calculate the heading size by the height of the line
                    let { headingPadding, heading, headingTrail } = this.headingHandler(fontScale, meanTextHeight, runningText);
                    runningText = `${headingPadding}${heading}${runningText}${headingTrail}`;

                    if (highlightAccumulate) 
                        runningText = `${runningText}==`;
                    positionRunningText.obj = runningText;
                    positionRunningText.width = width;
                    positionRunningText.height = height - positionRunningText.x;
                    objPositions.push(positionRunningText);
                    runningText = '';
                    if (highlightAccumulate) 
                        runningText = `==${runningText}`;
                }
                positionRunningText = new ObjectPosition(runningText, xn, yn, 0, 0);
                lastFontScale = fontScale;
                fontScale = fontSize * yScale;
                newLine = false;
            };
                    
            // Loop through operators
            for (let i = 0; i < opList.fnArray.length; i++) {
                const fnType : any = opList.fnArray[i];
                const args : any = opList.argsArray[i];
                
                const pseudoKey = Math.round(j * xl * yl);
                let width = 0;
                if (annotatedObjs[pseudoKey] !== undefined) 
                    width = annotatedObjs[pseudoKey].width;
                if (fnType === this.pdfjs.OPS.beginText) {
                    // processing text
                    processingText = true;
                }
                else if (fnType === this.pdfjs.OPS.endText) {
                    // if (j == DEBUG_PAGE)
                    //     console.log('endText')
                    processingText = false;
                }
                else if (fnType === this.pdfjs.OPS.setFont) {
                    // processing font - look up from commonObjs
                            
                    const font : any = commonObjs[args[0]];
                    const fontDataName = font.data.name;
                    fontSize = parseFloat(args[1]);
                    // if (j == DEBUG_PAGE)  
                    //     console.log('setFont', fontScale, fontSize)
                    italic = (font.data.italic !== undefined ? font.data.italic : fontDataName.indexOf('Italic') > -1);
                    bold = (font.data.bold !== undefined ? font.data.bold : fontDataName.indexOf('Bold') > -1);
                }
                else if (fnType === this.pdfjs.OPS.setTextMatrix) {
                    xScale = args[0];
                    yScale = args[3];
                    const x : number = args[4];
                    const y : number = args[5];
                    let xn :number = x;// * xScale * fontSize;
                    let yn :number = y * Math.sign(yScale);
                    let xChange : number = xn - (xl + width);
                    let yChange : number = (yn - yl ) / (fontScale);
                    newLine = false;
                    superscript = false;
                    subscript = false;
                    let localFontScale = fontSize * yScale;

                    // if (positionRunningText != null && (bounds(-yChange, LINE_HEIGHT_MAX, 0))) {
                    if (positionRunningText != null && 
                         (bounds(-yChange, LINE_HEIGHT_MAX, LINE_HEIGHT_MIN) && x <= xll)) {
                        // Do nothing
                        newLine = bounds(-yChange, LINE_HEIGHT_MAX, LINE_HEIGHT_MIN);// && xChange <= 0;
                    }
                    else if (positionRunningText != null && 
                        (x > xl && Math.abs(yChange) < 0.5 && Math.abs(lastFontScale) >= Math.abs(fontScale))) {
                        // Do nothing
                        newLine = bounds(-yChange, LINE_HEIGHT_MAX, LINE_HEIGHT_MIN);// && xChange <= 0;
                        if (!newLine && Math.abs(fontScale) > Math.abs(localFontScale)) {
                            // subscript = yChange < 0 && yChange > LINE_HEIGHT_MAX;
                            superscript = yChange > 0 && yChange < -LINE_HEIGHT_MIN;
                        }
                    }
                    else {
                        completeObject(xn, yn, width, yl);

                        let xmax : number = Math.round(xn - Math.abs(fontScale) * 2);
                        let xmin : number = Math.round(xn - Math.abs(fontScale) * 5);
                        if (Math.abs(lastFontScale) > Math.abs(fontScale) && j % 2 === 0 && bounds(leftMarginEvenLikely, xmin, xmax)) {
                            runningText = `> ${runningText}`;
                        }
                        else if (Math.abs(lastFontScale) > Math.abs(fontScale) && j % 2 === 1 && bounds(leftMarginOddLikely, xmin, xmax)) {
                            runningText = `> ${runningText}`;
                        }
                    }
                    if (j == DEBUG_PAGE)
                        console.log("setTextMatrix", newLine, x, xl, xll, yScale, yChange, lastFontScale, fontScale)
                    xl = xn;
                    yl = yn;
                    xll = x;
                }
                else if (fnType === this.pdfjs.OPS.setLeadingMoveText || fnType === this.pdfjs.OPS.moveText) {
                    let x : number = args[0];
                    let y : number = args[1];
                    xOffset = x * fontScale;
                    yOffset = y * fontScale;
                    let xn :number = xl + xOffset;
                    let yn :number = yl + yOffset;
                    newLine = false;
                    // Review these conditions:
                    // 1. Next line, normal text
                    // 2. Next line, inside bibliography
                    // 3. Same line
                    if (!inBibliography && 
                        ((bounds(y, LINE_HEIGHT_MAX, LINE_HEIGHT_MIN) && x <= 0) || 
                            (Math.abs(y) < 0.1))) {
                        newLine = (bounds(y, LINE_HEIGHT_MAX, LINE_HEIGHT_MIN));
                        xSpaces = Math.abs(xn - xl) / fontScale;
                        // Do not create a new object
                    }
                    else if (inBibliography && 
                        ((j % 2 == 0 && bounds(y, LINE_HEIGHT_MAX, LINE_HEIGHT_MIN) && xn > leftMarginEvenLikely + xScale) || 
                         (j % 2 == 1 && bounds(y, LINE_HEIGHT_MAX, LINE_HEIGHT_MIN) && xn > leftMarginOddLikely + xScale) || 
                            (Math.abs(y) < 0.1))) {
                        newLine = (j % 2 == 0 && bounds(y, LINE_HEIGHT_MAX, LINE_HEIGHT_MIN) && xn > leftMarginEvenLikely + xScale) || 
                            (j % 2 == 1 && bounds(y, LINE_HEIGHT_MAX, LINE_HEIGHT_MIN) && xn > leftMarginOddLikely + xScale);
                        xSpaces = Math.abs(xn - xl) / fontScale;
                        // Do not create a new object
                    }
                    else {
                        completeObject(xn, yn, width, yl);
                    }
                    xl = xn;
                    yl = yn;
                    if (j == DEBUG_PAGE)
                        console.log("setLeadingMoveText", x, y, xl, yl);

                }
                else if (fnType === this.pdfjs.OPS.nextLine) {
                    yl += yOffset;
                }
                else if (fnType === this.pdfjs.OPS.showText) {
                    const chars : any[] = args[0];
                    let bufferText : string = '';
                    for (let k = 0; k < chars.length; k++) {
                        if (chars[k].unicode !== undefined) 
                            bufferText += chars[k].unicode;
                        else {
                            const code = parseFloat(chars[k]);
                            if (code < -100)
                                bufferText += ' ';
                        }
                    }
                    
                    if (runningText.length == 0 && bufferText.trim().length == 0) 
                        bufferText = '';
                    
                    if (newLine && runningText.length > 0 && !runningText.endsWith(' ') && !runningText.endsWith('\n') && bufferText.trim().length > 0) 
                        runningText += ' ';
                    if (!newLine && xSpaces > runningText.length && runningText.length > 0 && !runningText.endsWith(' ')) 
                        runningText += ' '; 

                    if (newLine && bufferText.trim().length == 0) {
                        runningText += '\n\n';
                        bufferText = '';
                    }
    

                    if (width === undefined)
                        width = bufferText.length * fontSize * xScale;

                    let height = fontScale;
                    let transform = [1, 0, 0, 1, xl, yl];
                    let item : any = { width: width, height: height, transform: transform, text: bufferText };

                    // Apply annotations
                    let results : any = this.applyAnnotations(item, annotations, j);
                    let { highlightStart, highlightEnd, highlightL, highlightR, isComment, commentRef, commentText} = results;
                    if (j == DEBUG_PAGE) 
                        console.log('showText', j, i, bufferText);
                        
                    if (highlightStart) {
                        highlightAccumulate = true;
                        highlightAccumulator = '';
                    }
    
                    const leadingSpace = bufferText.startsWith(' ') ? ' ' : '';
                    const trailingSpace = bufferText.endsWith(' ') ? ' ' : '';
                    if (bold && bufferText.trim().length > 0) {
                        if (runningText.endsWith('**')) {
                            runningText = runningText.substring(0, runningText.length - 2);
                            bufferText = `${bufferText.trim()}**${trailingSpace}`;
                        }
                        else 
                            bufferText = `**${bufferText.trim()}**${trailingSpace}`;
                    }
                    if (italic && bufferText.trim().length > 0) {
                        if (runningText.endsWith('*')) {
                            runningText = runningText.substring(0, runningText.length - 1);
                            bufferText = `${bufferText.trim()}*${trailingSpace}`;
                        }
                        else
                            bufferText = `*${bufferText.trim()}*${trailingSpace}`;
                    }
    
                    if (subscript)
                        bufferText = `<sub>${bufferText}</sub>`;
                    else if (superscript)
                        bufferText = `<sup>${bufferText}</sup>`;


                    // Handle any highlighting
                    let str = bufferText;
                    ({ str, highlightAccumulate, highlightAccumulator, footnoteCounter, footnotes, annotationMetadata } = this.highlightHandler(
                            bufferText, 
                            footnoteCounter, 
                            highlightStart, 
                            highlightL, 
                            highlightEnd, 
                            highlightR, 
                            isComment, 
                            footnotes, 
                            commentRef, 
                            commentText, 
                            highlightAccumulate, 
                            highlightAccumulator, 
                            annotationMetadata, 
                            j));
    
                    // if (j == DEBUG_PAGE)
                    //     console.log("showText", newLine, `%${bufferText}%`, `%${runningText}%`, `@${str}@`);
    
                    // Causes problems. Remove when safe to do so.
                    // if (str.trim().length == 0) 
                    //     str = '';

                    runningText += str;
                    // runningText += bufferText;

                    if ('BIBLIOGRAPHY' === bufferText.trim()) {
                        inBibliography = true;
                    }
                }
                else if (fnType === this.pdfjs.OPS.transform && settings.pdfExtractIncludeImages) {
                    const xScale : number = args[0];
                    const yScale : number = args[3];
                    const x : number = args[4];
                    const y : number = args[5];
                    const yAdj : number = y + yScale;
                    positionImg = new ObjectPosition(null, x, yAdj, 0, 0);
                }
                // Image handling
                else if (fnType === this.pdfjs.OPS.paintImageXObject && settings.pdfExtractIncludeImages) {

                    try {

                        let img = page.objs.get(args[0])
                        // Convert and save image to a PNG
                        if (img != null) { 
                            
                            let bn = '';
                            if (file !== null)
                                bn = file.basename;
                            const imageName = `${bn}_${j}_${i+1}`.replace(/\s+/g, '');
                            const imagePath = normalizePath(`${this.generatedPath}${imageName}.png`);
                            const imageFile = <TFile> vault.getAbstractFileByPath(imagePath);
                            const md = `![${imageName}](${imagePath})`;
                            imagePaths[displayCounter] = md;
                            
                            positionImg.width = img.width;
                            positionImg.height = img.height;
                            positionImg.obj = md;
                            objPositions.push(positionImg);

                            displayCounter++;
                            if (imageFile != null)
                                continue;
                                // For the moment, don't overwrite images - skip the following logic
                                // await vault.delete(imageFile);

                            let imgDataNew : number[] = [];
                            const imgSize : number = img.data.length;
                            if (img.kind === ImageKind.GRAYSCALE_1BPP) {
                                const imgSizeNew = imgSize / 1 * 4;
                                imgDataNew = new Array<number>(imgSizeNew);
                                for (let k = 0, l = 0; k < imgSize; k++, l+=4) {
                                    imgDataNew[l] = img.data[k];
                                    imgDataNew[l+1] = img.data[k];
                                    imgDataNew[l+2] = img.data[k];
                                    imgDataNew[l+3] = 255;
                                }
                            }
                            else if (img.kind === ImageKind.RGB_24BPP) {
                                const imgSizeNew = imgSize / 3 * 4;
                                imgDataNew = new Array<number>(imgSizeNew);
                                for (let k = 0, l = 0; k < imgSize; k++, l++) {
                                    imgDataNew[l] = img.data[k];
                                    if (k % 3 == 2) {
                                        imgDataNew[(l++)+1] = 255;
                                    }
                                }
                            }
                            else if (img.kind === ImageKind.RGBA_32BPP) {
                                imgDataNew = new Array<number>(imgSize);
                                for (let k = 0; k < imgSize; k++) {
                                    imgDataNew[k] = img.data[k];
                                }
                            }

                            const buffer = Buffer.from(imgDataNew);
                            const pngInput = { data: buffer, width: img.width, height: img.height };
                            const png = await encode(pngInput);
                            await vault.createBinary(imagePath, png);
                        }
                    }
                    catch (e) {
                        console.log(`Failed to process image in ${file.basename}. Error: ${e}.`);
                    }
                }
            }
            if (runningText.trim() !== '') {
                positionRunningText.obj = runningText;
                objPositions.push(positionRunningText);
            }

            // Sort objects by x position, where a.x must be greater than b.x + b.width, then by y position.
            /*
            Need to handle two use cases:
            1. Regular vertical flow (y-ordering)
            2. Multiple columns (y-then-x ordering)
            In the second case, consider four elements with <x,y> coordinates as follows:
            a = { x: 100, y: 600, width: 400 }
            b = { x: 0, y: 500, width: 200 }
            c = { x: 200, y: 500, width: 200 }
            d = { x: 0, y: 300, width: 200 }

            y-ordering would produce: a, b, c, d
            (x+width)-then-y ordering would produce: a, b, d, c
            */
            objPositions = objPositions.sort((a, b) => {
                let comp = 0;
                let yDiff = b.y - a.y;
                let xDiff = a.x - b.x;
                let axExtent = a.x + a.width;
                let bxExtent = b.x + b.width;
                let aComp = a.x - bxExtent;
                let bComp = b.x - axExtent;
                comp = aComp > 0 ? aComp : (bComp > 0 ? bComp : (yDiff === 0 ? xDiff : yDiff)); 
                return comp;
            });


            let mdStrings = objPositions.map((pos) => { return pos.format(); });
            mdStrings.splice(0, 0, `\n\n`);
            if (settings.pdfExtractIncludePagesAsHeadings) {
                mdStrings.splice(1, 0, `---\n## Page ${j}`);
            }
            let mdString : string = mdStrings.join('\n\n');
            // Various fixes
            mdString = mdString.replace(/(\w)\-\s(\w)/g, '$1$2');
            mdString = mdString.replace('ﬂ ', 'ﬂ');
            mdString = mdString.replace('ﬁ ', 'ﬁ ');

            if (j == DEBUG_PAGE) 
                console.log('objPositions', objPositions);

            pageCounter++;

            // Release page resources.
            page.cleanup();

            // let markdownContents = markdownStrings.join('');
            // await vault.append(newFile, markdownStrings.join(''));
            await vault.append(newFile, mdString);

        }

        // Add any footnotes 
        let footnoteContents : string = '\n\n---\n## Footnotes';
        for (let footnoteID in footnotes) {
            let footnoteText = footnotes[footnoteID];
            footnoteContents += `\n\n[^${footnoteID}]: ${footnoteText}`;
        }
        await vault.append(newFile, footnoteContents);

    };


    private headingHandler(height: any, meanTextHeight: number, str: any) {
        let heading = '';
        let headingPadding = '';
        let headingTrail = '';
        if (height > meanTextHeight) {
            const diffH = height / meanTextHeight - 1;
            const headingSize = Math.ceil(0.5 / diffH);
            if (headingSize <= 6) {
                heading = "#".repeat(headingSize) + ' ';
                headingPadding = "\n".repeat(Math.floor((6 - headingSize) / 2));
                // headingTrail = "\n".repeat(1);
            }
        }
        // In the case where all the text is upper case, treat as a level 3 heading
        // TODO: Probably needs to be another heading
        if (str.trim() !== '' && str.search(/[A-Z]/) >= 0 && str.toUpperCase() === str) {
            const headingSize = 3;
            if (headingSize <= 6) {
                heading = "#".repeat(headingSize) + ' ';
                headingPadding = "\n".repeat(Math.floor((6 - headingSize) / 2));
                // headingTrail = "\n".repeat(1);
            }
        }
        return { headingPadding, heading, headingTrail };
    }
    

    /**
     * 
     * @param item 
     * @param annotations 
     * @param pageCounter 
     * @returns 
     */
     applyAnnotations = (item: any, annotations: Array<any>, pageCounter: number) => {

        const { dir, width, height, transform, fontName, hasEOL } = item;

        let includePageNumbersInFootnotes = true;

        let highlightStart = false, highlightEnd = false;
        let highlightL = 0.0, highlightR = 1.0;
        let isComment = false;
        let commentRef = '';
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
                            if (annotation.contentsObj.str.trim().length > 0) {
                                isComment = true;

                                if (includePageNumbersInFootnotes && commentText === '') {
                                    commentRef = `#Page ${pageCounter}`;
                                }

                                commentText += annotation.contentsObj.str;
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
                        isComment = true;
                        commentText += annotation.contents;
                    }
                }
                else if (annotation.inReplyTo == parentID) {
                    isComment = true;
                    commentText += annotation.contents;
                }
            }
        }

        return { highlightStart: highlightStart, 
                highlightEnd: highlightEnd, 
                highlightL: highlightL, 
                highlightR: highlightR, 
                isComment: isComment, 
                commentRef: commentRef, 
                commentText: commentText };
    }
    


    /**
     * 
     * @param highlightStart 
     * @param str 
     * @param highlightL 
     * @param highlightEnd 
     * @param highlightR 
     * @param comment 
     * @param footnoteCounter 
     * @param footnotes 
     * @param commentText 
     * @returns 
     */
    processHighlights(str: any, highlightStart: boolean, highlightEnd: boolean, highlightL: number, highlightR: number, comment: boolean, commentRef: string, commentText: string, footnoteCounter: number, footnotes: Record<number, string>) {
        let highlightedText : string = '';
        if (highlightStart) {
            let sl = str.length;
            if (sl > 0) {
                let hl = Math.floor(sl * highlightL);
                if (hl > 0 && str.charAt(hl) === ' ')
                    hl += 1;
                else if (hl > 0 && str.charAt(hl - 1) !== ' ') 
                    hl -= 1;
                let highlightText1 = str.substr(0, hl);
                let highlightText2 = str.substr(hl);

                str = highlightText1 + `==${highlightText2}`;
                highlightedText += highlightText2;
            }
        }
        if (highlightEnd) {
            let sl = str.length;
            if (sl > 0) {
                let hr = Math.ceil(sl * highlightR);
                // Add the two highlight characters if part of the same block
                if (highlightStart)
                    hr += 2;
                else if (hr < sl)
                    hr -= 1;
                let highlightText1 = str.substr(0, hr);
                let highlightText2 = str.substr(hr);

                // Add the footnote marker here
                if (comment) {
                    highlightText1 += `[^${footnoteCounter}]`;
                    footnotes[footnoteCounter] = `[[${commentRef}]]: ${commentText}` ;
                    footnoteCounter++;
                }

                str = highlightText1 + `==${highlightText2}`;
                highlightedText += highlightText1;
            }
        }
        return { str, highlightedText, footnoteCounter, footnotes };
    }


    private highlightHandler(str: any, footnoteCounter: number, highlightStart: boolean, highlightL: number, highlightEnd: boolean, highlightR: number, comment: boolean, footnotes: Record<number, string>, commentRef: string, commentText: string, highlightAccumulate: boolean, highlightAccumulator: string, annotationMetadata: any[], pageCounter: number) {
        let highlightedText = '';
        ({ str, highlightedText, footnoteCounter, footnotes } = this.processHighlights(str, highlightStart, highlightEnd, highlightL, highlightR, comment, commentRef, commentText, footnoteCounter, footnotes));
        if (highlightAccumulate) {
            if (highlightedText.length > 0)
                highlightAccumulator += highlightedText + ' ';

            else
                highlightAccumulator += str + ' ';
        }
        if (highlightEnd) {
            annotationMetadata.push({ highlightText: highlightAccumulator, page: (pageCounter + 1), commentText: commentText });
            highlightAccumulate = false;
        }
        return { str, highlightAccumulate, highlightAccumulator, footnoteCounter, footnotes, annotationMetadata };
    }

    async extract(vault: Vault, settings: TopicLinkingSettings, statusBarItemEl: HTMLElement, metadata: Record<string, any>, citeproc: CiteprocFactory) {

        // Load PdfJs
		this.pdfjs = await loadPdfJs();
    
        this.citeproc = citeproc;

        statusBarItemEl.setText(`Extracting Markdown text from PDF files...`);

        this.generatedPath = settings.generatedPath;
        this.pdfPath = settings.pdfPath;
        this.metadata = metadata;
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