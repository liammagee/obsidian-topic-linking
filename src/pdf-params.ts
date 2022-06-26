
// From pdf.js src/shared/utils.js  
export const ImageKind = {
    GRAYSCALE_1BPP: 1,
    RGB_24BPP: 2,
    RGBA_32BPP: 3
};


export const NEWLINE_DEVIANCE = 0.9;
export const BLOCKQUOTE_DEVIANCE = 0.97;
export const BLOCKQUOTE_MIN = 1.25;
export const BLOCKQUOTE_MAX = 4;
export const SUBSCRIPT_DEVIANCE = 0.8;
export const JITTER = 0.01;
export const COORD_TOLERANCE = .51;


// Constants for detecting line change
// Work on a way to calculate this dynamically for double-spaced texts
export const LINE_HEIGHT_MIN = -0.75;
export const LINE_HEIGHT_MAX = -1.75;

// Constants for detecting second column objects in multi column layout
export const COLUMN_WIDTH_THRESHOLD = 0.4;
export const PAGE_HEADER_THRESHOLD = 0.05;
export const PAGE_FOOTER_THRESHOLD = 0.95;
