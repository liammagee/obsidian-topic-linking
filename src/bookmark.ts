import { 
    Vault, 
    TFile, 
	request,
    htmlToMarkdown,
    normalizePath,
    debounce} from 'obsidian';
import { TopicLinkingSettings } from './settings';



export class BookmarkContentExtractor {
    generatedPath: string;
    bookmarkPath: string;

    
    async deleteBookmarks(vault: Vault, bookmarkPath: string) {
        const filesToDelete: TFile[] = vault.getFiles().
            filter((file : TFile) => file.path.indexOf(normalizePath(bookmarkPath)) > -1 && file.extension === 'md');
        for (let i = 0; i < filesToDelete.length; i++)
            await vault.delete(filesToDelete[i]);        
    }

    async extract(vault: Vault, settings: TopicLinkingSettings, statusBarItemEl: HTMLElement) {
    
        this.generatedPath = settings.generatedPath;
        this.bookmarkPath = settings.bookmarkPath;

        statusBarItemEl.setText('Retrieving web content as markdown...');
        // Bookmark path
        const bookmarkDir : string = `${this.generatedPath}${this.bookmarkPath}`;

        // If overwrite is enabled, delete all existing markdown files
        if (settings.bookmarkOverwrite) 
            this.deleteBookmarks(vault, bookmarkDir);

        try {
            await vault.createFolder(normalizePath(bookmarkDir));
        }
        catch (err) {
            // Already exists? continue on
        }

        let headers : Record<string, string> = {};
    
        // Get all files in the vault
        const files : TFile[] = vault.getMarkdownFiles().filter((file : TFile) => file.path.indexOf(this.bookmarkPath) === 0);
        for (let file of files) {
            let contents = await vault.cachedRead(file)
            let links: string[] = contents.match(/https*:\/\/[^ )]*/g);
            if (links != null) {

                // Extract only valid Markdown-able links
                links = links.filter(link => !link.endsWith('.pdf') && !link.endsWith('.jpg'));
                for (let i = 0; i < links.length; i++) {
                    const link = links[i];

                    try {

                        // Retrieve the contents of the link
                        console.log(`Downloading content from ${link}`)
                        let htmlContents = await request({url: link, headers: headers});

                        // Find the title, and override if not null
                        let title : string = link;
                        if (htmlContents != null) {
                            const titleMatch = htmlContents.match(/<title>([^<]*)<\/title>/i);
                            if (titleMatch !== null && titleMatch.length > 1 && titleMatch[1] !== '') 
                                title = titleMatch[1];

                            // Ignore HTTP errors
                            if (title.indexOf('40') === 0 || title.indexOf('50') === 0)
                                continue;

                            // Remove punctuation
                            title = title.trim().replace(/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~·]/g, '-');

                            // Remove trailing hyphens
                            if (title.indexOf('-') === 0)
                                title = title.substring(1);

                            // Limit file name length
                            title = title.substring(0, 50);

                            // Add some unique identifier to the title
                            title += `-${i}`;

                            // Convert to Markdown and add link
                            let md = htmlToMarkdown(htmlContents);
                            md = `${link}\n\n${md}`;

                            // Create the file
                            const fileName: string = normalizePath(`${bookmarkDir}${title}.md`);
                            console.log(`Writing content to ${fileName}`)

                            const file = <TFile> vault.getAbstractFileByPath(fileName);
                            if (file !== null) {
                                if (settings.bookmarkOverwrite)
                                    vault.modify(file, md);
                            }
                            else 
                                vault.create(fileName, md);
                        }

                    }
                    catch (err) {
                        console.log(err);
                    }
                }
            }
        }

        statusBarItemEl.setText('All done!');
    }
} 