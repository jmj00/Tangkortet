// The map key ("Signaturforklaring"): explains whichever layers are on the map
// right now -- a species' finds (attached solid, washed-up as a ring, unknown
// faint), the risk markers by group with the dashed ring, and the pin. The
// layer code (layers.ts) pushes its state in through `legendFor(map).update()`;
// with nothing to explain it hides. Risk markers are only drawn on the Risiko
// tab, so the key follows the tab without knowing about it.
//
// A self-contained element inside the map container, placed from the shell's
// --map-inset-* properties (map.css): at the bottom left of the uncovered map,
// above the scale bar, in every layout -- opposite the locate button on a
// phone, away from the button column (top right) beside the sidebar. The line
// opens the full key. Framing the risk ring keeps clear of the key, open or
// closed (legendInsets); the key itself never moves the camera. Where the
// uncovered map is short (a phone at large text) the closed key is an icon.
// Adapted from Svampekortet 624fb8b (web/src/maplegend.ts, web/src/map.css).

import type maplibregl from "maplibre-gl";
import { mapInsets, type Padding } from "./camera";
import type { GroupKey } from "./risk";
import type { Attachment } from "./types";

export interface LegendFinds {
  /** The open species' name. */
  name: string;
  /** Its colour on the map (layers.ts algaeColor, per theme). */
  color: string;
  /** The kinds of find drawn now (the filter in the species sheet). */
  kinds: Attachment[];
}

export interface LegendRisk {
  radiusM: number;
  /** The groups with a marker inside the ring, in the list's order. */
  groups: { key: GroupKey; label: string; color: string }[];
}

/** One row of the coast section (coastmap.ts legendItems). */
export interface LegendCoastItem {
  key: string;
  label: string;
  color: string;
  /** The fill's edge colour, for a "fill" swatch. */
  edge?: string;
  style: "fill" | "line" | "dash" | "dots";
}

interface LegendState {
  finds: LegendFinds | null;
  risk: LegendRisk | null;
  /** The coast kinds drawn in view (zoom 13 and closer), or null. */
  coast: LegendCoastItem[] | null;
  /** The pin's colour, when a pin is set. */
  pin: string | null;
}

const STORAGE_KEY = "tangkortet.legend";

const KIND_TEXT: Record<Attachment, string> = {
  attached: "Fastsiddende",
  drift: "Opskyllet",
  unknown: "Ukendt om fastsiddende",
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function readStoredOpen(): boolean | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "open" ? true : stored === "closed" ? false : null;
  } catch {
    return null;
  }
}

function storeOpen(open: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, open ? "open" : "closed");
  } catch {
    // private mode / blocked storage: the choice just doesn't persist
  }
}

/** A find mark drawn the way the circle layer draws it. */
function findMark(kind: Attachment, color: string): HTMLElement {
  const mark = el("span", `map-key__dot map-key__dot--${kind}`);
  mark.style.setProperty("--c", color);
  mark.setAttribute("aria-hidden", "true");
  return mark;
}

function riskMark(color: string): HTMLElement {
  const mark = el("span", "map-key__dot map-key__dot--risk");
  mark.style.setProperty("--c", color);
  mark.setAttribute("aria-hidden", "true");
  return mark;
}

function coastMark(item: LegendCoastItem): HTMLElement {
  const mark = el("span", `map-key__coast map-key__coast--${item.style}`);
  mark.style.setProperty("--c", item.color);
  if (item.edge) mark.style.setProperty("--edge", item.edge);
  mark.setAttribute("aria-hidden", "true");
  return mark;
}

const km = (m: number): string => `${String(m / 1000).replace(".", ",")} km`;

/** Pure: the closed key's one-line description, for its accessible name. */
export function legendSummary(
  state: Pick<LegendState, "finds" | "risk"> & { coast?: LegendCoastItem[] | null },
): string {
  const parts: string[] = [];
  if (state.finds) parts.push(`fund af ${state.finds.name}`);
  if (state.risk) parts.push(`mulige kilder inden for ${km(state.risk.radiusM)}`);
  if (state.coast?.length) parts.push("kysten");
  if (parts.length > 2) return `${parts.slice(0, -1).join(", ")} og ${parts[parts.length - 1]}`;
  return parts.join(" og ");
}

export class MapLegend {
  private state: LegendState = { finds: null, risk: null, coast: null, pin: null };
  private readonly root: HTMLDivElement;
  private readonly toggle: HTMLButtonElement;
  private readonly summary: HTMLSpanElement;
  private readonly panel: HTMLDivElement;
  private open: boolean;

