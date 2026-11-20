"""Build the expert review page (Danish) for Tangkortet's open content questions.

    py scripts/build_expert_review.py        # -> review/public/index.html

Modelled on Svampekortet's species review tool (`scripts/build_photo_review.py`
there, commit 0024b43): a static page deployed as its own Cloudflare Pages
project (`review/`), separate from the app, with answers saved live through a
Pages Function backed by Workers KV (`review/functions/api/review-state.js`).
KV rather than a Claude Artifact's storage capabilities because those require
the viewer to have a Claude account in the owner's organisation, which the
expert does not.

The page asks the questions in docs/plan.md ("Questions for the expert"), asks
the expert to weigh the risk factors from their own brief, and has one card
per candidate species showing the GBIF evidence from
`data/expert/species_evidence.json` (`scripts/spike_gbif_seaweed.py`) next to
fields for depth, harvest method, season and warnings.

State shape: ``{"answers": {<field key>: str | list[str]}}``. Every input on
the page carries a ``data-key``; checkbox groups store a list.
"""

from __future__ import annotations

import hashlib
import html
import json
import pathlib
import re
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
from pipeline.publish import IMAGES_DIR, slugify  # noqa: E402
from pipeline.species import TARGET_SPECIES  # noqa: E402

EVIDENCE = REPO_ROOT / "data" / "expert" / "species_evidence.json"
# The app's traffic-light rules (ADR-0005); the same file web/src/verdict.ts reads.
VERDICT_RULES = REPO_ROOT / "web" / "src" / "verdict-rules.json"
# Literature-based accumulation proposals (docs/literature-accumulation.md).
PROPOSALS = REPO_ROOT / "data" / "expert" / "accumulation_proposals.json"
OUT = REPO_ROOT / "review" / "public" / "index.html"

# Keep in sync with TOKEN in review/functions/api/review-state.js -- not a real
# secret, it ships in the page's client-side JS either way.
API_TOKEN = "aa8646a44b0cd3d63a83c5e56dd0cd59"

MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]

HARVEST_METHODS = [
    ("klip_skudspids", "Klip skudspidserne af med saks (vokser fra spidserne)"),
    ("hel_plade", "Høst hele bladpladen / tæt ved stipes (vokser fra bladpladen)"),
    ("andet", "Andet (beskriv nedenfor)"),
]

INCLUDE = [("ja", "Ja"), ("maaske", "Måske"), ("nej", "Nej")]

ACCUMULATION = [("jod", "Jod"), ("arsen", "Arsen"), ("cadmium", "Cadmium")]

# The risk factors from the brief's §1 table, in its order.
RISK_FACTORS = [
    ("industri", "Industri og historisk forurening"),
    ("landbrug", "Landbrug og dræn"),
    ("nedboer", "Kraftig nedbør (seneste 24–72 timer)"),
    ("spildevand", "Spildevand og overløb"),
    ("havne", "Havne og sejlads"),
    ("sediment", "Sediment og havbund (klappladser m.m.)"),
    ("badevand", "Badevandskvalitet"),
    ("opblomstring", "Opblomstringer (mikroalger, cyanobakterier)"),
    ("art_saeson", "Art og sæson (ophobning af arsen, cadmium, jod)"),
    ("naturbeskyttelse", "Naturbeskyttelse (fredninger, Natura 2000)"),
]
IMPORTANCE = [("hoej", "Høj"), ("middel", "Middel"), ("lav", "Lav"), ("ikke", "Ikke relevant")]

GENERAL_QUESTIONS = [
    {
        "key": "q.opskyl",
        "title": "Opskyllet tang",
        "text": "Jeres brief anbefaler frisk, fastsiddende tang frem for opskyllet. "
        "Hvordan skal appen vise fund af opskyllet tang?",
        "choices": [
            ("sankested", "Som et sted man kan sanke"),
            ("tegn", "Kun som et tegn på, at arten gror i nærheden"),
            ("skjul", "Slet ikke"),
        ],
    },
    {
        "key": "q.vurdering",
        "title": "Liste eller samlet vurdering",
        "text": "Når man vælger et sted på kortet, viser appen de risikofaktorer, den "
        "kan finde i nærheden (fx udløb, havne, forurenede grunde, regn). Er en "
        "sådan liste nok, eller forventer sankere en samlet vurdering?",
        "choices": [
            ("liste", "En liste over risikofaktorer er nok"),
            ("trafiklys", "En samlet vurdering (fx trafiklys)"),
            ("begge", "Begge dele"),
        ],
    },
    {
        "key": "q.kilder_ophobning",
        "title": "Kilder om jod, arsen og cadmium",
        "text": "Kender du gode kilder (fx Fødevarestyrelsen, DTU Fødevareinstituttet, "
        "forskningsartikler) til, hvor meget de enkelte arter ophober?",
    },
    {
        "key": "q.regler",
        "title": "Regler for indsamling",
        "text": "Hvilke regler for indsamling af tang til eget brug bør appen nævne "
        "(fx privat strand, fredning, Natura 2000, mængder)? Kender du kilden?",
    },
    {
        "key": "q.andet",
        "title": "Andet",
        "text": "Er der noget, appen absolut bør have med, eller noget den bør undgå?",
    },
]


