import type maplibregl from "maplibre-gl";
import "./style.css";
import "./shell.css";
import { openAbout } from "./about";
import { initPlaceSearch, type ChosenPlace } from "./placesearch";
import { flyCamera, fitCamera, mapInsets, popupAnchor, ringBounds } from "./camera";
import { loadAllSpecies, loadManifest, loadSpecies } from "./data";
import { formatDistance } from "./geo";
import { renderGuide } from "./guide";
import { formatHash, parseHash, type Tab } from "./hash";
import { clearObservations, clearRisk, frameToNearest, showObservations, showRisk } from "./layers";
import { createLocateGate, locateErrorMessage, LOCATION_UNSUPPORTED_MESSAGE } from "./locate";
import { createMap, DENMARK_BOUNDS, type MapBundle } from "./map";
import { initNavigation, readNavState, type Navigation, type Snapshot } from "./nav";
import { registerServiceWorker } from "./register-sw";
import { RiskPanel } from "./riskpanel";
import { initErrorMonitoring } from "./sentry";
import { initSheet } from "./sheet";
import { SpeciesPanel } from "./speciespanel";
import { initStart } from "./start";
import { landingTarget, type Landing } from "./startstate";
import type { Manifest } from "./types";

initErrorMonitoring();
registerServiceWorker();

// "My location" answers once per press (locatecontrol.ts, locate.ts): the
// answer sets the pin unless the user has chosen a spot of their own since.
const locateGate = createLocateGate();

const mapReady: Promise<MapBundle> = createMap("map", {
  onLocateAsk: () => locateGate.asked(),
  onAbout: () => openAbout(manifest),
});
const readout = document.getElementById("readout") as HTMLParagraphElement;
const appRoot = document.getElementById("app") as HTMLElement;
const panelEl = document.getElementById("panel") as HTMLElement;
const searchForm = document.getElementById("search") as HTMLFormElement;
const mapStatus = document.getElementById("map-status") as HTMLElement;

let manifest: Manifest | null = null;
let speciesPanel: SpeciesPanel | null = null;
let riskPanel: RiskPanel | null = null;
let pin: [number, number] | null = null;
let marker: maplibregl.Marker | null = null;
let framedSlug: string | null = null;
/** The Risiko tab's search radius, as it last reported it (riskpanel.ts). */
let riskRadiusM = 2000;
/** Resolves when a startup flight (from a shared link) has landed. */
let cameraSettled: Promise<void> = Promise.resolve();
/** The browser history (nav.ts); set up below, once the panels can answer. */
let navigation: Navigation | null = null;

/** Run `fn` once the map has loaded (layers can't be added before). */
function onMap(fn: (map: maplibregl.Map) => void): void {
  void mapReady.then(({ map, loaded }) => loaded.then(() => fn(map)));
}

// --- app shell: the sheet (phone) or sidebar (desktop), and the map's padding ---

let onShellLayout: () => void = () => {};
const sheet = initSheet({
  app: appRoot,
  sheet: panelEl,
  header: document.getElementById("sheet-header") as HTMLElement,
  handle: document.getElementById("sheet-handle") as HTMLButtonElement,
  body: document.getElementById("sheet-body") as HTMLElement,
  onLayout: () => onShellLayout(),
});

/** On the phone the sheet covers the lower part of the map and the address
 * search its top. MapLibre's padding tells it where the uncovered middle is,
 * so the opening view and every flight land in view rather than under the
 * sheet. It follows the half snap and is only re-applied when the layout
 * really changes: changing it shifts the map, which must not happen just
 * because the sheet was dragged (the live edge is --map-inset-bottom, which
 * camera.ts mapInsets() reads). */
