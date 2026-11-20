// "Råd og regler" tab: the expert's checklist and advice, verbatim from the brief
// (§2, §4, §5; the brief itself is kept private). Marked "foreløbig" until the expert has
// reviewed it as app text. Items the app helps with point to the Risiko tab.

import { h, extLink } from "./dom";

interface CheckItem {
  text: string;
  /** Where in the app this is (partly) covered, if anywhere. */
  app?: string;
}

const CHECKLIST: CheckItem[] = [
  {
    text: "Tjek registreret og historisk forurening nær kysten.",
    app: "Risiko: jordforurening, industri",
  },
  {
    text: "Kortlæg udløb, vandløb, dræn og landbrugsoplande.",
    app: "Risiko: udløb og vandløb inden for 200 m (dræn og landbrugsoplande mangler endnu)",
  },
  {
    text: "Undersøg renseanlæg, kloakoverløb og regnvandsudløb.",
    app: "Risiko: overløb, renseanlæg, regnvand",
  },
  { text: "Kontrollér nedbør de seneste 24, 48 og 72 timer.", app: "Risiko: nedbør" },
  {
    text: "Se badevandsadvarsler og meldinger om algeopblomstring.",
    app: "Risiko: badevand (link til varsler)",
  },
  { text: "Vurdér strøm, vind og vandudskiftning i området." },
  {
    text: "Identificér tangarten, kontrollér dens friskhed og indsamlingsregler.",
    app: "Arter; Risiko: naturbeskyttelse",
  },
];

const OVERLOOKED: [string, string][] = [
  [
    "Kloakoverløb",
    "Kraftig regn kan medføre udledning af opspædet, urenset spildevand. Undersøg derfor andet end landbrugsafstrømning.",
  ],
  [
    "Historiske kilder",
    "En kyst kan være påvirket af forurening fra tidligere aktiviteter, selv uden synlig industri i dag.",
  ],
  [
    "Strøm og vandudskiftning",
    "Vind, havstrømme og lokale forhold afgør, hvor udledninger føres hen. Afstand alene er ikke nok til at bedømme risiko.",
  ],
  [
    "Biologisk ophobning",
    "Tang kan akkumulere stoffer fra havmiljøet. Rent udseende vand eller god badevandskvalitet garanterer ikke egnet tang.",
  ],
];

export function renderGuide(root: HTMLElement): void {
  root.replaceChildren(
    h("p", { class: "badge badge--provisional" }, "Fra ekspertbriefet · foreløbig"),
    h("h2", {}, "Tjekliste før en sanketur"),
    h(
      "ul",
      { class: "checklist" },
      ...CHECKLIST.map((item) =>
        h(
          "li",
          {},
          h("label", {}, h("input", { type: "checkbox" }), h("span", {}, item.text)),
          item.app ? h("span", { class: "note" }, `I appen: ${item.app}`) : null,
        ),
      ),
    ),
    h("h2", {}, "Under selve sankningen"),
    h(
      "p",
      {},
      "Foretræk frisk, fastsiddende tang frem for opskyllet eller nedbrudt materiale. Undgå områder ved synlige udløb, havne, oliehinder, misfarvninger eller mistænkelig lugt. Notér dato, præcis lokalitet, art, vejr og eventuelle observationer.",
    ),
    h("h2", {}, "Fødevarestyrelsens råd"),
    h(
      "ul",
      { class: "plain" },
      h("li", {}, "Pluk kun frisk tang – pluk den i vandet, og saml den ikke op på stranden."),
      h("li", {}, "Vandet skal være klart og rent: undgå havne, byer, åer og spildevandsudløb."),
      h("li", {}, "Pluk kun tang, når du kender arten."),
      h(
        "li",
        {},
        "Skyl tangen i havvand, når du plukker den, og vask den i drikkevand lige før brug.",
      ),
    ),
    h(
      "p",
      { class: "note" },
      extLink(
        "https://www.foedevarestyrelsen.dk/kost-og-foedevarer/alt-om-mad/god-koekkenhygiejne/saadan-goer-du/tang",
        "Råd til dig, som plukker tang (Fødevarestyrelsen)",
      ),
    ),
    h("h2", {}, "Regler"),
    h(
      "ul",
      { class: "plain" },
      h(
        "li",
        {},
        "Natura 2000-områder og fredninger kan have regler for indsamling – Risiko-fanen viser, om nålen ligger i et. Undersøg reglerne for det konkrete område.",
      ),
      h(
        "li",
        {},
        "Vil du sælge den tang, du samler, skal du registreres hos Fødevarestyrelsen. ",
        extLink(
          "https://www.foedevarestyrelsen.dk/kost-og-foedevarer/start-og-drift-af-foedevarevirksomhed/specifikke-foedevarer-hygiejneregler/tang-og-mikroalger",
          "Læs mere",
        ),
      ),
    ),
    h("h2", {}, "Opskyllet tang"),
    h(
      "p",
      {},
      "Opskyllet tang kan sankes, men kun efter en grundig sensorisk vurdering af biomassen, sammenholdt med vindforholdene: den er sandsynligvis skyllet op ved sidste kraftige blæst, og det afgør, hvor frisk den er. Den kan også komme fra steder længere væk, så det er på eget ansvar at bruge den til konsum.",
    ),
    h("p", { class: "note" }, "Fra ekspertens svar, oktober 2026. Se vinden i Risiko-fanen."),
    h("h2", {}, "Fire forhold der ofte overses"),
    h(
      "dl",
      { class: "overlooked" },
      ...OVERLOOKED.flatMap(([term, text]) => [h("dt", {}, term), h("dd", {}, text)]),
    ),
  );
}
