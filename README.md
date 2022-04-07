## Obsidian Topic Linking Plugin

This is a plugin with several commands for working with PDF and web content in a reference context. 

**Note:** This plugin is highly experimental, and can have unintended consequences on existing vaults.
Use with caution, and with test vaults where consequences are non-destructive. 




### Example Workflows

The plugin is designed to help with common tasks associated with research. Often researchers will build large repositories of PDFs and links, not easily organised by a single folder or tagging system. 

#### Scenario 1

A researcher has a collection of PDFs scattered across folders in an Obsidian vault. They want to convert the PDFs to Markdown, to make them easier to search. 

The *Extract PDF Content* command will produce a set of Markdown files in a nominated folder (by defauled called *Generated/*). 

#### Scenario 2

A researcher has a large Zotero database. They would like to produce a series of notes about each entry, and produce a human-readable bibliography.

The *Make Bibliography* will produce a set of notes contained the metadata and a human-readable bibliography, similar to what Zotero will produce in MS Word. 

Note a much more expanded version of this functionality is available in [BibNotes](https://github.com/stefanopagliari/bibnotes), which is recommended for cases where control over note output is required. The reason this feature is included here at all is for the human-readable version of the bibliography.

#### Scenario 3

A researcher has an archive of PDFs and web bookmarks in their vault, and both PDFs and links cover a range of subjects or topics. The researcher would like discover common topics between them. These topics will be stored in a series of notes, with links to the source documents.

The researchers stores their PDF files in a vault folder called 'PDFs', and web bookmarks in in a *Bookmarks* folder. 


1. Both *Extract PDF Content* and *Extract Web Links* commands are run, producing a series of Markdown files in the *Generated/* folder.
2. A number of the generated files include the term 'Data' in their file name, and this is a general subject  of interest. The *Topic File Pattern* Settings field is set to 'Generated/*Data*' (using a *glob*-style pattern).
3. Some of these files are books, containing more than 50K words. There are also a large number of files (~100) meeting this pattern. The *Fixed Number of Words* Settings field is set to *1,000*, to ensure topic mapping and linking executes in reasonable time. The *Randomise Text* field is also set to true, so that front matter (containing copyright and Table of Contents) is often ignored.
4. The *Link Topics* command is then executed, producing 10 topic files that map associated keywords and relevant documents. A *Topic Index* file links all of the files together, and includes a convenience check list of all documents matching the file pattern, which can be used to flag which documents have been read or cited.


They first run:

 - The *Extract PDF Content* command, to produce Markdown files for their PDFs.
 - The *Extract Web Link-Generated Content* command, to produce Markdown files from web content referenced in their bookmarks.

This produces a series of Markdown files in the *Generated/* folder. The researcher notices a number of the generated files include the term 'Data' in their file name, and thinks these files could contain topics of interest. 

They return to plugin settings, to set the *Topic File Pattern* Settings field to 'Generated/*Data*' (using a *glob*-style pattern.


They then run:

 - The *Link Topics* command, to generate a set of linked topic notes.




#### Scenario 4

Following on from *Scenario 3*, this researcher would also like to include metadata, annotations and a human-readable bibliography. They have a Zotero database, with Zotfile and Better BibTex plugins installed. 

They first export their database using *both* "Better Bibtex JSON" and "Better CSL JSON" formats. It is important to do both, because unfortunately each contains different information. The researcher saves both exports in the root of their vault, and specifies these two locations in the *Topic Linking* plugin settings:

  *Better Bibtex File*: TopicLinking_bibtex.json
  *Better CSL File*: TopicLinking_csl.json



#### Scenario 5

Again like *Scenario 3*, but this time the researcher is working with a number of books, containing more than 50K words. There are also a large number of files (~100) meeting this pattern. 

Before running the *Link Topics* command, the researcher sets:

  *Fixed Number of Words* Settings field to *1,000*, to ensure topic mapping and linking executes in reasonable time. 
  *Randomise Text* field to **true**, so that front matter (containing copyright and Table of Contents) is often ignored.




### General Settings

Each of the commands need folders to specify inputs and outputs. The key settings, and their default folders, are as follows:

  *Generated Files*: the default output folder for the *Extract PDF Content* command. Defaults to 'Generated/'.
  *PDF Files*: a repository of PDF files (can included nested folders). Defaults to 'PDFs/'.
  *Bookmark Files*: a repository of bookmarks exported from a browser. Defaults to 'Bookmarks/'.
  *Topic files*: the default output folder for the *Link Topics* command. Defaults to 'Topics'. 

**Note**: Each of these folders should be created before running the tasks. 



### Make Bibliography

TBD.

### Extract PDF Content

The *Extract PDF Content* command uses *Obsidian*'s built-in PDF parser to convert a vault's PDFs to Markdown. The conversion is highly simplified and approximate, to produce a stream of text for the topic linking command. However results should still be humanly legible. The command takes four options:

- *PDF files*: where to locate PDF files for processing
- *Overwrite PDF-generated content*: whether to overwrite existing Markdown files with the same name
- *Limit file number*: the maximum number of files to process (failing to set this can result in *Obsidian* running out of memory for large repositories)
- *Limit file size*: the maximum size of files to process. The meaning of 'file' (either the PDF source or generated Markdown) depends upon whether *Chunk file if size exceeds limit* is set. 
- *Chunk file if size exceeds limit*: if *Limit file size* is set, and Markdown files greater than this size are likely to be produced, the command will instead try to split the generated text across multiple smaller files. 


#### Experimental Settings

Several additional 'experimental' settings allow for some customisation:

 - *Include Pages As Headings*: Inserts *Page X* headings into the generated Markdown. This can be useful for linking to specific pages.
 - *Extract Annotations*: Extracts annotations from PDF as highlights.
 - *Include Comments with Annotations*: Includes any comments attached to extracted annotations as endnotes.
 - *Better Bibtex File*: This is a feature copied from [BibNotes](https://github.com/stefanopagliari/bibnotes). If a valid Zotero export (in Better BibTex JSON format) file location is specified here, Zotero metadata will be included in the generated Markdown.
 - *Better CSL File*: This is a separate setting that ensures human-readable bibliographies can be generated from the various commands.
 

### Extract Web Link-Generated Content

The *Extract Web Link-Generated Content* command scans a folder (the default is named *Bookmarks*) for web links in Markdown files - anything beginning with *http(s)://*. It takes two parameters:
- *Bookmark files*: where to locate files containing links for processing
- *Overwrite Web Links*: whether to overwrite existing generated Markdown files with the same name



### The *Link Topics* Command

The *Link Topics* Command uses the [stdlib](https://github.com/stdlib-js/stdlib) implementation of [LDA](https://en.wikipedia.org/wiki/Latent_Dirichlet_allocation) (Latent Dirichlet  allocation) to scan Markdown text for common topics and keywords. It will produces a folder (by default, *Topics*) that contains an index and a series of individual files that link to documents relevant to related topics. 

The command at the heart of the plugin is *Link Topics*. This takes a pattern setting, *Topic File Pattern*, to scan Markdown files for topics. A number of other settings condition how those files are scanned, how the LDA model is trained, and how the results of the model are then formatted. Here are the general  parameters for the command:
- *Number of topics*: how many topics to generate
- *Number of words*: how many words to include for each topic
- *Stemming*: whether scanned tokens should be stemmed (e.g. 'capital' becomes 'capit')
- *Topic threshold*: what probability (between 0 and 1) a document must have to be relevant to a given topic

Three parameters relate to which Markdown file contents are included in the topic model:
- *Topic file pattern*: a *glob* style pattern for locating files
- *Topic search pattern*: a non-empty string further filters files, depending on whether they contain the search term
- *Topic tag pattern*: a non-empty tag further filters files, depending on whether they include one of the space-separated tags (e.g. '#fashion')

Other parameters condition how the Markdown files are sampled:
- *Fixed number of words*: select just a subset of each Markdown file, based on a fixed number of words
- *Percentage of total text*: select just a subset of each Markdown file, based on a percentage of the file's text (overriden by any non-zero value for *Fixed Number of Words*)
- *Randomise text*: if either *Fixed Number of Words* or *Percentage of Total Text* are selected, randomised whether these samples are drawn randomly.

The *Topic* folder can include either or both of the file pattern or current timestamp:
- *Include pattern in topic folder
- *Include timestamp in topic folder

Finally, the training parameters of the LDA model can be conditioned, as described in the [stdlib lda documentation](https://www.npmjs.com/package/@stdlib/nlp-lda):
- *LDA iterations*: Number of training iterations
- *LDA burn in*: Number of candidates initially discarded
- *LDA thin*: Number of candidates discarded at each subsequent iteration




### Acknowledgements

This code includes a modified version of the *Citeproc-plus* library.

Source code: <https://github.com/fiduswriter/citeproc-plus>
Copyright: Johannes Wilm
License: <https://raw.githubusercontent.com/fiduswriter/citeproc-plus/master/LICENSE>

*Citeproc-plus* in turn includes *citeproc-js* and the [*Citation Style Langage* CSL](<https://citationstyles.org/>) project. 

Citeproc-js licence: <https://raw.githubusercontent.com/Juris-M/citeproc-js/master/LICENSE>
Citation Style Langage styles: <https://github.com/citation-style-language/styles> 
Citation Style Langage locales: <https://github.com/citation-style-language/locales> 
Extra style licence: <https://raw.githubusercontent.com/fiduswriter/citeproc-plus/master/extra_style_licenses.txt>



### Github link

See https://github.com/liammagee/obsidian-topic-linking-plugin

