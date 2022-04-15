import { 
    Vault, 
    TFile, 
    normalizePath,
    loadPdfJs, 
    TAbstractFile} from 'obsidian';
import { TopicLinkingSettings } from './settings';
import { CiteprocFactory } from './bibliography';
import { TemplateResolver } from './templates/resolver';
import nunjucks from 'nunjucks';
import { encode } from 'fast-png';

// From pdf.js src/shared/utils.js
const ImageKind = {
    GRAYSCALE_1BPP: 1,
    RGB_24BPP: 2,
    RGBA_32BPP: 3
};
const DEBUG_PAGE : number = 0;
const DEBUG_PAGE_MAX : number = 0;
const DEBUG_ITEM_START : number = 0;
const DEBUG_ITEM_END : number = 1000;

// Constants for detecting line change
// Work on a way to calculate this dynamically for double-spaced texts
const LINE_HEIGHT_MIN = -0.75;
const LINE_HEIGHT_MAX = -1.3;



class PDFDocumentState {
    lineSpacingEstimateMin: number;
    lineSpacingEstimateMax: number;
    leftMarginOddLikely: number;
    leftMarginEvenLikely: number;
    meanTextHeight: number;
    modeTextHeight: number;
    footnoteCounter: number;
    footnotes: Record<number, string>;
    inBibliography: boolean;
    currentPage: number;
    annotationData: any[];
    itemHighlights: any;
    highlightAccumulate: boolean;
    highlightAccumulator: string;

    constructor() {
        this.resetState();
    }

    resetState() {
        this.currentPage = 0;
        this.footnoteCounter = 1;
        this.footnotes = {};
        this.inBibliography = false;
        this.highlightAccumulate = false;
        this.highlightAccumulator = '';
        this.annotationData = [];
    }


    /**
     * Estimate line spacing
     * @param yAccumulator 
     * @param yCounter 
     * @param hAccumulator 
     * @param hCounter 
     */
     estimateLineSpacing(yAccumulator: number, yCounter: number, hAccumulator: number, hCounter: number) {
        const yChangeAverage = yAccumulator / yCounter;
        const heightAverage = hAccumulator / hCounter;
        const lineSpacingAverage = yChangeAverage / heightAverage;
        let lineSpacingEstimateMin = lineSpacingAverage * LINE_HEIGHT_MIN;
        let lineSpacingEstimateMax = lineSpacingAverage * LINE_HEIGHT_MAX;
        this.lineSpacingEstimateMin = lineSpacingEstimateMin;
        this.lineSpacingEstimateMax = lineSpacingEstimateMax;
    }    


    /**
     * Estimates odd and event left margins
     * @param leftMarginsOdd 
     * @param leftMarginsEven 
     * @returns 
     */
    estimateMargins(leftMarginsOdd: Record<string, any>, leftMarginsEven: Record<string, any>) {
        let leftMarginOddLikely : number = 1000, leftMarginOddLikelyCounter : number = 0;
        let leftMarginEvenLikely : number = 1000, leftMarginEvenLikelyCounter : number = 0;
        for (let key in leftMarginsOdd) {
            if (leftMarginsOdd[key] > leftMarginOddLikelyCounter) {
                leftMarginOddLikelyCounter = leftMarginsOdd[key];
                leftMarginOddLikely = parseFloat(key);
            } 
        }
        for (let key in leftMarginsEven) {
            if (leftMarginsEven[key] > leftMarginEvenLikelyCounter) {
                leftMarginEvenLikelyCounter = leftMarginsEven[key];
                leftMarginEvenLikely = parseFloat(key);
            }
        }
        this.leftMarginOddLikely = leftMarginOddLikely;
        this.leftMarginEvenLikely = leftMarginEvenLikely;
    }


    estimateTextHeight(totalH: number, counterH: number) {
        this.meanTextHeight = totalH / (counterH * 0.8);
    }

