// Place cards in the Risiko tab: a well-known beach, harbour or headland near
// the pin, with an open-licence photo (Wikimedia Commons) and one or two
// sentences from its Wikipedia article (pipeline/placeinfo.py,
// data/places_info/README.md). Most places have none, and that is fine.
//
// Background only, never a recommendation: the card comes last in the tab,
// after every risk card, under a modest "Om stedet" heading, and the pipeline
// drops any sentence that says a place is clean, safe, good for bathing,
// beautiful or popular. Nothing here may soften or compete with the verdict.

import "./placecard.css";

import { h } from "./dom";
import { formatDistance } from "./geo";
import { openPhotoViewer } from "./photoviewer";
import { photoImg } from "./thumb";
import type { PlaceCard, PlacePhoto } from "./types";

/** A card shows when its place (point or outline) is this close to the pin. */
export const PLACE_RADIUS_M = 500;
/** A peninsula's or islet's card shows only this close to its shore (the
 * coastline along its outline), never for a pin inland on it. So does a big
 * bay's (the coastline round its point), and on the water near its point. */
export const SHORE_RADIUS_M = 300;
/** Places this much further off than the nearest still count as as near:
 * then a shore or land card the pin's header names, else one that is not a
 * bay, comes first (Tuse Næs before Lammefjorden on Tuse Næs's shore). */
export const TIE_M = 100;

export const KIND_LABEL: Record<string, string> = {
  marina: "Lystbådehavn",
  fishing_harbour: "Fiskerihavn",
  ferry_harbour: "Færgehavn",
  harbour: "Havn",
  beach: "Strand",
  spit: "Odde",
  headland: "Pynt",
  cliff: "Klint",
  islet: "Holm",
  peninsula: "Halvø",
  bay: "Bugt",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? "Sted";
}

type LonLat = [number, number];

/** Metres per degree of longitude / latitude near `lat` (local, flat). */
function scale(lat: number): [number, number] {
  return [111_320 * Math.cos((lat * Math.PI) / 180), 110_574];
}

