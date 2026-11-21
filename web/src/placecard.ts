// Place cards in the Risiko tab: a well-known beach, harbour or headland near
// the pin, with an open-licence photo (Wikimedia Commons) and one or two
// sentences from its Wikipedia article (pipeline/placeinfo.py,
// data/places_info/README.md). Most places have none, and that is fine.
//
// Factual only, and kept apart from (below) the risk verdict: the pipeline
// drops any sentence that says a place is clean, safe or good for bathing, and
// nothing here may soften the risk content.

import "./placecard.css";

import { h } from "./dom";
import { formatDistance } from "./geo";
import { openPhotoViewer } from "./photoviewer";
import { photoImg } from "./thumb";
import type { PlaceCard, PlacePhoto } from "./types";

/** A card shows when its place (point or outline) is this close to the pin. */
export const PLACE_RADIUS_M = 500;

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

/** Metres from the pin to the place: 0 inside its outline, else the nearer
 * of its point and its outline. */
export function placeDistance(card: Pick<PlaceCard, "lon" | "lat" | "geom">, pin: LonLat): number {
  const k = scale(pin[1]);
  let best = Math.hypot((card.lon - pin[0]) * k[0], (card.lat - pin[1]) * k[1]);
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

/** The carded places within `radiusM` of the pin, nearest first. A place the
 * pin is inside comes before one only near it; ties go to the smaller
 * outline's kind order (a beach before the bay it lies in). */
export function nearPlaces(
  cards: readonly PlaceCard[],
  pin: LonLat,
  radiusM = PLACE_RADIUS_M,
): NearPlace[] {
  const order = Object.keys(KIND_LABEL);
  return cards
    .map((card) => ({ card, distanceM: placeDistance(card, pin) }))
    .filter((n) => n.distanceM <= radiusM)
    .sort(
      (a, b) =>
        a.distanceM - b.distanceM ||
        order.indexOf(a.card.kind) - order.indexOf(b.card.kind) ||
        a.card.name.localeCompare(b.card.name, "da"),
    );
}

function link(href: string, text: string, title?: string): HTMLAnchorElement {
  return h("a", { href, target: "_blank", rel: "noopener", title }, text);
}

/** "Foto: <author>, <licence>" with the licence linked to its deed (or the
 * file's Commons page when it has none, e.g. public domain). */
export function photoCredit(photo: PlacePhoto): (string | HTMLElement)[] {
  const href = photo.license_url ?? photo.page;
  return [
    `Foto: ${photo.author}, `,
    href ? link(href, photo.license, "Licensen (nyt vindue)") : photo.license,
    ...(photo.page
      ? [" · ", link(photo.page, "Wikimedia Commons", "Fotoets side (nyt vindue)")]
      : []),
  ];
}

/** "Tekst: Wikipedia (CC BY-SA)" linked to the article, or Wikidata. */
export function textCredit(card: PlaceCard): (string | HTMLElement)[] {
  if (!card.text) return [];
  if (card.text_source === "wikidata")
    return [
      "Tekst: ",
      link(`https://www.wikidata.org/wiki/${card.id}`, "Wikidata", "Wikidata (nyt vindue)"),
      " (CC0)",
    ];
  const url = card.article?.url;
  const name = card.article?.lang === "en" ? "Wikipedia på engelsk" : "Wikipedia";
  return [
    "Tekst: ",
    url ? link(url, `${name} (CC BY-SA)`, "Artiklen (nyt vindue)") : `${name} (CC BY-SA)`,
  ];
}

/** The photo's text alternative: what it is of, by name and kind. */
export function placeAlt(card: PlaceCard): string {
  return `Foto af ${card.name} (${kindLabel(card.kind).toLowerCase()})`;
}

/** The card for one place; `others` the other carded places near the pin,
 * each a button that shows its card instead (`onPick`). */
export function placeCardElement(
  near: NearPlace,
  others: readonly NearPlace[],
  onPick: (id: string) => void,
): HTMLElement {
  const { card } = near;
  const headingId = `place-${card.id}`;
  const section = h("section", {
    class: "card place",
    id: "place-card",
    "aria-labelledby": headingId,
    tabindex: "-1",
  });
  const photo = card.photo;
  if (photo) {
    const img = photoImg(
      { src: photo.small, srcset: `${photo.small} 320w, ${photo.large} 800w` },
      "(min-width: 900px) 400px, 100vw",
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
    const figure = h("figure", { class: "place__photo" }, open);
    img.addEventListener("load", () => figure.classList.add("is-loaded"));
    // no photo (offline, gone): the card goes on as text only
    img.addEventListener("error", () => figure.remove());
    open.addEventListener("click", () =>
      openPhotoViewer(
        card.name,
        [{ src: photo.large, alt: placeAlt(card), credit: photoCredit(photo) }],
        0,
        () => (section.querySelector<HTMLElement>(".place__open") ?? section).focus(),
      ),
    );
    section.append(figure);
  }
  const credits = [
    ...(photo ? [h("span", {}, ...photoCredit(photo))] : []),
    ...(card.text ? [h("span", {}, ...textCredit(card))] : []),
  ];
  section.append(
    h(
      "div",
      { class: "place__body" },
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
      h("h3", { id: headingId, class: "place__name" }, card.name),
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
      card.article?.url
        ? h(
            "p",
            { class: "place__more" },
            link(card.article.url, "Mere på Wikipedia", "Artiklen på Wikipedia (nyt vindue)"),
          )
        : null,
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
    ),
  );
  return section;
}
