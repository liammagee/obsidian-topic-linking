---

## Footnotes
{% for footnoteID, footnoteText in footnotes %}

[^{{footnoteID}}]: {{ footnoteText }}
{% endfor %}
