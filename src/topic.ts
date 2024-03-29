import { 
    App, 
    Vault, 
    TFile,
    prepareSimpleSearch,
    getAllTags, 
    normalizePath,
	moment } from 'obsidian';

import { TopicLinkingSettings } from './settings';
import { CiteprocFactory } from './bibliography';
import { TemplateResolver } from './templates/resolver';
import { TfIdf } from './tfidf';

// For LDA
import roundn from '@stdlib/math-base-special-roundn';
import stopwords from '@stdlib/datasets-stopwords-en';
import lda from '@stdlib/nlp-lda';
import porterStemmer from  '@stdlib/nlp-porter-stemmer' ;
import markdownToTxt from 'markdown-to-txt';
// import natural from 'natural';


// For File matching
import micromatch from 'micromatch';

// For file sanitisation
import sanitize from 'sanitize-filename';

export class TopicLinker {

    async deleteTopics(vault: Vault, topicPath: string) {
        const filesToDelete: TFile[] = vault.getFiles().
            filter((file : TFile) => file.path.indexOf(normalizePath(topicPath)) > -1 && file.extension === 'md');
        for (let i = 0; i < filesToDelete.length; i++)
            await vault.delete(filesToDelete[i]);        
    }


    async link(app: App, settings: TopicLinkingSettings, statusBarItemEl: HTMLElement, metadata: Record<string, any>, citeproc: CiteprocFactory) {

        const { vault } = app;

        const topicPathPattern = settings.topicPathPattern;
        const topicSearchPattern = settings.topicSearchPattern;
        const topicTagPattern = settings.topicTagPattern;
        const templateTopicIndex = settings.templateTopicIndex;
        const templateTopicIndividual = settings.templateTopicIndividual;

        console.log(`Number of topics: ${settings.numTopics}`);
        console.log(`Number of words: ${settings.numWords}`);
        console.log(`Topic threshold: ${settings.topicThreshold}`);
        console.log(`Percentage of text: ${settings.percentageTextToScan}`);
        console.log(`Topic file pattern: ${topicPathPattern}`);
        console.log(`Topic search pattern: ${topicSearchPattern}`);
        console.log(`Topic tag pattern: ${topicTagPattern}`);
        console.log(`Fixed word length: ${settings.fixedWordLength}`);
        console.log(`Text percentage: ${settings.percentageTextToScan}`);
        console.log(`Word selection: ${settings.wordSelectionRandom}`);

        statusBarItemEl.setText(`Extracting Markdown file contents at ${settings.percentageTextToScan}%...`);
        
        let topicDir = this.makeTopicDir(settings, topicPathPattern, topicSearchPattern);
        if (settings.topicOverwrite)
            await this.deleteTopics(vault, topicDir);


        let files: TFile[] = vault.getMarkdownFiles().filter((file) => micromatch([file.path], ['*' + topicPathPattern + '*']).length > 0);

        // Add search condition here
        if (topicSearchPattern && topicSearchPattern.length > 0) {
            // Prepare query
           const topicSearchFunc = prepareSimpleSearch(topicSearchPattern);

            // Search through each matching file
            const resultingFiles: TFile[] = [];
            // let results: any[] = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const fileContents = await vault.cachedRead(file);
                const result = topicSearchFunc(fileContents);
                if (result) {
                    resultingFiles.push(file);
                    // const { score, matches } = result;
                    // results.push({file: file.basename, });
                }
            }
            files = resultingFiles;
        }

