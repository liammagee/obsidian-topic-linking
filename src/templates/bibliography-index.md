# Bibliography

{%- for key, csl in entries %}
{{ csl | safe }}
[link]({{ key }})
{%- endfor %}