let appliedPadding = { top: -1, bottom: -1 };
/** The least height of map the padding leaves between the search and the sheet. */
const MIN_MAP_PX = 120;
function applyMapPadding(map: maplibregl.Map): void {
  const field = searchForm.querySelector("input");
  const searchShown = !searchForm.hidden && sheet.isActive() && field !== null;
  // The field and a status line that is really showing; never the whole
  // form, whose suggestion list opens in its flow and must not move the map.
  const bottom = sheet.halfHeight();
  let top = 0;
  if (searchShown) {
    const fieldBottom = field.getBoundingClientRect().bottom + 8;
    // A tall status line (offline + "Prøv igen" at large text on a small
    // phone) may cover more of the map, but the padding always leaves a strip
    // of map between the field and the sheet to aim flights at.
    const roomForMap = appRoot.clientHeight - bottom - MIN_MAP_PX;
    top = Math.round(
      Math.max(fieldBottom, Math.min(fieldBottom + searchStatusHeight(), roomForMap)),
    );
  }
  appRoot.style.setProperty("--map-inset-top", `${top}px`);
  const unchanged =
    Math.abs(bottom - appliedPadding.bottom) < 40 && Math.abs(top - appliedPadding.top) < 40;
  if (unchanged) return;
  appliedPadding = { top, bottom };
  map.jumpTo({ padding: { top, bottom, left: 0, right: 0 } });
}

/** The map is ready: give it its padding, then (without a pin to fly to)
 * frame Denmark inside the uncovered part. Registered before any flight, so
 * flights start from the padded camera. */
const shellReady: Promise<MapBundle> = mapReady.then((bundle) => {
  const { map } = bundle;
  applyMapPadding(map);
  // The phone shows the compass only while the map is turned (shell.css).
  const markRotated = (): void => {
    appRoot.toggleAttribute("data-map-rotated", map.getBearing() !== 0 || map.getPitch() !== 0);
  };
  map.on("rotate", markRotated);
  map.on("pitch", markRotated);
  onShellLayout = () => {
    applyMapPadding(map);
    map.resize();
  };
  // Clear of the button column too, or Bornholm lands under the locate button.
  if (!initial.pin) {
    void fitCamera(map, DENMARK_BOUNDS, {
      margin: 16,
      instant: true,
      padding: mapInsets(map, { controls: true }),
    });
  }
  return bundle;
});

/** The place search (placesearch.ts) appears once it is set up and can show
 * a status line ("Prøv igen") or change height; the sheet's full snap, the
 * map's padding and the sidebar's room for the status line all follow it.
 * placesearch.ts owns #search-status (inside the form, role=status); this
 * only measures it. */
/** Height (with a 6 px gap) of the search's status line while it shows a
 * message, else 0. The search area keeps it in the form, never hidden: when
 * empty it is a 1×1 clipped box with .is-empty. */
function searchStatusHeight(): number {
  const status = document.getElementById("search-status");
  if (!status || status.hidden || status.classList.contains("is-empty")) return 0;
  const h = status.offsetHeight;
  return h > 2 ? h + 6 : 0;
}

function measureSearch(): void {
  appRoot.style.setProperty("--search-status-h", `${searchStatusHeight()}px`);
  const fieldH = searchForm.hidden ? 0 : (searchForm.querySelector("input")?.offsetHeight ?? 0);
  if (fieldH > 0) appRoot.style.setProperty("--search-h", `${fieldH}px`);
  sheet.relayout();
  onShellLayout();
}
{
  // Sizes, not the form's: the field (0 when the form is hidden) and the
  // status line (1 px while .is-empty). The suggestion list is an overlay.
  let watchedStatus: HTMLElement | null = null;
  const resized = "ResizeObserver" in window ? new ResizeObserver(() => measureSearch()) : null;
  const watchStatus = (): void => {
    const status = document.getElementById("search-status");
    if (!status || status === watchedStatus) return;
    if (watchedStatus) resized?.unobserve(watchedStatus);
    watchedStatus = status;
    resized?.observe(status);
  };
  const field = searchForm.querySelector("input");
  if (field) resized?.observe(field);
  // the status line added later (by the search area's code)
  new MutationObserver(() => {
    watchStatus();
    measureSearch();
  }).observe(searchForm, { childList: true });
  watchStatus();
  measureSearch();
}

// --- tabs: Arter / Risiko / Før du går (a WAI-ARIA tablist) ---

const tabButtons = [...document.querySelectorAll<HTMLButtonElement>("#tabs button")];