  constructor(map: maplibregl.Map) {
    this.root = el("div", "map-key");
    this.root.hidden = true;

    this.panel = el("div", "map-key__panel");
    this.panel.id = "map-key-panel";
    this.panel.setAttribute("role", "region");
    this.panel.setAttribute("aria-label", "Signaturforklaring");

    this.toggle = el("button", "map-key__toggle");
    this.toggle.type = "button";
    this.toggle.setAttribute("aria-controls", this.panel.id);
    this.summary = el("span", "map-key__summary");
    this.summary.setAttribute("aria-hidden", "true");
    const chevron = el("span", "map-key__chevron");
    chevron.setAttribute("aria-hidden", "true");
    const icon = el("span", "map-key__icon");
    icon.setAttribute("aria-hidden", "true");
    this.toggle.append(
      icon,
      this.summary,
      el("span", "map-key__name", "Signaturforklaring"),
      chevron,
    );

    // Open by default only where it leaves the map room: a tall desktop.
    const roomy = window.matchMedia?.("(min-width: 720px) and (min-height: 800px)").matches;
    this.open = readStoredOpen() ?? roomy ?? false;
    this.toggle.addEventListener("click", () => {
      this.setOpen(!this.open);
      storeOpen(this.open);
    });
    // Escape inside the key folds it and leaves the focus on its line.
    this.root.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !this.open) return;
      e.stopPropagation();
      this.setOpen(false);
      storeOpen(false);
      this.toggle.focus();
    });

    this.root.append(this.panel, this.toggle);
    this.applyOpen();
    map.getContainer().append(this.root);
    this.trackRoom(map);
  }

  /** A phone's uncovered map under this height gets the icon-only key. */
  static readonly COMPACT_BELOW_PX = 300;

  /** Icon-only while the uncovered map is short (the sheet half open on a
   * small phone at large text), so the closed key covers little of it. */
  private trackRoom(map: maplibregl.Map): void {
    const phone = window.matchMedia?.(
      "(max-width: 559.98px), (max-width: 719.98px) and (min-height: 520.02px)",
    );
    const apply = (): void => {
      const pad = mapInsets(map);
      const free = map.getContainer().clientHeight - pad.top - pad.bottom;
      const compact = Boolean(phone?.matches) && free < MapLegend.COMPACT_BELOW_PX;
      if ((this.root.dataset.compact === "true") !== compact)
        this.root.dataset.compact = String(compact);
    };
    apply();
    map.on("resize", apply);
    // the sheet moving (sheet.ts sets --map-inset-bottom on #app)
    const app = map.getContainer().parentElement;
    if (app) new MutationObserver(apply).observe(app, { attributes: true });
  }

  /** The key's box in map-container pixels, open or closed. */
  box(): { left: number; top: number; right: number; bottom: number } | null {
    // Hidden (nothing drawn yet, e.g. a ring framed before its markers
    // arrive): where its closed line will be, measured unseen, at least as
    // wide as a closed line with marks usually is.
    const hidden = this.root.hidden;
    if (hidden) {
      this.root.style.visibility = "hidden";
      this.root.hidden = false;
    }
    const measured = this.root.getBoundingClientRect();
    if (hidden) {
      this.root.hidden = true;
      this.root.style.visibility = "";
    }
    const compact = this.root.dataset.compact === "true";
    const box = {
      left: measured.left,
      top: hidden ? measured.bottom - 44 : measured.top,
      right: hidden && !compact ? Math.max(measured.right, measured.left + 170) : measured.right,
      bottom: measured.bottom,
    };
    if (measured.width === 0 && !hidden) return null;
    const map = this.root.parentElement?.getBoundingClientRect();
    if (!map) return null;
    return {
      left: box.left - map.left,
      top: box.top - map.top,
      right: box.right - map.left,
      bottom: box.bottom - map.top,
    };
  }

  update(patch: Partial<LegendState>): void {
    this.state = { ...this.state, ...patch };
    this.render();
  }

  /** Redraw (after a theme change the callers have pushed new colours). */
  refresh(): void {
    this.render();
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.applyOpen();
  }

  private applyOpen(): void {
    this.root.dataset.open = String(this.open);
    this.toggle.setAttribute("aria-expanded", String(this.open));
    this.panel.hidden = !this.open;
  }

  private render(): void {
    const { finds, risk, coast, pin } = this.state;
    // The pin alone needs no key.
    this.root.hidden = !finds && !risk && !coast?.length;
    this.panel.replaceChildren();
    this.summary.replaceChildren();
    if (this.root.hidden) return;

    if (finds) {
      this.panel.append(this.findsSection(finds));
      // each mark kept with its word when the line wraps (large text)
      for (const kind of finds.kinds.filter((k) => k !== "unknown")) {
        const pair = el("span", "map-key__summary-group");
        pair.append(
          findMark(kind, finds.color),
          el("span", undefined, KIND_TEXT[kind].toLowerCase()),
        );
        this.summary.append(pair);
      }
    }
    if (risk) {
      this.panel.append(this.riskSection(risk, pin));
      const group = el("span", "map-key__summary-group");
      for (const g of risk.groups.slice(0, 4)) group.append(riskMark(g.color));
      // "none drawn", never "none": soil and streams count in the verdict but
      // are not drawn as points
      group.append(el("span", undefined, risk.groups.length ? "kilder" : "ingen punkter"));
      this.summary.append(group);
    } else if (pin) {
      this.panel.append(this.pinSection(pin));
    }
    if (coast?.length) {
      this.panel.append(this.coastSection(coast));
      const group = el("span", "map-key__summary-group");
      for (const item of coast.slice(0, 3)) group.append(coastMark(item));
      group.append(el("span", undefined, "kyst"));
      this.summary.append(group);
    }
    this.toggle.setAttribute("aria-label", `Signaturforklaring: ${legendSummary(this.state)}`);
  }

  private findsSection(finds: LegendFinds): HTMLElement {
    const section = el("section", "map-key__section");
    section.append(el("h3", "map-key__title", `Fund af ${finds.name}`));
    const list = el("ul", "map-key__list");
    for (const kind of finds.kinds) {
      const row = el("li", "map-key__row");
      row.append(findMark(kind, finds.color), el("span", undefined, KIND_TEXT[kind]));
      list.append(row);
    }
    if (finds.kinds.length === 0) {
      list.append(el("li", "map-key__row", "Ingen fund vist – se filteret i artens side."));
    }
    section.append(list, el("p", "map-key__hint", "Tryk på et fund for år og dybde."));
    return section;
  }

  private riskSection(risk: LegendRisk, pin: string | null): HTMLElement {
    const section = el("section", "map-key__section");
    section.append(el("h3", "map-key__title", "Mulige kilder"));
    const list = el("ul", "map-key__list");
    for (const g of risk.groups) {
      const row = el("li", "map-key__row");
      row.append(riskMark(g.color), el("span", undefined, g.label));
      list.append(row);
    }
    if (risk.groups.length === 0) {
      list.append(
        el(
          "li",
          "map-key__row map-key__none",
          "Ingen kilder vist som punkter i ringen – se listen for jord og vandløb",
        ),
      );
    }
    const around = el("ul", "map-key__list");
    if (pin) around.append(this.pinRow(pin));
    const ring = el("li", "map-key__row");
    const ringMark = el("span", "map-key__ring");
    ringMark.setAttribute("aria-hidden", "true");
    if (pin) ringMark.style.setProperty("--c", pin);
    ring.append(ringMark, el("span", undefined, `Søgeradius, ${km(risk.radiusM)}`));
    around.append(ring);
    section.append(list, around);
    return section;
  }

  private coastSection(items: LegendCoastItem[]): HTMLElement {
    const section = el("section", "map-key__section");
    section.append(el("h3", "map-key__title", "Kysten"));
    const list = el("ul", "map-key__list");
    for (const item of items) {
      const row = el("li", "map-key__row");
      row.append(coastMark(item), el("span", undefined, item.label));
      list.append(row);
    }
    section.append(list, el("p", "map-key__hint", "OpenStreetMap – kan være ufuldstændigt."));
    return section;
  }

  private pinSection(pin: string): HTMLElement {
    const section = el("section", "map-key__section");
    const list = el("ul", "map-key__list");
    list.append(this.pinRow(pin));
    section.append(list);
    return section;
  }

  private pinRow(pin: string): HTMLElement {
    const row = el("li", "map-key__row");
    const mark = el("span", "map-key__pin");
    mark.setAttribute("aria-hidden", "true");
    mark.style.setProperty("--c", pin);
    row.append(mark, el("span", undefined, "Nålen – det sted, du ser på"));
    return row;
  }
}