def _esc(s: object) -> str:
    return html.escape(str(s), quote=True)


def _radio(key: str, options: list[tuple[str, str]]) -> str:
    return "\n".join(
        f'<label class="opt"><input type="radio" name="{_esc(key)}" data-key="{_esc(key)}" '
        f'value="{_esc(v)}"> {_esc(label)}</label>'
        for v, label in options
    )


def _checks(key: str, options: list[tuple[str, str]]) -> str:
    return "\n".join(
        f'<label class="opt chip"><input type="checkbox" data-key="{_esc(key)}" '
        f'data-multi value="{_esc(v)}"> {_esc(label)}</label>'
        for v, label in options
    )


def _text(key: str, placeholder: str = "", rows: int = 3) -> str:
    return (
        f'<textarea data-key="{_esc(key)}" rows="{rows}" '
        f'placeholder="{_esc(placeholder)}"></textarea>'
    )


def _number(key: str, label: str, unit: str = "m", max_value: int = 60) -> str:
    return (
        f'<label class="num">{_esc(label)} <input type="number" inputmode="decimal" '
        f'min="0" max="{max_value}" step="0.5" data-key="{_esc(key)}"> {_esc(unit)}</label>'
    )


RULE_VERDICT = [("enig", "Enig"), ("juster", "Justér"), ("fjern", "Fjern")]
LEVEL_LABEL = {"red": "Rød", "yellow": "Gul"}


def _rule_row(r: dict) -> str:
    k = f"trafiklys.{r['id']}"
    return f"""<div class="risk" data-group="{_esc(k)}">
  <div class="risk-name"><span class="lvl lvl--{r["level"]}">{LEVEL_LABEL[r["level"]]}</span>
    {_esc(r["text"])}</div>
  <div class="opts row">{_radio(k, RULE_VERDICT)}</div>
  {_text(k + ".kommentar", "Fx en anden afstand eller grænse", 1)}
</div>"""


WIND_DIRECTION = [
    ("paalands", "Ja – kun vind ind mod kysten tæller"),
    ("nej", "Nej – al kraftig vind tæller"),
    ("vedikke", "Ved ikke"),
]


FOLLOWUP2_SARGASSUM = [
    ("fraraades", "Frarådes helt som fødevare"),
    ("smaa_maengder", "Kan spises, men ikke store mængder dagligt"),
]
FOLLOWUP2_COMPRESSA = [
    ("flad", "Flad rørhinde (den nationale artsliste)"),
    ("andet", "Et andet navn (skriv det nedenfor)"),
]
FOLLOWUP2_GRACILARIA = [
    ("arterdk", "Ja – brug arter.dk-navnet"),
    ("begge", "Ja, men nævn også paryktang"),
    ("nej", "Nej (skriv hvorfor nedenfor)"),
]


PHOTO_VERDICT = [("behold", "Behold"), ("afvis", "Afvis"), ("ved_ikke", "Ved ikke")]
_PHOTO_ID = re.compile(r"/photos/(\d+)/")
COUNTRY_NAME = {"DK": "Danmark", "SE": "Sverige", "NO": "Norge", "DE": "Tyskland",
                "NL": "Holland", "GB": "Storbritannien", "IE": "Irland", "FR": "Frankrig",
                "IS": "Island", "JE": "Jersey", "GG": "Guernsey", "BE": "Belgien",
                "ES": "Spanien", "PT": "Portugal", "FO": "Færøerne", "CA": "Canada",
                "US": "USA", "NZ": "New Zealand"}  # fmt: skip