        if (topicTagPattern && topicTagPattern.length > 0) {
            // Assume tag pattern is formatted like: '#fashion #photography'
            const topicTags : string[] = topicTagPattern.split(' ');

            // Search through each matching file
            const resultingFiles: TFile[] = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const cm = app.metadataCache.getFileCache(file);
                const tags : string[] = getAllTags(cm);
                if (tags && tags.length > 0) {
                    tags.forEach(tag => {
                        if (topicTags.indexOf(tag) >= 0) 
                            resultingFiles.push(file);
                    });
                }
            }
            files = resultingFiles;

        }

        if (files.length === 0) {
            statusBarItemEl.setText('No Markdown files found!');
            return;
        }

        // Get PDF names for later matching
        const pdfNames = vault.getFiles().filter(file => { return file.extension === 'pdf' }).map(file => file.basename);
        // TODO: Add weblinks here...

        // Add stop words
        const words : string[] = stopwords();
        const wordRegexes : RegExp[] = words.map(word => { return new RegExp('\\b' + word + '\\b', 'gi'); });

        // Add other stop words
        const extendedStops = ['©',  '▢', ' ', 'null', 'obj', 'pg', 'de', 'et', 'la', 'le', 'el', 'que', 'dont', 'flotr2', 'mpg', 'ibid', 'pdses', 'à', 'en', 'les', 'des', 'qui', 'du', 'der', 'im', 'th', 'fi'];
        extendedStops.forEach(word => { wordRegexes.push(new RegExp('\\b' + word + '\\b', 'gi')) });


        // Retrieve all file contents
        let documents: string[] = await this.naiveTokenizer(files, vault, settings, wordRegexes);

        // Do the LDA model fitting
        const numTopics = settings.numTopics;
        const numWords = settings.numWords;
        const threshold = settings.topicThreshold;
        const iterations = settings.ldaIterations;
        const burnin = settings.ldaBurnIn;
        const thin = settings.ldaThin;

        statusBarItemEl.setText('Finding ' + numTopics + ' topics to meet ' + threshold + '...');

        const ldaModel : any = lda(documents, numTopics);
        ldaModel.fit(iterations, burnin, thin);

        // Create an array of topics with links to documents that meet the threshold
        const topicDocs = new Array(numTopics);
        for (let j = 0; j < numTopics; j++) {
            for (let i = 0; i < documents.length; i++) {
                const score = roundn(ldaModel.avgTheta.get(i, j), -3);
                if (score > threshold) {
                    if (topicDocs[j] === undefined)
                        topicDocs[j] = [];
                    topicDocs[j].push({ doc: files[i].basename, score: score });
                }
            }
        }

        // Generate the list of topic strings
        const topicStrings = [];
        for (let j = 0; j < numTopics; j++) {
            const terms : Array<any> = ldaModel.getTerms(j, numWords);
            const topicString = `Topic ${j + 1} - ${terms.map((t : any) => t.word).join('-')}`;
            topicStrings.push(topicString);
        }

        statusBarItemEl.setText(`Creating topic files with ${numWords} per topic...`);


        try {
            await vault.createFolder(normalizePath(topicDir));
        }
        catch (err) {
            // Already exists? continue on
        }

        // Get templates
        const templateIndex = await TemplateResolver.resolveTemplateTopicIndex(vault, templateTopicIndex);
        const templateEntry = await TemplateResolver.resolveTemplateTopicEntry(vault, templateTopicIndividual);

        // Create the topic files
        for (let j = 0; j < numTopics; j++) {

            const terms = ldaModel.getTerms(j, numWords);
            // No associated terms - move on
            if (terms[0].word === undefined)
                continue;

            // Make the file name safe
            const sanitisedTopic = sanitize(topicStrings[j]);
            const fileName: string = normalizePath(`${topicDir}/${sanitisedTopic}.md`);
            
            let thisTopicDocs = topicDocs[j];
            if (thisTopicDocs !== undefined) 
                thisTopicDocs.sort((td1 : any, td2 : any) => { return (td1.score > td2.score ? -1 : (td1.score < td2.score ? 1 : 0)) })

            let fileText = '';
            fileText = templateEntry.render( { 
                topicNo: j + 1,
                tags: terms.map((term:any) => term.word),
                topicWords: terms.map((term:any) => {
                    return { word: term.word, prob: term.prob.toPrecision(2) }
                }),
                links: thisTopicDocs
            } );
    
            try {
                const file = <TFile> vault.getAbstractFileByPath(fileName);
                if (file !== undefined && file !== null)
                    vault.modify(file, fileText);
                else
                    vault.create(fileName, fileText);
            }
            catch (err) {
                console.log(err);
            }
        }

        // Create the index file
        // Use natural tokenizer and stemmer
        // let tokenizer = new natural.WordTokenizer();

        // Do term frequency - inverse document frequency
        /*
        let tfidf = new natural.TfIdf();
        documents.forEach((document) => tfidf.addDocument(document));
        let documentMap : any[] = [];
        for (let i = 0; i < documents.length; i++) {
            let terms = tfidf.listTerms(i).slice(0, 10);
            // let terms : any = [];
            let title = files[i].basename;
            let docData = { 
                title: title, 
                ref: files[i].basename, 
                authors: '', 
                bib: '', 
                terms: terms 
            }
            if (metadata !== undefined && metadata[title] !== undefined) {
                let itemMeta = metadata[title];
                docData.bib = citeproc.makeBibliography([itemMeta.citationKey]);
                docData.authors = itemMeta.creators.map((creator: any) => creator.lastName + ', ' + creator.firstName).join('; ');
                docData.title = itemMeta['title'];
            }
            documentMap.push(docData);
        }
        */

        // Add relative frequencies to the index file
        let tfidf = new TfIdf();
        documents.forEach((document) => tfidf.addDocument(document));
        let tfidfs = tfidf.tfidfs(1.2, 0.75, 1, 'bm25', null);
        let documentMap : any[] = [];
        for (let i = 0; i < documents.length; i++) {

            let terms = tfidfs[i].slice(0, 10);
            let title = files[i].basename;
            let docData = { 
                title: title, 
                ref: files[i].basename, 
                authors: '', 
                bib: '', 
                terms: terms
            }
            if (metadata !== undefined && metadata[title] !== undefined) {
                let itemMeta = metadata[title];
                docData.bib = citeproc.makeBibliography([itemMeta.citationKey]);
                docData.authors = itemMeta.creators.map((creator: any) => creator.lastName + ', ' + creator.firstName).join('; ');
                docData.title = itemMeta['title'];
            }
            documentMap.push(docData);
        }


        await this.createIndex(vault, 
                            topicDir,
                            templateIndex, 
                            documentMap,
                            topicPathPattern, 
                            topicSearchPattern, 
                            topicTagPattern, 
                            topicStrings);

        statusBarItemEl.setText(`All done!`);
    }

    private async createIndex(vault: Vault, 
                                topicDir: string, 
                                templateIndex:any, 
                                documentMap: any[],
                                topicPathPattern: string, 
                                topicSearchPattern: string, 
                                topicTagPattern: string, 
                                topicStrings: string[], 
                                ) {

        let topicFileText = '';
        topicFileText = templateIndex.render(await {
            topicPathPattern: topicPathPattern,
            topicSearchPattern: topicSearchPattern,
            topicTagPattern: topicTagPattern,
            topics: topicStrings.map((ts) => sanitize(ts)),
            entries: documentMap
        });


        const topicFileName: string = normalizePath(`${topicDir}/Topic Index.md`);
        const topicFile = <TFile>vault.getAbstractFileByPath(topicFileName);
        if (topicFile !== undefined && topicFile !== null)
            vault.modify(topicFile, topicFileText);

        else
            vault.create(topicFileName, topicFileText);
    }

    private async naiveTokenizer(files: TFile[], vault: Vault, settings: TopicLinkingSettings, wordRegexes: RegExp[]) {
        let documents: string[] = [];

        for (let file of files) {
            let document = await vault.cachedRead(file);

            document = markdownToTxt(document);

            // Handle fixed number of words
            if (settings.fixedWordLength > 0) {
                const totalWords = document.split(' ');
                const wordLength = totalWords.length;
                const scanEnd = (wordLength > settings.fixedWordLength) ? settings.fixedWordLength : wordLength;
                let scanStart = 0;
                if (settings.wordSelectionRandom)
                    scanStart = Math.floor(Math.random() * (wordLength - scanEnd));
                document = totalWords.slice(scanStart, scanStart + scanEnd).join(' ');

            }
            else if (settings.percentageTextToScan > 0 && settings.percentageTextToScan < 100) {
                const scanEnd = document.length * (settings.percentageTextToScan / 100);
                let scanStart = 0;
                if (settings.wordSelectionRandom)
                    scanStart = Math.floor(Math.random() * (100 - scanEnd));
                document = document.substring(scanStart, scanEnd);
            }

            document = document.toLowerCase()
                .replace(/[\u0000\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,\-./:;<=>?@[\]^_`{|}~]/g, '')
                .replace(/\b\d{1,}\b/g, '');
            wordRegexes.forEach(word => { document = document.replace(word, ''); });
            document = document.replace(/\s{2,}/g, ' ');

            if (settings.stemming)
                document = document.split(' ').map(word => porterStemmer(word)).join(' ');

            documents.push(document.trim());
        }
        return documents;
    }

    private makeTopicDir(settings: TopicLinkingSettings, topicPathPattern: string, topicSearchPattern: string) {
        let topicDir = settings.topicFolderName;
        if (settings.topicIncludePattern)
            topicDir += `-${topicPathPattern.replace(/[*/. ]/g, '-')}-${topicSearchPattern.replace(/[*/. ]/g, '-')}`;
        if (settings.topicIncludeTimestamp)
            topicDir += `-${moment().format('YYYYMMDDhhmmss')}`;
        topicDir = topicDir.replace(/--/, '-');
        return topicDir;
    }
}