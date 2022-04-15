{% if item and item.citationKey %}---
ID: {{item.citationKey}}
Title: "{{item.title}}"
Authors: "{{item.authors}}"
Abstract: "{{item.abstractNote}}"
Published: {{item.date}}
Publisher: "{{item.extra}}"
Publication: "{{item.publicationTitle}}"
Volume: {{item.volume}}
Issue: {{item.issue}}
Pages: {{item.pages}}
Reference: "{{item.bib | striptags}}"
---

[Open in Zotero](zotero://select/library/items/{{item.select}}) {% endif %}
Source: [[{{filePath}}]]

{%- if annotations and annotations.length > 1 %}

---

#### Annotations


{% for annotation in annotations %}
> [!QUOTE] Highlight from [[#Page {{annotation.page}}]]
> *{{annotation.highlightText|safe}}*
>
> {% if annotation.commentText %}**Note:** ${{ annotation.commentText|safe }} {% endif %}
{% endfor %}
{%- endif %}

{%- for footnoteID, footnoteText in footnotes %}

[^{{footnoteID}}]: {{ footnoteText }}
{%- endfor %}
