// The pin's card in the sheet header (phone) or the sidebar (desktop): where
// the pin is (the nearest named place), the Risiko tab's traffic light at a
// glance, and how many species were found near it, with "Se risiko" and
// "Se arter" to open those tabs. It replaces the old one-line readout
// ("Nål: 56.15100, 10.21900") and keeps its job of showing a risk item the
// user focused in the list.
//
// The place comes from the search's place list (placeindex.ts), fetched the
// first time a pin is set; coordinates stand in while it loads and when it
// cannot be had (offline). The traffic light comes from the Risiko tab
// (riskpanel.ts onVerdict), which computes it whether or not that tab shows.
//
// Screen readers hear a new pin's place once, the traffic light once it has
// settled (and again only if it changes level), not every redraw.

import { summaryLine } from "./coast";
import { formatDistance } from "./geo";
import { loadPlaceIndex, loadedPlaceIndex, nearestPlace, type NearestPlace } from "./placeindex";
import { findsNear, NEAR_PIN_M } from "./species";
import type { SpeciesDoc } from "./types";
import type { CoastState } from "./riskpanel";
import { LEVEL_TEXT, type Level } from "./verdict";

export type VerdictState = Level | "pending";

export interface FindsSummary {
  /** Species with at least one find within NEAR_PIN_M. */
  species: number;
  /** The same species by their best evidence, so the three add up: found
   * attached; else only washed up; else only finds of unknown kind. */
  attached: number;
  drift: number;
  unknown: number;
}

/** How the pin was set: a search result and "my location" bring a name of
 * their own; a tap and a shared link only have coordinates. */
export type PinSource =
  { kind: "tap" } | { kind: "link" } | { kind: "search"; label: string } | { kind: "locate" };

export interface TapCardHooks {
  onShowRisk(): void;
  onShowSpecies(): void;
}

export const EMPTY_TEXT = "Tryk på kortet ved kysten for at sætte en nål.";

const comma = (v: string): string => v.replace(".", ",");

/** "56,1510° N, 10,2190° Ø" */
export function coordsText([lon, lat]: [number, number]): string {
  return `${comma(lat.toFixed(4))}° N, ${comma(lon.toFixed(4))}° Ø`;
}

/** Within this the pin is "ved" a place; further off it is "x km fra". */
export const AT_PLACE_M = 500;

/** "Ved Aarhus", "1,2 km fra Ebeltoft", "Ved Sydstranden, Kerteminde";
 * null without a place. */
export function placeText(place: NearestPlace | null): string | null {
  if (!place) return null;
  const name = place.town ? `${place.name}, ${place.town}` : place.name;
  if (place.distanceM < AT_PLACE_M) return `Ved ${name}`;
  return `${formatDistance(place.distanceM)} fra ${name}`;
}

/** The traffic light in a few words. Green always says it is no guarantee. */
export function verdictText(state: VerdictState): string {
  if (state === "pending") return "Vurderer risiko…";
  if (state === "green") return `${LEVEL_TEXT.green.title} · ingen garanti`;
  return LEVEL_TEXT[state].title;
}

export function summarizeFinds(docs: readonly SpeciesDoc[], pin: [number, number]): FindsSummary {
  const summary: FindsSummary = { species: 0, attached: 0, drift: 0, unknown: 0 };
  for (const doc of docs) {
    const near = findsNear(doc, pin);
    if (near.total === 0) continue;
    summary.species++;
    if (near.attached) summary.attached++;
    else if (near.drift) summary.drift++;
    else summary.unknown++;
  }
  return summary;
}

const KM = `${NEAR_PIN_M / 1000} km`;

/** The count alone ("11 arter", "Ingen fund"): the phone shows just this, on
 * one line; the words after it (findsNearText) are read out there and shown
 * in the sidebar. Loading and error say it all themselves. */
export function findsText(finds: FindsSummary | "loading" | "error"): string {
  if (finds === "loading") return "Finder arter…";
  if (finds === "error") return "Arterne kunne ikke hentes";
  if (finds.species === 0) return "Ingen fund";
  return `${finds.species} ${finds.species === 1 ? "art" : "arter"}`;
}

/** What follows the count: " i nærheden" (empty while loading / on error). */
export function findsNearText(finds: FindsSummary | "loading" | "error"): string {
  return typeof finds === "object" ? " i nærheden" : "";
}

/** How near, and the species by their best evidence (adding up to the count,
 * a zero part left out); the sidebar shows it under the count, the phone
 * reads it out. */