def photo_key(slug: str, url: str) -> str:
    """The answer key of one photo: ``foto.<slug>.<iNaturalist photo id>``
    (scripts/apply_photo_review.py reads it back)."""
    match = _PHOTO_ID.search(url)
    ident = match.group(1) if match else hashlib.sha1(url.encode()).hexdigest()[:10]
    return f"foto.{slug}.{ident}"


def _photo(slug: str, img: dict) -> str:
    key = photo_key(slug, img["url"])
    medium = img["url"].replace("/large.", "/medium.")
    link = img.get("observation_url") or img.get("photo_url") or img["url"]
    where = COUNTRY_NAME.get(img.get("country") or "", img.get("country") or "")
    radios = "".join(
        f'<label class="opt chip"><input type="radio" name="{_esc(key)}" '
        f'data-key="{_esc(key)}" value="{v}"> {label}</label>'
        for v, label in PHOTO_VERDICT
    )
    return f"""<figure class="photo">
  <a href="{_esc(link)}" target="_blank" rel="noopener"><img src="{_esc(medium)}"
    alt="Foto til vurdering" loading="lazy" width="240" height="180"></a>
  <figcaption>{_esc(img["credit"])} · {_esc(img["license"])}{" · " + _esc(where) if where else ""}
    · <a href="{_esc(link)}" target="_blank" rel="noopener">se fundet</a></figcaption>
  <div class="opts row">{radios}</div>
</figure>"""


def _photos() -> str:
    """One card per species: keep or reject each photo the app shows."""
    cards = []
    for sp in TARGET_SPECIES:
        if sp["status"] != "published":
            continue
        slug = slugify(sp["scientific_name"])
        path = IMAGES_DIR / f"{slug}.json"
        images = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
        name = sp["danish_name"] or sp["scientific_name"]
        grid = (
            '<div class="photos">' + "".join(_photo(slug, i) for i in images) + "</div>"
            if images
            else "<p><i>Vi har ikke fundet et frit foto (CC0 / CC BY) af arten. Kender du et,"
            " vi må bruge, så skriv det gerne her.</i></p>"
        )
        cards.append(f"""<section class="card q" data-group="foto.{slug}">
  <h3>{_esc(name)} <span class="sci">{_esc(sp["scientific_name"])}</span></h3>
  {grid}
  {_text(f"foto.{slug}.kommentar", "Fx: ingen af dem er den rigtige art, eller et bedre foto", 2)}
</section>""")
    return f"""<h2>Fotos af arterne</h2>
<p class="intro"><b>Nyt:</b> Appen viser nu fotos af hver art, hentet fra iNaturalist-fund
  med en fri licens. Fotografen har bestemt arten, men ingen fagperson har kigget på dem.
  Er det den rigtige art, og er det et godt billede at kende den på? Vælg “Behold” eller
  “Afvis” for hvert foto – tryk på billedet for at se fundet. Afviste fotos fjernes fra
  appen, og indtil du har set dem, står der i appen, at fotos ikke er gennemgået.</p>
{"".join(cards)}"""


