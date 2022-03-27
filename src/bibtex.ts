import { 
    App, 
    TFile } from 'obsidian';
import { TopicLinkingSettings } from './settings';


export class BibtexParser {

    async parse(app: App, settings: TopicLinkingSettings) {

        const bibPath = settings.bibPath.trim();
        const bibFile = <TFile>app.vault.getAbstractFileByPath(bibPath);
        const buffer = await app.vault.read(bibFile);
		const data = JSON.parse(buffer.toString()); 
        const keyedItems = data.items.reduce((acc:any,item:any) => (acc[item.citationKey]=item,acc),{});

        return keyedItems;
    }

}