// The start screen ("forside"): the ways into the app, in the expert's order
// of priority (contamination risk first), each landing in the main interface
// already set up for that task. A layer of the same page, not a page of its
// own: the sidebar's content on wide screens (the map stays live beside it),
// a sheet over the map on phones. Adapted from Svampekortet (624fb8b,
// web/src/start.ts) for seaweed: no photos, a risk flow instead of a season
// flow, and the expert's welcome text and disclaimer verbatim (welcome.ts).
//
// Three views, switched through data-start on #app (absent = closed):
//   home     the ways in, the way straight to the map, the welcome text, and
//            the safety line and "Før du går" pinned underneath
//   place    "where?" for "Kan jeg sanke her?" and "Find en strand": my
//            position, the place search (placesearch.ts, the same search as
//            the main field), or a tap on the map (on a phone this view is a
//            card at the top, so the map below it can be tapped)
//   species  every species of the manifest by group, with its colour dot
//
// This module draws the views and reports what was chosen; main.ts owns the
// pin, the map and the panels, and does the landing (`enter`). What shows
// when, in which order and where it lands is decided in startstate.ts, which
// has the tests.

import "./start.css";
import type { Combobox } from "./addresscombo";
import { fitCamera, prefersReducedMotion, type Padding } from "./camera";
import { h } from "./dom";
import { parseHash } from "./hash";
import { DENMARK_BOUNDS, type MapBundle } from "./map";
import { readNavState, type StartSnap } from "./nav";
import { tapAgainMessage } from "./tapzoom";
import { attachPlaceSearch } from "./placesearch";
import { PHONE_LAYOUT } from "./sheet";
import { LOAD_TIMEOUT_MS } from "./species";
import {
  compactSafety,
  entryStep,
  escapeFrom,
  fromStartSnap,
  locateMessage,
  mapTapLanding,
  pickerGroups,
  placeFocus,
  placeOptions,
  shouldShowStart,
  toStartSnap,
  type Entry,
  type Landing,
  type LocateResult,
  type PlaceFlow,
  type PlaceOption,
  type StartView,
} from "./startstate";
import { shownName, type Manifest, type SpeciesSummary } from "./types";
import { WELCOME_DISCLAIMER, welcomeText } from "./welcome";

export interface StartDeps {
  app: HTMLElement;
  /** What lies behind the layer; made inert while it covers it. */
  behind: { search: HTMLElement; panel: HTMLElement; map: HTMLElement };
  map: Promise<MapBundle>;
  manifest: Promise<Manifest>;
  /** The pin and what the readout calls it, or null without one. */
  getPin(): { lngLat: [number, number]; label: string } | null;
  /** Give up on a position that has not arrived yet (locate.ts gate). */
  cancelLocate(): void;
  /** Go into the main interface (main.ts). The layer is already closed. */
  enter(landing: Landing): void;
  /** The view shown changed, by any route (for the browser history, nav.ts). */
  onNavigate(): void;
}

export interface StartScreen {
  isOpen(): boolean;
  /** Show the home view. `fromMain`: from the "Forside" button, so it eases
   * in and takes keyboard focus on its heading. */
  open(options?: { fromMain?: boolean }): void;
  close(): void;
  /** What the history (nav.ts) records for the layer. */
  navSnap(): StartSnap;
  /** Show what Back or Forward brings back: opens the layer if it is closed. */
  show(snap: Exclude<StartSnap, null>): void;
  /** Whether a tap on the map may set the pin now: not while the species
   * step is up (it asks for a species, not a place). */
  allowsMapPin(): boolean;
  /** A far-out tap has flown the map in (tapzoom.ts): say "tap again" in the
   * layer. False when the layer is closed (main.ts says it over the map). */
  sayZoomedIn(): boolean;
}