function setTab(tab: Tab): void {
  appRoot.dataset.tab = tab;
  for (const button of tabButtons) {
    const on = button.dataset.tab === tab;
    button.setAttribute("aria-selected", String(on));
    button.tabIndex = on ? 0 : -1;
  }
  for (const section of document.querySelectorAll<HTMLElement>(".tab")) {
    section.hidden = section.id !== `tab-${tab}`;
  }
  // Risk markers only while their list is visible, so they never get mistaken
  // for finds.
  if (tab !== "risiko") onMap(clearRisk);
  else riskPanel?.redrawMap();
}

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    const tab = button.dataset.tab as Tab;
    // On the phone, the tab already showing folds the sheet away or brings it
    // back, as in most map apps; another tab opens it far enough to read.
    if (appRoot.dataset.tab === tab && sheet.isActive()) {
      sheet.snapTo(sheet.snap() === "peek" ? "half" : "peek");
      return;
    }
    sheet.atLeast("half");
    setTab(tab);
    writeHash();
    // Risiko opened by hand: show the whole ring around the pin.
    // (The sheet stays where the tab click put it: on a two-stop screen
    // lowering it would fold it straight back to peek.)
    if (tab === "risiko" && pin) void frameRing(pin, false);
  });
  button.addEventListener("keydown", (e) => {
    const i = tabButtons.indexOf(button);
    const to =
      e.key === "ArrowRight"
        ? (i + 1) % tabButtons.length
        : e.key === "ArrowLeft"
          ? (i - 1 + tabButtons.length) % tabButtons.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabButtons.length - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    // Home/End on the tab already chosen: a click would fold the sheet.
    if (to === i) return;
    tabButtons[to].focus();
    tabButtons[to].click();
  });
}

// --- shareable links (hash.ts) ---
function writeHash(species = speciesPanel?.selectedSlug ?? null): void {
  // history.state is nav.ts's; the hash only rides along on the same entry.
  history.replaceState(
    history.state,
    "",
    formatHash(pin, (appRoot.dataset.tab as Tab) ?? "arter", species),
  );
}
document.getElementById("about")?.addEventListener("click", () => openAbout(manifest));
renderGuide(document.getElementById("tab-guide") as HTMLElement);
const initial = parseHash(location.hash);
setTab(initial.tab ?? "arter");

// --- payload + panels ---

/** Waiting for a species sheet to open (Back/Forward, nav.ts). */
let speciesWaiter: { slug: string; resolve: () => void } | null = null;
/** Whether the phone sheet was fully open when a species sheet opened. */
let fullBeforeDetail = false;

let resolvePanel: (panel: SpeciesPanel | null) => void = () => {};
const panelReady = new Promise<SpeciesPanel | null>((resolve) => (resolvePanel = resolve));

// One fetch of the manifest, shared by the panels and the start screen.
const manifestReady = loadManifest();
manifestReady
  .then((m) => {
    manifest = m;
    speciesPanel = new SpeciesPanel(document.getElementById("tab-arter") as HTMLElement, m, {
      loadDoc: (s) => loadSpecies(s.file),
      onSelect: (doc, visible) => {
        const opened = doc !== null && doc.slug !== framedSlug;
        const closed = doc === null && framedSlug !== null;
        framedSlug = doc?.slug ?? null;
        onMap((map) => {
          if (!doc) return clearObservations(map);
          showObservations(map, doc, visible);
          // Only when a species is opened, not on every toggle: zoom out just
          // enough to show its nearest find if none is in the uncovered map.
          if (opened) {
            const points = doc.observations.map(([lon, lat]): [number, number] => [lon, lat]);
            void cameraSettled.then(() => frameToNearest(map, points));
          }
        });
        // History first (a new entry copies the current address), then the hash.
        navigation?.record();
        writeHash(doc?.slug ?? null);
        if (opened) {
          // Its finds have just been drawn on the map: show both.
          fullBeforeDetail = sheet.snap() === "full";
          if (sheet.isActive() && sheet.snap() !== "half") sheet.snapTo("half");
        } else if (closed && fullBeforeDetail && sheet.snap() === "half") {
          sheet.snapTo("full");
        }
        if (doc && speciesWaiter?.slug === doc.slug) {
          speciesWaiter.resolve();
          speciesWaiter = null;
        }
      },
    });
    if (initial.species) speciesPanel.selectBySlug(initial.species);
    resolvePanel(speciesPanel);
    riskPanel = new RiskPanel(document.getElementById("tab-risiko") as HTMLElement, m, {
      onItems: (p, radiusM, items) => {
        const resized = radiusM !== riskRadiusM;
        riskRadiusM = radiusM;
        if (appRoot.dataset.tab !== "risiko") return;
        onMap((map) => showRisk(map, p, radiusM, items));
        // 1/2/5 km chosen: keep the whole ring in view.
        if (resized) void frameRing(p);
      },
      onFocus: (item) => {
        readout.textContent = `${item.title} – ${formatDistance(item.distanceM)} fra nålen`;
        void flyTo([item.lon, item.lat], 15);
      },
    });
    if (pin) applyPin(pin);
  })
  .catch((err) => {
    console.error(err);
    resolvePanel(null);
    const panel = document.getElementById("tab-arter");
    if (panel) panel.textContent = "Kunne ikke indlæse data.";
  });

