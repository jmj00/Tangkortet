// "Arter" tab: the species list (search, group chips, sorted by finds near the
// pin once one is set) and a species sheet with its safety structure:
// "Vigtigt" first, then Fund, Høst, Ophobning og sikkerhed, Forveksling, Kilder.
//
// The list frame (search field, chips, rows) is built once and kept, so a
// keystroke or a new pin only patches it: the search field keeps its focus and
// caret, and "back" returns to the same filter. Structure and states follow
// Svampekortet's specieslist.ts / detail.ts / panel.ts (624fb8b).

import "./species.css";

import { h, extLink } from "./dom";
import { ALGAE_COLOR } from "./layers";
import {
  filterSpecies,
  findsNear,
  GROUP_PLURAL,
  GROUPS,
  groupLabel,
  isActiveQuery,
  licenseName,
  NEAR_PIN_M,
  sheetModel,
  sortByNear,
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

type View =
  | { kind: "list" }
  | { kind: "loading"; summary: SpeciesSummary }
  | { kind: "error"; summary: SpeciesSummary; offline: boolean }
  | { kind: "sheet"; summary: SpeciesSummary; doc: SpeciesDoc };

interface RowRefs {
  li: HTMLLIElement;
  button: HTMLButtonElement;
  meta: HTMLElement;
}

export class SpeciesPanel {
  private pin: [number, number] | null = null;
  private docs: Map<string, SpeciesDoc> = new Map();
  private view: View = { kind: "list" };
  private visible = new Set<Attachment>(ATTACHMENTS);
  /** Row to return focus to on "← Alle arter": the one the user opened. */
  private returnSlug: string | null = null;
  private loadToken = 0;
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
    placeholder: "Søg art eller gruppe, fx søl",
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
  private readonly reset = h("button", { type: "button", class: "spp-reset" }, "Nulstil");
  private readonly hint = h("p", { class: "spp-hint" });
  private readonly results = h("div", { class: "spp-results" });

  constructor(
    private root: HTMLElement,
    private manifest: Manifest,
    private hooks: SpeciesPanelHooks,
  ) {
    this.buildFrame();
    this.setView(this.view, false);
    // The sticky back bar gets a hairline once the sheet has scrolled under it.
    this.root.addEventListener(
      "scroll",
      () => this.root.toggleAttribute("data-spp-scrolled", this.root.scrollTop > 4),
      { passive: true },
    );
    // A species that failed to load while offline is fetched again on reconnect.
    window.addEventListener("online", () => {
      if (this.view.kind === "error") void this.open(this.view.summary, this.headingHasFocus());
    });
  }

  setPin(pin: [number, number], allDocs: SpeciesDoc[]): void {
    this.pin = pin;
    for (const d of allDocs) this.docs.set(d.slug, d);
    if (this.view.kind === "list") this.refreshList();
    else if (this.view.kind === "sheet") this.patchNear(this.view.doc);
  }

  /** Slug of the open species (also while it loads or failed), or null on the list. */
  get selectedSlug(): string | null {
    return this.view.kind === "list" ? null : this.view.summary.slug;
  }

  selectBySlug(slug: string): void {
    const summary = this.manifest.species.find((s) => s.slug === slug);
    // From a link: move focus only if the user is already working in the panel.
    if (summary) void this.open(summary, this.root.contains(document.activeElement));
  }

  private headingHasFocus(): boolean {
    return document.activeElement?.classList.contains("spp-title") ?? false;
  }

  private async open(summary: SpeciesSummary, focus: boolean): Promise<void> {
    const token = ++this.loadToken;
    const cached = this.docs.get(summary.slug);
    if (cached) return this.show(summary, cached, focus);

    this.setView({ kind: "loading", summary }, focus);
    let doc: SpeciesDoc;
    try {
      doc = await this.hooks.loadDoc(summary);
    } catch (err) {
      console.error(err);
      if (token !== this.loadToken) return;
      // Keep focus on the heading if it is there; never pull it back from elsewhere.
      const offline = navigator.onLine === false;
      this.setView({ kind: "error", summary, offline }, this.headingHasFocus());
      return;
    }
    if (token !== this.loadToken) return; // another species was opened meanwhile
    this.docs.set(doc.slug, doc);
    this.show(summary, doc, this.headingHasFocus());
  }

  private show(summary: SpeciesSummary, doc: SpeciesDoc, focus: boolean): void {
    this.setView({ kind: "sheet", summary, doc }, focus);
    this.hooks.onSelect(doc, this.visible);
  }

  private back(): void {
    const closing = this.selectedSlug;
    this.loadToken++; // drop a load still in flight
    const wasSheet = this.view.kind === "sheet";
    this.setView({ kind: "list" }, false);
    if (wasSheet) this.hooks.onSelect(null, this.visible);
    const target =
      this.rows.get(this.returnSlug ?? "")?.button ?? this.rows.get(closing ?? "")?.button;
    (target ?? this.search).focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });
    this.returnSlug = null;
  }

  private setView(view: View, focus: boolean): void {
    if (this.view.kind === "list" && this.listRoot.isConnected) {
      this.listScroll = this.root.scrollTop;
    }
    this.view = view;
    this.nearLine = null;
    if (view.kind === "list") {
      this.root.replaceChildren(this.listRoot);
      this.refreshList();
      this.root.scrollTop = this.listScroll;
      return;
    }
    const sheet =
      view.kind === "sheet"
        ? this.sheet(view.summary, view.doc)
        : view.kind === "loading"
          ? this.placeholder(view.summary, "loading")
          : this.placeholder(view.summary, view.offline ? "offline" : "error");
    this.root.replaceChildren(sheet);
    this.root.scrollTop = 0;
    if (focus) sheet.querySelector<HTMLElement>(".spp-title")?.focus({ preventScroll: true });
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

    this.listRoot.append(
      h("h2", { class: "sr-only" }, "Arter"),
      h(
        "div",
        { class: "spp-toolbar" },
        h("div", { class: "spp-search" }, icon("search", "spp-search__icon"), this.search),
        this.chips,
        h("div", { class: "spp-status" }, this.count, this.reset),
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
      const doc = this.docs.get(s.slug);
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
    this.reset.hidden = !filtered;

    this.hint.replaceChildren(
      icon("pin", "spp-hint__icon"),
      h(
        "span",
        {},
        near
          ? `Sorteret efter fund inden for ${NEAR_PIN_M / 1000} km af nålen.`
          : "Sæt en nål ved kysten for at se arter i nærheden.",
      ),
    );
    this.hint.dataset.pinned = String(near !== null);
    this.hint.hidden = matched.length === 0;

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
      void this.open(s, true);
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
    const back = h(
      "button",
      { type: "button", class: "spp-back" },
      icon("back", "spp-back__icon"),
      h("span", {}, "Alle arter"),
    );
    back.addEventListener("click", () => this.back());

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
      h("div", { class: "spp-nav" }, back),
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
    const article = h(
      "article",
      { class: "spp spp-sheet", "aria-labelledby": `spp-title-${summary.slug}` },
      ...children,
    );
    article.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      this.back();
    });
    return article;
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
      retry.addEventListener("click", () => void this.open(summary, true));
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
    const color = ALGAE_COLOR[doc.group] ?? "#888";
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
        h("span", { class: "spp-swatch", style: `--c:${color}`, "aria-hidden": "true" }),
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
      button.addEventListener("click", () => void this.open(summary, true));
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
