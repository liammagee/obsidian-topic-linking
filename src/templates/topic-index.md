# Topic Index

Results based on scanning files that match file path '{{ topicPathPattern }}', search pattern '{{ topicSearchPattern }}' and tags '{{ topicTagPattern }}'.

## Topics 

{%- for topic in topics %}
 - [[{{- topic }}]]
{%- endfor %}

## Reading List

**Note:** to retain this list, copy to another location or check the 'Topic Folder Timestamp' option under 'Settings'.


{%- for entry in entries %}
 - [ ] [[{{- entry }}]]
{%- endfor %}