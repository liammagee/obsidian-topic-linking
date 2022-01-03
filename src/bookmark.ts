import { 
    Vault, 
    TFile, 
	request,
    htmlToMarkdown } from 'obsidian';
import { TopicLinkingSettings } from './settings';

export class BookmarkContentExtractor {
    generatedPath: string;
    bookmarkPath: string;

    async deleteBookmarks(vault: Vault) {
        let filesToDelete: TFile[] = vault.getFiles().
            filter((file : TFile) => file.path.indexOf(`${this.generatedPath}${this.bookmarkPath}`) > -1 && file.extension === 'md');
        for (let i = 0; i < filesToDelete.length; i++)
            await vault.delete(filesToDelete[i]);        
    }

    async extract(vault: Vault, settings: TopicLinkingSettings, statusBarItemEl: HTMLElement) {
    
        this.generatedPath = settings.generatedPath;
        this.bookmarkPath = settings.bookmarkPath;

        statusBarItemEl.setText('Retrieving web content as markdown...');

        // If overwrite is enabled, delete all existing markdown files
        if (settings.bookmarkOverwrite) 
            this.deleteBookmarks(vault);

        // Get all files in the vault
        const files : TFile[] = vault.getMarkdownFiles().filter((file : TFile) => file.path.indexOf(this.bookmarkPath) > -1);
        const fileContents: string[] = await Promise.all(files.map((file) => vault.cachedRead(file)));

        fileContents.forEach((contents) => {
            let links: string[] = contents.match(/https*\:\/\/[^ \)]*/g);
            if (links != null) {

                // Extract only valid Markdown-able links
                links = links.filter(link => !link.endsWith('.pdf') && !link.endsWith('.jpg'));
                links.forEach(async (link) => {

                    // Retrieve the contents of the link
                    const htmlContents = await request({url: link});

                    // Find the title, and override if not null
                    let titleMatch = htmlContents.match(/<title>([^<]*)<\/title>/i);
                    let title : string = link;

                    if (titleMatch !== null)
                        title = titleMatch[1];

                    // Ignore HTTP errors
                    if (title.indexOf('40') === 0 || title.indexOf('50') === 0)
                        return;

                    // Remove punctuation
                    title = title.trim().replace(/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,\.\/:;<=>?@\[\]^`{|}~·]/g, '-');

                    // Remove trailing hyphens
                    if (title.indexOf('-') === 0)
                        title = title.substring(1);

                    // Limit file name length
                    title = title.substring(0, 50);

                    // Convert to Markdown and add link
                    let md = htmlToMarkdown(htmlContents);
                    md = `${link}\n\n${md}`;

                    // Create the file
                    let fileName: string = `${this.generatedPath}${this.bookmarkPath}${title}.md`;
                    let file : any = vault.getAbstractFileByPath(fileName);
                    try {
                            if (file !== null) {
                            if (settings.bookmarkOverwrite)
                                vault.modify(file, md);
                        }
                        else
                            vault.create(fileName, md);
                    }
                    catch (err) {
                        console.log(link);
                        console.log(err);
                    }
                });
            }
        })

        statusBarItemEl.setText('All done!');
    }
} 