    estimateTextModeHeight(heightFrequencies: Record<number, number>) {
        let heightMax: number = -1;
        let heightMode: number = -1;
        Object.keys(heightFrequencies).forEach((key:any) => {
            let value: number = heightFrequencies[key];
            if (value > heightMax) {
                heightMax = value;
                heightMode = key;
            }  
        });
        this.modeTextHeight = heightMode;
    }    

    addAnnotation(commentText: string) {
        const annotation : any = {
            highlightText: this.highlightAccumulator,
            page: this.currentPage,
            commentText: commentText
        }
        this.annotationData.push(annotation);
        this.highlightAccumulate = false;
    }


}


class PDFPageState {

}


class PDFObjectPosition {
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
        if (str.startsWith('* '))
            str = '\\' + str;
        str = str.replace('</sup> <sup>', ' ');
        return str;
    }
    copy() {
        return new PDFObjectPosition(this.obj, this.x, this.y, this.width, this.height);
    }
}


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


    captureImage = async (vault: Vault, page: any, args: any[], file: TFile, positionImg: PDFObjectPosition, displayCounter: number, j:number, i:number) => {

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
                
                positionImg.width = img.width;
                positionImg.height = img.height;
                positionImg.obj = md;

                displayCounter++;
                if (imageFile != null)
                    return {
                        counter: displayCounter + 1,
                        positionImg: positionImg,
                        md: md
                    };
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
                return {
                    counter: displayCounter + 1,
                    positionImg: positionImg,
                    md: md
                }
            }
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

        let stateDocument : PDFDocumentState = new PDFDocumentState();

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

        // Create a Markdown file for output
        const subPath = this.subPathFactory(file, this.pdfPath.length);
        const fileName: string = normalizePath(`${this.generatedPath}${subPath}${file.basename}.md`);
        let newFile = <TFile> vault.getAbstractFileByPath(fileName);
        if (newFile !== null)
            await vault.modify(newFile, '');
        else 
            newFile = await vault.create(fileName, '');


        // ANNOTATION DATA
        // For footnotes
        // For annotation metadata
        let annotationMetadata : any[] = [];
        let annotatedObjs : any = {};


        // For margins
        let leftMarginsOdd : Record<number, number> = {},
            leftMarginsEven : Record<number, number> = {};
        let totalH = 0, counterH = 0;
        let fontScale : number = 1;
        let fontSize : number = 1;
        let yAccumulator = 0, yCounter = 0, yLast = 0;
        let hAccumulator = 0, hCounter = 0, hLast = 0;
        let heightFrequencies: Record<number, number> = {};
        let heightStringLengths: Record<number, number> = {};

        // FIRST LOOP: extract annotations, and estimate line spacing and left margins
        for (let j = 1; j <= pdf.numPages && (DEBUG_PAGE_MAX <= 0 || j <= DEBUG_PAGE_MAX); j++) {
            stateDocument.currentPage = j;
            const page = await pdf.getPage(j);
            const textContent = await page.getTextContent();
            const annotations = await page.getAnnotations();
            const opList = await page.getOperatorList();

            // For debugging
            // if (j == DEBUG_PAGE) {
            //     for (let i = 0; i < opList.fnArray.length; i++) {
            //         const fnType : any = opList.fnArray[i];
            //         const args : any = opList.argsArray[i];
            //         console.log(fnType, args)
            //     }
            //     console.log(page)
            // }

            yLast = 0;
            for (let i = 0; i < textContent.items.length; i++) {
                const item = textContent.items[i];
                
                let { str } = item;
                const { dir, width, height, transform, fontName, hasEOL } = item;
                const x = item.transform[4];
                const y = item.transform[5];
                
                const pseudoKey = Math.round(j * 1000000 + y * 1000 + x);
                annotatedObjs[pseudoKey] = item;

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

                if (heightFrequencies[height] === undefined) 
                    heightFrequencies[height] = str.trim().length;
                else
                    heightFrequencies[height] += str.trim().length;
                // if (heightFrequencies[height] === undefined) 
                //     heightFrequencies[fontScale] = 1;
                // else
                //     heightFrequencies[height] += 1;
                totalH += height;
                counterH++;
                // totalH += height;
                // counterH++;

                // Do check for whether any annotation bounding boxes overlap with this item
                // Handle annotations - highlight and comments as footnotes
                let { stateDocument:PDFDocumentState, itemHighlights } = this.applyAnnotations(stateDocument, item, annotations);

                // if (j == DEBUG_PAGE)
                //     console.log(str, itemHighlights);

                // Handle any highlighting
                ({ stateDocument, str } = this.highlightHandler(
                                                        stateDocument, 
                                                        str, 
                                                        itemHighlights));

            }

        
            for (let i = 0; i < opList.fnArray.length; i++) {
                const fnType : any = opList.fnArray[i];
                const args : any = opList.argsArray[i];
                if (fnType === this.pdfjs.OPS.setTextMatrix) {
                    let xScale = args[0];
                    let yScale = args[3];
                    const x : number = args[4];
                    const y : number = args[5];
                    if (j % 2 === 0) 
                        leftMarginsEven[x] = (leftMarginsEven[x] === undefined) ? 1 : leftMarginsEven[x] + 1;
                    else 
                        leftMarginsOdd[x] = (leftMarginsOdd[x] === undefined) ? 1 : leftMarginsOdd[x] + 1;

                    // Alternative way of calculating text heights / widths
                    /*
                    if (fontSize > 0) {
                        let fontScale = fontSize * xScale;
                        if (heightFrequencies[fontScale] === undefined)
                            heightFrequencies[fontScale] = 1;
                        else
                            heightFrequencies[fontScale] += 1;
                        totalH += fontScale;
                        counterH++;
                    }
                    */
    
                }
                else if(fnType === this.pdfjs.OPS.setFont) {
                    fontSize = parseFloat(args[1]);
                }
            }

            // Important - clean up once page processing is done
            page.cleanup();
        }


        // Estimate line spacing
        stateDocument.estimateLineSpacing(yAccumulator, yCounter, hAccumulator, hCounter);
        // Calculate odd and even margins, average text height
        stateDocument.estimateMargins(leftMarginsOdd, leftMarginsEven);
        // Calculate average text height
        stateDocument.estimateTextHeight(totalH, counterH);
        stateDocument.estimateTextModeHeight(heightFrequencies);
        // console.log(heightFrequencies);
        console.log("Mean height: ",stateDocument.meanTextHeight);
        console.log("Mode height: ",stateDocument.modeTextHeight);

        // Append the metadata
        await this.createHeader(file, stateDocument, vault, newFile);

        // Reset document state
        stateDocument.resetState();


        // SECOND LOOP: Do content extraction
        for (let j = 1; j <= pdf.numPages && (DEBUG_PAGE_MAX <= 0 || j <= DEBUG_PAGE_MAX); j++) {

            let statePage : PDFPageState = new PDFPageState();

            stateDocument.currentPage = j;
            const page = await pdf.getPage(j);
            const opList = await page.getOperatorList();
            const annotations = await page.getAnnotations();
            const textContent = await page.getTextContent();
            const commonObjs = page.commonObjs._objs;

            let inCode = false;

            // Save images
            let displayCounter : number = 0;
            let imagePaths : Record<number, string> = [];

            let objPositions : PDFObjectPosition[] = [];
            let runningText : string = '';
            let positionRunningText : PDFObjectPosition = null;
            let positionImg : PDFObjectPosition = null;

            // Coordinate variables
            // Set scale to 1 by default (in case setTextMatrix is not called)
            let xScale : number = 1;
            let yScale : number = 1;
            let xl = 0, yl = 0;
            let xOffset = 0, yOffset = 0;
            let xOffsetFromMargin = j % 2 == 1 ? stateDocument.leftMarginOddLikely : stateDocument.leftMarginEvenLikely;
            let runningWidth : number = 0;

            let italic : boolean = false;
            let bold : boolean = false;
            let subscript : boolean = false;
            let superscript : boolean = false;
            let newLine : boolean = false;

            let fontSize : number = 1;
            let fontScale : number = 1;
            let fontScaleLast : number = 1;

            let associatedItem = null;

            // Helper functions
            // These make use of local variables, need to remain in scope
            const bounds = (test:number, min:number, max:number) =>  (test >= min && test <= max);

            const completeObject = (xn : number, yn: number, width: number, height: number) => {
                if (runningText.trim() !== '') {
                    if (runningText === 'BIBLIOGRAPHY')
                        stateDocument.inBibliography = true;

                    // Treat as a heading, and calculate the heading size by the height of the line
                    if (j == DEBUG_PAGE)
                        console.log("fontScale", fontScale);
                    let { headingPadding, heading, headingTrail } = this.headingHandler(fontScale, stateDocument.modeTextHeight, runningText);
                    runningText = `${headingPadding}${heading}${runningText}${headingTrail}`;

                    if (stateDocument.highlightAccumulate) 
                        runningText = `${runningText}==`;

                    positionRunningText.obj = runningText;
                    positionRunningText.width = width;
                    positionRunningText.height = height - positionRunningText.x;
                    objPositions.push(positionRunningText);
                    runningText = '';
                    
                    if (stateDocument.highlightAccumulate) 
                        runningText = `==${runningText}`;
                }
                positionRunningText = new PDFObjectPosition(runningText, xn, yn, 0, 0);
                fontScaleLast = fontScale;
                fontScale = fontSize * yScale;
                
                newLine = false;
                runningWidth = 0;

                return true;
            };
            // if (j == DEBUG_PAGE)  
            //     console.log("annotatedObjs", annotatedObjs)

            if (positionRunningText !== null) {
                positionRunningText.obj = runningText;
                objPositions.push(positionRunningText);
            }
                            
            // Loop through operators
            for (let i = 0; i < opList.fnArray.length; i++) {
                const fnType : any = opList.fnArray[i];
                const args : any = opList.argsArray[i];
                
                const pseudoKey = Math.round(j * 1000000 + yl * 1000 + xl);
                associatedItem = annotatedObjs[pseudoKey] !== undefined ? annotatedObjs[pseudoKey] : associatedItem;
                let width = (associatedItem !== null) ? associatedItem.width : 0;
                
                if (fnType === this.pdfjs.OPS.beginText) {
                    // Begin text
                }
                else if (fnType === this.pdfjs.OPS.endText) {
                    // End of text
                }
                else if (fnType === this.pdfjs.OPS.setFont) {
                    // processing font - look up from commonObjs

                    // Get font properties
                    const font : any = commonObjs[args[0]];
                    const fontDataName = font.data.name;
                    italic = (font.data.italic !== undefined ? font.data.italic : fontDataName.indexOf('Italic') > -1);
                    bold = (font.data.bold !== undefined ? font.data.bold : fontDataName.indexOf('Bold') > -1);
                    fontSize = parseFloat(args[1]);
                }
                else if (fnType === this.pdfjs.OPS.setTextMatrix) {
                    xScale = args[0];
                    const x : number = args[4];
                    let xn :number = x;// * xScale * fontSize;
                    let xChange : number = xn - (xl + width);

                    yScale = args[3];
                    const y : number = args[5];
                    let ySign = Math.sign(yScale);
                    let yn :number = y * ySign;

                    newLine = false;
                    superscript = false;
                    subscript = false;
                    let fontScaleNew = fontSize * yScale;
                    let fontScaleMax = fontScale;
                    if (Math.abs(fontScaleMax) < Math.abs(fontScaleLast))
                        fontScaleMax = fontScaleLast;
                    if (Math.abs(fontScaleMax) < Math.abs(fontScaleNew))
                        fontScaleMax = fontScaleNew;
                    let yChange : number = (yn - yl) / (fontScaleMax * ySign);


                    let completedObject = false;

                    const NEWLINE_DEVIANCE = 0.9;
                    const BLOCKQUOTE_DEVIANCE = 0.97;
                    const SUBSCRIPT_DEVIANCE = 0.8;
                    const Y_JITTER = 0.01;

                    const withinLineBounds = bounds(yChange, stateDocument.lineSpacingEstimateMax, stateDocument.lineSpacingEstimateMin);

                    // Captures the case where the y coordinate change is not significant enough to mean a nwe line change
                    if (positionRunningText != null && x <= xOffsetFromMargin && 
                        withinLineBounds && 
                        Math.abs(fontScaleNew) > fontScale * NEWLINE_DEVIANCE)  {
                               // Do nothing
                        newLine = withinLineBounds;// && xChange <= 0;
                        if (!newLine && fontScaleNew < stateDocument.modeTextHeight * SUBSCRIPT_DEVIANCE) {
                            superscript = yChange > Y_JITTER && 
                                            yChange < -stateDocument.lineSpacingEstimateMin;
                        }
                    }
                    else if (positionRunningText != null && 
                        (x > xl && Math.abs(yChange) < .51)) {
                        // (x > xl && Math.abs(yChange) < 0.5 && Math.abs(fontScaleLast) >= Math.abs(fontScale))) {
                        // Do nothing
                        newLine = withinLineBounds;// && xChange <= 0;
                        if (!newLine && fontScaleNew < stateDocument.modeTextHeight * SUBSCRIPT_DEVIANCE) {
                            superscript = yChange > Y_JITTER && 
                                            yChange < -stateDocument.lineSpacingEstimateMin;
                        }
                    }
                    else {
                        completeObject(xn, yn, width, yl);
                        completedObject = true;

                        let xmax : number = Math.round(xn - Math.abs(fontScale) * 2);
                        let xmin : number = Math.round(xn - Math.abs(fontScale) * 4);
                        if (fontScale < stateDocument.modeTextHeight * BLOCKQUOTE_DEVIANCE && 
                            j % 2 === 0 && 
                            bounds(stateDocument.leftMarginEvenLikely, xmin, xmax)) {
                            runningText = `> ${runningText}`;
                        }
                        else if (fontScale < stateDocument.modeTextHeight * BLOCKQUOTE_DEVIANCE && 
                            j % 2 === 1 && 
                            bounds(stateDocument.leftMarginOddLikely, xmin, xmax)) {
                            runningText = `> ${runningText}`;
                        }

                        superscript = //Math.abs(fontScaleLast) > Math.abs(fontScale) && 
                                    Math.abs(fontScale) < stateDocument.modeTextHeight * SUBSCRIPT_DEVIANCE ;
                                    // && yChange > 0.01;
                                    //  && yChange < -stateDocument.lineSpacingEstimateMin;
                    }
                    if (j == DEBUG_PAGE && (i >= DEBUG_ITEM_START && i <= DEBUG_ITEM_END))
                        console.log(`setTextMatrix ${i}`, 
                        fontScale < stateDocument.modeTextHeight * SUBSCRIPT_DEVIANCE, 
                        fontScale, 
                        stateDocument.modeTextHeight * NEWLINE_DEVIANCE, superscript, withinLineBounds, completedObject )
                    xl = xn;
                    yl = yn;
                    xOffsetFromMargin = xn;
                }
                else if (fnType === this.pdfjs.OPS.setLeadingMoveText || fnType === this.pdfjs.OPS.moveText) {
                    let x : number = args[0];
                    let y : number = args[1];
                    xOffset = x * fontScale;
                    yOffset = y * fontScale;
                    let xn :number = xl + xOffset;
                    let yn :number = yl + yOffset;
                    let yChange : number = (yn - yl ) / fontScale;
                    newLine = false;
                    const withinLineBounds = bounds(yChange, stateDocument.lineSpacingEstimateMax, stateDocument.lineSpacingEstimateMin);
                    // Review these conditions:
                    // 1. Next line, normal text
                    // 2. Next line, inside bibliography
                    // 3. Same line
                    if (!stateDocument.inBibliography && 
                        ((withinLineBounds && x <= 0) || 
                            (Math.abs(yChange) < 0.1))) {
                        newLine = withinLineBounds;
                    }
                    else if (stateDocument.inBibliography && 
                        ((j % 2 == 0 && withinLineBounds && 
                            xn > stateDocument.leftMarginEvenLikely + xScale) || 
                         (j % 2 == 1 && withinLineBounds && 
                            xn > stateDocument.leftMarginOddLikely + xScale) || 
                            (Math.abs(y) < 0.1))) {

                        newLine = (j % 2 == 0 && withinLineBounds && 
                                xn > stateDocument.leftMarginEvenLikely + xScale) || 
                            (j % 2 == 1 && withinLineBounds && 
                                xn > stateDocument.leftMarginOddLikely + xScale);

                    }
                    else {
                        completeObject(xn, yn, width, yl);
                    }

                    if (j == DEBUG_PAGE && (i >= DEBUG_ITEM_START && i <= DEBUG_ITEM_END))
                        console.log(`setLeadingMoveText ${i}`, yChange, fontScale, x, y, xl, yl, xn, yn);
                    xl = xn;
                    yl = yn;

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

                    // Apply annotations
                    let height = fontScale;
                    let transform = [1, 0, 0, 1, xl, yl];
                    let item : any = { width: width, height: height, transform: transform, text: bufferText };
                    let { stateDocument:PDFDocumentState, itemHighlights } : any = this.applyAnnotations(stateDocument, item, annotations);

                    // Rules for new lines
                    if (runningText.length == 0 && bufferText.trim().length == 0) 
                        bufferText = '';

                    if (newLine && runningText.length > 0 && !runningText.endsWith(' ') && !runningText.endsWith('\n') && bufferText.trim().length > 0) 
                        runningText += ' ';
                    
                    if (!newLine && (xl > runningWidth || xl < xOffsetFromMargin) && runningText.trim().length > 0 && !runningText.endsWith(' ') && !runningText.endsWith('==')) 
                        runningText += ' '; 

                    if (newLine && bufferText.trim().length == 0) {
                        runningText += '\n\n';
                        bufferText = '';
                    }

                    // Complicated logic for handling hyphens at end-of-line. Looks to work,
                    // but could break in some circumstances
                    if (newLine && runningText.endsWith('-')) 
                        runningText = runningText.substring(0, runningText.length - 1);
                    else if (newLine && runningText.endsWith('- ')) 
                        runningText = runningText.substring(0, runningText.length - 2);
                    else if (bufferText.endsWith('- '))
                        bufferText = bufferText.substring(0, bufferText.length - 1);
                    // if (j == DEBUG_PAGE)  
                    //     console.log('showText', newLine, j, i, bufferText);

                    if (j == DEBUG_PAGE && (i >= DEBUG_ITEM_START && i <= DEBUG_ITEM_END))
                        console.log(`showText ${i}`, runningWidth, xl, xOffsetFromMargin, pseudoKey, newLine, `%${bufferText}%`, `%${runningText}%`); //, `@${associatedItem.str}@`

                    let tmpWidth = bufferText.length * fontSize * xScale;
                    runningWidth = xl + tmpWidth / 3;

                    if (subscript)
                        bufferText = `<sub>${bufferText}</sub> `;
                    else if (superscript)
                        bufferText = `<sup>${bufferText}</sup> `;

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

                    // Handle any highlighting
                    let str = '';
                    ({ stateDocument, str } = this.highlightHandler(
                            stateDocument, 
                            bufferText, 
                            itemHighlights));
    
                    // stateDocument.footnoteCounter = footnoteCounter;
                    // stateDocument.footnotes = footnotes;
    
                    // Causes problems. Remove when safe to do so.
                    if (str.trim().length == 0) 
                        str = '';

                    runningText += str;
                    // runningText += bufferText;

                    if ('BIBLIOGRAPHY' === bufferText.trim()) {
                        stateDocument.inBibliography = true;
                    }
                }
                else if (fnType === this.pdfjs.OPS.transform && settings.pdfExtractIncludeImages) {
                    const xScale : number = args[0];
                    const yScale : number = args[3];
                    const x : number = args[4];
                    const y : number = args[5];
                    const yAdj : number = y + yScale;
                    positionImg = new PDFObjectPosition(null, x, yAdj, 0, 0);
                }
                // Image handling
                else if (fnType === this.pdfjs.OPS.paintImageXObject && settings.pdfExtractIncludeImages) {

                    let { counter, positionImg:PDFObjectPosition, md } = await this.captureImage(vault, page, args, file, positionImg, displayCounter, j, i);
                    displayCounter = counter;
                    imagePaths[displayCounter] = md;
                    objPositions.push(positionImg);
    
                }
            }

            // Release page resources.
            page.cleanup();

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
            // mdStrings.splice(0, 0, `\n\n`);
            // if (settings.pdfExtractIncludePagesAsHeadings) {
            //     mdStrings.splice(1, 0, `---\n## Page ${j}`);
            // }
            let mdString : string = mdStrings.join('\n\n');
            // Various fixes
            // mdString = mdString.replace(/(\w)\-\s(\w)/g, '$1$2');

            // Replace ligatures
            mdString = mdString.replaceAll('ﬂ', 'fl');
            mdString = mdString.replaceAll('ﬁ', 'fi');
            mdString = mdString.replaceAll('</sup> <sup>', ' ');
            // mdString = mdString.replace(/(\ +)/g, ' ');

            if (j == DEBUG_PAGE)  {
                // console.log("textContent", textContent);
                console.log('objPositions', objPositions);
            }

            const pageOutput = this.templatePage.render({ pageNo: j, markdownOutput: mdString });
            await vault.append(newFile, pageOutput);

        }

        // Add any footnotes 
        let footnoteContents : string = this.templateFooter.render( { footnotes: stateDocument.footnotes } );
        await vault.append(newFile, footnoteContents);
    };


    private async createHeader(file: TFile, stateDocument: PDFDocumentState, vault: Vault, newFile: TFile) {
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
                                annotations: stateDocument.annotationData, 
                                footnotes: stateDocument.footnotes 
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
     applyAnnotations = (stateDocument: PDFDocumentState, item: any, annotations: Array<any>) => {

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
                                    commentRef = `#Page ${stateDocument.currentPage}`;
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

        stateDocument.itemHighlights = itemHighlights;
        if (itemHighlights.highlightStart) {
            stateDocument.highlightAccumulate = true;
            stateDocument.highlightAccumulator = '';
        }

        return { stateDocument, itemHighlights };
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
    processHighlights(stateDocument: PDFDocumentState, str: any, itemHighlights: any) {
        let {highlightStart, 
            highlightEnd, 
            highlightL, 
            highlightR, 
            isComment, 
            commentRef, 
            commentText} = itemHighlights;
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
                if (isComment) {
                    highlightText1 += `[^${stateDocument.footnoteCounter}]`;
                    stateDocument.footnotes[stateDocument.footnoteCounter] = `[[${commentRef}]]: ${commentText}` ;
                    stateDocument.footnoteCounter++;
                }

                str = highlightText1 + `==${highlightText2}`;
                highlightedText += highlightText1;
            }
        }
        return { stateDocument, str, highlightedText };
    }


    private highlightHandler(stateDocument: PDFDocumentState, 
                                str: any, 
                                itemHighlights : any) {
        let highlightedText = '';
        ({ stateDocument, str, highlightedText } = this.processHighlights(stateDocument, str, itemHighlights));
        if (stateDocument.highlightAccumulate) {
            if (highlightedText.length > 0)
                stateDocument.highlightAccumulator += highlightedText + ' ';
            else
                stateDocument.highlightAccumulator += str + ' ';
        }
        if (itemHighlights.highlightEnd) {
            stateDocument.addAnnotation(itemHighlights.commentText );
        }
        return { stateDocument, str };
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
        const pdfTemplate = settings.templatePdfHeader;
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