function applyPin(p: [number, number]): void {
  riskPanel?.setPin(p);
  if (manifest && speciesPanel) {
    const panel = speciesPanel;
    void loadAllSpecies(manifest)
      .then((docs) => panel.setPin(p, docs))
      .catch((err) => console.error("species docs failed to load", err));
  }
}

function setPin(lngLat: [number, number], label: string): void {
  readout.textContent = label;
  pin = lngLat;
  applyPin(lngLat);
  writeHash();
  void mapReady.then(({ map, maplibregl }) => {
    marker?.remove();
    marker = new maplibregl.Marker({ color: "#1f6f78" }).setLngLat(lngLat).addTo(map);
  });
}

const pinLabel = (p: [number, number]): string => `Nål: ${p[1].toFixed(5)}, ${p[0].toFixed(5)}`;

/** Fly so `center` lands in the middle of the uncovered map (camera.ts). A
 * fully open phone sheet comes down to half first: it would hide the map it
 * is flying over. */
function flyTo(center: [number, number], zoom: number): Promise<void> {
  sheet.atMost("half");
  return shellReady.then(({ map }) => flyCamera(map, center, zoom));
}

/** Fit the risk ring (the Risiko tab's radius around the pin) into the
 * uncovered map, clear of the map buttons. `lowerSheet`: bring a fully open
 * sheet down first (a flight), or leave it (the user just raised it). */
function frameRing(center: [number, number], lowerSheet = true): Promise<void> {
  if (lowerSheet) sheet.atMost("half");
  return shellReady.then(({ map }) =>
    fitCamera(map, ringBounds(center, riskRadiusM), {
      maxZoom: 15,
      margin: 16,
      padding: mapInsets(map, { controls: true }),
    }),
  );
}

/** Take the camera to a new pin: on Risiko the whole ring around it must
 * show; elsewhere a plain flight to `zoom` (still into the uncovered map). */
function framePin(center: [number, number], zoom: number): Promise<void> {
  return appRoot.dataset.tab === "risiko" ? frameRing(center) : flyTo(center, zoom);
}

// --- messages over the map (the locate button's refusals) ---
let statusTimer: number | undefined;
const mapStatusText = mapStatus.querySelector(".map-status__text") as HTMLElement;
const mapStatusClose = mapStatus.querySelector(".map-status__close") as HTMLButtonElement;
function showMapStatus(text: string): void {
  window.clearTimeout(statusTimer);
  // The role=status line stays rendered (only visually hidden while empty), so
  // a screen reader hears the text change; only the box and its button show.
  mapStatusText.textContent = text;
  mapStatus.dataset.open = "";
  mapStatusClose.hidden = false;
  statusTimer = window.setTimeout(hideMapStatus, 9000);
}
function hideMapStatus(): void {
  window.clearTimeout(statusTimer);
  if (mapStatus.dataset.open === undefined) return;
  delete mapStatus.dataset.open;
  mapStatusText.textContent = "";
  mapStatusClose.hidden = true;
}
mapStatusClose.addEventListener("click", hideMapStatus);

