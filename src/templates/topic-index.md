# Topic Index

Results based on scanning files that match file path '{{ topicPathPattern }}', search pattern '{{ topicSearchPattern }}' and tags '{{ topicTagPattern }}'.

## Topics 

{%- for topic in topics %}
 - [[{{- topic }}]]
{%- endfor %}

## Reading List

> [!NOTE] NOTE
> To retain this list, copy to another location or check the 'Topic Folder Timestamp' option under 'Settings'.


{%- for docData in entries %}


### {{ docData.title }}

{%- if docData.bib != '' %}
Citation: 
{{- docData.bib | safe }}
{%- endif %}

Source: [[{{- docData.ref }}]]

- [ ] Read?

##### Distinctive Terms:

| Term                 | Frequency    | Relative Frequency  |
| :------------------- | -----------: | ------------------: |
{%- for term in docData.terms %}
| {{ term.term }} | {{ term.tf | round(2) }} | {{ term.tfidf | round(2) }} |
{%- endfor %}
{%- endfor %}