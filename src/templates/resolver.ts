import { 
    Vault, 
    TFile, 
    normalizePath, 
    TAbstractFile} from 'obsidian';

import nunjucks from 'nunjucks';

export class TemplateResolver {
    static _instance: TemplateResolver;
    defaultEnv: nunjucks.Environment;
    templatePdfHeader: nunjucks.Template;
    templatePdfPage: nunjucks.Template;
    templatePdfFooter: nunjucks.Template;
    templateTopicIndex: nunjucks.Template;
    templateTopicEntry: nunjucks.Template;
    templateBibliographyIndex: nunjucks.Template;
    templateBibliographyEntry: nunjucks.Template;

    private constructor() {
        this.defaultEnv = new nunjucks.Environment();
        this.templatePdfHeader = this.makeTemplatePdfHeader(this.defaultEnv);
        this.templatePdfPage = this.makeTemplatePdfPage(this.defaultEnv);
        this.templatePdfFooter = this.makeTemplatePdfFooter(this.defaultEnv);
        this.templateTopicIndex = this.makeTemplateTopicIndex(this.defaultEnv);
        this.templateTopicEntry = this.makeTemplateTopicEntry(this.defaultEnv);
        this.templateBibliographyIndex = this.makeTemplateBibliographyIndex(this.defaultEnv);
        this.templateBibliographyEntry = this.makeTemplateBibliographyEntry(this.defaultEnv);
    }

    private makeTemplatePdfHeader(env: nunjucks.Environment) {
        return new nunjucks.Template(require('./pdf-header.md').default, env);
    }

    private makeTemplatePdfPage(env: nunjucks.Environment) {
        return new nunjucks.Template(require('./pdf-page.md').default, env);
    }

    private makeTemplatePdfFooter(env: nunjucks.Environment) {
        return new nunjucks.Template(require('./pdf-footer.md').default, env);
    }

    private makeTemplateTopicIndex(env: nunjucks.Environment) {
        return new nunjucks.Template(require('./topic-index.md').default, env);
    }

    private makeTemplateTopicEntry(env: nunjucks.Environment) {
        return new nunjucks.Template(require('./topic-entry.md').default, env);
    }

    private makeTemplateBibliographyIndex(env: nunjucks.Environment) {
        return new nunjucks.Template(require('./bibliography-index.md').default, env);
    }

    private makeTemplateBibliographyEntry(env: nunjucks.Environment) {
        return new nunjucks.Template(require('./bibliography-entry.md').default, env);
    }

    static get instance() {
        if (!TemplateResolver._instance)
            TemplateResolver._instance = new TemplateResolver();
        return TemplateResolver._instance;
    }

    static async resolveTemplate(vault: Vault, templatePath: string, fallbackTemplate: nunjucks.Template) {
        
        const templateFile : TAbstractFile = await vault.getAbstractFileByPath(templatePath);
        if (templateFile == null) {
            if (fallbackTemplate) {
                return fallbackTemplate;
            }
            else {
                console.log(`Template file ${templatePath} not found, and no valid fallback provided.`);
                return null;
            }
        }
        
        const templateString = await vault.cachedRead(templateFile as TFile);
        return new nunjucks.Template(templateString, TemplateResolver.instance.defaultEnv);
    }
    

    static async resolveTemplatePdfHeader(vault: Vault, templatePath: string) {
        return TemplateResolver.resolveTemplate(vault, templatePath, TemplateResolver.instance.templatePdfHeader);
    }

    static async resolveTemplatePdfPage(vault: Vault, templatePath: string) {
        return TemplateResolver.resolveTemplate(vault, templatePath, TemplateResolver.instance.templatePdfPage);
    }

    static async resolveTemplatePdfFooter(vault: Vault, templatePath: string) {
        return TemplateResolver.resolveTemplate(vault, templatePath, TemplateResolver.instance.templatePdfFooter);
    }

    static async resolveTemplateTopicIndex(vault: Vault, templatePath: string) {
        return TemplateResolver.resolveTemplate(vault, templatePath, TemplateResolver.instance.templateTopicIndex);
    }

    static async resolveTemplateTopicEntry(vault: Vault, templatePath: string) {
        return TemplateResolver.resolveTemplate(vault, templatePath, TemplateResolver.instance.templateTopicEntry);
    }

    static async resolveTemplateBibliographyIndex(vault: Vault, templatePath: string) {
        return TemplateResolver.resolveTemplate(vault, templatePath, TemplateResolver.instance.templateBibliographyIndex);
    }

    static async resolveTemplateBibliographyEntry(vault: Vault, templatePath: string) {
        return TemplateResolver.resolveTemplate(vault, templatePath, TemplateResolver.instance.templateBibliographyEntry);
    }


    
}