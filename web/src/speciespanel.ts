// "Arter" tab: the species list (search, group chips, sorted by finds near the
// pin once one is set) and a species sheet with its safety structure:
// "Vigtigt" first, then Fund, Høst, Ophobning og sikkerhed, Forveksling, Kilder.
//
// The list frame (search field, chips, rows) is built once and kept, so a
// keystroke or a new pin only patches it: the search field keeps its focus and
// caret, and "back" returns to the same filter. Structure and states follow
// Svampekortet's specieslist.ts / detail.ts / panel.ts (624fb8b).

import "./species.css";

import { forgetPendingSpecies } from "./data";
import { h, extLink } from "./dom";
import {
  filterSpecies,
  findsNear,
  GROUP_PLURAL,
  GROUPS,
  groupLabel,
  isActiveQuery,
  licenseName,
  NEAR_PIN_M,
  groupCounts,
  sheetModel,
  sortByNear,
  SpeciesSelection,
  type SelectionView,
  type FieldText,
  type SheetModel,
} from "./species";
import { shownName } from "./types";
import type { Attachment, Manifest, SpeciesDoc, SpeciesSummary } from "./types";

const STATUS_LABEL: Record<FieldText["status"], string | null> = {
  expert: null,
  provisional: "Foreløbig",
  data: "Fra fund – afventer ekspert",
  pending: null,
};

const ATTACHMENT_LABEL: Record<Attachment, string> = {
  attached: "Fastsiddende",
  drift: "Opskyllet",
  unknown: "Ukendt",
};

const ATTACHMENT_HELP: Record<Attachment, string> = {
  attached: "Fund med dybde, fra dykning eller beskrevet som fastsiddende.",
  drift:
    "Opskyllet tang, typisk efter storm. Et tegn på, at arten sandsynligvis gror i nærheden – men den kan også være drevet langvejs fra.",
  unknown: "Fundet beskriver ikke, om tangen sad fast. Gælder de fleste nyere strandfund.",
};

const ATTACHMENTS: Attachment[] = ["attached", "drift", "unknown"];

/** Sources listed before the rest fold away under "Vis … flere". */
const SOURCES_SHOWN = 5;

const NUMBER = new Intl.NumberFormat("da-DK");

// 20x20 line icons, drawn in the current text colour (static markup).
const ICONS = {
  search:
    '<circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m13 13 4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  pin: '<path d="M10 18.2s5.6-5.4 5.6-9.7a5.6 5.6 0 0 0-11.2 0c0 4.3 5.6 9.7 5.6 9.7Z" fill="currentColor"/><circle cx="10" cy="8.4" r="2.1" fill="var(--surface)"/>',
  chevron:
    '<path d="m8 4 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  back: '<path d="M12.5 4 6.5 10l6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  alert:
    '<path d="M10 2.8 18.4 17H1.6L10 2.8Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M10 8v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="10" cy="14.4" r="1" fill="currentColor"/>',
  info: '<circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 9v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="10" cy="6.3" r="1" fill="currentColor"/>',
  seaweed:
    '<path d="M10 18c0-4-3-5.5-3-9s2-5 2-6.5M10 18c0-3 3-4 3-7.5S11 6 12.5 3.5M10 18c-.5-2-3.5-2.5-4.5-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  offline:
    '<path d="M2.5 7.5a11 11 0 0 1 15 0M5 10.4a7.2 7.2 0 0 1 10 0M7.6 13.2a3.4 3.4 0 0 1 4.8 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="m3 3 14 14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
} as const;

function icon(name: keyof typeof ICONS, className: string): HTMLSpanElement {
  const span = h("span", { class: className, "aria-hidden": "true" });
  span.innerHTML = `<svg viewBox="0 0 20 20" width="20" height="20" focusable="false">${ICONS[name]}</svg>`;
  return span;
}

function dot(group: string): HTMLSpanElement {
  return h("span", { class: "spp-dot", "data-group": group, "aria-hidden": "true" });
}

