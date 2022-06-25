import { 
    LINE_HEIGHT_MIN, 
    LINE_HEIGHT_MAX 
}  from './pdf-params';

export class PDFDocumentState {
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
    bufferText: string;

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
        this.bufferText = '';
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
     estimateMarginsForCollection(leftMargins: Record<string, any>) {
        let leftMarginLikely : number = 1000, leftMarginLikelyCounter : number = 0;
        for (let key in leftMargins) {
            if (leftMargins[key] > leftMarginLikelyCounter) {
                leftMarginLikelyCounter = leftMargins[key];
                leftMarginLikely = parseFloat(key);
            } 
        }
        return leftMarginLikely;
    }

    /**
     * Estimates odd and event left margins
     * @param leftMarginsOdd 
     * @param leftMarginsEven 
     * @returns 
     */
    estimateMargins(leftMarginsOdd: Record<string, any>, leftMarginsEven: Record<string, any>) {
        this.leftMarginOddLikely = this.estimateMarginsForCollection(leftMarginsOdd);
        this.leftMarginEvenLikely = this.estimateMarginsForCollection(leftMarginsEven);
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


export class PDFPageState {
    inCode = false;

    // Save images
    displayCounter : number = 0;
    imagePaths : Record<number, string> = [];

    objPositions : PDFObjectPosition[] = [];
    runningText : string = '';
    positionRunningText : PDFObjectPosition = null;
    positionImg : PDFObjectPosition = null;

    // Coordinate variables
    // Set scale to 1 by default (in case setTextMatrix is not called)
    xScale : number = 1;
    yScale : number = 1;
    xl = 0;
    yl = 0;
    xn = 0;
    yn = 0;
    xll = 0;
    xOffset = 0;
    yOffset = 0;
    xOffsetFromMargin = 0;
    runningWidth : number = 0;
    xOrigin : number = 0;
    yOrigin : number = 0;
    xRunning : number = 0;
    yRunning : number = 0;

    italic : boolean = false;
    bold : boolean = false;
    subscript : boolean = false;
    superscript : boolean = false;
    newLine : boolean = false;
    blockquote : boolean = false;
    xOffsetBlockquote: number = 0;

    fontSize : number = 1;
    fontNameLast : string = null;
    fontFaceChange : boolean = false;
    transform : any = null;
    transforms : any[] = [];
    fontScale : number = 1;
    fontScaleLast : number = 1;
    fontTransform : number = 1;
    fontTransformLast : number = 1;
    width: number = 0;
    
    associatedTextContent : any = null;

    resetPageState() {
        this.fontScaleLast = this.fontScale;
        this.fontScale = this.fontSize * this.yScale;
        this.fontTransformLast = this.fontTransform;
        this.fontTransform = this.fontScale;
        if (this.transform) {
            // this.fontScale *= this.transform[3];
            this.fontTransform *= this.transform[3];
        }
        
        // this.runningWidth = 0;
        this.width = 0;
        this.fontFaceChange = false;

        this.newLine = false;
        this.subscript = false;
        this.superscript = false;
        this.blockquote = false;
        this.xOffsetBlockquote = this.xOffsetFromMargin;
        this.runningWidth = 0;
    }

    // Helper functions
    // These make use of local variables, need to remain in scope
    bounds = (test:number, min:number, max:number) =>  (test >= min && test <= max);

}


export class PDFObjectPosition {
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