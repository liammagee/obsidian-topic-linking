const CSL = require('citeproc'); 
import { TopicLinkingSettings } from './settings';


// Mostly taken from citeproc-plus
export function inflateCSLObj(slimObj:any) {
    if (slimObj.name) {
        // Already inflated
        return slimObj
    }
    const obj:any = {}
    obj.name = slimObj.n
    if (slimObj.a) {
        obj.attrs = slimObj.a
    } else {
        obj.attrs = {}
    }
    obj.children = []
    if (slimObj.c) {
        slimObj.c.forEach((child:any) => {
            if (typeof child === 'string') {
                obj.children.push(child)
            } else {
                obj.children.push(inflateCSLObj(child))
            }
        })
    } else if (slimObj.n === 'term') {
        obj.children.push('')
    }
    return obj
}


class CiteprocWrapper {

    styles : any = {};
    locales : any = {};
    citeproc : any = {};

    constructor() {
        this.styles = {}
        this.locales = {}
        this.citeproc = false
    }

    getStyles() {
        return import("../build/styles-common").then(
            (styles:any) => styles.styles
        )
    }

    async getEngine(originalSys:any, styleId:any, lang:string, forceLang:boolean) {
        let locale:any, style:any;
        await this.getCiteproc();
        style = await this.getStyle(styleId);
        locale = await this.getLocale(style, lang, forceLang)
        const sys = Object.assign(Object.create(originalSys), originalSys)
        sys.retrieveLocale = () => locale
        return new this.citeproc.Engine(sys, style, lang, forceLang)
    }

    getEngineSync(originalSys:any, styleId:any, lang:string, forceLang:boolean) {
        // Attempt to get engine synchronously based on already cached downloads. Returns false if cache is not available.
        if (!this.citeproc || !this.styles[styleId]) {
            return false
        }
        const style = this.styles[styleId]
        let localeId = forceLang ? forceLang :
            style.attrs['default-locale'] ? style.attrs['default-locale'] :
            lang ? lang :
            'en-US'

        if (!this.locales[localeId]) {
            localeId = 'en-US'
        }
        if (!this.locales[localeId]) {
            return false
        }
        const locale = this.locales[localeId]
        const sys = Object.assign(Object.create(originalSys), originalSys)
        sys.retrieveLocale = () => locale
        return new this.citeproc.Engine(sys, style, lang, forceLang)
    }

    getCiteproc() {
        if (this.citeproc) {
            return Promise.resolve()
        }
        return import("citeproc").then(
            (citeprocModule:any) => {;
                this.citeproc = citeprocModule.default;
            }
        )
    }

    getStyle(styleId:any) {
        if (typeof styleId === 'object') {

            /*
             * Advanced usage: The styleId is a style definition itself.
             * Return directly without caching.
             */

            return Promise.resolve(styleId)
        }

        return import("../build/styles-common").then(
            (module:any) => {
                let styleLocations:any = module.styleLocations;

                if (!styleLocations[styleId]) 
                    styleId = Object.keys(styleLocations).find(() => true)

                let returnValue;
                if (this.styles[styleLocations[styleId]]) {
                    this.styles[styleLocations[styleId]][styleId] = inflateCSLObj(this.styles[styleLocations[styleId]][styleId])
                    returnValue = Promise.resolve(this.styles[styleLocations[styleId]][styleId])
                } else {
                    this.styles[styleLocations[styleId]] = styleLocations[styleId]
                    this.styles[styleLocations[styleId]][styleId] = inflateCSLObj(this.styles[styleLocations[styleId]][styleId])

                    returnValue = Promise.resolve(this.styles[styleLocations[styleId]][styleId])
                }
                return returnValue

            }
        )
    }

    async getLocale(style:any, lang:string, forceLang:boolean) {
        let localeId = forceLang ? forceLang :
            style.attrs['default-locale'] ? style.attrs['default-locale'] :
            lang ? lang :
            'en-US'

        if (!this.locales[localeId]) {
            localeId = 'en-US'
        }

        if (this.locales[localeId]) {
            return Promise.resolve(this.locales[localeId])
        }
        return import("../build/locales").then(
            (module:any) => module.locales
        ).then(locales => {
            this.locales[localeId] = inflateCSLObj(locales[localeId])
            return Promise.resolve(this.locales[localeId])
        })
    }
}





export class CiteprocFactory {

    wrapper : any = {};
    engine : any = {};

    async initEngine(metadata: Record<string, any>, settings: TopicLinkingSettings) {

        const {citeprocStyleId, citeprocLang, citeprocForceLang} = settings;
        
        let sys: any = {
        
            retrieveItem: function(id: string) {

                if (metadata[id] && !Object.keys(metadata).includes('id')) { 
                    metadata[id].id = id;
                }

                return metadata[id];
            }
        };

        this.wrapper = new CiteprocWrapper();
        this.engine = await this.wrapper.getEngine(
            sys, // required, same as for citeproc-js, but without the retrieveLocale method
            citeprocStyleId, // required, The id of the style to use
            citeprocLang, // optional, same as for citeproc-js
            citeprocForceLang // optional, same as for citeproc-js
        )
    }

    makeBibliography(itemIds: string[]) {

        this.engine.updateItems(itemIds);
        return this.engine.makeBibliography()[1].join('');
        
    }

}