const legends = new WeakMap<maplibregl.Map, MapLegend>();

/** The map's key, created on first use. */
export function legendFor(map: maplibregl.Map): MapLegend {
  let legend = legends.get(map);
  if (!legend) {
    legend = new MapLegend(map);
    legends.set(map, legend);
  }
  return legend;
}

/**
 * `pad` (camera.ts mapInsets) widened so a frame keeps clear of the open key
 * at the bottom left: either from the left or from the bottom, whichever
 * leaves the larger square for the frame (a ring fits a square). Unchanged
 * while the key is closed or hidden.
 */
export function legendInsets(map: maplibregl.Map, pad: Padding): Padding {
  const box = legendFor(map).box();
  if (!box) return pad;
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  return clearOfBox(pad, box, w, h);
}

/** Pure: the two ways round a box in the bottom-left corner; the one that
 * leaves the larger square wins. */
export function clearOfBox(
  pad: Padding,
  box: { right: number; top: number },
  w: number,
  h: number,
  gap = 8,
): Padding {
  const fromLeft = { ...pad, left: Math.max(pad.left, Math.ceil(box.right + gap)) };
  const fromBottom = { ...pad, bottom: Math.max(pad.bottom, Math.ceil(h - box.top + gap)) };
  const side = (p: Padding): number => Math.min(w - p.left - p.right, h - p.top - p.bottom);
  return side(fromLeft) >= side(fromBottom) ? fromLeft : fromBottom;
}