def _followup2() -> str:
    """Round 3 (2026-11-20): what we did with the expert's round-2 answers, and the
    questions they raised."""
    return f"""<h2>Opfølgning 2 – tak for de mange svar</h2>
<p class="intro">Det har vi gjort ud fra dine svar (se det i
  <a href="https://tangkortet.pages.dev" target="_blank" rel="noopener">appen</a>):
  høstmetoder for blæretang, søl og sukkertang; jod-advarslen for sukkertang og fingertang;
  kainsyre i søl; arsen i butblæret sargassotang; Ulva fenestrata (Almindelig søsalat) i
  stedet for Ulva lactuca; fem nye arter (kortene ligger nederst); risikofaktorerne sorteret
  efter din vægtning; trafiklysets regler justeret, og din regel om å-udløb inden for 200 m
  tilføjet; Fødevarestyrelsens råd og regler i "Før du går"; og en velkomstbesked. Vinden:
  kun pålandsvind tæller nu, og opskyllet tang regnes som frisk i ca. 1 døgn efter blæsten.</p>

<section class="card q" data-group="q2.sargassum">
  <h3>Butblæret sargassotang</h3>
  <p>Du skrev både, at den frarådes at spise, og at den kan spises, men ikke i store mængder
    dagligt. Appen siger nu: "Frarådes som fødevare – spis den i hvert fald aldrig i større
    mængder." Hvad skal den sige?</p>
  <div class="opts">{_radio("q2.sargassum", FOLLOWUP2_SARGASSUM)}</div>
  {_text("q2.sargassum.kommentar", "Uddyb gerne")}
</section>

<section class="card q" data-group="q2.compressa">
  <h3>Navnet på Ulva compressa</h3>
  <p>Du kaldte den tarm-rørhinde, men i den nationale artsliste hedder den
    <b>Flad rørhinde</b>; "Tarm-rørhinde" bruges om Ulva intestinalis. Appen bruger nu
    "Flad rørhinde". Er det rigtigt?</p>
  <div class="opts">{_radio("q2.compressa", FOLLOWUP2_COMPRESSA)}</div>
  {_text("q2.compressa.kommentar", "Fx det navn, du vil foreslå")}
</section>

<section class="card q" data-group="q2.gracilaria">
  <h3>Navnet på Gracilaria vermiculophylla</h3>
  <p>På arter.dk hedder den <b>Brunlig gracilariatang</b>; du skrev også paryktang. Appen
    bruger nu arter.dk-navnet. Er det i orden?</p>
  <div class="opts">{_radio("q2.gracilaria", FOLLOWUP2_GRACILARIA)}</div>
  {_text("q2.gracilaria.kommentar", "Uddyb gerne")}
</section>

<section class="card q" data-group="q2.maengder">
  <h3>Hvad er "store mængder dagligt"?</h3>
  <p>Advarslerne om jod (Laminaria-arter), kainsyre (søl) og arsen siger, at man ikke bør
    spise store mængder dagligt. Har du et tal eller en tommelfingerregel, vi kan bruge
    (fx gram tørret tang pr. dag eller pr. uge)?</p>
  {_text("q2.maengder", "Fx: højst X g tørret sukkertang om ugen")}
</section>"""


def _followup(rules: dict) -> str:
    """Round 2 (2026-10-23): follow-up on the expert's first answers -- the draft
    traffic light they asked for, and the wind check for drift tang."""
    rows = "".join(_rule_row(r) for r in rules["rules"])
    return f"""<h2>Opfølgning på dine svar</h2>
<p class="intro">Tak for dine svar! Ud fra dem har vi lavet to ting, som du kan se i appen
  (<a href="https://tangkortet.pages.dev/#pin=56.15100,10.21900&tab=risiko" target="_blank"
  rel="noopener">eksempel fra Aarhus</a>): et <b>samlet trafiklys</b> øverst under Risiko, og et
  <b>vindkort</b>, der viser, hvornår det sidst blæste kraftigt. Opskyllet tang vises nu kun som
  et tegn på, at arten gror i nærheden, sammen med dit råd om friskhed.</p>

<section class="card" data-group="trafiklys">
  <h3>Trafiklys – udkast til regler</h3>
  <p>Rød, hvis én rød regel passer; gul, hvis én gul regel passer; ellers grøn ("få kendte
    risikokilder" – aldrig "sikkert"). Afstandene og grænserne er vores bud. Er du enig, eller
    skal de justeres? Kystvandets kemiske tilstand er udeladt, fordi 121 af 123 danske
    kystvande har ikke-god kemisk tilstand.</p>
{rows}
  <div class="field"><span class="lbl">Mangler der regler?</span>
    {_text("trafiklys.mangler", "Fx strøm, vandløbsudmunding, årstid …")}</div>
</section>

<section class="card" data-group="vind">
  <h3>Vind og opskyllet tang</h3>
  <p>Du skrev, at opskyllet tang sandsynligvis er kommet op ved sidste kraftige blæst. Appen
    viser nu den seneste time med mindst 10,8 m/s middelvind (Beaufort 6, "hård vind") ved
    den DMI-station inden for 40 km, der målte mest vind, de seneste 14 dage.</p>
  <div class="field"><span class="lbl">Hvad regner du som kraftig blæst?</span>
    <div class="row">{_number("vind.kraftig_ms", "mindst", "m/s middelvind", 40)}</div></div>
  <div class="field"><span class="lbl">Hvor længe efter blæsten kan opskyllet tang være frisk
    nok?</span>
    <div class="row">{_number("vind.friske_dage", "op til", "dage", 30)}</div></div>
  <div class="field"><span class="lbl">Betyder vindretningen noget (fx kun pålandsvind)?</span>
    <div class="opts">{_radio("vind.retning", WIND_DIRECTION)}</div>
    {_text("vind.kommentar", "Uddyb gerne")}</div>
</section>"""


