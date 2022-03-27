

export function formatBibtexAsMetadata(item) {
    let metadataContents = '';
    metadataContents += `\nCitationKey: ${item.citationKey}`;
    metadataContents += `\nTitle: "${item.title}"`;
    metadataContents += `\nAuthors: "${item.creators.map((author:any) => author.lastName + ', ' + author.firstName).join('; ')}"`;
    metadataContents += `\nAbstract: "${item.abstractNote}"`;
    return metadataContents;
}