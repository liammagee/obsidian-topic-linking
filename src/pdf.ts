import { 
    Vault, 
    TFile, 
    normalizePath,
    loadPdfJs} from 'obsidian';
import { TopicLinkingSettings } from './settings';
import { CiteprocFactory } from './bibliography';
import { TemplateResolver } from './templates/resolver';
import nunjucks from 'nunjucks';
import { encode } from 'fast-png';
import { 
    ImageKind, 
    NEWLINE_DEVIANCE, 
    BLOCKQUOTE_DEVIANCE, 
    BLOCKQUOTE_MIN, 
    BLOCKQUOTE_MAX, 
    SUBSCRIPT_DEVIANCE, 
    JITTER, 
    COORD_TOLERANCE, 
    COLUMN_WIDTH_THRESHOLD,
    PAGE_HEADER_THRESHOLD,
    PAGE_FOOTER_THRESHOLD,
    LINE_HEIGHT_MIN, 
    LINE_HEIGHT_MAX 
}  from './pdf-params';
import { PDFDocumentState, PDFPageState, PDFObjectPosition } from './pdf-state';
import {     
    DEBUG_PAGE, 
    DEBUG_PAGE_MAX, 
    DEBUG_ITEM_START, 
    DEBUG_ITEM_END, 
    log } from './pdf-log';


export class PDFContentExtractor {
    pdfjs: any;
    generatedPath: string;
    pdfPath: string;
    metadata: Record<string,any>;
    citeproc: CiteprocFactory;
    templateHeader: nunjucks.Template;
    templatePage: nunjucks.Template;
    templateFooter: nunjucks.Template;

