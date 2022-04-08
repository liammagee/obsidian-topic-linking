# Topic {{ topicNo }}

Return to [[Topic Index]]

## Keywords 

#### Tags

{% for tag in tags %} #{{tag}},{% endfor %}


#### Topic-Word Relevance 

| Word                 | Probability  |
| :------------------- | -----------: |
{%- for topicWord in topicWords %}
| **{{topicWord.word}}**                  | {{topicWord.prob}}      |
{%- endfor %}

## Links 

{%- for link in links %}
 - [[{{ link.doc }}]] [relevance: {{ link.score }}] ([[{{link.doc}}.pdf|Source]])
{%- endfor %}