def _general(q: dict) -> str:
    choices = f'<div class="opts">{_radio(q["key"], q["choices"])}</div>' if "choices" in q else ""
    comment_key = q["key"] + ".kommentar" if "choices" in q else q["key"]
    placeholder = "Uddyb gerne her" if "choices" in q else "Dit svar"
    return f"""<section class="card q" data-group="{_esc(q["key"])}">
  <h3>{_esc(q["title"])}</h3>
  <p>{_esc(q["text"])}</p>
  {choices}
  {_text(comment_key, placeholder)}
</section>"""


def _risk_row(key: str, label: str) -> str:
    k = f"risiko.{key}"
    return f"""<div class="risk" data-group="{k}">
  <div class="risk-name">{_esc(label)}</div>
  <div class="opts row">{_radio(k + ".vigtighed", IMPORTANCE)}</div>
  {_text(k + ".kommentar", "Kommentar (valgfri)", 1)}
</div>"""


def _evidence(e: dict) -> str:
    att = e["attachment"]
    depth = e["depth"]
    if depth:
        depth_line = (
            f"{depth['n']} fund med dybde: typisk {depth['p10']:g}–{depth['p90']:g} m "
            f"(median {depth['median']:g} m)"
        )
    else:
        depth_line = "Ingen fund med dybde"
    datasets = ", ".join(f"{_esc(name)} ({n})" for name, n in e["top_datasets"][:3])
    return f"""<div class="evidence">
  <div><b>{e["records_dk"]}</b> danske fund i GBIF, heraf {e["records_since_2015"]} siden 2015</div>
  <div>{_esc(depth_line)}</div>
  <div>Automatisk vurderet: {att.get("attached", 0)} fastsiddende ·
    {att.get("drift", 0)} opskyllet · {att.get("unknown", 0)} ukendt</div>
  <div class="src">Kilder: {datasets}</div>
</div>"""


# Cards keyed by an outdated name keep their key, so the expert's answers stay put.
RENAMED = {
    "Ulva lactuca": (
        "Almindelig søsalat",
        "Ulva fenestrata (tidligere registreret som Ulva lactuca)",
    )
}
PROPOSAL_ALIAS = {"ulva-lactuca": "ulva-fenestrata"}

EVIDENCE_LABEL = {
    "dansk": "Danske målinger",
    "udenlandsk": "Udenlandsk litteratur",
    "usikker": "Sparsomme data",
    "ekspert": "Ekspertens oplysning",
    "ingen": "Ingen data fundet",
}
FLAG_LABEL = {"jod": "Jod", "arsen": "Arsen", "cadmium": "Cadmium"}
PROPOSAL_VERDICT = [("enig", "Enig i forslaget"), ("uenig", "Uenig – se mine rettelser nedenfor")]


def _short_citation(source: dict) -> str:
    first = source["citation"].split(",")[0].rsplit(" ", 1)[0]
    year = source["citation"].split("(")[1][:4]
    holdt = " – med Susan Løvstad Holdt" if source["holdt"] else ""
    return (
        f'<a href="https://doi.org/{_esc(source["doi"])}" target="_blank" rel="noopener">'
        f"{_esc(first)} m.fl. {year}</a>{holdt}"
    )


def _proposal(k: str, proposal: dict, sources: dict) -> str:
    flags = proposal["flags"]
    if flags is None:
        headline = "Ingen data – vi har brug for din vurdering"
    elif flags:
        headline = "Foreslået advarsel: " + ", ".join(FLAG_LABEL[f] for f in flags)
    else:
        headline = "Foreslået: ingen særlig advarsel"
    cites = "; ".join(_short_citation(sources[s]) for s in proposal["sources"])
    src = f'<p class="src">Kilder: {cites}</p>' if cites else ""
    return f"""<div class="proposal">
    <span class="lbl">Forslag fra litteraturen · {EVIDENCE_LABEL[proposal["evidence"]]}</span>
    <p><b>{_esc(headline)}</b></p>
    <p>{_esc(proposal["text"])}</p>
    {src}
    <div class="opts">{_radio(k + ".ophobning_forslag", PROPOSAL_VERDICT)}</div>
  </div>"""


