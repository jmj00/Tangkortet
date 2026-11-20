// The place search in the top field (#q): towns, postal districts and coastal
// bathing sites from the app's own list (placeindex.ts), and addresses from
// Adressevælgeren when Tangkortet has a key (addresses.ts). It says what
// became of a search that has nothing to list. Adapted from Svampekortet
// 624fb8b (web/src/placesearch.ts), with bathing sites where it has forests.

import "./search.css";
import { ADDRESSES_ENABLED, searchAddresses } from "./addresses";
import { attachCombobox, type Combobox, type ComboItem, type SearchOutcome } from "./addresscombo";
import {
  LIMITS,
  loadedPlaceIndex,
  loadPlaceIndex,
  matchPlaces,
  type PlaceSuggestion,
} from "./placeindex";

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

/** idle: nothing typed; loading: the place list is on its way; short: too
 * little typed; results; empty: nothing matched; failed: the address service
 * could not be reached; offline: the place list could not be fetched. */
export type SearchState = "idle" | "loading" | "short" | "results" | "empty" | "failed" | "offline";

/** From this many characters a name is searched by its beginning (three
 * digits: postal numbers). Fewer letters find only a name that is just them. */
export const MIN_QUERY = 3;

/** What the field is called, with and without addresses. */
export function searchWords(addresses: boolean): {
  placeholder: string;
  /** For a field too narrow for the whole placeholder (large text, small phone). */
  short: string;
  /** For the narrowest (a small phone at 150 % text). */
  tiny: string;
  label: string;
} {
  return addresses
    ? {
        placeholder: "Søg by, strand eller adresse…",
        short: "Søg by eller adresse…",
        tiny: "Søg sted…",
        label: "Søg by, strand eller adresse",
      }
    : {
        placeholder: "Søg by, postnummer eller strand…",
        short: "Søg by eller strand…",
        tiny: "Søg sted…",
        label: "Søg by, postnummer eller strand",
      };
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
    case "loading":
      return "Henter byer og strande…";
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
    case "results":
      // said, not shown: the list is there to see
      return outcome.shown === 1 ? "1 forslag" : `${outcome.shown} forslag`;
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

/**
 * The places for what is typed, then (with a key) the addresses. `loading`
 * is told when the search has to wait for the place list.
 */
export async function search(
  query: string,
  signal: AbortSignal,
  show: (items: ComboItem[], note?: string) => void,
  loading: () => void = () => {},
): Promise<SearchState> {
  if (!query) return "idle";
  const short = query.length < MIN_QUERY;
  if (short && /d/.test(query)) return "short";

  let places: ComboItem[] = [];
  let offline = false;
  try {
    if (!loadedPlaceIndex()) loading();
    const index = await loadPlaceIndex(); // gives up after LOAD_TIMEOUT_MS
    places = matchPlaces(index, query).map(placeItem);
  } catch {
    offline = true;
  }
  if (signal.aborted) return "idle";
  if (places.length > 0) show(places);
  // one or two letters: a place of just that name, else "type more"
  if (short) return offline ? "offline" : places.length > 0 ? "results" : "short";
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

/** The elements of one place-search field. `status` holds a
 * `.search-status__text` and a "Prøv igen" `button`. */
export interface PlaceSearchElements {
  input: HTMLInputElement;
  /** Must carry an id; the input names it in aria-controls. */
  listbox: HTMLUListElement;
  status: HTMLElement;
}

/**
 * Wire up the search field (#search, #q, #results, #search-status) and show
 * it. `onPlace` gets the chosen place; the caller sets the pin and flies.
 */
export function initPlaceSearch(onPlace: (place: ChosenPlace) => void): void {
  const form = document.getElementById("search") as HTMLFormElement;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  form.hidden = false;
  form.addEventListener("submit", (e) => e.preventDefault());
  attachPlaceSearch(
    {
      input: document.getElementById("q") as HTMLInputElement,
      listbox: document.getElementById("results") as HTMLUListElement,
      status: document.getElementById("search-status") as HTMLElement,
    },
    (place) => {
      onPlace(place);
      // On a phone the keyboard would cover the map that is about to move: on
      // to the pin's label (read out as it changes), not to nowhere.
      if (!finePointer.matches) {
        const readout = document.getElementById("readout");
        if (readout) {
          if (!readout.hasAttribute("tabindex")) readout.tabIndex = -1;
          readout.focus({ preventScroll: true });
        }
      }
    },
  );
}

/**
 * The place search on any field: the main interface's (initPlaceSearch) and
 * the start screen's place step (start.ts) are the same search, with the same
 * messages and "Prøv igen". `onPlace` gets the chosen place.
 */
export function attachPlaceSearch(
  { input, listbox, status }: PlaceSearchElements,
  onPlace: (place: ChosenPlace) => void,
): Combobox {
  const statusText = status.querySelector(".search-status__text") as HTMLElement;
  const retry = status.querySelector("button") as HTMLButtonElement;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const words = searchWords(ADDRESSES_ENABLED);

  // the whole placeholder where it fits, else the short one (the field's
  // label keeps the whole description for screen readers)
  const fitPlaceholder = (): void => {
    const style = getComputedStyle(input);
    const room = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx || room <= 0) return;
    ctx.font = style.font || `${style.fontSize} ${style.fontFamily}`;
    const fits = [words.placeholder, words.short].find((w) => ctx.measureText(w).width <= room);
    input.placeholder = fits ?? words.tiny;
  };
  input.placeholder = words.placeholder;
  input.setAttribute("aria-label", words.label);
  listbox.setAttribute(
    "aria-label",
    ADDRESSES_ENABLED ? "Forslag til byer, strande og adresser" : "Forslag til byer og strande",
  );
  fitPlaceholder();
  if ("ResizeObserver" in window) new ResizeObserver(fitPlaceholder).observe(input);

  let last: SearchOutcome<SearchState | "chosen"> = { state: "idle", query: "", shown: 0 };
  const say = (): void => {
    const focused = document.activeElement === input || status.contains(document.activeElement);
    const text =
      focused || last.state !== "idle"
        ? searchMessage(last, finePointer.matches ? "klik" : "tryk", ADDRESSES_ENABLED, focused)
        : "";
    // the region stays in the page (a live region added and filled at once
    // may go unread); only its text changes, and it is out of sight when empty
    if (statusText.textContent !== text) statusText.textContent = text;
    // a result count is for screen readers only
    status.classList.toggle("is-empty", text === "" || last.state === "results");
    status.dataset.state = last.state;
    retry.hidden = !RETRY.has(last.state);
  };

  const combobox = attachCombobox<SearchState>({
    input,
    listbox,
    search: (query, signal, show) =>
      search(query, signal, show, () => {
        last = { state: "loading", query, shown: 0 };
        say();
      }),
    enterPicksFirst: true,
    onOutcome: (outcome) => {
      last = outcome;
      say();
    },
    onSelect: (item) => {
      onPlace({ lngLat: item.target, label: item.text, zoom: item.zoom ?? ADDRESS_ZOOM });
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
      status.classList.add("is-empty");
    }, 150),
  );
  retry.addEventListener("blur", () =>
    window.setTimeout(() => {
      if (document.activeElement !== input) {
        statusText.textContent = "";
        status.classList.add("is-empty");
      }
    }, 150),
  );
  return combobox;
}