export function splitText(finds: FindsSummary): string {
  // the species list then suggests the nearest beaches with finds (elsewhere.ts)
  if (finds.species === 0) return `Ingen inden for ${KM} – se steder med fund under Arter`;
  const where = `Inden for ${KM}`;
  const parts = [
    finds.attached ? `${finds.attached} fastsiddende` : "",
    finds.drift ? `${finds.drift} kun opskyllet` : "",
    finds.unknown ? `${finds.unknown} ukendt` : "",
  ].filter(Boolean);
  return parts.length ? `${where}: ${parts.join(", ")}` : where;
}

/** The coast in one line (the sidebar shows it under the buttons; on a
 * phone the sheet's peek has no room, and the Risiko tab has it in full).
 * null: nothing to say (no coast data for the area). */
export function coastText(coast: CoastState): string | null {
  if (coast === null) return null;
  if (coast === "loading") return "Kysten: henter…";
  if (coast === "error") return "Kysten: kunne ikke hentes";
  const line = summaryLine(coast);
  return coast.water || coast.nearby.length ? `Kysten: ${line}` : line;
}

const same = (a: [number, number] | null, b: [number, number]): boolean =>
  a !== null && a[0] === b[0] && a[1] === b[1];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class TapCard {
  private pin: [number, number] | null = null;
  private source: PinSource = { kind: "tap" };
  private place: NearestPlace | null = null;
  private verdict: VerdictState = "pending";
  private finds: FindsSummary | "loading" | "error" = "loading";
  private coast: CoastState = "loading";
  private focusText: string | null = null;
  /** The level last announced for this pin, so a redraw is not repeated. */
  private announcedLevel: Level | null = null;
  private placeAnnounced = false;
  private queued: string[] = [];
  private announceTimer: number | undefined;

  private readonly where: HTMLParagraphElement;
  private readonly placeEl: HTMLSpanElement;
  private readonly coordsEl: HTMLSpanElement;
  private readonly actions: HTMLDivElement;
  private readonly riskButton: HTMLButtonElement;
  private readonly riskLabel: HTMLSpanElement;
  private readonly findsButton: HTMLButtonElement;
  private readonly findsLabel: HTMLSpanElement;
  private readonly findsNear: HTMLSpanElement;
  private readonly findsSplit: HTMLSpanElement;
  private readonly coastEl: HTMLParagraphElement;
  private readonly live: HTMLParagraphElement;

  constructor(
    private readonly root: HTMLElement,
    hooks: TapCardHooks,
  ) {
    root.classList.add("tapcard");
    // The card is not a live region itself (it redraws as answers arrive);
    // the status line below speaks for it.
    root.removeAttribute("aria-live");

    this.where = el("p", "tapcard__where");
    // a focus target after a search pick (placesearch.ts)
    this.where.tabIndex = -1;
    this.placeEl = el("span", "tapcard__place");
    this.coordsEl = el("span", "tapcard__coords");
    this.where.append(this.placeEl, this.coordsEl);

    this.riskButton = el("button", "tapcard__chip tapcard__risk");
    this.riskButton.type = "button";
    this.riskLabel = el("span", "tapcard__label");
    this.riskButton.append(
      el("span", "tapcard__light"),
      this.riskLabel,
      el("span", "sr-only", " – se risiko"),
      el("span", "tapcard__go"),
    );
    this.riskButton.addEventListener("click", () => hooks.onShowRisk());

    this.findsButton = el("button", "tapcard__chip tapcard__finds");
    this.findsButton.type = "button";
    this.findsLabel = el("span", "tapcard__count");
    this.findsNear = el("span", "tapcard__near");
    this.findsSplit = el("span", "tapcard__split");
    const count = el("span", "tapcard__label");
    count.append(this.findsLabel, this.findsNear);
    const findsText = el("span", "tapcard__text");
    findsText.append(count, this.findsSplit);
    this.findsButton.append(
      findsText,
      el("span", "sr-only", " – se arter"),
      el("span", "tapcard__go"),
    );
    this.findsButton.addEventListener("click", () => hooks.onShowSpecies());

    this.actions = el("div", "tapcard__actions");
    this.actions.append(this.riskButton, this.findsButton);

    this.coastEl = el("p", "tapcard__coast");

    this.live = el("p", "sr-only");
    this.live.setAttribute("role", "status");

    root.replaceChildren(this.where, this.actions, this.coastEl, this.live);
    this.render();
  }

  /** A new pin: the card starts over and looks up the place. */
  setPin(pin: [number, number], source: PinSource): void {
    this.pin = pin;
    this.source = source;
    this.place = null;
    this.verdict = "pending";
    this.finds = "loading";
    this.coast = "loading";
    this.focusText = null;
    this.announcedLevel = null;
    this.placeAnnounced = false;
    // nothing said about the last pin may be read out after this one
    window.clearTimeout(this.announceTimer);
    this.queued = [];
    this.render();
    if (source.kind === "search") {
      this.announcePlace();
      return;
    }
    const index = loadedPlaceIndex();
    if (index) {
      this.place = nearestPlace(index, pin);
      this.render();
      this.announcePlace();
      return;
    }
    loadPlaceIndex().then(
      (loaded) => {
        if (!same(this.pin, pin)) return;
        this.place = nearestPlace(loaded, pin);
        this.render();
        this.announcePlace();
      },
      // offline or slow: the coordinates stay; the next pin tries again
      () => {
        if (same(this.pin, pin)) this.announcePlace();
      },
    );
  }

  setVerdict(pin: [number, number], state: VerdictState): void {
    if (!same(this.pin, pin)) return;
    if (state !== this.verdict) {
      this.verdict = state;
      this.render();
    }
    if (state !== "pending" && state !== this.announcedLevel) {
      this.announcedLevel = state;
      this.announce(`Risiko ved nålen: ${verdictText(state)}.`);
    }
  }

  setFinds(pin: [number, number], finds: FindsSummary | "error"): void {
    if (!same(this.pin, pin)) return;
    this.finds = finds;
    this.render();
  }

  setCoast(pin: [number, number], coast: CoastState): void {
    if (!same(this.pin, pin)) return;
    this.coast = coast;
    this.render();
  }

  /** A risk item chosen in the list: said in place of the place until the
   * next pin. */
  setFocus(text: string): void {
    this.focusText = text;
    this.render();
    this.announce(text);
  }

  /** The pin's place as the card shows it ("Ved Aarhus", a search label,
   * coordinates); null without a pin. */
  placeLabel(): string | null {
    return this.pin ? this.placeLine() : null;
  }

  private placeLine(): string {
    if (this.source.kind === "search") return this.source.label;
    const near = placeText(this.place);
    if (this.source.kind === "locate") return near ? `Min placering · ${near}` : "Min placering";
    return near ?? (this.pin ? coordsText(this.pin) : "");
  }

  private announcePlace(): void {
    if (this.placeAnnounced || !this.pin) return;
    this.placeAnnounced = true;
    const line = this.placeLine();
    this.announce(
      `Nål sat: ${line === coordsText(this.pin) ? line : `${line}, ${coordsText(this.pin)}`}.`,
    );
  }

  /** Messages arriving together are read together, once. */
  private announce(text: string): void {
    this.queued.push(text);
    window.clearTimeout(this.announceTimer);
    this.announceTimer = window.setTimeout(() => {
      this.live.textContent = this.queued.join(" ");
      this.queued = [];
    }, 350);
  }

  private render(): void {
    const pin = this.pin;
    this.root.dataset.state = pin ? "pin" : "empty";
    this.actions.hidden = !pin;
    const coast = pin ? coastText(this.coast) : null;
    this.coastEl.hidden = coast === null;
    this.coastEl.textContent = coast ?? "";
    this.coastEl.dataset.state = typeof this.coast === "string" ? this.coast : "done";
    if (!pin) {
      this.placeEl.textContent = EMPTY_TEXT;
      this.coordsEl.textContent = "";
      return;
    }
    const line = this.focusText ?? this.placeLine();
    this.where.dataset.focus = String(this.focusText !== null);
    this.placeEl.textContent = line;
    const coords = coordsText(pin);
    // the coordinates beside a name (the sidebar has room for them)
    this.coordsEl.textContent = line === coords || this.focusText ? "" : coords;
    this.where.title = coords;

    this.riskButton.dataset.level = this.verdict;
    this.riskLabel.textContent = verdictText(this.verdict);
    this.riskButton.setAttribute("aria-busy", String(this.verdict === "pending"));

    this.findsLabel.textContent = findsText(this.finds);
    this.findsNear.textContent = findsNearText(this.finds);
    this.findsSplit.textContent = typeof this.finds === "object" ? splitText(this.finds) : "";
    this.findsButton.dataset.state = typeof this.finds === "object" ? "done" : this.finds;
  }
}
