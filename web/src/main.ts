import type maplibregl from "maplibre-gl";
import "./style.css";
import { openAbout } from "./about";
import { maybeWelcome } from "./welcome";
import { searchAddresses, type AddressSuggestion } from "./addresses";
import { loadAllSpecies, loadManifest, loadSpecies } from "./data";
import { formatDistance } from "./geo";
import { renderGuide } from "./guide";
import { formatHash, parseHash, type Tab } from "./hash";
import { clearObservations, clearRisk, frameToNearest, showObservations, showRisk } from "./layers";
import { createMap, type MapBundle } from "./map";
import { registerServiceWorker } from "./register-sw";
import { RiskPanel } from "./riskpanel";
import { initErrorMonitoring } from "./sentry";
import { SpeciesPanel } from "./speciespanel";
import type { Manifest } from "./types";

initErrorMonitoring();
maybeWelcome();
registerServiceWorker();

const mapReady: Promise<MapBundle> = createMap("map");
const readout = document.getElementById("readout") as HTMLParagraphElement;
const appRoot = document.getElementById("app") as HTMLElement;

let manifest: Manifest | null = null;
let speciesPanel: SpeciesPanel | null = null;
let riskPanel: RiskPanel | null = null;
let pin: [number, number] | null = null;
let marker: maplibregl.Marker | null = null;
let geolocateActive = false;
let framedSlug: string | null = null;
/** Resolves when a startup flight (from a shared link) has landed. */
let cameraSettled: Promise<void> = Promise.resolve();

/** Run `fn` once the map has loaded (layers can't be added before). */
function onMap(fn: (map: maplibregl.Map) => void): void {
  void mapReady.then(({ map, loaded }) => loaded.then(() => fn(map)));
}

// --- tabs: Arter / Risiko / Før du går ---

function setTab(tab: Tab): void {
  appRoot.dataset.tab = tab;
  for (const button of document.querySelectorAll<HTMLButtonElement>("#tabs button")) {
    button.setAttribute("aria-selected", String(button.dataset.tab === tab));
  }
  for (const section of document.querySelectorAll<HTMLElement>(".tab")) {
    section.hidden = section.id !== `tab-${tab}`;
  }
  // Risk markers only while their list is visible, so they never get mistaken
  // for finds.
  if (tab !== "risiko") onMap(clearRisk);
  else riskPanel?.redrawMap();
}

for (const button of document.querySelectorAll<HTMLButtonElement>("#tabs button")) {
  button.addEventListener("click", () => {
    setTab(button.dataset.tab as Tab);
    writeHash();
  });
}

// --- shareable links (hash.ts) ---
function writeHash(species = speciesPanel?.selectedSlug ?? null): void {
  history.replaceState(null, "", formatHash(pin, (appRoot.dataset.tab as Tab) ?? "arter", species));
}
document.getElementById("about")?.addEventListener("click", () => openAbout(manifest));
renderGuide(document.getElementById("tab-guide") as HTMLElement);
const initial = parseHash(location.hash);
setTab(initial.tab ?? "arter");