def _species(e: dict, proposals: dict) -> str:
    slug = e["scientific_name"].lower().replace(" ", "-")
    k = f"art.{slug}"
    verified = e["danish_name_source"].startswith("arter.dk")
    name = e["danish_name"] or "(intet dansk navn fundet)"
    sci = e["scientific_name"]
    if sci in RENAMED:  # keep the card key (the expert's answers), show the new name
        name, sci, verified = *RENAMED[sci], True
    badge = "" if verified else '<span class="badge">navn ikke bekræftet</span>'
    months = [(str(i + 1), m) for i, m in enumerate(MONTHS)]
    proposal = proposals["species"][PROPOSAL_ALIAS.get(slug, slug)]
    return f"""<section class="card sp" data-group="{k}">
  <h3>{_esc(name)} <span class="sci">{_esc(sci)}</span> {badge}</h3>
  {_evidence(e)}
  <div class="field"><span class="lbl">Med i første version?</span>
    <div class="opts row">{_radio(k + ".med", INCLUDE)}</div></div>
  <div class="field"><span class="lbl">Forventet dybde, hvor man sanker den</span>
    <div class="row">{_number(k + ".dybde_min", "fra")}
      {_number(k + ".dybde_max", "til")}</div></div>
  <div class="field"><span class="lbl">Høstmetode</span>
    <div class="opts">{_radio(k + ".hoestmetode", HARVEST_METHODS)}</div></div>
  <div class="field"><span class="lbl">Bedste måneder at sanke</span>
    <div class="opts row">{_checks(k + ".maaneder", months)}</div></div>
  <div class="field">{_proposal(k, proposal, proposals["sources"])}
    <span class="lbl">Ophobning at advare om (din vurdering)</span>
    <div class="opts row">{_checks(k + ".ophobning", ACCUMULATION)}</div></div>
  <div class="field"><span class="lbl">Forvekslingsarter, friskhed, tilberedning, andet</span>
    {_text(k + ".noter", "Fx hvad den kan forveksles med, hvordan man ser om den er frisk")}</div>
  <div class="field"><span class="lbl">Rettelse til det danske navn</span>
    <input type="text" data-key="{k}.navn" placeholder="Udfyld kun, hvis navnet er forkert"></div>
</section>"""


STYLE = """
:root { color-scheme: light dark; --bg:#eef3f2; --fg:#1d2a2b; --muted:#5b6b6c;
  --card:#fff; --border:#cfdcdb; --accent:#1f6f78; --done:#2f7d4f; --warn:#b4552d; }
@media (prefers-color-scheme: dark) { :root {
  --bg:#141b1c; --fg:#e3ecec; --muted:#93a5a6; --card:#1c2627; --border:#2f3e3f;
  --accent:#5fb3bc; --done:#6cc08f; --warn:#e08a63; } }
* { box-sizing: border-box; }
body { margin:0; font:15px/1.5 system-ui, sans-serif; background:var(--bg); color:var(--fg); }
header { position:sticky; top:0; z-index:5; background:var(--card);
  border-bottom:1px solid var(--border); padding:.6rem 1rem;
  display:flex; gap:.75rem; align-items:center; flex-wrap:wrap; }
header h1 { font-size:1rem; margin:0 .5rem 0 0; }
.count { color:var(--muted); font-size:.88rem; }
.syncstate { font-size:.8rem; padding:.15rem .5rem; border-radius:999px;
  border:1px solid var(--border); }
.syncstate[data-state="saving"], .syncstate[data-state="loading"] { color:var(--accent);
  border-color:var(--accent); }
.syncstate[data-state="synced"] { color:var(--done); border-color:var(--done); }
.syncstate[data-state="error"] { color:var(--warn); border-color:var(--warn); }
main { padding:1rem; display:grid; gap:1rem; max-width:900px; margin:0 auto; }
h2 { margin:1.2rem 0 0; font-size:1.15rem; }
.intro { color:var(--muted); margin:0; }
.card { background:var(--card); border:1px solid var(--border);
  border-left:5px solid var(--border); border-radius:8px; padding:.9rem 1rem; }
.card[data-done] { border-left-color:var(--done); }
.card h3 { margin:0 0 .3rem; font-size:1.02rem; }
.card p { margin:.2rem 0 .6rem; }
.sci { color:var(--muted); font-style:italic; font-weight:normal; }
.badge { font-size:.72rem; font-weight:600; color:var(--warn); border:1px solid var(--warn);
  border-radius:999px; padding:.05rem .45rem; vertical-align:middle; }
.evidence { font-size:.85rem; color:var(--muted); background:var(--bg); border-radius:6px;
  padding:.5rem .7rem; margin:.3rem 0 .7rem; }
.evidence .src { font-size:.78rem; margin-top:.2rem; }
.field { margin:.65rem 0; }
.lbl { display:block; font-size:.78rem; color:var(--muted); text-transform:uppercase;
  letter-spacing:.04em; margin-bottom:.25rem; }
.opts { display:flex; flex-direction:column; gap:.3rem; }
.opts.row { flex-direction:row; flex-wrap:wrap; gap:.4rem .9rem; }
.opt { cursor:pointer; }
.chip { border:1px solid var(--border); border-radius:6px; padding:.15rem .5rem; }
.chip:has(input:checked) { border-color:var(--accent);
  background:color-mix(in srgb, var(--accent) 14%, transparent); }
.row { display:flex; gap:1rem; flex-wrap:wrap; align-items:center; }
.num input { width:5.5rem; }
textarea, input[type=text], input[type=number] { font:inherit; padding:.45rem .6rem;
  border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--fg); }
textarea { width:100%; resize:vertical; margin-top:.4rem; }
input[type=text] { width:100%; }
textarea:focus, input:focus { outline:2px solid var(--accent); outline-offset:1px; }
:disabled { opacity:.6; }
.risk { border-top:1px solid var(--border); padding:.6rem 0; }
.risk:first-of-type { border-top:0; }
.risk-name { font-weight:600; margin-bottom:.25rem; }
.proposal { background:var(--bg); border:1px dashed var(--accent); border-radius:6px;
  padding:.5rem .7rem; margin-bottom:.6rem; font-size:.9rem; }
.proposal p { margin:.25rem 0; }
.proposal .src { font-size:.8rem; color:var(--muted); }
.lvl { font-size:.72rem; font-weight:700; border-radius:999px; padding:.05rem .45rem;
  color:#fff; margin-right:.3rem; vertical-align:middle; }
.lvl--red { background:#c0392b; }
.lvl--yellow { background:#b8860b; }
.risk textarea { margin-top:.35rem; }
.photos { display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:.8rem;
  margin:.4rem 0; }
.photo { margin:0; display:flex; flex-direction:column; gap:.35rem; }
.photo img { width:100%; aspect-ratio:4/3; object-fit:cover; border-radius:6px;
  background:var(--bg); display:block; }
.photo figcaption { font-size:.78rem; color:var(--muted); }
.photo .opts.row { gap:.3rem; flex-wrap:nowrap; }
.photo .chip { padding:.35rem .5rem; font-size:.88rem; white-space:nowrap; }
"""