export interface SpeciesPanelHooks {
  /** Called on open/close and when the visible find types change. */
  onSelect(doc: SpeciesDoc | null, visible: Set<Attachment>): void;
  loadDoc(summary: SpeciesSummary): Promise<SpeciesDoc>;
}

const DENSITIES = ["full", "compact", "tiny"] as const;
type Density = (typeof DENSITIES)[number];

interface RowRefs {
  li: HTMLLIElement;
  button: HTMLButtonElement;
  meta: HTMLElement;
}

export class SpeciesPanel {
  private pin: [number, number] | null = null;
  private readonly sel: SpeciesSelection<SpeciesSummary, SpeciesDoc>;
  private visible = new Set<Attachment>(ATTACHMENTS);
  /** Row to return focus to on the way back to the list: the one the user opened. */
  private returnSlug: string | null = null;
  private listScroll = 0;
  /** The near-pin line of the open sheet, patched when the pin moves. */
  private nearLine: HTMLElement | null = null;

  // list state and frame
  private query = "";
  private group: string | null = null;
  private readonly rows = new Map<string, RowRefs>();
  private readonly listRoot = h("div", { class: "spp spp-list" });
  private readonly search = h("input", {
    class: "spp-search__input",
    type: "search",
    placeholder: "Søg art, fx søl",
    "aria-label": "Søg i artslisten",
    autocomplete: "off",
    spellcheck: "false",
    enterkeyhint: "search",
  });
  private readonly chips = h("div", {
    class: "spp-chips",
    role: "group",
    "aria-label": "Filtrér efter algegruppe",
  });
  private readonly count = h("p", { class: "spp-count", "aria-live": "polite", tabindex: "-1" });
  private readonly sortNote = h("span", { class: "spp-sort-note" });
  private readonly reset = h("button", { type: "button", class: "spp-reset" }, "Nulstil");
  private readonly hint = h("p", { class: "spp-hint" });
  private readonly results = h("div", { class: "spp-results" });

