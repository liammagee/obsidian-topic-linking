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
        // BibTex CSL JSON format
        const metadata = data.reduce((acc:any,item:any) => (acc[item.id]=item,acc),{});
        // BibTex Bibtex JSON format
        // const metadata = data.items.reduce((acc:any,item:any) => (acc[item.citationKey]=item,acc),{});

        return metadata;

    }

}