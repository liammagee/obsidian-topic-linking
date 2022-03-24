import { 
    App, 
    TFile,
    prepareSimpleSearch,
    getAllTags, 
    normalizePath,
	moment } from 'obsidian';
import { stringify } from 'querystring';

import { TopicLinkingSettings } from './settings';



export class BibtexParser {

    async parse(app: App, settings: TopicLinkingSettings) {

        const bibPath = settings.bibPath;
        const bibFile = <TFile>app.vault.getAbstractFileByPath(bibPath);
        const buffer = await app.vault.read(bibFile);
		const data = JSON.parse(buffer.toString()); 
        const keyedItems = data.items.reduce((acc:any,item:any) => (acc[item.citationKey]=item,acc),{});

        return keyedItems;
    }

}