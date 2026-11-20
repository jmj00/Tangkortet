// The start screen's pure logic (start.ts draws it): whether it shows, the
// order of its ways in (the expert's priorities: contamination risk first),
// what each way in asks for and where it lands, and the species picker's
// order. No DOM in here. The shape follows Svampekortet (624fb8b,
// web/src/startstate.ts); the decisions are Tangkortet's.

import type { HashState, Tab } from "./hash";
import type { StartSnap } from "./nav";
import { GROUP_PLURAL, GROUPS } from "./species";
import { shownName, type SpeciesSummary } from "./types";

// --- show it or not -------------------------------------------------------

/** `?kort` in the address skips the start screen for that visit (links
 * straight to the map, automated checks from a fresh profile). The same test
 * is inlined in index.html so the first paint is already right; keep the two
 * in step. */
export function hasSkipParam(search: string): boolean {
  return /[?&]kort(?:[=&]|$)/.test(search);
}

/** The start screen is the home: it shows on every visit, first or not,
 * unless the address says where to go. A shared link with a pin or a species
 * goes straight there; a tab alone (`#tab=arter`, which the app writes on
 * every visit) does not count. Mirrored in index.html's inline script. */
export function shouldShowStart(hash: Pick<HashState, "pin" | "species">, search: string): boolean {
  return !hasSkipParam(search) && hash.pin === null && hash.species === null;
}

// --- the ways in ------------------------------------------------------------

/** The four ways in, in the order the home view lists them. */
export type Entry = "risk" | "species" | "beach" | "map";

/** Risk first (the expert's first priority), then species, then a beach,
 * then the plain map. */
export const ENTRY_ORDER: readonly Entry[] = ["risk", "species", "beach", "map"];

/** The two ways in that start by asking for a place. */
export type PlaceFlow = "risk" | "beach";

export type StartView = "home" | "place" | "species";

/** What a way in opens first. */
export function entryStep(
  entry: Entry,
): { view: "place"; flow: PlaceFlow } | { view: "species" } | null {
  switch (entry) {
    case "risk":
    case "beach":
      return { view: "place", flow: entry };
    case "species":
      return { view: "species" };
    case "map":
      return null; // straight to the map
  }
}

/** Ways to answer "where?" in the place step. */
export type PlaceOption = "keep" | "locate" | "search" | "map";

/**
 * The place step's options in order. "Kan jeg sanke her?" is most often asked
 * standing on the beach, so the position comes first; "Find en strand" is a
 * search. With a pin already set, keeping it is offered before anything else.
 * The map is always there (a tap on it answers too).
 */
export function placeOptions(flow: PlaceFlow, hasPin: boolean): PlaceOption[] {
  const ways: PlaceOption[] =
    flow === "risk" ? ["locate", "search", "map"] : ["search", "locate", "map"];
  return hasPin ? ["keep", ...ways] : ways;
}

/** Where focus goes when the place step opens: the heading (read first, then
 * Tab on), or the search field for "Find en strand", which is a search. */
export function placeFocus(flow: PlaceFlow): "title" | "search" {
  return flow === "beach" ? "search" : "title";
}

/** A place chosen in the start screen. */
export interface Place {
  lngLat: [number, number];
  label: string;
  /** How close to fly for a searched place. */
  zoom: number;
}

/** Going into the main interface. `place` absent: the pin as it is. */
export type Landing =
  | { kind: "map" }
  | { kind: "guide" }
  | { kind: "risk"; place?: Place }
  | { kind: "beach"; place?: Place }
  | { kind: "species"; slug: string };

export interface LandingTarget {
  /** The tab to show; null keeps the current one. */
  tab: Tab | null;
  /** How the camera moves: frame the risk ring round the pin, fly to the
   * place, or leave it (a species frames its own finds). */
  camera: "ring" | "place" | "none";
  /** What gets keyboard focus afterwards. */
  focus: "tabpanel" | "tab" | "species";
}

/** Where each way in lands (main.ts does the landing). */
export function landingTarget(landing: Landing): LandingTarget {
  switch (landing.kind) {
    case "risk":
      return { tab: "risiko", camera: "ring", focus: "tabpanel" };
    case "beach":
      return { tab: "arter", camera: "place", focus: "tabpanel" };
    case "species":
      return { tab: "arter", camera: "none", focus: "species" };
    case "guide":
      return { tab: "guide", camera: "none", focus: "tabpanel" };
    case "map":
      return { tab: null, camera: "none", focus: "tab" };
  }
}

/** A tap on the map while the start screen is open: from the home view it is
 * "Kan jeg sanke her?" for that spot (risk first); in a place step it answers
 * that step; the species step asks for a species, not a place. */
export function mapTapLanding(view: StartView, flow: PlaceFlow | null): PlaceFlow | null {
  if (view === "home") return "risk";
  if (view === "place") return flow ?? "risk";
  return null;
}

/** What Escape (and the step's "Forside" button) does: a step goes back to
 * the home view, the home view to the map. */
export function escapeFrom(view: StartView): "home" | "map" {
  return view === "home" ? "map" : "home";
}

// --- the browser history (nav.ts) --------------------------------------------

export function toStartSnap(view: StartView | null, flow: PlaceFlow | null): StartSnap {
  if (view === null) return null;
  if (view === "place") return flow === "beach" ? "place-beach" : "place-risk";
  return view;
}

export function fromStartSnap(snap: Exclude<StartSnap, null>): {
  view: StartView;
  flow: PlaceFlow | null;
} {
  if (snap === "place-risk") return { view: "place", flow: "risk" };
  if (snap === "place-beach") return { view: "place", flow: "beach" };
  return { view: snap, flow: null };
}

// --- "my location" ----------------------------------------------------------

export type LocateResult = "ok" | "denied" | "unavailable";

/** What the place step says when the position does not come. Each points at
 * the other ways to answer. */
export function locateMessage(
  result: Exclude<LocateResult, "ok"> | "slow",
  verb: "tryk" | "klik",
): string {
  const others = `Søg en by eller en strand i stedet, eller ${verb} på kortet.`;
  switch (result) {
    case "denied":
      return `Placering er slået fra for siden. ${others}`;
    case "unavailable":
      return `Vi kunne ikke finde din placering. ${others}`;
    case "slow":
      return `Det tager længere end ventet. Du kan også søge en by eller en strand, eller ${verb} på kortet.`;
  }
}

// --- the species picker ------------------------------------------------------

export interface PickerGroup<T> {
  group: string;
  label: string;
  species: T[];
}

/**
 * The species by group (brown, red, green algae, as the species list has
 * them; anything else last), alphabetical by the name shown within each.
 * Empty groups are left out.
 */
export function pickerGroups<
  T extends Pick<SpeciesSummary, "group" | "danish_name" | "scientific_name">,
>(species: readonly T[]): PickerGroup<T>[] {
  const known: readonly string[] = GROUPS;
  const order = [
    ...GROUPS,
    ...new Set(species.map((s) => s.group).filter((g) => !known.includes(g))),
  ];
  const byName = (a: T, b: T): number => shownName(a).localeCompare(shownName(b), "da");
  return order
    .map((group) => ({
      group,
      label: GROUP_PLURAL[group] ?? "Andre",
      species: species.filter((s) => s.group === group).sort(byName),
    }))
    .filter((g) => g.species.length > 0);
}