// --- map interaction: tap = pin, tap on a find = its details ---
const ATTACHMENT_TEXT: Record<string, string> = {
  attached: "fastsiddende",
  drift: "opskyllet",
  unknown: "ukendt om fastsiddende",
};

mapReady
  .then(({ map, geolocate, maplibregl }) => {
    map.on("click", (e) => {
      hideMapStatus();
      const find = map.getLayer("observations")
        ? map.queryRenderedFeatures(e.point, { layers: ["observations"] })[0]
        : undefined;
      if (find) {
        const p = find.properties as { a: string; year: number | null; depth: number | null };
        const parts = [
          p.year ? `Fundet ${p.year}` : "Årstal ukendt",
          ATTACHMENT_TEXT[p.a] ?? p.a,
          typeof p.depth === "number" ? `${String(p.depth).replace(".", ",")} m dybde` : null,
        ].filter(Boolean);
        // Open towards the uncovered map, never down under the sheet.
        const { clientWidth: w, clientHeight: h } = map.getContainer();
        const pad = mapInsets(map, { controls: true });
        const anchor = popupAnchor(e.point.x, e.point.y, w, h, pad);
        new maplibregl.Popup({ closeButton: false, anchor, offset: 10 })
          .setLngLat(e.lngLat)
          .setText(parts.join(" · "))
          .addTo(map);
        return;
      }
      locateGate.superseded(); // the user picked a spot; a late position must not undo it
      const { lng, lat } = e.lngLat;
      // A tap never moves the camera: the user is looking at that spot.
      setPin([lng, lat], pinLabel([lng, lat]));
    });
    map.on("mouseenter", "observations", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "observations", () => (map.getCanvas().style.cursor = ""));
    // One answer per press; it sets the pin and frames it, once.
    geolocate.on("geolocate", (e) => {
      if (!locateGate.accept()) return;
      hideMapStatus();
      const { longitude, latitude } = (e as GeolocationPosition).coords;
      const here: [number, number] = [longitude, latitude];
      setPin(here, `Min placering – ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
      void framePin(here, Math.max(map.getZoom(), 13));
    });
    geolocate.on("error", (e) => {
      // A refusal is always said; a failed fix only while it is still wanted.
      const { code } = e as GeolocationPositionError;
      if (locateGate.accept() || code === 1) showMapStatus(locateErrorMessage(code));
    });
    geolocate.on("unsupported", () => showMapStatus(LOCATION_UNSUPPORTED_MESSAGE));
  })
  .catch((err) => {
    console.error("map failed to load", err);
    showMapStatus("Kortet kunne ikke indlæses. Genindlæs siden for at prøve igen.");
  });

if (initial.pin) {
  const p = initial.pin;
  setPin(p, pinLabel(p));
  cameraSettled = framePin(p, 12);
}

// A link pasted into an already-open tab only changes the hash; follow it.
// (writeHash uses history.replaceState, which does not fire this event.)
// Back/Forward through the app's own entries (nav.ts) also changes the hash
// when it differs between them; that is not a new link, and the app's state
// (pin, tab) stands: the address is just brought back in line with it.
window.addEventListener("hashchange", () => {
  if (readNavState(history.state)) {
    writeHash();
    return;
  }
  const next = parseHash(location.hash);
  if (next.tab && next.tab !== appRoot.dataset.tab) setTab(next.tab);
  if (next.pin && (next.pin[0] !== pin?.[0] || next.pin[1] !== pin?.[1])) {
    const p = next.pin;
    locateGate.superseded();
    setPin(p, pinLabel(p));
    cameraSettled = framePin(p, 12);
  }
  if (next.species && next.species !== speciesPanel?.selectedSlug) {
    speciesPanel?.selectBySlug(next.species);
  }
});

// --- Back and Forward (nav.ts): an open species sheet and a modal dialog each
// get a history entry, so a phone's Back closes them instead of leaving.

function navSnapshot(): Snapshot {
  const dialog = document.querySelector("dialog[open]") !== null;
  return {
    start: start.navSnap(),
    detail: speciesPanel?.selectedSlug ?? null,
    ...(dialog ? { dialog } : {}),
  };
}

function openSpecies(panel: SpeciesPanel, slug: string): Promise<void> {
  if (!manifest?.species.some((s) => s.slug === slug)) return Promise.resolve();
  return new Promise<void>((resolve) => {
    speciesWaiter = { slug, resolve };
    window.setTimeout(resolve, 5000); // a sheet that never loads must not stall the history
    panel.selectBySlug(slug);
  });
}

async function applyNavSnapshot(snap: Snapshot): Promise<void> {
  // Back with a dialog open closes the dialog only: the entry behind it is
  // what the dialog lay over.
  if (!snap.dialog) {
    for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog[open]")) {
      dialog.close();
    }
  }
  if (snap.start) start.show(snap.start);
  else if (start.isOpen()) start.close();
  const panel = await panelReady;
  if (!panel || panel.selectedSlug === snap.detail) return;
  const hadFocus = panelEl.contains(document.activeElement);
  if (snap.detail === null) {
    // Back must visibly do something: a species closed behind another tab
    // would change nothing on screen, so the list it returns to is shown.
    if (appRoot.dataset.tab !== "arter") {
      setTab("arter");
      writeHash();
    }
    panel.closeDetail();
  } else {
    if (appRoot.dataset.tab !== "arter") setTab("arter");
    await openSpecies(panel, snap.detail);
  }
  // The view under the focus was replaced: start again from its top.
  if (hadFocus && !panelEl.contains(document.activeElement)) {
    document.getElementById("tab-arter")?.focus({ preventScroll: true });
  }
}

// --- start screen (start.ts): each way in lands here, set up for its task ---
function landFromStart(landing: Landing): void {
  const target = landingTarget(landing);
  const place = landing.kind === "risk" || landing.kind === "beach" ? landing.place : undefined;
  if (place && (place.lngLat[0] !== pin?.[0] || place.lngLat[1] !== pin?.[1])) {
    locateGate.superseded(); // the user picked a place; a late position must not undo it
    setPin(place.lngLat, place.label);
  }
  if (target.tab) setTab(target.tab);
  writeHash();
  if (target.tab) sheet.snapTo("half");
  if (pin && target.camera === "ring") void frameRing(pin);
  if (pin && target.camera === "place") void flyTo(pin, place?.zoom ?? 13);
  const focusTarget =
    target.focus === "tab"
      ? tabButtons.find((b) => b.getAttribute("aria-selected") === "true")
      : document.getElementById(`tab-${appRoot.dataset.tab}`);
  focusTarget?.focus({ preventScroll: true });
  // (focus is in the panel first, so the species sheet takes it on its title)
  if (landing.kind === "species") speciesPanel?.selectBySlug(landing.slug);
}

const start = initStart({
  app: appRoot,
  behind: {
    search: searchForm,
    panel: panelEl,
    map: document.getElementById("map") as HTMLElement,
  },
  map: mapReady,
  manifest: manifestReady,
  getPin: () => (pin ? { lngLat: pin, label: readout.textContent ?? "" } : null),
  cancelLocate: () => locateGate.superseded(),
  enter: landFromStart,
  onNavigate: () => navigation?.record(),
});

navigation = initNavigation({ current: navSnapshot, apply: applyNavSnapshot });

// A modal dialog opening or closing, by any route (its button, Escape, a
// phone's own Back), is a change Back follows. showModal() sets the open
// attribute and close() removes it.
new MutationObserver((records) => {
  // <details> toggles the same attribute; only dialogs are history.
  if (records.some((r) => r.target instanceof HTMLDialogElement)) navigation?.record();
}).observe(document.body, {
  subtree: true,
  attributes: true,
  attributeFilter: ["open"],
});

// --- place search (placesearch.ts): towns, postal districts, bathing sites
// and, with a key, addresses. A chosen place becomes the pin.
function onPlaceChosen({ lngLat, label, zoom }: ChosenPlace): void {
  locateGate.superseded(); // the user picked a place; a late position must not undo it
  setPin(lngLat, label);
  void framePin(lngLat, zoom);
}
initPlaceSearch(onPlaceChosen);