// --- payload + panels ---
loadManifest()
  .then((m) => {
    manifest = m;
    speciesPanel = new SpeciesPanel(document.getElementById("tab-arter") as HTMLElement, m, {
      loadDoc: (s) => loadSpecies(s.file),
      onSelect: (doc, visible) => {
        const reframe = doc !== null && doc.slug !== framedSlug;
        framedSlug = doc?.slug ?? null;
        onMap((map) => {
          if (!doc) return clearObservations(map);
          showObservations(map, doc, visible);
          // Only when a species is opened, not on every toggle: zoom out just
          // enough to show its nearest find if none is in view.
          if (reframe) {
            const points = doc.observations.map(([lon, lat]): [number, number] => [lon, lat]);
            void cameraSettled.then(() => frameToNearest(map, points));
          }
        });
        writeHash(doc?.slug ?? null);
      },
    });
    if (initial.species) speciesPanel.selectBySlug(initial.species);
    riskPanel = new RiskPanel(document.getElementById("tab-risiko") as HTMLElement, m, {
      onItems: (p, radiusM, items) => {
        if (appRoot.dataset.tab === "risiko") onMap((map) => showRisk(map, p, radiusM, items));
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

const prefersReducedMotion = (): boolean =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function flyTo(center: [number, number], zoom: number): Promise<void> {
  return mapReady.then(({ map }) => {
    // flyTo({ duration: 0 }) NaNs the transform (Svampekortet lesson); jump instead.
    if (prefersReducedMotion()) {
      map.jumpTo({ center, zoom });
      return;
    }
    return new Promise<void>((resolve) => {
      map.once("moveend", () => resolve());
      map.flyTo({ center, zoom });
    });
  });
}

// --- map interaction: tap = pin, tap on a find = its details ---
const ATTACHMENT_TEXT: Record<string, string> = {
  attached: "fastsiddende",
  drift: "opskyllet",
  unknown: "ukendt om fastsiddende",
};

mapReady
  .then(({ map, geolocate, maplibregl }) => {
    geolocate.on("trackuserlocationstart", () => (geolocateActive = true));
    geolocate.on("trackuserlocationend", () => (geolocateActive = false));
    map.on("click", (e) => {
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
        new maplibregl.Popup({ closeButton: false })
          .setLngLat(e.lngLat)
          .setText(parts.join(" · "))
          .addTo(map);
        return;
      }
      if (geolocateActive) geolocate.trigger(); // the user picked a spot; stop following
      const { lng, lat } = e.lngLat;
      setPin([lng, lat], `Nål: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    });
    map.on("mouseenter", "observations", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "observations", () => (map.getCanvas().style.cursor = ""));
    geolocate.on("geolocate", (e) => {
      const { longitude, latitude } = (e as GeolocationPosition).coords;
      setPin(
        [longitude, latitude],
        `Min placering – ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
      );
    });
  })
  .catch((err) => console.error("map failed to load", err));

if (initial.pin) {
  const p = initial.pin;
  setPin(p, `Nål: ${p[1].toFixed(5)}, ${p[0].toFixed(5)}`);
  cameraSettled = flyTo(p, 12);
}

// A link pasted into an already-open tab only changes the hash; follow it.
// (writeHash uses history.replaceState, which does not fire this event.)
window.addEventListener("hashchange", () => {
  const next = parseHash(location.hash);
  if (next.tab) setTab(next.tab);
  if (next.pin) {
    const p = next.pin;
    setPin(p, `Nål: ${p[1].toFixed(5)}, ${p[0].toFixed(5)}`);
    cameraSettled = flyTo(p, 12);
  }
  if (next.species) speciesPanel?.selectBySlug(next.species);
});

// --- address autocomplete (Adressevælgeren), an ARIA combobox; from Svampekortet ---
const input = document.getElementById("q") as HTMLInputElement;
const results = document.getElementById("results") as HTMLUListElement;
let debounce: number | undefined;
let inFlight: AbortController | null = null;
let suggestions: AddressSuggestion[] = [];
let activeIndex = -1;

function closeResults(): void {
  results.replaceChildren();
  suggestions = [];
  activeIndex = -1;
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
}

function selectSuggestion(item: AddressSuggestion): void {
  const a = item.adgangsadresse;
  if (!a || typeof a.x !== "number" || typeof a.y !== "number") return;
  const target: [number, number] = [a.x, a.y];
  void mapReady.then(({ geolocate }) => {
    if (geolocateActive) geolocate.trigger();
  });
  setPin(target, item.tekst);
  void flyTo(target, 14);
  input.value = item.tekst;
  closeResults();
}

function highlight(next: number): void {
  const opts = [...results.children] as HTMLLIElement[];
  if (opts.length === 0) return;
  activeIndex = (next + opts.length) % opts.length;
  opts.forEach((li, i) => {
    const on = i === activeIndex;
    li.classList.toggle("is-active", on);
    li.setAttribute("aria-selected", String(on));
    if (on) {
      input.setAttribute("aria-activedescendant", li.id);
      li.scrollIntoView({ block: "nearest" });
    }
  });
}

input.addEventListener("input", () => {
  window.clearTimeout(debounce);
  debounce = window.setTimeout(runSearch, 250);
});

input.addEventListener("keydown", (e) => {
  if (results.children.length === 0) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    highlight(activeIndex + 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    highlight(activeIndex - 1);
  } else if (e.key === "Enter" && activeIndex >= 0) {
    e.preventDefault();
    selectSuggestion(suggestions[activeIndex]);
  } else if (e.key === "Escape") {
    closeResults();
  }
});

input.addEventListener("blur", () => window.setTimeout(closeResults, 150));

async function runSearch(): Promise<void> {
  inFlight?.abort();
  inFlight = new AbortController();
  let items: AddressSuggestion[] = [];
  try {
    items = await searchAddresses(input.value, inFlight.signal);
  } catch (err) {
    if ((err as Error).name !== "AbortError") console.error(err);
    return;
  }
  suggestions = items;
  activeIndex = -1;
  results.replaceChildren();
  items.forEach((item, i) => {
    const li = document.createElement("li");
    li.textContent = item.tekst;
    li.id = `addr-opt-${i}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");
    li.addEventListener("mousedown", (e) => e.preventDefault());
    li.addEventListener("click", () => selectSuggestion(item));
    results.appendChild(li);
  });
  input.setAttribute("aria-expanded", String(items.length > 0));
}

document.getElementById("search")?.addEventListener("submit", (e) => e.preventDefault());
// Address search needs Tangkortet's own Datafordeler key (web/.env.example);
// without one, hide the box rather than offer a search that never answers.
if (!import.meta.env.VITE_DATAFORDELER_API_KEY) {
  (document.getElementById("search") as HTMLElement).hidden = true;
}