    constructor() {
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
    makeSubFolders = async (vault: Vault, files : Array<TFile>) => {
        const baseFolderImageLoc = normalizePath(`${this.generatedPath}images/`);
        try {
            await vault.createFolder(baseFolderImageLoc);
        } 
        catch (err) { // Ignore errors here - no way of testing for existing files
            console.log("error making folder: " + baseFolderImageLoc);
        }

        files.map(async (file) => {
            const subPath = this.subPathFactory(file, this.pdfPath.length);
            if (subPath.length > 0) {
                const folderLoc = normalizePath(`${this.generatedPath}${subPath}`);
                const folderImageLoc = normalizePath(`${folderLoc}images/`);
                try {
                    await vault.createFolder(folderLoc);
                } 
                catch (err) { // Ignore errors here - no way of testing for existing files
                }
                try {
                    await vault.createFolder(folderImageLoc);
                } 
                catch (err) { // Ignore errors here - no way of testing for existing files
                    console.log("error making folder: " + folderImageLoc);
                }
            }
        });
    };


    captureImage = async (vault: Vault, img: any, file: TFile, statePg: PDFPageState, j:number, i:number, imagePath: string) => {

        try {

            // Convert and save image to a PNG
            const yScale : number = statePg.transform[3];
            const x = statePg.transform[4];
            const y = statePg.transform[5];
            const yAdj : number = y + yScale;
                
            const bn = (file !== null) ? file.basename : '';
            const imageName = `${bn}_${j}_${i+1}`.replace(/\s+/g, '');
            const imagePathFull = normalizePath(`${imagePath}${imageName}.png`);
            const imageFile = <TFile> vault.getAbstractFileByPath(imagePathFull);
            const markdown = `![${imageName}](${imagePathFull})`;
            const positionImg = new PDFObjectPosition(markdown, x, yAdj, img.width, img.height);

            if (imageFile != null)
                return positionImg;
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
            await vault.createBinary(imagePathFull, png);
            return positionImg;
        }
        catch (e) {
            console.log(`Failed to process image in ${file.basename}. Error: ${e}.`);
            return null;
        }
    }

    /**
     * Processess a single PDF file, by page and item, and extracts Markdown text based on a series of basic heuristics.
     * @param file 
     * @param fileCounter 
     */
    processPDF = async (vault: Vault, settings: TopicLinkingSettings, file : TFile, fileCounter : number) => {

        let stateDoc : PDFDocumentState = new PDFDocumentState();

        const buffer = await vault.readBinary(file);
        let pdf = null;
        try {
            pdf = await this.pdfjs.getDocument(buffer).promise;
        }
        catch (e) {
            console.log(`Error loading ${file.path}: ${e}`);
            return;
        }

        // Clear console - remove for production
        if (DEBUG_PAGE > 0)
            console.clear();

        console.log(`Loading file num ${fileCounter} at ${file.basename}, with: ${pdf.numPages} pages and size: ${file.stat.size / 1000}KB.`);

        // Create a Markdown file for output
        const subPath = this.subPathFactory(file, this.pdfPath.length);
        const fullPath = `${this.generatedPath}${subPath}`;
        const imagePath = `${fullPath}images/`;
        const fileName: string = normalizePath(`${fullPath}${file.basename}.md`);
        let newFile = <TFile> vault.getAbstractFileByPath(fileName);
        if (newFile !== null)
            await vault.modify(newFile, '');
        else 
            newFile = await vault.create(fileName, '');

        // For margins
        let leftMarginsOdd : Record<number, number> = {},
            leftMarginsEven : Record<number, number> = {};
        let leftMarginsByPage : Record<number, number>[] = [];
        let totalH = 0, counterH = 0;
        let yAccumulator = 0, yCounter = 0, yLast = 0;
        let hAccumulator = 0, hCounter = 0, hLast = 0;
        let heightFrequencies: Record<number, number> = {};

        let textItems : any[] = [];

        // FIRST LOOP: extract annotations, and estimate line spacing and left margins
        for (let j = 1; j <= pdf.numPages && (DEBUG_PAGE_MAX <= 0 || j <= DEBUG_PAGE_MAX); j++) {
            stateDoc.currentPage = j;
            const page = await pdf.getPage(j);
            const textContent = await page.getTextContent();
            const annotations = await page.getAnnotations();
            const opList = await page.getOperatorList();

            let leftMarginsPage : Record<number, number> = {};

            // For debugging
            if (j == DEBUG_PAGE) {
                for (let i = 0; i < opList.fnArray.length; i++) {
                    const fnType : any = opList.fnArray[i];
                    const args : any = opList.argsArray[i];
                    if (i >= DEBUG_ITEM_START && i <= DEBUG_ITEM_END)
                        console.log(i, fnType, args)
                }
            }

            yLast = 0;
            for (let i = 0; i < textContent.items.length; i++) {
                const item = textContent.items[i];
                
                if (j == DEBUG_PAGE)
                    textItems.push(item);
                
                let { str } = item;
                const { dir, width, height, transform, fontName, hasEOL } = item;
                const x = item.transform[4];
                const y = item.transform[5];
                
                if (i > 0) {
                    let yChange = Math.abs(y - yLast);
                    if (yChange != 0 && yChange < hLast * 5.0) {
                        yAccumulator += yChange;
                        yCounter++;
                        hAccumulator += hLast;
                        hCounter++;
                    }
                }
                yLast = y;
                if (height > 0)
                    hLast = height;

                heightFrequencies[height] = (heightFrequencies[height] || 0) + str.trim().length;
                totalH += height;
                counterH++;

                // Do check for whether any annotation bounding boxes overlap with this item
                // Handle annotations - highlight and comments as footnotes
                let { stateDoc:PDFDocumentState, itemHighlights } = this.applyAnnotations(stateDoc, item, annotations);

                leftMarginsPage[x] = (leftMarginsPage[x] === undefined) ? 1 : leftMarginsPage[x] + 1;
                if (j % 2 === 0) 
                    leftMarginsEven[x] = (leftMarginsEven[x] === undefined) ? 1 : leftMarginsEven[x] + 1;
                else 
                    leftMarginsOdd[x] = (leftMarginsOdd[x] === undefined) ? 1 : leftMarginsOdd[x] + 1;

                // Handle any highlighting
                stateDoc.bufferText = str;
                stateDoc = this.highlightHandler(stateDoc, itemHighlights);
            }

            for (let i = 0; i < opList.fnArray.length; i++) {
                const fnType : any = opList.fnArray[i];
                const args : any = opList.argsArray[i];
                if (fnType === this.pdfjs.OPS.setTextMatrix) {
                    const x : number = args[4];
                    const y : number = args[5];
    
                }
                else if(fnType === this.pdfjs.OPS.setFont) {
                    // statePg.fontSize = parseFloat(args[1]);
                }
            }

            leftMarginsByPage.push(leftMarginsPage);

            // Important - clean up once page processing is done
            page.cleanup();
        }


        // Estimate line spacing
        stateDoc.estimateLineSpacing(yAccumulator, yCounter, hAccumulator, hCounter);
        // Calculate odd and even margins, average text height
        stateDoc.estimateMargins(leftMarginsOdd, leftMarginsEven);
        // Calculate average text height
        stateDoc.estimateTextHeight(totalH, counterH);
        stateDoc.estimateTextModeHeight(heightFrequencies);
        // console.log(heightFrequencies);
        console.log("Mean height: ",stateDoc.meanTextHeight);
        console.log("Mode height: ",stateDoc.modeTextHeight);

        // Append the metadata
        await this.createHeader(file, stateDoc, vault, newFile);

        // Reset document state
        stateDoc.resetState();


        // SECOND LOOP: Do content extraction
        for (let j = 1; j <= pdf.numPages && (DEBUG_PAGE_MAX <= 0 || j <= DEBUG_PAGE_MAX); j++) {
        // for (let j = DEBUG_PAGE; j <= DEBUG_PAGE; j++) {

            const page = await pdf.getPage(j);
            const opList = await page.getOperatorList();
            const annotations = await page.getAnnotations();
            const commonObjs = page.commonObjs._objs;

            // State variables
            stateDoc.currentPage = j;
            let statePg : PDFPageState = new PDFPageState();

            // View variables
            const v = page.view;
            const pageX = v[0];
            const pageY = v[1];
            const pageWidth = v[2];
            const pageHeight = v[3];
            
            statePg.xOffsetFromMargin = stateDoc.estimateMarginsForCollection(leftMarginsByPage[j - 1]);
            statePg.xOffsetBlockquote = statePg.xOffsetFromMargin;

            // Loop through operators
            for (let i = 0; i < opList.fnArray.length; i++) {
            // for (let i = DEBUG_ITEM_START; i < DEBUG_ITEM_END; i++) {
                const fnType : any = opList.fnArray[i];
                const args : any = opList.argsArray[i];

                
                if (fnType === this.pdfjs.OPS.beginText) {
                    // Begin text
                }
                else if (fnType === this.pdfjs.OPS.endText) {
                    // End of text
                    if (statePg.transform) {
                        statePg.xRunning = statePg.transform[4];
                        statePg.yRunning = statePg.transform[5];
                    }
                }
                else if (fnType === this.pdfjs.OPS.save) {
                    statePg.transforms.push(null);
                    if (j == DEBUG_PAGE && (i >= DEBUG_ITEM_START && i <= DEBUG_ITEM_END))
                        log(j, i, { fn: 'Save', t: statePg.transforms });
                }
                else if (fnType === this.pdfjs.OPS.transform) {
                    let x = args[4];
                    let y = args[5];
                    if (statePg.transform != undefined) {
                        x = statePg.transform[0] * x + statePg.transform[1] * y;
                        y = statePg.transform[2] * x + statePg.transform[3] * y;

                        // Multiply existing transform values
                        statePg.transform[0] *= args[0];
                        statePg.transform[1] *= args[1];
                        statePg.transform[2] *= args[2];
                        statePg.transform[3] *= args[3];
                    }
                    else {
                        statePg.transform = args;
                    }
                    // statePg.transform = args;
                    const tn = [1, 0, 0, 1, 0, 0];
                    tn[0] = args[0];
                    tn[1] = args[1];
                    tn[2] = args[2];
                    tn[3] = args[3];
                    tn[4] = args[4];
                    tn[5] = args[5];
                    statePg.transforms[statePg.transforms.length - 1] = tn;

                    const xScale = statePg.transform[0];
                    const yScale = statePg.transform[3];
                    statePg.xScale *= xScale;
                    statePg.yScale *= yScale;
                    statePg.xOrigin += x;
                    statePg.yOrigin += y;
                    statePg.xRunning = statePg.xOrigin;
                    statePg.yRunning = statePg.yOrigin;

                    if (j == DEBUG_PAGE && (i >= DEBUG_ITEM_START && i <= DEBUG_ITEM_END))
                        log(j, i, { fn: 'Transform', t: statePg.transforms, ti: statePg.transform });
                }
                else if (fnType === this.pdfjs.OPS.restore) {
                    const t = statePg.transforms.pop();
                    if (t != null) {
                        const xScale = t[0];
                        const yScale = t[3];
                        let x = t[4];
                        let y = t[5];
                        x = t[0] * x + t[1] * y;
                        y = t[2] * x + t[3] * y;
                        statePg.xScale /= xScale;
                        statePg.yScale /= yScale;
                        statePg.xOrigin -= x;
                        statePg.yOrigin -= y;
                        statePg.xRunning = statePg.xOrigin;
                        statePg.yRunning = statePg.yOrigin;
                        statePg.transform = [1,0,0,1,0,0];
                        for (let k = 0; k < statePg.transforms.length; k++) {
                            const tn = statePg.transforms[k];
                            if (tn != null) {
                                statePg.transform[0] *= tn[0];
                                statePg.transform[1] *= tn[1];
                                statePg.transform[2] *= tn[2];
                                statePg.transform[3] *= tn[3];
                            }
                        }
                    }
                    if (j == DEBUG_PAGE && (i >= DEBUG_ITEM_START && i <= DEBUG_ITEM_END))
                        log(j, i, { fn: 'Restore', t: statePg.transforms, ti: statePg.transform });
                }
                else if (fnType === this.pdfjs.OPS.setFont) {
                    // processing font - look up from commonObjs

                    // Get font properties
                    const font : any = commonObjs[args[0]];
                    const fontDataName = font.data.name;
                    if (fontDataName !== statePg.fontNameLast && statePg.fontNameLast != null) 
                        statePg.fontFaceChange = true;
                    statePg.fontNameLast = fontDataName;

                    statePg.italic = (font.data.italic !== undefined ? font.data.italic : fontDataName.indexOf('Italic') > -1 || fontDataName.endsWith('I'));
                    statePg.bold = (font.data.bold !== undefined ? font.data.bold : fontDataName.indexOf('Bold') > -1 || fontDataName.endsWith('B'));
                    statePg.fontSize = parseFloat(args[1]);
                    // Set this to 1, in case setTextMatrix is not called
                    if (statePg.yScale <= 0)
                        statePg.yScale = 1;
                }
                else if (fnType === this.pdfjs.OPS.setTextMatrix) {

                    statePg.xScale = args[0];
                    statePg.yScale = args[3];

                    // Get transform variables
                    let x0 = 1, y0 = 0;
                    let x1 = 0, y1 = 1;

                    if (statePg.transform) {
                        x0 = statePg.transform[0];
                        y0 = statePg.transform[1];
                        x1 = statePg.transform[2];
                        y1 = statePg.transform[3];
                    }

                    let x : number = args[4];
                    let y : number = args[5];
                    let xt = x0 * x + y0 * y;
                    let yt = x1 * x + y1 * y;
                    statePg.xOffset = xt;
                    statePg.yOffset = yt;
                    let xn : number = statePg.xOrigin + statePg.xOffset;
                    let yn : number = statePg.yOrigin + statePg.yOffset;

                    statePg.fontScale = statePg.fontSize * statePg.yScale;
                    statePg.fontTransform = statePg.fontScale * y1;
                    statePg.superscript = false;

                    let fontTransformMax = statePg.fontTransform;
                    if (Math.abs(fontTransformMax) < Math.abs(statePg.fontTransformLast))
                        fontTransformMax = statePg.fontTransformLast;
                    if (Math.abs(fontTransformMax) < Math.abs(statePg.fontTransform))
                        fontTransformMax = statePg.fontTransform;

                    // Represent change in coordinates in relative line terms
                    let yChange : number = (yn - statePg.yl) / (fontTransformMax);

                    const withinLineBounds = statePg.bounds(yChange, 
                                                                stateDoc.lineSpacingEstimateMax, 
                                                                stateDoc.lineSpacingEstimateMin);

                    let newBlock = false;
                    // Captures the case where the y coordinate change is not significant enough to mean a new line change
                    if (statePg.positionRunningText != null 
                        &&  
                            ((!statePg.blockquote && xn <= statePg.positionRunningText.x + JITTER) || 
                            // ((!statePg.blockquote && xn <= statePg.xOffsetFromMargin + JITTER) || 
                            (statePg.blockquote && xn >= statePg.xOffsetBlockquote - JITTER)) 
                        && withinLineBounds 
                        && Math.abs(statePg.fontTransform) > NEWLINE_DEVIANCE
                        )  {

                        // Do nothing
                        statePg.newLine = withinLineBounds;
                        if (!statePg.newLine && statePg.fontTransform < stateDoc.modeTextHeight * SUBSCRIPT_DEVIANCE) {
                            statePg.superscript = yChange > JITTER && 
                                            yChange < -stateDoc.lineSpacingEstimateMin;
                        }

                    }
                    else if (statePg.positionRunningText != null && 
                        (xn + COORD_TOLERANCE > statePg.xl && Math.abs(yChange) < COORD_TOLERANCE)) {
                        // (x > statePg.xl && Math.abs(yChange) < 0.5 && Math.abs(fontScaleLast) >= Math.abs(fontScale))) {
                        
                        // Do nothing
                        statePg.newLine = withinLineBounds;// && xChange <= 0;
                        if (!statePg.newLine && statePg.fontTransform < stateDoc.modeTextHeight * SUBSCRIPT_DEVIANCE) {
                            statePg.superscript = yChange > JITTER && 
                                            yChange < -stateDoc.lineSpacingEstimateMin;
                        }

                    }
                    else {

                        this.completeObject(stateDoc, statePg, xn, yn, statePg.width, statePg.yl);
                        newBlock = true;
                        let xmax : number = Math.round(xn - Math.abs(statePg.fontTransform) * BLOCKQUOTE_MIN);
                        let xmin : number = Math.round(xn - Math.abs(statePg.fontTransform) * BLOCKQUOTE_MAX);
                        if (statePg.fontTransform < stateDoc.modeTextHeight * BLOCKQUOTE_DEVIANCE && 
                            j % 2 === 0 && 
                            statePg.bounds(stateDoc.leftMarginEvenLikely, xmin, xmax)) {

                            statePg.runningText = `> ${statePg.runningText}`;
                            statePg.blockquote = true;
                            statePg.xOffsetBlockquote = xn;

                        }
                        else if (statePg.fontTransform < stateDoc.modeTextHeight * BLOCKQUOTE_DEVIANCE && 
                            j % 2 === 1 && 
                            statePg.bounds(stateDoc.leftMarginOddLikely, xmin, xmax)) {

                            statePg.runningText = `> ${statePg.runningText}`;
                            statePg.blockquote = true;
                            statePg.xOffsetBlockquote = xn;

                        }

                        statePg.superscript = Math.abs(statePg.fontTransform) < stateDoc.modeTextHeight * SUBSCRIPT_DEVIANCE;

                    }

                    statePg.superscript = statePg.fontTransform < stateDoc.modeTextHeight * SUBSCRIPT_DEVIANCE;
                    if (j == DEBUG_PAGE && (i >= DEBUG_ITEM_START && i <= DEBUG_ITEM_END))
                        console.log( {i, withinLineBounds, fontScale: statePg.fontScale, newBlock, xl: statePg.xl, fontTransformMax, yChange, modeTextHeight: stateDoc.modeTextHeight, fontTransform: statePg.fontTransform, args, xn, yn, xOffsetFromMargin: statePg.xOffsetFromMargin } );
                    
                    statePg.xll = statePg.xl;
                    statePg.xl = xn;
                    statePg.yl = yn;
                    statePg.runningWidth = 0;
                    statePg.xRunning = xn;
                    statePg.yRunning = yn;

                }
                else if (fnType === this.pdfjs.OPS.setLeadingMoveText || 
                        fnType === this.pdfjs.OPS.moveText) {
                    let x : number = args[0];
                    let y : number = args[1];
                    if (statePg.transform != null) {
                        x = statePg.transform[0] * x + statePg.transform[1] * y;
                        y = statePg.transform[2] * x + statePg.transform[3] * y;
                    }
                    else {
                        x = x * statePg.xScale;
                        y = y * statePg.yScale;
                    }
                    statePg.xOffset = x;
                    statePg.yOffset = y;
                    let xn:number = statePg.xRunning + statePg.xOffset;
                    let yn:number = statePg.yRunning + statePg.yOffset;
                
                    let yChange : number = (yn - statePg.yl ) / statePg.fontTransform;
                    statePg.newLine = false;

                    let withinLineBounds = statePg.bounds(yChange, 
                                                            stateDoc.lineSpacingEstimateMax, 
                                                            stateDoc.lineSpacingEstimateMin);
                    

                    // Review these conditions:
                    // 1. Next line, normal text
                    // 2. Next line, inside bibliography
                    // 3. Same line
                    if (statePg.positionRunningText != null && 
                        ((!statePg.blockquote && xn <= statePg.xOffsetFromMargin + JITTER) || 
                            (statePg.blockquote && xn >= statePg.xOffsetBlockquote - JITTER)) && 
                        withinLineBounds && 
                        Math.abs(statePg.fontTransform) > NEWLINE_DEVIANCE)  {
            
                        statePg.newLine = withinLineBounds;

                    }
                    else if (statePg.positionRunningText != null && 
                        (xn > statePg.xl && Math.abs(yChange) < .51)) {

                        statePg.newLine = withinLineBounds;

                    }
                    else if (stateDoc.inBibliography && 
                        ((j % 2 == 0 && withinLineBounds && 
                            xn > stateDoc.leftMarginEvenLikely + statePg.xScale) || 
                         (j % 2 == 1 && withinLineBounds && 
                            xn > stateDoc.leftMarginOddLikely + statePg.xScale) || 
                            (Math.abs(y) < 0.1))) {

                        statePg.newLine = (j % 2 == 0 && withinLineBounds && 
                                            xn > stateDoc.leftMarginEvenLikely + statePg.xScale) || 
                                        (j % 2 == 1 && withinLineBounds && 
                                            xn > stateDoc.leftMarginOddLikely + statePg.xScale);
                    }
                    else {

                        this.completeObject(stateDoc, statePg, xn, yn, statePg.width, statePg.yl);

                    }
                    if (j == DEBUG_PAGE && (i >= DEBUG_ITEM_START && i <= DEBUG_ITEM_END))
                        log(j, i, {fnType, sss: statePg.fontTransform < stateDoc.modeTextHeight * SUBSCRIPT_DEVIANCE, ss: stateDoc.modeTextHeight * SUBSCRIPT_DEVIANCE, t: statePg.transform, i, xOffsetFromMargin: statePg.xOffsetFromMargin, x, xScale: statePg.xScale, y, yScale: statePg.yScale, fontScale: statePg.fontScale, xRunning: statePg.xRunning, yRunning: statePg.yRunning, xn, yn, xl: statePg.xl, yl: statePg.yl, xll: statePg.xll,   yChange});

                    statePg.superscript = statePg.fontTransform < stateDoc.modeTextHeight * SUBSCRIPT_DEVIANCE;

                    statePg.xll = statePg.xl;
                    statePg.xl = xn;
                    statePg.yl = yn;
                    statePg.xRunning = xn;
                    statePg.yRunning = yn;

                }
                else if (fnType === this.pdfjs.OPS.setCharSpacing) {

                    let xn:number = statePg.xl + statePg.xOffset;
                    // statePg.xll = statePg.xl;
                    // statePg.xl = xn;
                    // statePg.xRunning = xn;
                    // statePg.newLine = false;

                }
                else if (fnType === this.pdfjs.OPS.nextLine) {
                    statePg.xl = statePg.positionRunningText.x;
                    statePg.yl += statePg.yOffset;
                    statePg.xRunning = statePg.xl;
                    statePg.yRunning += statePg.yOffset;
                    if (DEBUG_PAGE == j)
                        log(j, i, {fund: "Next line", i, yRunning: statePg.yRunning, yOffset: statePg.yOffset, yScale: statePg.yScale, yl: statePg.yl})
                }
                else if (fnType === this.pdfjs.OPS.showText) {
                    
                    const chars : any[] = args[0];
                    let bufferText : string = '';
                    let localWidth : number = 0;
                    let spaceCount : number = 0;
                    for (let k = 0; k < chars.length; k++) {
                        const c = chars[k];
                        if (c.unicode !== undefined) {
                            if (c.unicode === ' ') 
                                spaceCount++;
                            else
                                spaceCount = 0;
                            if (spaceCount < 2) {
                                bufferText += c.unicode;
                                localWidth += c.width;
                                // if (c.unicode !== ' ') 
                                //     localWidth += c.width;
                                // else
                                //     localWidth += 100;
                            }
                        }
                        else {
                            const code = parseFloat(c);
                            if (code < -100 && spaceCount < 2) {
                                spaceCount++;
                                bufferText += ' ';
                            }
                            else {
                                spaceCount = 0;
                            }
                            localWidth += Math.abs(code);
                        }
                    }


                    // Apply annotations
                    let transform = [1, 0, 0, 1, statePg.xl,  statePg.yl];
                    let item : any = { width: statePg.width, height: statePg.fontScale, transform: transform, text: bufferText };
                    let { stateDoc:PDFDocumentState, itemHighlights } : any = this.applyAnnotations(stateDoc, item, annotations);

                    // Rules for new lines
                    if (statePg.runningText.length == 0 && bufferText.trim().length == 0) 
                        bufferText = '';

                    // Set new running width
                    if (statePg.newLine)
                        statePg.runningWidth = statePg.xRunning;

                    if (statePg.newLine && 
                        statePg.runningText.length > 0 && 
                        !statePg.runningText.endsWith(' ') && 
                        !statePg.runningText.endsWith('\n') && 
                        bufferText.trim().length > 0) {

                        statePg.runningText += ' ';
                        statePg.runningWidth += Math.abs(statePg.fontTransform);
                        
                    }
                        
                       
                    if (!statePg.newLine && 
                        (
                            statePg.xl > statePg.runningWidth * 10.0 + statePg.xOrigin + statePg.xOffset
                            || 
                            statePg.xl < statePg.xll
                        ) && 
                        statePg.runningText.trim().length > 0 && 
                        !statePg.runningText.endsWith(' ') && 
                        !statePg.runningText.endsWith('==')) {

                        statePg.runningText += ' '; 
                        statePg.runningWidth += Math.abs(statePg.fontTransform);

                    }
                        
                    
                    if (statePg.fontFaceChange) {
                        // statePg.runningText += ' '; 
                        statePg.fontFaceChange = false;
                    }

                    if (statePg.newLine && bufferText.trim().length == 0) {
                        statePg.runningText += '\n\n';
                        bufferText = '';
                    }

                    // Complicated logic for handling hyphens at end-of-line. Looks to work,
                    // but could break in some circumstances
                    if (statePg.newLine && statePg.runningText.endsWith('-')) 
                        statePg.runningText = statePg.runningText.substring(0, statePg.runningText.length - 1);
                    else if (statePg.newLine && statePg.runningText.endsWith('- ')) 
                        statePg.runningText = statePg.runningText.substring(0, statePg.runningText.length - 2);
                    else if (bufferText.endsWith('- '))
                        bufferText = bufferText.substring(0, bufferText.length - 1);

                    statePg.sectionWidth = (Math.abs(statePg.fontTransform) * localWidth / 1000);
                    statePg.runningWidth = statePg.runningWidth + statePg.sectionWidth;

                    if (j == DEBUG_PAGE && (i >= DEBUG_ITEM_START && i <= DEBUG_ITEM_END))  
                        console.log({index: i, command: 'showText', lw: localWidth, ft: statePg.fontTransform, wc: (Math.abs(statePg.fontTransform) * localWidth / 1000), xOrigin: statePg.xOrigin, xOffset: statePg.xOffset, width: statePg.width, xll: statePg.xll, xl: statePg.xl, runningWidth: statePg.runningWidth, bufferText});

                    const leadingSpace = bufferText.startsWith(' ') ? ' ' : '';
                    const trailingSpace = bufferText.endsWith(' ') ? ' ' : '';

                    if (statePg.subscript)
                        bufferText = `<sub>${bufferText.trim()}</sub>${trailingSpace}`;
                    else if (statePg.superscript)
                        bufferText = `<sup>${bufferText.trim()}</sup>${trailingSpace}`;

                    if (statePg.bold && bufferText.trim().length > 0) {
                        if (statePg.runningText.endsWith('**')) {
                            statePg.runningText = statePg.runningText.substring(0, statePg.runningText.length - 2);
                            bufferText = `${bufferText.trim()}**${trailingSpace}`;
                        }
                        else 
                            bufferText = `**${bufferText.trim()}**${trailingSpace}`;
                    }
                    if (statePg.italic && bufferText.trim().length > 0) {
                        if (statePg.runningText.endsWith('*')) {
                            statePg.runningText = statePg.runningText.substring(0, statePg.runningText.length - 1);
                            bufferText = `${bufferText.trim()}*${trailingSpace}`;
                        }
                        else
                            bufferText = `*${bufferText.trim()}*${trailingSpace}`;
                    }

                    // Handle any highlighting
                    stateDoc.bufferText = bufferText;
                    stateDoc = this.highlightHandler(stateDoc, itemHighlights);
                    let str = stateDoc.bufferText;
                    
                    // Can cause problems. Remove when safe to do so.
                    // if (str.trim().length == 0) 
                    //     str = '';

                    statePg.runningText += str;
                    
                    if (statePg.runningWidth > statePg.width) 
                        statePg.width = statePg.runningWidth;
                    if (statePg.xl < statePg.positionRunningText.x) 
                        statePg.positionRunningText.x = statePg.xl;

                    if ('BIBLIOGRAPHY' === bufferText.trim()) {
                        stateDoc.inBibliography = true;
                    }
                }
                // Image handling
                else if (fnType === this.pdfjs.OPS.paintImageXObject && settings.pdfExtractIncludeImages) {

                    try {
                        let img = page.objs.get(args[0]);
                        if (img != null) {
                            let imageResult = await this.captureImage(vault, img, file, statePg, j, i, imagePath);
                            if (imageResult != null) 
                                statePg.objPositions.push(imageResult);
                        }
    
                    }
                    catch (e) {
                        console.log(`Error ${e}, working with ${file} on page ${j}, item ${i}`);
                    }
                }
            
            }

            // Release page resources.
            page.cleanup();

            if (statePg.runningText.trim() !== '') {
                statePg.positionRunningText.obj = statePg.runningText;
                // log(j, 2599, {runningWidth: statePg.runningWidth, width:statePg.width});
                statePg.positionRunningText.width = statePg.width;
                statePg.positionRunningText.height = statePg.yl - statePg.positionRunningText.y;
                statePg.objPositions.push(statePg.positionRunningText);
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
            // statePg.objPositions = statePg.objPositions.sort((a, b) => {                
            //     let yDiff = b.y - a.y;
            //     let xDiff = a.x - b.x;
            //     return (yDiff === 0 ? xDiff : yDiff);
            // });
            let objPositionsNew : PDFObjectPosition[] = [];
            // Tries to re-sort page objects to handle:
            // 1. Dual columns (where items with higher y values in a second column should come *after* all items in a first column)
            // 2. Header / footer items, which should appear in their original order
            for (let i = 0; i < statePg.objPositions.length; i++) {
                let a = statePg.objPositions[i];
                let swappingStart = -1;
                for (let k = i + 1; k < statePg.objPositions.length; k++) {
                    let b = statePg.objPositions[k];
                    let bxExtent = b.x + b.width;
                    if (a.x > bxExtent && 
                        a.x > pageWidth * COLUMN_WIDTH_THRESHOLD
                        && (a.y < pageHeight * PAGE_FOOTER_THRESHOLD && a.y > pageHeight * PAGE_HEADER_THRESHOLD)
                        ) {
                        if (!objPositionsNew.includes(b)) {
                            objPositionsNew.push(b);
                            swappingStart = k;
                        }
                    }
                }
                if (!objPositionsNew.includes(a))
                    objPositionsNew.push(a);
            }

            if (j == DEBUG_PAGE) {
                console.log(objPositionsNew)
                console.log(page.view)
            }
                

            let mdStrings = objPositionsNew.map((pos) => { return pos.format(); });

            let mdString : string = mdStrings.join('\n\n');
            // Various fixes - replace ligatures
            mdString = mdString.replaceAll('ﬂ', 'fl');
            mdString = mdString.replaceAll('ﬁ', 'fi');
            mdString = mdString.replaceAll('fi ', 'fi');
            mdString = mdString.replaceAll('fl ', 'fl');
            // Replace repeating superscripts
            mdString = mdString.replaceAll(/<\/sup>(\**)\s(\**)<sup>/g, ' ');
            mdString = mdString.replaceAll(/<\/sup><sup>/g, '');

            const pageOutput = this.templatePage.render({ pageNo: j, markdownOutput: mdString });
            await vault.append(newFile, pageOutput);

        }

        // Add any footnotes 
        let footnoteContents : string = this.templateFooter.render( { footnotes: stateDoc.footnotes } );
        await vault.append(newFile, footnoteContents);
    };


    private async createHeader(file: TFile, stateDoc: PDFDocumentState, vault: Vault, newFile: TFile) {
        let metadataContents = ``;
        let itemMeta: any = {};
        if (this.metadata !== undefined && this.metadata[file.basename] !== undefined) {
            itemMeta = this.metadata[file.basename];
            itemMeta.bib = this.citeproc.makeBibliography([itemMeta.citationKey]);
            itemMeta.authors = itemMeta.creators.map((creator: any) => creator.lastName + ', ' + creator.firstName).join('; ');
        }
        metadataContents += this.templateHeader.render({ 
                                filePath: file.path, 
                                item: itemMeta, 
                                annotations: stateDoc.annotationData, 
                                footnotes: stateDoc.footnotes 
                            });
        // Append metadata, both any bibtex content and annotations
        await vault.append(newFile, metadataContents);
    }



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
        if (str.trim() !== '' && str.search(/[A-Z]/) >= 0 && str.toUpperCase() === str && height > meanTextHeight * 0.9) {
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
     applyAnnotations = (stateDoc: PDFDocumentState, item: any, annotations: Array<any>) => {

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
                                    commentRef = `#Page ${stateDoc.currentPage}`;
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

        const itemHighlights = { highlightStart: highlightStart, 
            highlightEnd: highlightEnd, 
            highlightL: highlightL, 
            highlightR: highlightR, 
            isComment: isComment, 
            commentRef: commentRef, 
            commentText: commentText };

        stateDoc.itemHighlights = itemHighlights;
        if (itemHighlights.highlightStart) {
            stateDoc.highlightAccumulate = true;
            stateDoc.highlightAccumulator = '';
        }

        return { stateDoc, itemHighlights };
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
    processHighlights(stateDoc: PDFDocumentState, itemHighlights: any) {
        let {highlightStart, 
            highlightEnd, 
            highlightL, 
            highlightR, 
            isComment, 
            commentRef, 
            commentText} = itemHighlights;
        let highlightedText : string = '';
        let str = stateDoc.bufferText;
        if (highlightStart) {
            let sl = str.length;
            if (sl > 0) {
                let hl = Math.floor(sl * highlightL);
                if (hl > 0 && str.charAt(hl) === ' ')
                    hl += 1;
                else if (hl > 0 && str.charAt(hl - 1) !== ' ') 
                    hl -= 1;
                let highlightText1 = str.substring(0, hl);
                let highlightText2 = str.substring(hl);

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
                let highlightText1 = str.substring(0, hr);
                let highlightText2 = str.substring(hr);

                // Add the footnote marker here
                if (isComment) {
                    highlightText1 += `[^${stateDoc.footnoteCounter}]`;
                    stateDoc.footnotes[stateDoc.footnoteCounter] = `[[${commentRef}]]: ${commentText}` ;
                    stateDoc.footnoteCounter++;
                }

                str = highlightText1 + `==${highlightText2}`;
                highlightedText += highlightText1;
            }
        }
        stateDoc.bufferText = str;
        return { stateDoc, highlightedText };
    }


    private highlightHandler(stateDoc: PDFDocumentState, 
                                itemHighlights : any) {
        let highlightedText = '';
        ({ stateDoc, highlightedText } = this.processHighlights(stateDoc, itemHighlights));
        if (stateDoc.highlightAccumulate) {
            if (highlightedText.length > 0)
                stateDoc.highlightAccumulator += highlightedText + ' ';
            else
                stateDoc.highlightAccumulator += stateDoc.bufferText + ' ';
        }
        if (itemHighlights.highlightEnd) {
            stateDoc.addAnnotation(itemHighlights.commentText );
        }
        return stateDoc;
    }


    private completeObject = (stateDoc: PDFDocumentState, statePg: PDFPageState,  xn : number, yn: number, width: number, lastY: number) => {
        if (statePg.runningText.trim() !== '') {

            if (['bibliography', 'references'].includes(statePg.runningText.trim().toLowerCase()))
                stateDoc.inBibliography = true;

            // Treat as a heading, and calculate the heading size by the height of the line
            let { headingPadding, heading, headingTrail } = this.headingHandler(statePg.fontScaleLast, 
                                                                                stateDoc.modeTextHeight, 
                                                                                statePg.runningText);
            statePg.runningText = `${headingPadding}${heading}${statePg.runningText}${headingTrail}`;

            if (stateDoc.highlightAccumulate) 
                statePg.runningText = `${statePg.runningText}==`;

            statePg.positionRunningText.obj = statePg.runningText;
            statePg.positionRunningText.width = statePg.width;
            // log({txt:"Completing Object", fontScale: statePg.fontScale, yl: statePg.yl, y:statePg.positionRunningText.y})
            statePg.positionRunningText.height = Math.abs(statePg.fontScale + statePg.yl - statePg.positionRunningText.y);
            statePg.objPositions.push(statePg.positionRunningText);

            statePg.runningText = '';
            if (stateDoc.highlightAccumulate) 
                statePg.runningText = `==${statePg.runningText}`;
        }

        statePg.positionRunningText = new PDFObjectPosition(statePg.runningText, xn, yn, 0, 0);
        statePg.resetPageState();

    };




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

        // Initialise template
        this.templateHeader = await TemplateResolver.resolveTemplatePdfHeader(vault, settings.templatePdfHeader);
        this.templatePage = await TemplateResolver.resolveTemplatePdfPage(vault, settings.templatePdfPage);
        this.templateFooter = await TemplateResolver.resolveTemplatePdfFooter(vault, settings.templatePdfFooter);

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