SCRIPT = """
const API = "/api/review-state";
const TOKEN = "%TOKEN%";
let state = { answers: {} };
let loaded = false;

function setSyncState(s) {
  const el = document.getElementById("syncstate");
  el.textContent = { loading: "Henter…", saving: "Gemmer…", synced: "Gemt",
    error: "Kunne ikke gemme – prøver igen ved næste ændring" }[s] || "";
  el.dataset.state = s;
}

async function loadState() {
  setSyncState("loading");
  let ok = false;
  try {
    const res = await fetch(API, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === "object") state = data;
      ok = true;
    }
  } catch {}
  if (!state.answers) state.answers = {};
  if (!ok) { setSyncState("error"); return; } // never overwrite answers we couldn't read
  fill();
  loaded = true;
  document.querySelectorAll("[data-key]").forEach(el => el.disabled = false);
  render();
  setSyncState("synced");
}

function fill() {
  document.querySelectorAll("[data-key]").forEach(el => {
    const v = state.answers[el.dataset.key];
    if (el.type === "radio") el.checked = v === el.value;
    else if (el.type === "checkbox") el.checked = Array.isArray(v) && v.includes(el.value);
    else if (v !== undefined) el.value = v;
  });
}

function read(el) {
  const key = el.dataset.key;
  if (el.type === "checkbox") {
    return [...document.querySelectorAll(`[data-key="${key}"]:checked`)].map(c => c.value);
  }
  return el.value;
}

let saveTimer = null;
function scheduleSave(delay) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, delay);
}
async function doSave() {
  setSyncState("saving");
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json", "x-review-token": TOKEN },
      body: JSON.stringify(state),
    });
    if (!res.ok) throw new Error(String(res.status));
    setSyncState("synced");
  } catch {
    setSyncState("error");
  }
}

function onInput(e) {
  const el = e.target;
  if (!loaded || !el.dataset || !el.dataset.key) return;
  const v = read(el);
  if (v === "" || (Array.isArray(v) && v.length === 0)) delete state.answers[el.dataset.key];
  else state.answers[el.dataset.key] = v;
  render();
  scheduleSave(el.tagName === "TEXTAREA" || el.type === "text" ? 900 : 0);
}

function render() {
  let done = 0;
  const cards = document.querySelectorAll(".card");
  cards.forEach(card => {
    const g = card.dataset.group;
    const any = Object.keys(state.answers).some(k => k === g || k.startsWith(g + "."));
    card.toggleAttribute("data-done", any);
    if (any) done++;
  });
  document.getElementById("count").textContent = `${done}/${cards.length} afsnit besvaret`;
}

document.addEventListener("input", onInput);
document.addEventListener("change", onInput);
addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-key]").forEach(el => el.disabled = true);
  loadState();
});
"""


