import { 
    App, 
    TFile } from 'obsidian';
import { TopicLinkingSettings } from './settings';


export class BibtexParser {

    async loadJSON(app: App, settings: TopicLinkingSettings) {
        const bibtexPath = settings.bibtexPath.trim();
        const bibtexFile = <TFile>app.vault.getAbstractFileByPath(bibtexPath);
        const buffer = await app.vault.read(bibtexFile);
		return JSON.parse(buffer.toString()); 
    }


    async parseBibtexJSON(app: App, settings: TopicLinkingSettings) {

        let data = await this.loadJSON(app, settings);
        return data.items.reduce((acc:any,item:any) => (acc[item.citationKey]=item,acc),{});

    }

    convertToCSLJSON(bibtexJSON: any) {
        
        let cslJSON : any = {};
        for (let id in bibtexJSON) {
            let item = bibtexJSON[id];

            // Create publisher
            let publisher = '';
            if (item.extra && item.extra.search('Publisher: ') > -1) 
                publisher = item.extra.split('Publisher: ')[1];
            // Create item type
            let itemType = 'article-journal';
            if (item.type === 'book') itemType = 'book';
            let authors : {family: string, given: string}[] = [];
            let cslItem = {
                id: id,
                'citation-key': item.citationKey,
                title: item.title,
                "title-short": item.titleShort,
                "container-title": item.publicationTitle,
                publisher: publisher,
                issued: { "date-parts":[[item.date]] },
                abstract: item.abstract,
                volume: item.volume,
                issue: item.issue,
                page: item.pages,
                language: item.language,
                source: item.libraryCatalog,
                type: itemType,
                author: authors
            }
            item.creators.forEach((creator:any) => {
                if (creator.creatorType === 'author') {
                    cslItem.author.push({
                        family: creator.lastName,
                        given: creator.firstName
                    });
                }
            });
            cslJSON[id] = cslItem;
        }
        return cslJSON;
    }

    
    async parseCSLJSON(app: App, settings: TopicLinkingSettings) {

        let data = await this.loadJSON(app, settings);
        return data.reduce((acc:any,item:any) => (acc[item.id]=item,acc),{});

    }

}

export function formatBibtexAsMetadata(item:any) {
    let metadataContents = '';
    metadataContents += `\nID: ${item.citationKey}`;
    metadataContents += `\nTitle: "${item.title}"`;
    // BibTex CSL JSON format
    metadataContents += `\nAuthors: "${item.creators.map((creator:any) => creator.lastName + ', ' + creator.firstName).join('; ')}"`;
    if (item.abstract) 
        metadataContents += `\nAbstract: "${item.abstractNote}"`;
    if (item.date) 
        metadataContents += `\nPublished: "${item.date}"`;
    if (item.extra) 
        metadataContents += `\nPublisher: "${item.extra}"`;
    if (item.publicationTitle) 
        metadataContents += `\nPublisher: "${item.publicationTitle}"`;
    if (item.volume) 
        metadataContents += `\nVolume: "${item.volume}"`;
    if (item.issue) 
        metadataContents += `\nIssue: "${item.issue}"`;
    if (item.pages) 
        metadataContents += `\nPages: "${item.pages}"`;
    // BibTex CSL JSON format
    // metadataContents += `\nAuthors: "${item.author.map((author:any) => author.family + ', ' + author.given).join('; ')}"`;
    // if (item.abstract) 
    //     metadataContents += `\nAbstract: "${item.abstract}"`;
    // if (item.issued) 
    //     metadataContents += `\nPublished: "${item.issued['date-parts'].join('-')}"`;
    // if (item.publisher) 
    //     metadataContents += `\nPublisher: "${item.publisher}"`;
    // if (item.volume) 
    //     metadataContents += `\nVolume: "${item.volume}"`;
    // if (item.issue) 
    //     metadataContents += `\nIssue: "${item.issue}"`;
    // if (item.page) 
    //     metadataContents += `\nPages: "${item.page}"`;

    return metadataContents;
}