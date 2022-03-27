

export function formatBibtexAsMetadata(item) {
    let metadataContents = '';
    metadataContents += `\nID: ${item.id}`;
    metadataContents += `\nTitle: "${item.title}"`;
    // BibTex CSL JSON format
    metadataContents += `\nAuthors: "${item.author.map((author:any) => author.family + ', ' + author.given).join('; ')}"`;
    if (item.abstract) 
        metadataContents += `\nAbstract: "${item.abstract}"`;
    if (item.issued) 
        metadataContents += `\nPublished: "${item.issued['date-parts'].join('-')}"`;
    if (item.publisher) 
        metadataContents += `\nPublisher: "${item.publisher}"`;
    if (item.volume) 
        metadataContents += `\nVolume: "${item.volume}"`;
    if (item.issue) 
        metadataContents += `\nIssue: "${item.issue}"`;
    if (item.page) 
        metadataContents += `\nPages: "${item.page}"`;
    // Better BibTex JSON format
    // metadataContents += `\nAuthors: "${item.creators.map((author:any) => author.lastName + ', ' + author.firstName).join('; ')}"`;
    // metadataContents += `\nAbstract: "${item.abstractNote}"`;
    return metadataContents;
}