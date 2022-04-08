import ad from "./styles/ad.csljson"
import ai from "./styles/ai.csljson"
import ce from "./styles/ce.csljson"
import cm from "./styles/cm.csljson"
import dm from "./styles/dm.csljson"
import ed from "./styles/ed.csljson"
import ek from "./styles/ek.csljson"
import eq from "./styles/eq.csljson"
import es from "./styles/eq.csljson"
import fx from "./styles/fx.csljson"
import hd from "./styles/hd.csljson"


export const styleLocations = {
    "apa": ek,
    "chicago-author-date": ai,
    "chicago-fullnote-bibliography": cm,
    "chicago-note-bibliography": ce,
    "ieee": ad,
    "ieee-with-url": dm,
    "nature": es,
    "oxford-university-press-note": ai,
    "sage-harvard": fx,
    "turabian-fullnote-bibliography": eq,
    "turabian-author-date": hd,
    "university-of-york-mla": ed
}

export const styles = {
    "apa": "American Psychological Association 7th edition",
    "chicago-author-date": "Chicago Manual of Style 17th edition (author-date)",
    "chicago-fullnote-bibliography": "Chicago Manual of Style 17th edition (full note)",
    "chicago-note-bibliography": "Chicago Manual of Style 17th edition (note)",
    "ieee": "IEEE",
    "ieee-with-url": "IEEE (with URL)",
    "nature": "Nature",
    "oxford-university-press-note": "Oxford University Press (note)",
    "sage-harvard": "SAGE - Harvard",
    "turabian-fullnote-bibliography": "Turabian 8th edition (full note)",
    "turabian-author-date": "Turabian 9th edition (author-date)",
    "university-of-york-mla": "University of York - Modern Language Association 8th edition"
}
