export class TfIdf {

    documents: string[][] = [];
    documentLengths: number[] = [];
    averageDocumentLength : number = 0;

    constructor() {
        this.documents = [];
    }

    addDocument(doc: string, tokenise:boolean = false) {
        if (tokenise) {
            doc = doc.toLowerCase().replace(/[^A-Za-z\ ]+/g, '').replace(/\s+/g, ' ');
        }
        let tokens = doc.split(' ');
        this.documents.push(tokens);
        this.documentLengths.push(doc.length);
    }

    private tfs() {
        let tfs : Record<string, number>[] = [];
        for (let tokens of this.documents) {
            let tf : Record<string, number> = {};
            for (let token of tokens) {
                if (tf[token] == null) {
                    tf[token] = 1
                } else {
                    tf[token] += 1
                }
            }
            tfs.push(tf)
        }
        return tfs;
    }

    private dfs() {
        let dfs : Record<string, number> = {};
        let n : number = this.documents.length;
        for (let i = 0; i < n; i++) {
            let doc = this.documents[i];
            let tokensUnique = doc.filter((value, index, arr) => arr.indexOf(value) === index);
            for (let token of tokensUnique) {
                if (dfs[token] != undefined)
                    dfs[token] += 1; 
                else
                    dfs[token] = 1;
            }
        }
        return dfs;
    }


    private sorted(results: any[][], sortKey : string = 'bm25') {
        if (results.length == 0 || results[0].length == 0 || results[0][0] == null || results[0][0][sortKey] == null)
            throw new Error("Empty results or invalid sort key");
        let sortedResults : any[][] = [];
        for (let resultsDoc of results) {
            let sortedResultsDoc : any[] = [];
            sortedResultsDoc = resultsDoc.sort((a, b) => b[sortKey] - a[sortKey]);
            sortedResults.push(sortedResultsDoc);
        }
        return sortedResults; 
    }

    private top(results: any[][], topN:number) {
        let sortedResults : any[][] = [];
        for (let resultsDoc of results) {
            let resultsTopN : any[] = resultsDoc.slice(0, topN);
            sortedResults.push(resultsTopN);
        }
        return sortedResults;         
    }

    private idfs(mix:number) {
        let dfs : Record<string, number> = this.dfs();
        let n = this.documents.length;
        let idfs : Record<string, number> = {};
        Object.keys(dfs).forEach((token) => {
            let df : number = dfs[token];
            // Non-BM25 version
            // idfs[token] =  1 + Math.log((n) / (df + mix));
            // If 'mix' == 1, amounts to the same
            idfs[token] = 1 + Math.log(mix + ( n - df + 0.5) / (df + 0.5));
        });
        return idfs;
    }


    tfidfs(k: number = 1.0, b: number = 0.75, mix: number = 0.0, sortKey: string = 'bm25', topN: number = 10) {
        let tfs = this.tfs();
        let idfs = this.idfs(mix);
        let tfidfs : Record<string, number>[] = [];
        let results : any[] = [];

        // Get average document length
        let adl = this.documentLengths.reduce((a, b) => a + b, 0) / this.documentLengths.length;
        
        for (let i in tfs) {
            let tfDoc = tfs[i];
            let tfidfRec : Record<string, number> = {};
            let dl : number = this.documentLengths[i];
            let kb : number = k * (1 - b + b * (dl / adl));
            let resultsDoc : any[] = [];
            for (let term in tfDoc) {
                let tf : number = tfDoc[term];
                let tfkb : number = tf / (tf + kb);
                let idf = idfs[term];
                let tfidf : number = tf * idf;
                let bm25 : number = tfkb * idf;
                let resultTerm : any = {
                    term: term,
                    tf: tf,
                    idf: idf,
                    tfidf: tfidf,
                    bm25: bm25
                }
                resultsDoc.push(resultTerm);
            }
            results.push(resultsDoc);
            tfidfs.push(tfidfRec);
        }
        if (sortKey != null) 
            results = this.sorted(results, sortKey);
        if (topN != null && topN > 0)
            results = this.top(results, topN);
        return results;  
    }

}
