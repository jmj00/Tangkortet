// The "Luftfoto" button on the map: switches the basemap between the map
// (Skærmkort) and the aerial photo (map.ts). A toggle button with
// aria-pressed; its name stays "Luftfoto" whichever way it is set. The
// choice is remembered per device. Placed in the map's button column: on a
// phone a round icon button between "?" and "find me" (shell.css), on a
// desktop a small labelled button under the zoom buttons.

import type { IControl } from "maplibre-gl";

export type BasemapMode = "map" | "photo";

const STORAGE_KEY = "tangkortet.basemap";

/** Pure: a stored value as a mode; anything unexpected is the map (the
 * photo is never the default). */
export function parseBasemapMode(stored: string | null | undefined): BasemapMode {
  return stored === "photo" ? "photo" : "map";
}

export function readBasemapMode(): BasemapMode {
  try {
    return parseBasemapMode(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return "map";
  }
}

export function storeBasemapMode(mode: BasemapMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // private mode / blocked storage: the choice just doesn't persist
  }
}

// A framed landscape: the usual "photo" glyph.
const ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
  '<rect x="3" y="4.5" width="18" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
  '<circle cx="9" cy="9.5" r="1.8" fill="currentColor"/>' +
  '<path d="M4 18l5.5-5.5 3.5 3.5 2.5-2.5L20 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
  "</svg>";

export class BasemapControl implements IControl {
  private container: HTMLDivElement | null = null;
  private button: HTMLButtonElement | null = null;
  private photo: boolean;

  constructor(private readonly options: { photo: boolean; onToggle: (photo: boolean) => void }) {
    this.photo = options.photo;
  }

  onAdd(): HTMLElement {
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl maplibregl-ctrl-group basemap-ctrl";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "basemap-ctrl__button";
    button.innerHTML = `${ICON}<span class="basemap-ctrl__label">Luftfoto</span>`;
    button.addEventListener("click", () => this.options.onToggle(!this.photo));
    container.append(button);
    this.container = container;
    this.button = button;
    this.render();
    return container;
  }

  onRemove(): void {
    this.container?.remove();
    this.container = null;
    this.button = null;
  }

  setPhoto(photo: boolean): void {
    this.photo = photo;
    this.render();
  }

  private render(): void {
    if (!this.button) return;
    this.button.setAttribute("aria-pressed", String(this.photo));
    this.button.title = this.photo ? "Luftfoto er slået til – tryk for kortet" : "Vis luftfoto";
  }
}