function segmentM(p: LonLat, a: LonLat, b: LonLat, [kx, ky]: [number, number]): number {
  const px = p[0] * kx;
  const py = p[1] * ky;
  const ax = a[0] * kx;
  const ay = a[1] * ky;
  const dx = b[0] * kx - ax;
  const dy = b[1] * ky - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function inRing(ring: readonly LonLat[], [x, y]: LonLat): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function shoreM(shore: readonly (readonly LonLat[])[], pin: LonLat, k: [number, number]): number {
  let best = Infinity;
  for (const line of shore)
    for (let i = 1; i < line.length; i++)
      best = Math.min(best, segmentM(pin, line[i - 1], line[i], k));
  return best;
}

/** Metres from the pin to the place. A peninsula or islet with a shore: the
 * distance to that shore (inside it counts for nothing); a bay with a shore:
 * the nearer of that shore and its point. Else 0 inside its outline, or the
 * nearer of its point and its outline. */
export function placeDistance(
  card: Pick<PlaceCard, "kind" | "lon" | "lat" | "geom" | "shore">,
  pin: LonLat,
): number {
  const k = scale(pin[1]);
  const point = Math.hypot((card.lon - pin[0]) * k[0], (card.lat - pin[1]) * k[1]);
  if (card.shore?.length) {
    const shore = shoreM(card.shore, pin, k);
    return card.kind === "bay" ? Math.min(shore, point) : shore;
  }
  let best = point;
  const g = card.geom;
  if (g && g.coords.length > 1) {
    if (g.type === "ring" && inRing(g.coords, pin)) return 0;
    for (let i = 1; i < g.coords.length; i++)
      best = Math.min(best, segmentM(pin, g.coords[i - 1], g.coords[i], k));
  }
  return best;
}

export interface NearPlace {
  card: PlaceCard;
  distanceM: number;
}

/** Whether the pin is near enough for the card: within `radiusM` of the
 * place; with a shore, within SHORE_RADIUS_M of it (or, for a bay, within
 * `radiusM` of its point out on the water). */
function inReach(card: PlaceCard, pin: LonLat, distanceM: number, radiusM: number): boolean {
  if (!card.shore?.length) return distanceM <= radiusM;
  const k = scale(pin[1]);
  if (shoreM(card.shore, pin, k) <= Math.min(radiusM, SHORE_RADIUS_M)) return true;
  if (card.kind !== "bay") return false;
  return Math.hypot((card.lon - pin[0]) * k[0], (card.lat - pin[1]) * k[1]) <= radiusM;
}

const fold = (s: string): string => s.toLocaleLowerCase("da");

/** Whether the pin's header ("Ved Tuse Næs", "På Helgenæs") names the place. */
export function headerNames(header: string | null | undefined, name: string): boolean {
  return !!header && fold(header).includes(fold(name));
}

/** The carded places within `radiusM` of the pin (a shore within
 * SHORE_RADIUS_M), nearest first. A place the pin is inside comes before one
 * only near it; ties go to the smaller outline's kind order (a beach before
 * the bay it lies in). Among those within TIE_M of the nearest, the card
 * the pin's `header` names leads, else the nearest one that is not a bay:
 * on Tuse Næs's shore, Tuse Næs and not Lammefjorden. */
export function nearPlaces(
  cards: readonly PlaceCard[],
  pin: LonLat,
  radiusM = PLACE_RADIUS_M,
  header?: string | null,
): NearPlace[] {
  const order = Object.keys(KIND_LABEL);
  const near = cards
    .map((card) => ({ card, distanceM: placeDistance(card, pin) }))
    .filter((n) => inReach(n.card, pin, n.distanceM, radiusM))
    .sort(
      (a, b) =>
        a.distanceM - b.distanceM ||
        order.indexOf(a.card.kind) - order.indexOf(b.card.kind) ||
        a.card.name.localeCompare(b.card.name, "da"),
    );
  if (near.length < 2) return near;
  const close = near.filter((n) => n.distanceM <= near[0].distanceM + TIE_M);
  const rank = (n: NearPlace): number =>
    headerNames(header, n.card.name) ? 0 : n.card.kind === "bay" ? 2 : 1;
  const lead = close.reduce((best, n) => (rank(n) < rank(best) ? n : best));
  return lead === near[0] ? near : [lead, ...near.filter((n) => n !== lead)];
}

function link(href: string, text: string, title?: string, cls?: string): HTMLAnchorElement {
  return h("a", { href, target: "_blank", rel: "noopener", title, class: cls ?? null }, text);
}

export const CC_BY_SA_4 = "https://creativecommons.org/licenses/by-sa/4.0/";
export const ODBL = "https://opendatacommons.org/licenses/odbl/1-0/";

/** "Foto: <author>, <licence> · Wikimedia Commons", the licence linked to its
 * deed (or the file's Commons page when it has none, e.g. public domain). */
export function photoCredit(photo: PlacePhoto): (string | HTMLElement)[] {
  const href = photo.license_url ?? photo.page;
  return [
    `Foto: ${photo.author}, `,
    href
      ? link(
          href,
          photo.license,
          "Licensen (nyt vindue)",
          photo.license.length <= 6 ? "place__short" : undefined,
        )
      : photo.license,
    ...(photo.page
      ? [" · ", link(photo.page, "Wikimedia Commons", "Fotoets side (nyt vindue)")]
      : []),
  ];
}

/** "Tekst: uddrag fra Wikipedia (forkortet), CC BY-SA 4.0", the article and
 * the licence linked once each; "Tekst: Wikidata (CC0)" for a description
 * from Wikidata. */
export function textCredit(card: PlaceCard): (string | HTMLElement)[] {
  if (!card.text) return [];
  if (card.text_source === "wikidata")
    return [
      "Tekst: ",
      link(`https://www.wikidata.org/wiki/${card.id}`, "Wikidata", "Wikidata (nyt vindue)"),
      " (CC0)",
    ];
  const url = card.article?.url;
  const name = card.article?.lang === "en" ? "engelsk Wikipedia" : "Wikipedia";
  return [
    "Tekst: uddrag fra ",
    url ? link(url, name, "Artiklen (nyt vindue)") : name,
    " (forkortet), ",
    link(CC_BY_SA_4, "CC BY-SA 4.0", "Licensen (nyt vindue)"),
  ];
}

/** What OpenStreetMap gave the card: "Afgrænsning" (its outline or shore),
 * "Kortdata" (only the match), or null (nothing). */
export function osmCreditLabel(card: Pick<PlaceCard, "geom" | "shore" | "osm">): string | null {
  if (card.geom || card.shore?.length) return "Afgrænsning";
  return card.osm ? "Kortdata" : null;
}

/** "Afgrænsning: © OpenStreetMap-bidragydere (ODbL)" when the card's outline
 * or shore comes from OpenStreetMap; "Kortdata: …" when only the match does
 * (`osm`, a point); [] for a card OpenStreetMap had no part in. */
export function outlineCredit(
  card: Pick<PlaceCard, "geom" | "shore" | "osm">,
): (string | HTMLElement)[] {
  const label = osmCreditLabel(card);
  if (!label) return [];
  return [
    `${label}: © OpenStreetMap-bidragydere (`,
    link(ODBL, "ODbL", "Licensen (nyt vindue)", "place__short"),
    ")",
  ];
}

/** The photo's text alternative: what it is of, by name and kind. */
export function placeAlt(card: PlaceCard): string {
  return `Foto af ${card.name} (${kindLabel(card.kind).toLowerCase()})`;
}

/** The card for one place; `others` the other carded places near the pin,
 * each a button that shows its card instead (`onPick`). The photo is a small
 * thumbnail of a fixed size beside the name, so nothing moves while it loads
 * and the card's top keeps its height when "+N" switches place. */
export function placeCardElement(
  near: NearPlace,
  others: readonly NearPlace[],
  onPick: (id: string) => void,
): HTMLElement {
  const { card } = near;
  const nameId = `place-${card.id}`;
  const section = h("section", {
    class: "card place",
    id: "place-card",
    "aria-labelledby": `place-heading ${nameId}`,
    tabindex: "-1",
  });
  const photo = card.photo;
  const photoCreditEl = photo
    ? h("span", { class: "place__photo-credit" }, ...photoCredit(photo))
    : null;
  let figure: HTMLElement | null = null;
  if (photo) {
    const img = photoImg(
      { src: photo.small, srcset: `${photo.small} 330w, ${photo.large} 960w` },
      "120px",
    );
    img.alt = placeAlt(card);
    img.className = "place__img";
    const open = h(
      "button",
      {
        type: "button",
        class: "place__open",
        "aria-label": `Vis fotoet af ${card.name} i fuld skærm`,
      },
      img,
    );
    const fig = h("figure", { class: "place__photo" }, open);
    img.addEventListener("load", () => fig.classList.add("is-loaded"));
    // no photo (offline, gone): the card goes on as text only, and the
    // photo's credit goes with the photo
    img.addEventListener("error", () => {
      fig.remove();
      photoCreditEl?.remove();
      section.classList.add("place--text-only");
    });
    open.addEventListener("click", () =>
      openPhotoViewer(
        card.name,
        [{ src: photo.large, alt: placeAlt(card), credit: photoCredit(photo) }],
        0,
        () => (section.querySelector<HTMLElement>(".place__open") ?? section).focus(),
      ),
    );
    figure = fig;
  } else section.classList.add("place--text-only");
  const outline = outlineCredit(card);
  const credits = [
    ...(photoCreditEl ? [photoCreditEl] : []),
    ...(card.text ? [h("span", {}, ...textCredit(card))] : []),
    ...(outline.length ? [h("span", {}, ...outline)] : []),
  ];
  const parts: (HTMLElement | null)[] = [
    h("h3", { id: "place-heading", class: "place__heading" }, "Om stedet"),
    h(
      "div",
      { class: "place__head" },
      figure,
      h(
        "div",
        { class: "place__title" },
        h("h4", { id: nameId, class: "place__name" }, card.name),
        h(
          "p",
          { class: "place__kind" },
          kindLabel(card.kind),
          h(
            "span",
            { class: "place__dist" },
            ` · ${near.distanceM ? formatDistance(near.distanceM) : "ved nålen"}`,
          ),
        ),
      ),
    ),
    card.text
      ? h(
          "p",
          {
            class: "place__text",
            lang: card.article?.lang === "en" && card.text_source !== "wikidata" ? "en" : null,
          },
          card.text,
        )
      : null,
    credits.length ? h("p", { class: "place__credit" }, ...credits) : null,
    others.length
      ? h(
          "p",
          { class: "place__others" },
          others.length === 1 ? "+1 sted mere: " : `+${others.length} steder mere: `,
          ...others.flatMap((o, i) => [
            i ? ", " : "",
            h(
              "button",
              { type: "button", class: "linkish", onclick: () => onPick(o.card.id) },
              o.card.name,
            ),
          ]),
        )
      : null,
  ];
  section.append(...parts.filter((el): el is HTMLElement => el !== null));
  return section;
}
