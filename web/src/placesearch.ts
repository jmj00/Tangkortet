// The place search in the top field (#q): towns, postal districts and coastal
// bathing sites from the app's own list (placeindex.ts), and addresses from
// Adressevælgeren when Tangkortet has a key (addresses.ts). It says what
// became of a search that has nothing to list. Adapted from Svampekortet
// 624fb8b (web/src/placesearch.ts), with bathing sites where it has forests.

import "./search.css";
import { ADDRESSES_ENABLED, searchAddresses } from "./addresses";
import { attachCombobox, type ComboItem, type SearchOutcome } from "./addresscombo";
import { LIMITS, loadPlaceIndex, matchPlaces, type PlaceSuggestion } from "./placeindex";

/** What was chosen: where, what to call the pin, how close to fly. */
export interface ChosenPlace {
  lngLat: [number, number];
  label: string;
  zoom: number;
}

/** How close to fly to an address. */
const ADDRESS_ZOOM = 14;

const svg = (body: string): string =>
  `<svg class="place-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
// Town icon from Svampekortet 624fb8b.
const ICON_TOWN = svg(
  '<path d="M3.5 20.5V11l5-3.5 5 3.5v9.5M13.5 20.5V8.5l4-3 3 2.2v12.8M2.5 20.5h19M7 14h3M7 17h3M16.5 11h1.5M16.5 14h1.5M16.5 17h1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
);
const ICON_COAST = svg(
  '<path d="M2.5 9.5c1.6 0 1.6-1.5 3.2-1.5s1.6 1.5 3.2 1.5 1.6-1.5 3.1-1.5 1.6 1.5 3.2 1.5 1.6-1.5 3.2-1.5 1.5 1.5 3.1 1.5M2.5 14.5c1.6 0 1.6-1.5 3.2-1.5s1.6 1.5 3.2 1.5 1.6-1.5 3.1-1.5 1.6 1.5 3.2 1.5 1.6-1.5 3.2-1.5 1.5 1.5 3.1 1.5M2.5 19.5c1.6 0 1.6-1.5 3.2-1.5s1.6 1.5 3.2 1.5 1.6-1.5 3.1-1.5 1.6 1.5 3.2 1.5 1.6-1.5 3.2-1.5 1.5 1.5 3.1 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
);
const ICON_POSTAL = svg(
  '<rect x="3" y="5.5" width="18" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
);
const ICON_ADDRESS = svg(
  '<path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="9.8" r="2.3" fill="none" stroke="currentColor" stroke-width="1.6"/>',
);
const ICONS: Record<PlaceSuggestion["kind"], string> = {
  town: ICON_TOWN,
  postal: ICON_POSTAL,
  coast: ICON_COAST,
};

/** idle: nothing typed; short: too little typed; results; empty: nothing
 * matched; failed: the address service could not be reached; offline: the
 * place list could not be fetched. */
export type SearchState = "idle" | "short" | "results" | "empty" | "failed" | "offline";

/** From this many characters a name is searched (three digits: postal numbers). */
export const MIN_QUERY = 3;

/** What the field is called, with and without addresses. */
export function searchWords(addresses: boolean): { placeholder: string; label: string } {
  return addresses
    ? { placeholder: "Søg by, strand eller adresse…", label: "Søg by, strand eller adresse" }
    : { placeholder: "Søg by, postnummer eller strand…", label: "Søg by, postnummer eller strand" };
}

/**
 * What the search says, if anything. `verb` is how this device picks a spot
 * on the map: "tryk" by touch, "klik" with a mouse. `focused`: the field has
 * focus (an empty focused field explains what it finds).
 */
export function searchMessage(
  outcome: SearchOutcome<SearchState | "chosen">,
  verb: "tryk" | "klik",
  addresses: boolean,
  focused = true,
): string {
  const q = outcome.query;
  switch (outcome.state) {
    case "idle":
      if (!focused) return "";
      return addresses
        ? "Skriv en by, et postnummer, en badestrand eller en adresse – fx „Skagen“, „6857“ eller „Vestergade 10, Silkeborg“."
        : "Skriv en by, et postnummer eller en badestrand – fx „Skagen“, „6857“ eller „Vemmetofte Strand“.";
    case "short":
      return /^\d+$/.test(q)
        ? "Skriv mindst 3 cifre af postnummeret."
        : `Skriv mindst ${MIN_QUERY} bogstaver.`;
    case "empty":
      return addresses
        ? `Ingen byer, strande eller adresser matcher „${q}“. Prøv et vejnavn med by, fx „Vestergade 10, Silkeborg“, eller ${verb} på kortet.`
        : `Ingen byer, postnumre eller badestrande matcher „${q}“. Prøv et bynavn eller et postnummer, fx „Silkeborg“ eller „8600“, eller ${verb} på kortet.`;
    case "failed":
      return outcome.shown > 0
        ? "Adressesøgningen svarer ikke lige nu, så her er kun byer og strande."
        : `Adressesøgningen svarer ikke lige nu. Tjek forbindelsen og prøv igen – eller ${verb} på kortet.`;
    case "offline":
      return `Listen over byer og strande kunne ikke hentes. Tjek forbindelsen og prøv igen – eller ${verb} på kortet.`;
    default:
      return "";
  }
}

/** Whether the state is worth a "Prøv igen". */
const RETRY: ReadonlySet<string> = new Set(["failed", "offline"]);

/** The line above addresses found elsewhere than in the town typed. */
export function missedText(street: string, town: string): string {
  return `Ingen ${street} i ${town} – adresser andre steder:`;
}

const placeItem = (s: PlaceSuggestion): ComboItem => ({
  text: s.text,
  meta: s.meta,
  icon: ICONS[s.kind],
  kind: s.kind,
  target: s.target,
  zoom: s.zoom,
});

/** The places for what is typed, then (with a key) the addresses. */
async function search(
  query: string,
  signal: AbortSignal,
  show: (items: ComboItem[], note?: string) => void,
): Promise<SearchState> {
  if (!query) return "idle";
  if (query.length < MIN_QUERY) return "short";

  let places: ComboItem[] = [];
  let offline = false;
  try {
    const index = await loadPlaceIndex();
    places = matchPlaces(index, query).map(placeItem);
  } catch {
    offline = true;
  }
  if (signal.aborted) return "idle";
  if (places.length > 0) show(places);
  if (!ADDRESSES_ENABLED) {
    if (offline) return "offline";
    return places.length > 0 ? "results" : "empty";
  }

  try {
    const result = await searchAddresses(query, signal);
    let note: string | undefined;
    if (result.missed) {
      note = missedText(result.missed.street, result.missed.town);
      // the town itself first: it may be where the user meant to go
      const town = result.missed.place;
      if (town && !places.some((p) => p.text === town.text)) places = [placeItem(town), ...places];
    }
    const addresses: ComboItem[] = result.addresses.map((a) => ({
      text: a.tekst,
      meta: "Adresse",
      icon: ICON_ADDRESS,
      kind: "address",
      target: [a.adgangsadresse.x, a.adgangsadresse.y],
      zoom: ADDRESS_ZOOM,
    }));
    // fewer places when addresses come too, so both fit
    const all = [
      ...places.slice(0, addresses.length ? LIMITS.total - 2 : LIMITS.total),
      ...addresses,
    ];
    if (addresses.length > 0 || result.missed) show(all, addresses.length ? note : undefined);
    if (offline && all.length === 0) return "offline";
    return all.length > 0 ? "results" : "empty";
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    console.warn("address search failed", err);
    return "failed";
  }
}

/**
 * Wire up the search field (#search, #q, #results, #search-status) and show
 * it. `onPlace` gets the chosen place; the caller sets the pin and flies.
 */
export function initPlaceSearch(onPlace: (place: ChosenPlace) => void): void {
  const form = document.getElementById("search") as HTMLFormElement;
  const input = document.getElementById("q") as HTMLInputElement;
  const listbox = document.getElementById("results") as HTMLUListElement;
  const status = document.getElementById("search-status") as HTMLElement;
  const statusText = status.querySelector(".search-status__text") as HTMLElement;
  const retry = status.querySelector("button") as HTMLButtonElement;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const words = searchWords(ADDRESSES_ENABLED);

  input.placeholder = words.placeholder;
  input.setAttribute("aria-label", words.label);
  listbox.setAttribute(
    "aria-label",
    ADDRESSES_ENABLED ? "Forslag til byer, strande og adresser" : "Forslag til byer og strande",
  );
  form.hidden = false;
  form.addEventListener("submit", (e) => e.preventDefault());

  let last: SearchOutcome<SearchState | "chosen"> = { state: "idle", query: "", shown: 0 };
  const say = (): void => {
    const focused = document.activeElement === input || status.contains(document.activeElement);
    const text =
      focused || last.state !== "idle"
        ? searchMessage(last, finePointer.matches ? "klik" : "tryk", ADDRESSES_ENABLED, focused)
        : "";
    if (statusText.textContent !== text) statusText.textContent = text;
    status.hidden = text === "";
    status.dataset.state = last.state;
    retry.hidden = !RETRY.has(last.state);
  };

  const combobox = attachCombobox<SearchState>({
    input,
    listbox,
    search,
    enterPicksFirst: true,
    onOutcome: (outcome) => {
      last = outcome;
      say();
    },
    onSelect: (item) => {
      onPlace({ lngLat: item.target, label: item.text, zoom: item.zoom ?? ADDRESS_ZOOM });
      // On a phone the keyboard would cover the map that is about to move.
      if (!finePointer.matches) input.blur();
    },
  });

  retry.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the field
  retry.addEventListener("click", () => {
    input.focus();
    combobox.refresh();
  });

  input.addEventListener("focus", () => {
    // The place list is fetched when the field is first focused, so the
    // first search does not wait for it.
    void loadPlaceIndex().catch(() => {});
    // Back in a field that still holds a search: list it again.
    if (last.state === "chosen") {
      input.select(); // typing replaces the chosen place
    } else if (input.value.trim()) {
      combobox.refresh();
    } else {
      say();
    }
  });

  // The message belongs to the search in progress: it goes when the field is
  // left (as the suggestions do), unless focus went to its own button.
  input.addEventListener("blur", () =>
    window.setTimeout(() => {
      const here = document.activeElement;
      if (here === input || status.contains(here)) return; // came straight back
      if (!input.value.trim()) last = { state: "idle", query: "", shown: 0 };
      statusText.textContent = "";
      status.hidden = true;
    }, 150),
  );
  retry.addEventListener("blur", () =>
    window.setTimeout(() => {
      if (document.activeElement !== input) status.hidden = true;
    }, 150),
  );
}