  constructor(
    private root: HTMLElement,
    private manifest: Manifest,
    private hooks: SpeciesPanelHooks,
  ) {
    this.sel = new SpeciesSelection<SpeciesSummary, SpeciesDoc>({
      loadDoc: (s) => this.hooks.loadDoc(s),
      onSelect: (doc) => this.hooks.onSelect(doc, this.visible),
      render: (view, prev, user) => this.renderView(view, prev, user),
      isOffline: () => navigator.onLine === false,
      onTimeout: (s) => forgetPendingSpecies(s.file),
    });
    this.buildFrame();
    this.renderView({ kind: "list" }, { kind: "list" }, false);

    // Scroll events do not bubble; listen in the capture phase so this works
    // whichever ancestor is the scroller. The sticky back bar gets a hairline
    // once the page has scrolled under it.
    document.addEventListener(
      "scroll",
      (e) => {
        if (e.target instanceof Element && e.target.contains(this.root)) {
          this.root.toggleAttribute("data-spp-scrolled", e.target.scrollTop > 4);
        }
      },
      { capture: true, passive: true },
    );
    // Sheet height, the scroller's padding and the text size all change the
    // layout: re-measure when the scroller resizes.
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => this.measure()).observe(this.scroller());
    }
    // Escape steps back, but only within this tab (no global listener).
    this.root.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.defaultPrevented || this.sel.view.kind === "list") return;
      e.preventDefault();
      e.stopPropagation();
      this.sel.back();
    });
    // A page that failed while offline is fetched again on reconnect.
    window.addEventListener("online", () => this.sel.retry(false));
  }

  setPin(pin: [number, number], allDocs: SpeciesDoc[]): void {
    this.pin = pin;
    this.sel.addDocs(allDocs); // may turn a loading/error page into the species page
    const view = this.sel.view;
    if (view.kind === "list") this.refreshList();
    else if (view.kind === "sheet") this.patchNear(view.doc);
  }

  /** Slug of the open species (also while it loads or failed), or null on the list. */
  get selectedSlug(): string | null {
    const view = this.sel.view;
    return view.kind === "list" ? null : view.summary.slug;
  }

  /** Close the species page as "Alle arter" does: back to the list, map
   * selection cleared, focus and scroll restored. No-op on the list. For the
   * shell (the browser/phone back button). */
  closeDetail(): void {
    if (this.sel.view.kind === "list") return;
    // Called for the browser's back button, perhaps while the map has focus:
    // only take focus to the row if it was in the panel already.
    this.sel.home(this.root.contains(document.activeElement));
  }

  selectBySlug(slug: string): void {
    const summary = this.manifest.species.find((s) => s.slug === slug);
    // From a link: move focus only if the user is already working in the panel.
    const user = this.root.contains(document.activeElement);
    if (summary) void this.sel.open(summary, { user, via: "list" });
  }

  /** The element that scrolls the tab: the panel root or its nearest scrolling ancestor. */
  private scroller(): HTMLElement {
    for (let el: HTMLElement | null = this.root; el; el = el.parentElement) {
      const overflow = getComputedStyle(el).overflowY;
      if (overflow === "auto" || overflow === "scroll") return el;
    }
    return this.root;
  }

  /** Hand the scroller's padding to the sticky bar and the fade (so they reach
   * its edges whatever padding the shell uses), and pick the list density
   * from the height actually available. */
  private measure(): void {
    const scroller = this.scroller();
    const boxes = scroller === this.root ? [scroller] : [scroller, this.root];
    const pad = (side: "paddingTop" | "paddingBottom" | "paddingLeft") =>
      boxes.reduce((sum, el) => sum + (parseFloat(getComputedStyle(el)[side]) || 0), 0);
    const node = this.root.querySelector<HTMLElement>(":scope > .spp");
    if (node) {
      node.style.setProperty("--spp-pad-top", `${pad("paddingTop")}px`);
      node.style.setProperty("--spp-pad-bottom", `${pad("paddingBottom")}px`);
      node.style.setProperty("--spp-pad-x", `${pad("paddingLeft")}px`);
    }
    this.chooseDensity(scroller.clientHeight - pad("paddingTop") - pad("paddingBottom"));
  }

  /** The richest list density whose toolbar still leaves room for about two
   * rows: "full", then "compact" (no hint, tighter), then "tiny" (no chips
   * either; typing a group's name still works). Measured, so text size and
   * sheet height both count. Going back to a richer density needs some spare
   * room (hysteresis), so dragging the sheet across a threshold does not make
   * the toolbar jump back and forth. */
  private chooseDensity(room = this.listRoom()): void {
    if (!this.listRoot.isConnected || room <= 0) return;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const toolbar = this.listRoot.querySelector<HTMLElement>(".spp-toolbar");
    if (!toolbar) return;
    const current = DENSITIES.indexOf(this.listRoot.dataset.density as Density);
    let pick: Density = "tiny";
    for (const [i, density] of DENSITIES.entries()) {
      this.listRoot.dataset.density = density;
      const row = this.listRoot.querySelector<HTMLElement>(".spp-row");
      const need = toolbar.offsetHeight + 2 * (row?.offsetHeight || 3 * rem);
      const spare = current >= 0 && i < current ? 1.5 * rem : 0;
      if (need + spare <= room) {
        pick = density;
        break;
      }
    }
    this.listRoot.dataset.density = pick;
  }

  private listRoom(): number {
    const scroller = this.scroller();
    const style = getComputedStyle(scroller);
    return (
      scroller.clientHeight -
      (parseFloat(style.paddingTop) || 0) -
      (parseFloat(style.paddingBottom) || 0)
    );
  }

  private renderView(
    view: SelectionView<SpeciesSummary, SpeciesDoc>,
    prev: SelectionView<SpeciesSummary, SpeciesDoc>,
    user: boolean,
  ): void {
    const scroller = this.scroller();
    if (prev.kind === "list" && this.listRoot.isConnected) this.listScroll = scroller.scrollTop;
    // Focus inside the page being replaced (its heading, "Prøv igen", "back")
    // moves to the new page's heading instead of being lost.
    const hadFocus = prev.kind !== "list" && this.root.contains(document.activeElement);
    this.nearLine = null;

    if (view.kind === "list") {
      this.root.replaceChildren(this.listRoot);
      this.refreshList();
      this.measure();
      scroller.scrollTop = this.listScroll;
      if (prev.kind !== "list") {
        if (user || hadFocus) {
          const target =
            this.rows.get(this.returnSlug ?? "")?.button ??
            this.rows.get(prev.summary.slug)?.button;
          (target ?? this.search).focus({ preventScroll: true });
          target?.scrollIntoView({ block: "nearest" });
        }
        this.returnSlug = null;
      }
      return;
    }
    const sheet =
      view.kind === "sheet"
        ? this.sheet(view.summary, view.doc)
        : view.kind === "loading"
          ? this.placeholder(view.summary, "loading")
          : this.placeholder(view.summary, view.offline ? "offline" : "error");
    this.root.replaceChildren(sheet);
    this.measure();
    scroller.scrollTop = 0;
    if (user || hadFocus) {
      sheet.querySelector<HTMLElement>(".spp-title")?.focus({ preventScroll: true });
    }
  }

  // --- list ----------------------------------------------------------------

  private buildFrame(): void {
    this.search.addEventListener("input", () => {
      this.query = this.search.value;
      this.refreshList();
    });

    for (const group of GROUPS) {
      const n = this.manifest.species.filter((s) => s.group === group).length;
      if (n === 0) continue;
      const chip = h(
        "button",
        { type: "button", class: "spp-chip", "data-group": group, "aria-pressed": "false" },
        dot(group),
        h("span", {}, GROUP_PLURAL[group] ?? group),
        h("span", { class: "spp-chip__n" }, n),
      );
      chip.addEventListener("click", () => {
        this.group = this.group === group ? null : group;
        this.refreshList();
      });
      this.chips.append(chip);
    }

    this.reset.addEventListener("click", () => this.resetFilters());
    this.hint.append(
      icon("pin", "spp-hint__icon"),
      h("span", {}, "Sæt en nål ved kysten for at se arter i nærheden."),
    );

    this.listRoot.append(
      h("h2", { class: "sr-only" }, "Arter"),
      h(
        "div",
        { class: "spp-toolbar" },
        h("div", { class: "spp-search" }, icon("search", "spp-search__icon"), this.search),
        this.chips,
        h("div", { class: "spp-status" }, this.count, this.reset, this.sortNote),
        this.hint,
      ),
      this.results,
      h("div", { class: "spp-fade", "aria-hidden": "true" }),
    );
  }

  private resetFilters(): void {
    this.query = "";
    this.search.value = "";
    this.group = null;
    this.refreshList();
    // The pressed button may be gone; with a mouse or keyboard go to the search
    // field, on a touch screen the count line (no keyboard popping up).
    const fine = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? true;
    (fine ? this.search : this.count).focus({ preventScroll: !fine });
  }

  private nearCounts(): Map<string, number> | null {
    if (!this.pin) return null;
    const near = new Map<string, number>();
    for (const s of this.manifest.species) {
      const doc = this.sel.doc(s.slug);
      if (doc) near.set(s.slug, findsNear(doc, this.pin).total);
    }
    return near;
  }

  private refreshList(): void {
    const near = this.nearCounts();
    const matched = sortByNear(filterSpecies(this.manifest.species, this.query, this.group), near);
    const total = this.manifest.species.length;
    const filtered = isActiveQuery(this.query) || this.group !== null;

    for (const chip of this.chips.querySelectorAll<HTMLButtonElement>(".spp-chip")) {
      chip.setAttribute("aria-pressed", String(chip.dataset.group === this.group));
    }
    this.count.textContent = filtered ? `${matched.length} af ${total} arter` : `${total} arter`;
    // With a pin the order is "most finds near the pin first": said beside the count
    // (outside the live region, so typing does not repeat it).
    this.sortNote.textContent = near
      ? `Flest fund inden for ${NEAR_PIN_M / 1000} km af nålen først`
      : "";
    this.sortNote.hidden = !near;

    // Chip counts follow the search, so a chip never promises rows that are not there.
    const inQuery = groupCounts(this.manifest.species, this.query);
    for (const chip of this.chips.querySelectorAll<HTMLButtonElement>(".spp-chip")) {
      const n = inQuery.get(chip.dataset.group ?? "") ?? 0;
      const label = chip.querySelector(".spp-chip__n");
      if (label) label.textContent = String(n);
      chip.toggleAttribute("data-empty", n === 0);
    }
    this.reset.hidden = !filtered;

    // Without a pin: how to get the near-pin order (hidden on short sheets,
    // where the shell's own line already says to tap the map).
    this.hint.hidden = near !== null || matched.length === 0;

    if (matched.length === 0) {
      this.results.replaceChildren(this.emptyState());
      return;
    }
    const list = h("ul", { class: "spp-rows" });
    for (const s of matched) {
      const refs = this.row(s);
      this.patchRow(refs, s, near);
      list.append(refs.li);
    }
    this.chooseDensity();
    // Re-parenting a focused row blurs it; put focus back.
    const focused = document.activeElement;
    this.results.replaceChildren(list);
    if (focused instanceof HTMLElement && focused !== document.activeElement) {
      if (list.contains(focused)) focused.focus({ preventScroll: true });
    }
  }

  private emptyState(): HTMLElement {
    const q = isActiveQuery(this.query) ? this.query.trim() : "";
    const button = h("button", { type: "button", class: "spp-empty__reset" }, "Vis alle arter");
    button.addEventListener("click", () => this.resetFilters());
    const groupName = this.group ? (GROUP_PLURAL[this.group] ?? this.group).toLowerCase() : "";
    return h(
      "div",
      { class: "spp-empty" },
      icon("seaweed", "spp-empty__icon"),
      h(
        "p",
        { class: "spp-empty__title" },
        q ? `Ingen ${groupName || "arter"} matcher „${q}“` : "Ingen arter matcher filteret",
      ),
      h("p", { class: "spp-empty__hint" }, "Prøv fx søl, sukkertang eller brunalge."),
      button,
    );
  }

  private row(s: SpeciesSummary): RowRefs {
    const existing = this.rows.get(s.slug);
    if (existing) return existing;
    const meta = h("span", { class: "spp-row__meta" });
    const button = h(
      "button",
      { type: "button", class: "spp-row", "data-slug": s.slug },
      dot(s.group),
      h(
        "span",
        { class: "spp-row__text" },
        h(
          "span",
          { class: "spp-row__name" },
          h("span", { class: s.danish_name ? "" : "spp-sci" }, shownName(s)),
          s.invasive ? h("span", { class: "spp-tag spp-tag--invasive" }, "Invasiv") : null,
        ),
        h(
          "span",
          { class: "spp-row__sub" },
          s.danish_name ? h("span", { class: "spp-sci" }, s.scientific_name) : "Intet dansk navn",
          h("span", { class: "sr-only" }, `, ${s.group},`),
        ),
      ),
      meta,
      icon("chevron", "spp-row__chevron"),
    );
    button.addEventListener("click", () => {
      this.returnSlug = s.slug;
      void this.sel.open(s, { user: true, via: "list" });
    });
    const refs = { li: h("li", {}, button), button, meta };
    this.rows.set(s.slug, refs);
    return refs;
  }

  private patchRow(refs: RowRefs, s: SpeciesSummary, near: Map<string, number> | null): void {
    const n = near?.get(s.slug);
    if (n === undefined) {
      refs.meta.replaceChildren(
        h("span", { class: "spp-row__total" }, `${NUMBER.format(s.observation_count)} fund`),
      );
      return;
    }
    refs.meta.replaceChildren(
      h(
        "span",
        { class: n > 0 ? "spp-row__near" : "spp-row__near spp-row__near--none" },
        `${NUMBER.format(n)} nær`,
        h("span", { class: "sr-only" }, " nålen,"),
      ),
      h("span", { class: "spp-row__total" }, `${NUMBER.format(s.observation_count)} i alt`),
    );
  }

  // --- species sheet -------------------------------------------------------

  /** Back button + heading, shared by the sheet and its loading/error states.
   * `verified` is null while the species document is not there yet. */
  private head(summary: SpeciesSummary, verified: boolean | null, lookalikes = 0): HTMLElement[] {
    // Opened from a lookalike: "back" goes one step, and "Alle arter" sits beside it.
    const from = this.sel.trail[this.sel.trail.length - 1];
    const back = h(
      "button",
      { type: "button", class: "spp-back" },
      icon("back", "spp-back__icon"),
      h(
        "span",
        { class: "spp-back__label" },
        from ? `Tilbage til ${shownName(from)}` : "Alle arter",
      ),
    );
    back.addEventListener("click", () => this.sel.back());
    let home: HTMLButtonElement | null = null;
    if (from) {
      home = h("button", { type: "button", class: "spp-home" }, "Alle arter");
      home.addEventListener("click", () => this.sel.home());
    }

    const unverified = verified === false && summary.danish_name !== "";
    const tags = [
      summary.invasive ? h("li", { class: "spp-tag spp-tag--invasive" }, "Invasiv art") : null,
      unverified ? h("li", { class: "spp-tag spp-tag--provisional" }, "Navn ikke bekræftet") : null,
    ].filter((x): x is HTMLLIElement => x !== null);
    if (lookalikes > 0) {
      // Forveksling sits low on a long page; this takes you there.
      const jump = h(
        "button",
        { type: "button", class: "spp-tag spp-tag--jump" },
        `Kan forveksles med ${lookalikes} ${lookalikes === 1 ? "art" : "arter"}`,
        h("span", { "aria-hidden": "true" }, "↓"),
      );
      jump.addEventListener("click", () => {
        const target = this.root.querySelector<HTMLElement>("#spp-sec-lookalikes");
        if (!target) return;
        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
        target.focus({ preventScroll: true });
      });
      tags.push(h("li", {}, jump));
    }

    return [
      h("div", { class: "spp-nav" }, back, home),
      h(
        "header",
        { class: "spp-head" },
        h(
          "h2",
          {
            class: summary.danish_name ? "spp-title" : "spp-title spp-sci",
            id: `spp-title-${summary.slug}`,
            tabindex: "-1",
          },
          shownName(summary),
        ),
        h(
          "p",
          { class: "spp-subtitle" },
          dot(summary.group),
          summary.danish_name
            ? h("span", { class: "spp-sci" }, summary.scientific_name)
            : h("span", {}, "Intet dansk navn"),
          h("span", { class: "spp-subtitle__sep", "aria-hidden": "true" }, "·"),
          h("span", {}, groupLabel(summary.group)),
        ),
        tags.length ? h("ul", { class: "spp-tags" }, ...tags) : null,
        unverified
          ? h("p", { class: "spp-name-note" }, "Navnet er ikke bekræftet mod arter.dk.")
          : null,
      ),
    ];
  }

  private article(summary: SpeciesSummary, ...children: (HTMLElement | null)[]): HTMLElement {
    return h(
      "article",
      { class: "spp spp-sheet", "aria-labelledby": `spp-title-${summary.slug}` },
      ...children,
    );
  }

  private placeholder(
    summary: SpeciesSummary,
    state: "loading" | "error" | "offline",
  ): HTMLElement {
    let body: HTMLElement;
    if (state === "loading") {
      body = h(
        "div",
        { class: "spp-state spp-state--loading", role: "status" },
        h("span", { class: "spp-state__pulse", "aria-hidden": "true" }),
        h("p", { class: "spp-state__title" }, "Henter artsdata…"),
      );
    } else {
      const retry = h("button", { type: "button", class: "spp-btn" }, "Prøv igen");
      retry.addEventListener("click", () => this.sel.retry());
      body = h(
        "div",
        { class: `spp-state spp-state--${state}`, role: "alert" },
        icon(state === "offline" ? "offline" : "alert", "spp-state__icon"),
        h(
          "p",
          { class: "spp-state__title" },
          state === "offline" ? "Du er offline" : "Arten kunne ikke hentes",
        ),
        h(
          "p",
          { class: "spp-state__text" },
          state === "offline"
            ? "Artens side er ikke gemt på enheden endnu. Den hentes, så snart du er online igen."
            : "Tjek forbindelsen og prøv igen.",
        ),
        retry,
      );
    }
    return this.article(summary, ...this.head(summary, null), body);
  }

  private sheet(summary: SpeciesSummary, doc: SpeciesDoc): HTMLElement {
    const m = sheetModel(doc, this.manifest.species, this.pin);
    return this.article(
      summary,
      ...this.head(summary, doc.danish_name_verified, m.lookalikes.length),
      m.warnings.length
        ? h(
            "section",
            { class: "spp-warn", role: "note", "aria-labelledby": "spp-warn-title" },
            icon("alert", "spp-warn__icon"),
            h(
              "div",
              { class: "spp-warn__body" },
              h("h3", { class: "spp-warn__title", id: "spp-warn-title" }, "Vigtigt"),
              ...m.warnings.map((w) => h("p", {}, w)),
            ),
          )
        : null,
      this.findsSection(doc, m),
      this.section(
        "Høst",
        "spp-sec-harvest",
        h(
          "dl",
          { class: "spp-fields" },
          ...this.field("Dybde", m.harvest.depth),
          ...this.field("Høstmetode", m.harvest.method),
          ...this.field("Bedste sæson", m.harvest.season),
        ),
      ),
      this.section(
        "Ophobning og sikkerhed",
        "spp-sec-accumulation",
        h("dl", { class: "spp-fields" }, ...this.field("Ophobning", m.accumulation)),
        h(
          "p",
          { class: "spp-info" },
          icon("info", "spp-info__icon"),
          h(
            "span",
            {},
            "Tang kan ophobe arsen, cadmium og jod forskelligt alt efter art, voksested og sæson.",
          ),
        ),
      ),
      m.lookalikes.length ? this.lookalikesSection(m) : null,
      this.sourcesSection(doc, m),
    );
  }

  private section(title: string, id: string, ...children: (HTMLElement | null)[]): HTMLElement {
    return h(
      "section",
      { class: "spp-sec", "aria-labelledby": id },
      h("h3", { class: "spp-sec__title", id, tabindex: "-1" }, title),
      ...children,
    );
  }

  private field(label: string, value: FieldText): HTMLElement[] {
    const badge = STATUS_LABEL[value.status];
    return [
      h(
        "dt",
        {},
        h("span", {}, label),
        badge ? h("span", { class: `spp-tag spp-tag--${value.status}` }, badge) : null,
      ),
      h("dd", { class: value.status === "pending" ? "spp-pending" : "" }, value.text),
    ];
  }

  private nearText(doc: SpeciesDoc): string {
    if (!this.pin) return "Sæt en nål ved kysten for at se fund i nærheden.";
    const near = findsNear(doc, this.pin);
    if (near.total === 0) return `Ingen fund inden for ${NEAR_PIN_M / 1000} km af nålen.`;
    return `Inden for ${NEAR_PIN_M / 1000} km af nålen: ${near.attached} fastsiddende, ${near.drift} opskyllede, ${near.unknown} ukendte.`;
  }

  private patchNear(doc: SpeciesDoc): void {
    const line = this.nearLine;
    if (!line) return;
    line.dataset.pinned = String(this.pin !== null);
    const text = line.lastElementChild;
    if (text) text.textContent = this.nearText(doc);
  }

  private findsSection(doc: SpeciesDoc, m: SheetModel): HTMLElement {
    if (m.finds.total === 0) {
      return this.section(
        "Fund",
        "spp-sec-finds",
        h("p", { class: "spp-none" }, "Ingen fund på kortet endnu."),
      );
    }
    const toggles = ATTACHMENTS.map((a) =>
      h(
        "label",
        { class: `spp-toggle spp-toggle--${a}`, title: ATTACHMENT_HELP[a] },
        h("input", {
          type: "checkbox",
          checked: this.visible.has(a),
          onchange: (e: Event) => {
            if ((e.target as HTMLInputElement).checked) this.visible.add(a);
            else this.visible.delete(a);
            this.hooks.onSelect(doc, this.visible);
          },
        }),
        h("span", { class: "spp-swatch", "data-group": doc.group, "aria-hidden": "true" }),
        h("span", {}, ATTACHMENT_LABEL[a]),
        h("span", { class: "spp-toggle__n" }, NUMBER.format(m.finds.counts[a])),
      ),
    );
    this.nearLine = h(
      "p",
      { class: "spp-near", "data-pinned": String(this.pin !== null) },
      icon("pin", "spp-near__icon"),
      h("span", {}, this.nearText(doc)),
    );
    return this.section(
      "Fund",
      "spp-sec-finds",
      h(
        "fieldset",
        { class: "spp-toggles" },
        h("legend", { class: "sr-only" }, "Vis fund på kortet"),
        ...toggles,
      ),
      this.nearLine,
      h(
        "p",
        { class: "spp-note" },
        "Fastsiddende/opskyllet er vurderet automatisk ud fra fundenes dybde og beskrivelse. Mange fund er gamle herbarieindsamlinger – se årstal ved at trykke på et fund.",
      ),
      h(
        "p",
        { class: "spp-expert" },
        h("strong", {}, "Opskyllet tang (ekspertens råd): "),
        "Fundene viser, at arten sandsynligvis gror i nærheden. Opskyllet tang kan sankes, men kun efter en grundig vurdering af friskheden (lugt, udseende, konsistens) set i forhold til, hvornår det sidst blæste kraftigt – se Risiko-fanen. Den kan også komme langvejs fra, så det er på eget ansvar.",
      ),
    );
  }

  private lookalikesSection(m: SheetModel): HTMLElement {
    const items = m.lookalikes.map((ref) => {
      const summary = ref.slug ? this.manifest.species.find((s) => s.slug === ref.slug) : null;
      if (!summary) return h("li", {}, h("span", { class: "spp-look__plain" }, ref.label));
      const button = h(
        "button",
        { type: "button", class: "spp-look" },
        dot(summary.group),
        h(
          "span",
          { class: "spp-look__text" },
          h("span", { class: summary.danish_name ? "" : "spp-sci" }, shownName(summary)),
          summary.danish_name
            ? h("span", { class: "spp-look__sci spp-sci" }, summary.scientific_name)
            : null,
        ),
        icon("chevron", "spp-look__chevron"),
      );
      button.addEventListener(
        "click",
        () => void this.sel.open(summary, { user: true, via: "lookalike" }),
      );
      return h("li", {}, button);
    });
    return this.section(
      "Forveksling",
      "spp-sec-lookalikes",
      h("p", { class: "spp-lead" }, "Kan forveksles med:"),
      h("ul", { class: "spp-looks" }, ...items),
    );
  }

  private sourcesSection(doc: SpeciesDoc, m: SheetModel): HTMLElement {
    const item = (d: { title: string; license: string }) =>
      h(
        "li",
        {},
        d.title,
        d.license ? h("span", { class: "spp-license" }, ` – ${licenseName(d.license)}`) : null,
      );
    const shown = m.sources.slice(0, SOURCES_SHOWN);
    const rest = m.sources.slice(SOURCES_SHOWN);
    return this.section(
      "Kilder",
      "spp-sec-sources",
      h("ul", { class: "spp-sources" }, ...shown.map(item)),
      rest.length
        ? h(
            "details",
            { class: "spp-more-sources" },
            h("summary", {}, `Vis ${rest.length} flere datasæt`),
            h("ul", { class: "spp-sources" }, ...rest.map(item)),
          )
        : null,
      h(
        "p",
        { class: "spp-gbif" },
        extLink(`https://www.gbif.org/species/${doc.gbif_usage_key}`, "Arten på GBIF"),
      ),
    );
  }
}