const PLACE_COPY: Record<PlaceFlow, { title: string; lead: string }> = {
  risk: {
    title: "Hvor vil du sanke?",
    lead: "Så viser vi mulige forureningskilder, nedbør og vind omkring stedet.",
  },
  beach: {
    title: "Find en strand",
    lead: "Søg en by, et postnummer eller en badestrand. Så viser vi, hvilke arter der er fundet i nærheden.",
  },
};

const TITLE_IDS: Record<StartView, string> = {
  home: "start-title",
  place: "start-place-title",
  species: "start-species-title",
};

/** After this long without a position, say so and point at the other ways. */
const LOCATE_SLOW_MS = 9000;
/** A little over the enter/leave animations in start.css. */
const TRANSITION_MS = 240;

const ICON_BACK =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_LOCATE =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.2" fill="currentColor"/><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const ICON_PIN =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z" fill="currentColor"/><circle cx="12" cy="9.8" r="2.3" fill="var(--surface)"/></svg>';
const ICON_MAP =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3.5 6.5l5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2zM9 4.5v13M15 6.5v13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

function svg(className: string, markup: string): HTMLSpanElement {
  const span = h("span", { class: className, "aria-hidden": "true" });
  span.innerHTML = markup; // static markup from the constants above
  return span;
}

export function initStart(deps: StartDeps): StartScreen {
  const { app } = deps;
  const root = document.getElementById("start") as HTMLElement;
  const scroller = root.querySelector<HTMLElement>(".start__scroll") as HTMLElement;
  const startSheet = root.querySelector<HTMLElement>(".start__sheet") as HTMLElement;
  const views: Record<StartView, HTMLElement> = {
    home: root.querySelector<HTMLElement>('[data-view="home"]') as HTMLElement,
    place: root.querySelector<HTMLElement>('[data-view="place"]') as HTMLElement,
    species: root.querySelector<HTMLElement>('[data-view="species"]') as HTMLElement,
  };
  const homeTitle = document.getElementById("start-title") as HTMLElement;
  const phone = window.matchMedia(PHONE_LAYOUT);
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const verb = (): "tryk" | "klik" => (finePointer.matches ? "klik" : "tryk");

  let view: StartView | null = null;
  let pending: PlaceFlow | null = null;
  let transitionTimer: number | undefined;
  let bundle: MapBundle | null = null;

  // The expert's words, verbatim: the first paragraph of the welcome leads
  // the home view, the invitation to report finds closes it, and the
  // disclaimer is the safety line that never scrolls away.
  const [intro, invitation] = welcomeText();
  (document.getElementById("start-intro") as HTMLElement).replaceChildren(intro);
  (document.getElementById("start-welcome") as HTMLElement).replaceChildren(invitation);
  (document.getElementById("start-disclaimer") as HTMLElement).textContent = WELCOME_DISCLAIMER;

  // On short screens and at large text the safety line is cut to one line;
  // the same verbatim text opens in full on a tap.
  const safety = root.querySelector<HTMLElement>(".start__safety") as HTMLElement;
  const disclaimerToggle = document.getElementById("start-disclaimer-toggle") as HTMLButtonElement;
  disclaimerToggle.textContent = WELCOME_DISCLAIMER;
  disclaimerToggle.addEventListener("click", () => {
    const open = disclaimerToggle.getAttribute("aria-expanded") !== "true";
    disclaimerToggle.setAttribute("aria-expanded", String(open));
    safety.toggleAttribute("data-expanded", open);
  });
  const fitSafety = (): void => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    root.toggleAttribute(
      "data-compact",
      compactSafety(app.clientHeight || window.innerHeight, rem),
    );
  };
  fitSafety();
  window.addEventListener("resize", fitSafety);
  // a change of text size resizes the heading, not the window
  if ("ResizeObserver" in window) new ResizeObserver(fitSafety).observe(homeTitle);
  const homeMapHint = document.getElementById("start-maphint-text") as HTMLElement;
  const homeMapHintText = homeMapHint.textContent ?? "";

  // --- the layer itself -----------------------------------------------------

  function applyInert(): void {
    const open = view !== null;
    deps.behind.search.inert = open;
    deps.behind.panel.inert = open;
    // On a phone the layer lies over the map, except in the place step, where
    // the map below the card is one of the answers. On a wide screen the map
    // is beside the layer and always live.
    deps.behind.map.inert = open && phone.matches && view !== "place";
  }

  function setView(next: StartView | null): void {
    view = next;
    if (next) {
      app.dataset.start = next;
      for (const [name, element] of Object.entries(views)) element.hidden = name !== next;
      root.dataset.view = next; // the layer's geometry hangs on it, also while it fades out
      scroller.scrollTop = 0;
      root.setAttribute("aria-labelledby", TITLE_IDS[next]);
    } else {
      delete app.dataset.start;
    }
    applyInert();
    aimMap();
    deps.onNavigate();
  }

  /** Mark the layer as arriving or leaving for the length of the animation
   * (start.css). Nothing to mark when motion is reduced. */
  function transition(kind: "entering" | "leaving" | null): void {
    window.clearTimeout(transitionTimer);
    delete app.dataset.startEntering;
    delete app.dataset.startLeaving;
    if (kind === null || prefersReducedMotion()) return;
    if (kind === "entering") app.dataset.startEntering = "";
    else app.dataset.startLeaving = "";
    transitionTimer = window.setTimeout(() => transition(null), TRANSITION_MS);
  }

  // --- the map behind the layer (phone) ---------------------------------------
  // On a phone the layer covers most of the map: the home and species views
  // leave a band at the top, the place step a strip below its card. The map's
  // padding is pointed at what is left while the layer is up, and put back as
  // it was (main.ts's) when it closes, before main.ts lands.

  let savedPadding: Padding | null = null;

  /** How much of the map the layer covers from the top and the bottom. */
  function mapCover(): { top: number; bottom: number } | null {
    if (view === null || !phone.matches) return null;
    const rect = startSheet.getBoundingClientRect();
    const appRect = app.getBoundingClientRect();
    return view === "place"
      ? { top: Math.round(rect.bottom - appRect.top), bottom: 0 }
      : { top: 0, bottom: Math.round(appRect.bottom - rect.top) };
  }

  function restorePadding(): void {
    if (!bundle || !savedPadding) return;
    bundle.map.jumpTo({ padding: savedPadding });
    savedPadding = null;
  }

  function aimMap(): void {
    if (!bundle) return;
    const { map } = bundle;
    const cover = mapCover();
    if (!cover) {
      restorePadding();
      return;
    }
    savedPadding ??= map.getPadding();
    const padding: Padding = { top: cover.top, bottom: cover.bottom, left: 0, right: 0 };
    const current = map.getPadding();
    if (Math.abs(current.top - padding.top) < 8 && Math.abs(current.bottom - padding.bottom) < 8) {
      return;
    }
    // Without a pin the place step shows the whole coast below its card.
    if (view === "place" && !deps.getPin() && map.getZoom() < 7.5) {
      map.jumpTo({ padding });
      void fitCamera(map, DENMARK_BOUNDS, { margin: 12, padding, instant: true });
      return;
    }
    // (never a zero-duration animation: camera.ts)
    if (prefersReducedMotion()) map.jumpTo({ padding });
    else map.easeTo({ padding, duration: 300 });
  }

  void deps.map.then(
    (loaded) => {
      bundle = loaded;
      aimMap();
      loaded.map.on("click", (e) => {
        if (view === null) return;
        const flow = mapTapLanding(view, pending);
        if (!flow) return;
        // main.ts has handled the tap already: it set the pin there, unless
        // the tap was on a find (that shows its details instead).
        const pin = deps.getPin();
        if (!pin || pin.lngLat[0] !== e.lngLat.lng || pin.lngLat[1] !== e.lngLat.lat) return;
        leave({ kind: flow });
      });
      // Escape from the map beside a step (keyboard focus on its controls).
      loaded.map.getContainer().addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        if (view !== "place" && view !== "species") return;
        event.preventDefault();
        goHome();
      });
    },
    () => {},
  );
  window.addEventListener("resize", () => {
    if (view !== null) aimMap();
  });
  phone.addEventListener("change", () => {
    if (view === null) return;
    applyInert();
    aimMap();
  });

  // --- leaving -------------------------------------------------------------

  function close(): void {
    const wasOpen = view !== null;
    const hadFocus = root.contains(document.activeElement);
    stopLocating();
    combobox?.close();
    pending = null;
    homeMapHint.textContent = homeMapHintText;
    setView(null);
    restorePadding();
    transition(wasOpen ? "leaving" : null);
    // Focus was in the layer, which is gone (Back, Escape): on to the tab in
    // view. A landing (main.ts) moves it on from there.
    if (hadFocus) {
      document
        .querySelector<HTMLElement>('#tabs [aria-selected="true"]')
        ?.focus({ preventScroll: true });
    }
  }

  /** Close the layer and land in the main interface. */
  function leave(landing: Landing): void {
    close();
    deps.enter(landing);
  }

  function goHome(focusOn?: HTMLElement | null): void {
    const from = pending;
    const fromView = view;
    stopLocating();
    combobox?.close();
    pending = null;
    setView("home");
    const back =
      fromView === "place"
        ? flowButton(from ?? "risk")
        : fromView === "species"
          ? flowButton("species")
          : null;
    (focusOn ?? back ?? homeTitle).focus({ preventScroll: true });
  }

  const flowButton = (flow: string): HTMLElement | null =>
    views.home.querySelector<HTMLElement>(`[data-flow="${flow}"]`);

  /** The "Forside" button of a step: after the heading in the document (focus
   * lands on the heading, Tab goes on to it), shown above it (start.css). */
  function backBar(): HTMLElement {
    const back = h("button", { type: "button", class: "start__back" });
    back.append(svg("start__back-icon", ICON_BACK), h("span", {}, "Forside"));
    back.setAttribute("aria-label", "Tilbage til forsiden");
    back.addEventListener("click", () => goHome());
    return h("div", { class: "start__bar" }, back);
  }

  // --- place step -----------------------------------------------------------

  let combobox: Combobox | null = null;
  let locateToken = 0;
  let locating = false;

  const placeTitle = h("h2", {
    class: "start__title start__title--step",
    id: "start-place-title",
    tabindex: "-1",
  });
  const placeLead = h("p", { class: "start__lead" });

  const keepButton = h("button", { type: "button", class: "place__option" });
  const keepSub = h("span", { class: "place__option-sub" });
  keepButton.append(
    svg("place__option-icon", ICON_PIN),
    h(
      "span",
      { class: "place__option-text" },
      h("span", { class: "place__option-title" }, "Brug nålen"),
      keepSub,
    ),
  );
  keepButton.addEventListener("click", () => {
    if (pending) leave({ kind: pending });
  });

  const locateButton = h("button", {
    type: "button",
    class: "place__option place__option--primary",
  });
  const locateLabel = h("span", { class: "place__option-title" }, "Brug min placering");
  locateButton.append(
    svg("place__option-icon", ICON_LOCATE),
    h("span", { class: "place__option-text" }, locateLabel),
    h("span", { class: "place__spinner", "aria-hidden": "true" }),
  );
  const locateMessageEl = h("p", { class: "place__message", role: "status" });

  // The same search as the main interface's field (placesearch.ts).
  const searchInput = h("input", {
    type: "search",
    id: "start-q",
    class: "place__input",
    autocomplete: "off",
    spellcheck: "false",
    enterkeyhint: "search",
    role: "combobox",
    "aria-expanded": "false",
    "aria-controls": "start-results",
    "aria-autocomplete": "list",
    "aria-describedby": "start-search-status",
  });
  const searchList = h("ul", { id: "start-results", class: "place__results", role: "listbox" });
  const searchStatus = h(
    "div",
    { id: "start-search-status", class: "search-status is-empty", role: "status" },
    h("span", { class: "search-status__text" }),
    h("button", { type: "button", class: "search-status__retry", hidden: true }, "Prøv igen"),
  );
  const searchField = h(
    "div",
    { class: "start-field place__field" },
    searchInput,
    searchStatus,
    searchList,
  );
  combobox = attachPlaceSearch(
    { input: searchInput, listbox: searchList, status: searchStatus },
    (place) => {
      if (pending) leave({ kind: pending, place });
    },
  );

  const mapHint = h("p", { class: "place__hint", role: "status" });
  const mapHintText = h("span");
  mapHint.append(svg("place__hint-icon", ICON_MAP), mapHintText);

  const placeOptionsBox = h("div", { class: "place" });
  views.place.replaceChildren(placeTitle, backBar(), placeLead, placeOptionsBox);

  function say(message: string | null): void {
    locateMessageEl.hidden = message === null;
    locateMessageEl.textContent = message ?? "";
  }

  function stopLocating(): void {
    locateToken++;
    if (locating) deps.cancelLocate();
    locating = false;
    delete locateButton.dataset.state;
    locateButton.removeAttribute("aria-disabled");
    locateLabel.textContent = "Brug min placering";
  }

  /** Ask for the position once (the map's own locate button does the asking,
   * and main.ts sets the pin from the answer). */
  function requestPosition(): Promise<LocateResult> {
    return deps.map.then(
      ({ geolocate }) =>
        new Promise<LocateResult>((resolve) => {
          const done = (result: LocateResult): void => {
            geolocate.off("geolocate", ok);
            geolocate.off("error", fail);
            geolocate.off("unsupported", unsupported);
            resolve(result);
          };
          const ok = (): void => done("ok");
          const fail = (e: GeolocationPosition | GeolocationPositionError): void =>
            done((e as GeolocationPositionError).code === 1 ? "denied" : "unavailable");
          const unsupported = (): void => done("unavailable");
          geolocate.on("geolocate", ok);
          geolocate.on("error", fail);
          geolocate.on("unsupported", unsupported);
          if (!geolocate.trigger()) done("unavailable");
        }),
      () => "unavailable" as const,
    );
  }

  locateButton.addEventListener("click", () => {
    if (locating || !pending) return;
    locating = true;
    const token = ++locateToken;
    say(null);
    locateButton.dataset.state = "busy";
    locateButton.setAttribute("aria-disabled", "true");
    locateLabel.textContent = "Finder din placering …";
    const slow = window.setTimeout(() => {
      if (token === locateToken) say(locateMessage("slow", verb()));
    }, LOCATE_SLOW_MS);
    void requestPosition().then((result) => {
      window.clearTimeout(slow);
      if (token !== locateToken) return; // left the step, or asked again
      locating = false;
      delete locateButton.dataset.state;
      locateButton.removeAttribute("aria-disabled");
      locateLabel.textContent = "Brug min placering";
      if (result === "ok") {
        if (pending) leave({ kind: pending });
        return;
      }
      say(locateMessage(result, verb()));
      // The search is the way forward now; the button stays (for when the
      // permission has been changed) but steps back.
      locateButton.dataset.state = "failed";
      searchField.classList.add("is-suggested");
      aimMap(); // the card grew: keep the map's middle below it
      // With a keyboard the next step is to type; on a touch screen focusing
      // the field would throw the keyboard over the message just shown.
      if (finePointer.matches) searchInput.focus({ preventScroll: true });
    });
  });

  function showPlace(flow: PlaceFlow): void {
    stopLocating();
    combobox?.close();
    pending = flow;
    const copy = PLACE_COPY[flow];
    placeTitle.textContent = copy.title;
    placeLead.textContent = copy.lead;
    say(null);
    searchField.classList.remove("is-suggested");
    searchInput.value = "";
    locateButton.classList.toggle("place__option--primary", flow === "risk");
    mapHintText.textContent =
      verb() === "klik"
        ? "Du kan også zoome ind på kortet og klikke på kysten."
        : "Du kan også zoome ind på kortet under dette felt og trykke på kysten.";
    const pin = deps.getPin();
    keepSub.textContent = pin?.label ?? "";
    const parts: Record<PlaceOption, HTMLElement[]> = {
      keep: [keepButton],
      locate: [locateButton, locateMessageEl],
      search: [searchField],
      map: [mapHint],
    };
    placeOptionsBox.replaceChildren(...placeOptions(flow, pin !== null).flatMap((o) => parts[o]));
    setView("place");
    if (placeFocus(flow) === "search") searchInput.focus({ preventScroll: true });
    else placeTitle.focus({ preventScroll: true });
  }

  // --- species step ---------------------------------------------------------

  const speciesTitle = h(
    "h2",
    { class: "start__title start__title--step", id: "start-species-title", tabindex: "-1" },
    "Hvilken art leder du efter?",
  );
  const picker = h("div", { class: "picker" });
  views.species.replaceChildren(
    speciesTitle,
    backBar(),
    h("p", { class: "start__lead" }, "Vælg en art, og se på kortet, hvor den er fundet."),
    picker,
  );
  let manifestState: "loading" | "ready" | "failed" = "loading";
  let manifest: Manifest | null = null;

  function pickButton(s: SpeciesSummary): HTMLElement {
    const button = h("button", { type: "button", class: "pick", "data-slug": s.slug });
    const text = h("span", { class: "pick__text" });
    if (s.danish_name) {
      text.append(
        h("span", { class: "pick__name" }, s.danish_name),
        h("span", { class: "pick__sci", lang: "la" }, s.scientific_name),
      );
    } else {
      text.append(h("span", { class: "pick__name pick__name--sci", lang: "la" }, shownName(s)));
    }
    button.append(
      h("span", { class: "spp-dot", "data-group": s.group, "aria-hidden": "true" }),
      text,
    );
    if (s.invasive) button.append(h("span", { class: "spp-tag spp-tag--invasive" }, "Invasiv"));
    button.addEventListener("click", () => leave({ kind: "species", slug: s.slug }));
    return button;
  }

  function renderPicker(): void {
    if (manifestState === "ready" && manifest) {
      picker.removeAttribute("aria-busy");
      picker.replaceChildren(
        ...pickerGroups(manifest.species).map((g) =>
          h(
            "section",
            { class: "picker__group", "aria-labelledby": `picker-${g.group}` },
            h(
              "h3",
              { class: "picker__heading", id: `picker-${g.group}` },
              h("span", { class: "spp-dot", "data-group": g.group, "aria-hidden": "true" }),
              g.label,
              h("span", { class: "picker__count" }, String(g.species.length)),
            ),
            h(
              "ul",
              { class: "picker__list", role: "list" },
              ...g.species.map((s) => h("li", {}, pickButton(s))),
            ),
          ),
        ),
      );
      return;
    }
    if (manifestState === "loading") {
      picker.setAttribute("aria-busy", "true");
      picker.replaceChildren(
        h(
          "p",
          { class: "picker__status", role: "status" },
          h("span", { class: "place__spinner is-on", "aria-hidden": "true" }),
          "Henter arterne …",
        ),
      );
      return;
    }
    picker.removeAttribute("aria-busy");
    // Everything else on the page hangs on the same list, so trying again is
    // loading the page again (the history brings this step back).
    const retry = h("button", { type: "button", class: "picker__retry" }, "Prøv igen");
    retry.addEventListener("click", () => location.reload());
    picker.replaceChildren(
      h(
        "div",
        { class: "picker__failed", role: "alert" },
        h("strong", {}, "Kunne ikke hente arterne"),
        h("span", {}, "Tjek forbindelsen, og prøv igen."),
        retry,
      ),
    );
  }

  const giveUp = window.setTimeout(() => {
    if (manifestState !== "loading") return;
    manifestState = "failed";
    renderPicker();
  }, LOAD_TIMEOUT_MS);
  deps.manifest.then(
    (loaded) => {
      window.clearTimeout(giveUp);
      manifest = loaded;
      manifestState = "ready";
      renderPicker();
    },
    () => {
      window.clearTimeout(giveUp);
      manifestState = "failed";
      renderPicker();
    },
  );
  renderPicker();

  function showSpecies(): void {
    stopLocating();
    combobox?.close();
    pending = null;
    renderPicker();
    setView("species");
    speciesTitle.focus({ preventScroll: true });
  }

  // --- wiring ---------------------------------------------------------------

  function choose(entry: Entry | "guide"): void {
    if (entry === "guide") return leave({ kind: "guide" });
    const step = entryStep(entry);
    if (step === null) return leave({ kind: "map" });
    if (step.view === "place") showPlace(step.flow);
    else showSpecies();
  }

  root.addEventListener("click", (event) => {
    const flow = (event.target as HTMLElement).closest<HTMLElement>("[data-flow]")?.dataset.flow;
    if (
      flow === "map" ||
      flow === "risk" ||
      flow === "species" ||
      flow === "beach" ||
      flow === "guide"
    ) {
      event.preventDefault(); // "Gå til kortet" is a link (?kort) for when scripts fail
      choose(flow);
    }
  });

  // Escape steps back: from a step to the home view, from there to the map.
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || view === null) return;
    // An open suggestion list closes first (addresscombo.ts stops that
    // Escape); then a search field with text in it empties, as it does itself.
    if (event.target === searchInput && searchInput.value !== "") return;
    event.preventDefault();
    if (escapeFrom(view) === "map") leave({ kind: "map" });
    else goHome();
  });

  function open(options?: { fromMain?: boolean }): void {
    const wasOpen = view !== null;
    stopLocating();
    combobox?.close();
    pending = null;
    setView("home");
    if (options?.fromMain) {
      if (!wasOpen) transition("entering");
      homeTitle.focus({ preventScroll: true });
    }
  }

  // "Forside": the wordmark in the sidebar, the pill in the phone's sheet.
  for (const button of document.querySelectorAll<HTMLElement>("[data-home]")) {
    button.addEventListener("click", () => open({ fromMain: true }));
  }

  // A shared link pasted into an open tab while the layer is up: main.ts
  // follows it (hashchange), and the layer makes way. Back/Forward through
  // the app's own entries is not a new link.
  window.addEventListener("hashchange", () => {
    if (view === null || readNavState(history.state)) return;
    const next = parseHash(location.hash);
    if (next.pin || next.species) close();
  });

  // The inline script in index.html made the same call before the first
  // paint; this settles it.
  if (shouldShowStart(parseHash(location.hash), location.search, readNavState(history.state))) {
    open();
  } else close();

  return {
    isOpen: () => view !== null,
    open,
    close,
    navSnap: () => toStartSnap(view, pending),
    show(snap): void {
      const { view: next, flow } = fromStartSnap(snap);
      if (next === "home") {
        // from the map (Back/Forward): eases in and focuses the heading,
        // since what had focus is now inert under the layer
        if (view === null) open({ fromMain: true });
        else goHome();
        return;
      }
      if (view === null) transition("entering");
      if (next === "place") showPlace(flow ?? "risk");
      else showSpecies();
    },
    allowsMapPin: () => view === null || mapTapLanding(view, pending) !== null,
    sayZoomedIn(): boolean {
      if (view === null) return false;
      const text = tapAgainMessage(verb());
      if (view === "place") mapHintText.textContent = text;
      else homeMapHint.textContent = text;
      return true;
    },
  };
}
