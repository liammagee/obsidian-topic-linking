{% if item %}---
ID: {{item.citationKey}}
Title: {{item.title}}
Authors: {{item.authors}}
Abstract: {{item.abstractNote}}
Published: {{item.date}}
Publisher: {{item.extra}}
Publication: {{item.publicationTitle}}
Volume: {{item.volume}}
Issue: {{item.issue}}
Pages: {{item.pages}}
Reference: {{item.bib | striptags}}
---

[Open in Zotero](zotero://select/library/items/{{item.select}}) {% endif %}
Source: [[PDFs/{{filePath}}]]
{% if annotationMetadata %}
---
#### Annotations
{% for annotation in annotationMetadata %}
 - {{annotation.highlightText|safe}} [[#Page {{annotation.page}}]]. {% if annotation.commentText %} - **${{ annotation.commentText|safe }}** {% endif %} 
{% endfor %}
{% endif %}

