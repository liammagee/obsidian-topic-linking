export const DEBUG_PAGE : number = 2;
export const DEBUG_PAGE_MAX : number = 0;
export const DEBUG_ITEM_START : number = 0;
export const DEBUG_ITEM_END : number = 100;

// https://simplernerd.com/js-console-colors/
export const Log = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    underscore: "\x1b[4m",
    blink: "\x1b[5m",
    reverse: "\x1b[7m",
    hidden: "\x1b[8m",
    // Foreground (text) colors
    fg: {
      black: "\x1b[30m",
      red: "\x1b[31m",
      green: "\x1b[32m",
      yellow: "\x1b[33m",
      blue: "\x1b[34m",
      magenta: "\x1b[35m",
      cyan: "\x1b[36m",
      white: "\x1b[37m",
      crimson: "\x1b[38m"
    },
    // Background colors
    bg: {
      black: "\x1b[40m",
      red: "\x1b[41m",
      green: "\x1b[42m",
      yellow: "\x1b[43m",
      blue: "\x1b[44m",
      magenta: "\x1b[45m",
      cyan: "\x1b[46m",
      white: "\x1b[47m",
      crimson: "\x1b[48m"
    }
  };

  
  export const log = (page: number, item: number, obj: any, indent: string = '') => {
    if (page == DEBUG_PAGE && (item >= DEBUG_ITEM_START && item <= DEBUG_ITEM_END)) {
        const cssKeys = ["color: #fa0; font-weight: "];
        const keyCss = ["color: #fa0"];
        console.log(`${indent}${Log.fg.green}PAGE: ${page}, ITEM: ${item}${Log.reset}`);
        Object.keys(obj).forEach(key => {
            const val = obj[key];
            if (typeof val === 'object' && val !== null) {
                console.log(`${indent}${Log.bright}${Log.fg.red}${key}:${Log.reset}`)
                log(page, item, val, indent + '   ');
            }
            else 
                console.log(`${indent}${Log.bright}${Log.fg.red}${key}: ${Log.reset}${Log.fg.white}${obj[key]}`)
        });
    }

}