def main() -> None:
    evidence = json.loads(EVIDENCE.read_text(encoding="utf-8"))
    general = "\n".join(_general(q) for q in GENERAL_QUESTIONS)
    risks = "\n".join(_risk_row(k, label) for k, label in RISK_FACTORS)
    proposals = json.loads(PROPOSALS.read_text(encoding="utf-8"))
    species = "\n".join(_species(e, proposals) for e in evidence)
    followup = _followup2() + _followup(json.loads(VERDICT_RULES.read_text(encoding="utf-8")))

    doc = f"""<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Tangkortet – ekspertspørgsmål</title>
<style>{STYLE}</style>
</head>
<body>
<header>
  <h1>Tangkortet – spørgsmål til eksperten</h1>
  <span id="count" class="count">…</span>
  <span id="syncstate" class="syncstate" data-state="loading">Henter…</span>
</header>
<main>
<p class="intro">Tak for jeres brief! Her er de spørgsmål, vi har brug for svar på, før
  appen kan vise noget om arter, dybde, høst og risiko. Svar på så meget eller lidt, du har
  lyst til – alt gemmes automatisk, mens du skriver, så du kan lukke siden og fortsætte
  senere, også fra en anden enhed. Tallene under hver art er hentet fra GBIF (bl.a.
  herbariet på Statens Naturhistoriske Museum, arter.dk og iNaturalist) og er kun et
  udgangspunkt. Er noget uklart, så skriv det i feltet nederst på siden.</p>

{_photos()}

{followup}

<h2>Generelle spørgsmål</h2>
{general}

<h2>Risikofaktorer</h2>
<section class="card" data-group="risiko">
  <p>Hvor vigtig er hver faktor fra jeres brief for en sanker? Det afgør, hvilke kortlag vi
    bygger først, og hvor tydeligt appen viser dem.</p>
{risks}
</section>

<h2>Arter</h2>
<p class="intro">Et første bud på arter. Vælg “Nej” til arter, der ikke skal med, og tilføj
  manglende arter nederst. Dybde, høstmetode og sæson vises i appen som “foreløbig”, indtil
  du har godkendt dem.</p>
<p class="intro"><b>Nyt:</b> Under hver art står nu et forslag til advarsler om jod, arsen og
  cadmium, baseret på Susan Løvstad Holdts danske målinger (Sá Monteiro, Sloth, Holdt &amp;
  Hansen 2019) og supplerende litteratur. Sig god for forslaget, eller ret det i felterne
  under det. Forslagene vises ikke i appen, før du har set dem.</p>
{species}

<section class="card q" data-group="arter.flere">
  <h3>Arter, der mangler</h3>
  <p>Hvilke andre arter bør med? Skriv gerne dybde, høstmetode og sæson for hver.</p>
  {_text("arter.flere", "Navn (gerne videnskabeligt), dybde, høstmetode og sæson", 4)}
</section>

<h2>Kommentarer og spørgsmål til os</h2>
<section class="card q" data-group="kommentarer">
  <p>Er et spørgsmål uklart, mangler der en svarmulighed, eller har du spørgsmål til os?
    Skriv det her – vi gennemgår kommentarerne og retter siden til.</p>
  {_text("kommentarer", "Fx: Spørgsmålet om høstmetode passer ikke til rødalger, fordi …", 6)}
</section>
</main>
<script>{SCRIPT.replace("%TOKEN%", API_TOKEN)}</script>
</body>
</html>
"""
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(doc, encoding="utf-8")
    print(f"{OUT}  —  {len(GENERAL_QUESTIONS)} questions, {len(evidence)} species")


if __name__ == "__main__":
    main()
