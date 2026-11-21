// "Risiko" tab: what the app can find around the pin. ADR-0005: a traffic
// light on top (verdict.ts, rules in verdict-rules.json, reviewed by the expert)
// as a summary,
// and the list of factors -- nearest first, each with its source -- as the
// reasoning behind it.

import "./coast.css";
import { cellsFor, COAST_RADIUS_M, NONE_TEXT, summarize, type CoastSummary } from "./coast";
import { loadCoastCell, loadNameCell, loadPlaceInfo, loadRiskCell } from "./data";
import {
  cellNames,
  distText,
  nameCellsFor,
  shoreRows,
  showsOfficialName,
  summarizeNames,
  waterLine,
  type ShoreRow,
} from "./names";
import { h, extLink } from "./dom";
import { bboxAround, cellKeys, formatDistance } from "./geo";
import { riskColor } from "./layers";
import {
  queryProtected,
  querySoil,
  parseStreams,
  queryNamedStreams,
  querySeaDirections,
  querySmallStreams,
  queryWaterBodies,
  SOIL_RADIUS_M,
  STREAM_RADIUS_M,
  type Streams,
  type LiveResult,
  type ProtectedArea,
  type SoilSite,
  type WaterBody,
} from "./live";
import { nearPlaces, placeCardElement, type NearPlace } from "./placecard";
import { fetchRain, type RainSummary } from "./rain";
import { groupNearby, riskItems, type GroupKey, type RiskItem } from "./risk";
import type { Manifest } from "./types";
import { evaluate, LEVEL_TEXT, RULES, type Level } from "./verdict";
import {
  compass,
  daysAgo,
  describeSea,
  fetchWind,
  onshoreFrom,
  stillFresh,
  STRONG_WIND_MS,
  WINDOW_DAYS,
  type WindSummary,
} from "./wind";

export const RADII_M = [1000, 2000, 5000] as const;

/** "Kysten her" rows shown before "+ N flere". */
export const COAST_ROWS = 4;

export const DISCLAIMER =
  "Kort og varslinger er værktøjer til at identificere potentielle risici – ikke en garanti for, at en lokalitet eller den indsamlede tang er fri for forurening.";

export interface RiskPanelHooks {
  onItems(pin: [number, number], radiusM: number, items: RiskItem[]): void;
  onFocus(item: RiskItem): void;
  /** The traffic light for `pin` each time the panel draws it ("pending"
   * until its inputs have answered); the pin's card (tapcard.ts) shows it. */
  onVerdict?(pin: [number, number], level: Level | "pending"): void;
  /** "Kysten her" for `pin` as it arrives (null: no coast data for this
   * area); the pin's card shows a line of it. */
  onCoast?(pin: [number, number], coast: CoastState): void;
  /** The pin's header as the user sees it ("Ved Tuse Næs"): among places
   * about as near, the place card it names comes first. */
  pinHeader?(): string | null;
}

/** The coast at the pin (coast.ts): null when the payload has no coast data
 * for the area (an old payload, or outside the dev sample). */
export type CoastState = CoastSummary | null | "loading" | "error";

type Pending<T> = T | "loading" | "error";

export class RiskPanel {
  private pin: [number, number] | null = null;
  private radiusM: number = RADII_M[1];
  private items: RiskItem[] | "loading" | "error" = "loading";
  private rain: Pending<RainSummary | null> = "loading";
  private wind: Pending<WindSummary | null> = "loading";
  /** 16 sea/land samples around the pin, or null if that query failed. */
  private sea: boolean[] | null = null;
  private water: Pending<LiveResult<WaterBody>> = "loading";
  private soil: Pending<LiveResult<SoilSite>> = "loading";
  /** Raw answers of the two watercourse queries (see live.ts). */
  private namedStreams: Pending<unknown | null> = "loading";
  private smallStreams: Pending<unknown | null> = "loading";
  private protectedAreas: Pending<LiveResult<ProtectedArea>> = "loading";
  private coast: CoastState = "loading";
  /** Carded places near the pin (placecard.ts), nearest first; [] for none,
   * for a payload without them and when the file cannot be fetched (the
   * card is extra: no error state of its own). */
  private places: NearPlace[] = [];
  /** The place shown when several are near ("+1 sted mere"). */
  private placeId: string | null = null;
  /** The card's element, kept across redraws so its photo is not refetched
   * and does not flash each time another answer arrives. */
  private placeEl: { places: NearPlace[]; id: string; el: HTMLElement } | null = null;
  /** "+ N flere" opened, kept across redraws for the same pin. */
  private coastMoreOpen = false;
  /** "Prøv igen" was pressed: the coast card keeps the focus until it answers. */
  private focusCoast = false;
  private abort: AbortController | null = null;
  /** The traffic light last reported through onVerdict, and for which pin. */
  private reported: { pin: [number, number]; level: Level | "pending" } | null = null;

  constructor(
    private root: HTMLElement,
    private manifest: Manifest,
    private hooks: RiskPanelHooks,
  ) {
    this.render();
    // The group dots match the markers on the map, which follow the theme.
    globalThis.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
      for (const dot of this.root.querySelectorAll<HTMLElement>(".dot[data-group]"))
        dot.style.background = riskColor(dot.dataset.group as GroupKey);
    });
  }

  setPin(pin: [number, number]): void {
    this.pin = pin;
    this.abort?.abort();
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.items = this.rain = this.wind = this.water = this.soil = this.protectedAreas = "loading";
    this.coastMoreOpen = this.focusCoast = false;
    this.namedStreams = this.smallStreams = "loading";
    this.render();

    const done =
      <T>(set: (v: T) => void) =>
      (v: T) => {
        if (signal.aborted) return;
        set(v);
        this.render();
      };
    void this.loadItems(pin).then(
      done((items) => {
        this.items = items;
        this.hooks.onItems(pin, this.radiusM, items);
      }),
      done(() => (this.items = "error")),
    );
    void fetchRain(pin, signal).then(
      done((r) => (this.rain = r)),
      done(() => (this.rain = "error")),
    );
    void querySeaDirections(pin, signal)
      .then((sea) => {
        this.sea = sea;
        return fetchWind(pin, signal, sea ? onshoreFrom(sea) : undefined);
      })
      .then(
        done((w) => (this.wind = w)),
        done(() => (this.wind = "error")),
      );
    void queryWaterBodies(pin, signal).then(done((r) => (this.water = r)));
    void querySoil(pin, signal).then(done((r) => (this.soil = r)));
    void queryNamedStreams(pin, signal).then(done((r) => (this.namedStreams = r)));
    void querySmallStreams(pin, signal).then(done((r) => (this.smallStreams = r)));
    void queryProtected(pin, signal).then(done((r) => (this.protectedAreas = r)));
    this.fetchCoast(pin, signal);
    this.places = [];
    this.placeId = null;
    const placeInfo = this.manifest.place_info;
    if (placeInfo)
      void loadPlaceInfo(placeInfo.file).then(
        done(
          (f) =>
            (this.places = nearPlaces(f.places, pin, undefined, this.hooks.pinHeader?.() ?? null)),
        ),
        () => undefined,
      );
  }

  /** "Kysten her": the coast cells round the pin (fetched once each). */
  private fetchCoast(pin: [number, number], signal: AbortSignal): void {
    const set = (state: CoastState): void => {
      if (signal.aborted) return;
      this.coast = state;
      this.hooks.onCoast?.(pin, state);
      this.render();
    };
    set("loading");
    const index = this.manifest.coast;
    const keys = index ? cellsFor(index, pin) : null;
    const names = this.manifest.names;
    const nameKeys = names ? nameCellsFor(names, pin) : null;
    if (!keys && !nameKeys) return set(null);
    // The official names come along when they can; without them the card
    // still has OpenStreetMap's coast (and the other way round).
    const namesSummary = nameKeys
      ? Promise.all(nameKeys.map(loadNameCell)).then(
          (cells) => summarizeNames(cellNames(cells, names?.cell_deg ?? 0), pin),
          () => undefined,
        )
      : Promise.resolve(undefined);
    const coast = keys
      ? Promise.all(keys.map(loadCoastCell)).then((cells) => summarize(cells, pin))
      : Promise.resolve<CoastSummary>({ water: null, nearby: [] });
    Promise.all([coast, namesSummary]).then(
      ([summary, named]) => {
        // the names alone: only when they say something (the pin is by the sea)
        if (!keys && !named?.water && !named?.landform) return set(null);
        set(named ? { ...summary, names: named } : summary);
      },
      () => set("error"),
    );
  }

  private async loadItems(pin: [number, number]): Promise<RiskItem[]> {
    const index = this.manifest.risk;
    if (!index) return [];
    const available = new Set(index.cells);
    const keys = cellKeys(bboxAround(pin, Math.max(...RADII_M)), index.cell_deg).filter((k) =>
      available.has(k),
    );
    const cells = await Promise.all(keys.map(loadRiskCell));
    return riskItems(cells, index, pin);
  }

  /** Re-emit the current items, e.g. when the Risiko tab is shown again. */
  redrawMap(): void {
    if (this.pin && Array.isArray(this.items))
      this.hooks.onItems(this.pin, this.radiusM, this.items);
  }

  private setRadius(m: number): void {
    this.radiusM = m;
    if (this.pin && Array.isArray(this.items)) this.hooks.onItems(this.pin, m, this.items);
    this.render();
  }

  private render(): void {
    if (!this.pin) {
      this.root.replaceChildren(
        h(
          "p",
          { class: "hint" },
          "Sæt en nål ved kysten – zoom ind og tryk på kortet, eller søg et sted – for at se mulige forureningskilder i nærheden.",
        ),
        h("p", { class: "disclaimer" }, DISCLAIMER),
      );
      return;
    }
    const coast = this.coastCard();
    const place = this.placeCard();
    // the element in the place card that has the focus (the card itself, a
    // credit link, the photo, "+1 sted mere"), refocused after the redraw
    const active = document.activeElement as HTMLElement | null;
    const placeFocus = active?.closest?.("#place-card") ? active : null;
    // Each redraw replaces the card: a focus on it (or on its "Prøv igen")
    // goes to the new card.
    const keepFocus = this.focusCoast || document.activeElement?.closest?.("#coast-card") != null;
    if (this.focusCoast && this.coast !== "loading") this.focusCoast = false;
    this.root.replaceChildren(
      this.verdictCard(),
      h("p", { class: "disclaimer" }, DISCLAIMER),
      ...(coast ? [coast] : []),
      this.rainCard(),
      this.windCard(),
      this.waterCard(),
      h(
        "div",
        { class: "radius" },
        h("span", {}, "Kilder inden for"),
        ...RADII_M.map((m) =>
          h(
            "button",
            {
              type: "button",
              "aria-pressed": String(m === this.radiusM),
              onclick: () => this.setRadius(m),
            },
            formatDistance(m),
          ),
        ),
      ),
      this.groups(),
      this.streamCard(),
      this.protectionCard(),
      this.soilCard(),
      // background, not a risk factor: after every risk card
      ...(place ? [place] : []),
      this.linksCard(),
    );
    if (keepFocus && coast) coast.focus({ preventScroll: true });
    else if (placeFocus && place) refocus(place, placeFocus);
  }

  /** The nearest carded place (or the one picked from "+1 sted mere"), last
   * before "Tjek også selv": background about the place, never a risk
   * factor or a verdict. */
  private placeCard(): HTMLElement | null {
    if (!this.places.length) return null;
    const shown = this.places.find((p) => p.card.id === this.placeId) ?? this.places[0];
    const kept = this.placeEl;
    if (kept && kept.places === this.places && kept.id === shown.card.id) return kept.el;
    const others = this.places.filter((p) => p !== shown).slice(0, 3);
    const el = placeCardElement(shown, others, (id) => {
      this.placeId = id;
      this.render();
      document.getElementById("place-card")?.focus({ preventScroll: true });
    });
    this.placeEl = { places: this.places, id: shown.card.id, el };
    return el;
  }

  /** Watercourses known so far; null if the named query failed. Small streams
   * count once their (slow) query has answered. */
  private streams(): Streams | null {
    if (this.namedStreams === "loading" || this.namedStreams === null) return null;
    const small = this.smallStreams === "loading" ? null : this.smallStreams;
    return parseStreams(this.namedStreams, small);
  }

  /** Report the traffic light when it changes (a new pin, or an answer that
   * settles or changes it), not on every redraw. */
  private emitVerdict(level: Level | "pending"): void {
    const pin = this.pin;
    if (!pin) return;
    const last = this.reported;
    if (last && last.pin === pin && last.level === level) return;
    this.reported = { pin, level };
    this.hooks.onVerdict?.(pin, level);
  }

  private verdictCard(): HTMLElement {
    // The small-stream query is slow and only supplementary: don't wait for it.
    const settled = [this.items, this.rain, this.soil, this.namedStreams].every(
      (v) => v !== "loading",
    );
    if (!settled) {
      this.emitVerdict("pending");
      return h("section", { class: "verdict verdict--pending" }, h("p", {}, "Vurderer…"));
    }
    const soil = this.soil as LiveResult<SoilSite> | "error";
    const rain = this.rain as RainSummary | null | "error";
    const verdict = evaluate({
      items: Array.isArray(this.items) ? this.items : null,
      rain48: rain && rain !== "error" ? rain.mm48 : null,
      soilV2:
        soil !== "error" && soil.ok ? soil.items.filter((i) => i.level === "V2").length : null,
      streams: this.streams(),
    });
    this.emitVerdict(verdict.level);
    const text = LEVEL_TEXT[verdict.level];
    return h(
      "section",
      { class: `verdict verdict--${verdict.level}` },
      h(
        "div",
        { class: "verdict__head" },
        h("span", { class: "verdict__light", "aria-hidden": "true" }),
        h("div", {}, h("h3", {}, text.title), h("p", {}, text.text)),
      ),
      verdict.reasons.length
        ? h(
            "ul",
            { class: "verdict__reasons" },
            ...verdict.reasons.map((r) =>
              h(
                "li",
                { class: `reason reason--${r.rule.level}` },
                h("strong", {}, r.rule.text),
                h("span", { class: "note" }, ` – ${r.evidence}`),
              ),
            ),
          )
        : null,
      this.smallStreams === "loading"
        ? h("p", { class: "note" }, "Tjekker også mindre vandløb…")
        : null,
      verdict.unchecked.length
        ? h(
            "p",
            { class: "note" },
            `Kunne ikke tjekkes (data mangler): ${verdict.unchecked.map((r) => r.text.toLowerCase()).join("; ")}.`,
          )
        : null,
      h(
        "details",
        { class: "verdict__rules" },
        h("summary", {}, "Sådan vurderer vi"),
        h(
          "p",
          { class: "note" },
          "Rød, hvis én af de røde regler passer; gul, hvis én af de gule passer; ellers grøn. Kystvandets kemiske tilstand indgår ikke, fordi næsten alle danske kystvande har ikke-god kemisk tilstand. Strøm, vind og vandudskiftning indgår heller ikke – dem må du selv vurdere.",
        ),
        h(
          "ul",
          { class: "plain" },
          ...RULES.rules.map((r) =>
            h(
              "li",
              { class: `reason reason--${r.level}` },
              r.level === "red" ? "Rød: " : "Gul: ",
              r.text,
            ),
          ),
        ),
      ),
      RULES.status === "udkast"
        ? h(
            "p",
            { class: "badge badge--provisional" },
            "Udkast – reglerne er endnu ikke godkendt af en fagperson",
          )
        : h("p", { class: "note" }, "Reglerne er gennemgået af en fagperson (november 2026)."),
    );
  }

  /** What the shore is like and how far the water is (OpenStreetMap). Only
   * how it is mapped: never whether the place is good or safe to collect. */
  private coastCard(): HTMLElement | null {
    const card = this.coastBody();
    if (card) {
      card.id = "coast-card";
      card.tabIndex = -1;
      card.classList.add("coast");
    }
    return card;
  }

  private coastBody(): HTMLElement | null {
    const title = "Kysten her";
    const c = this.coast;
    if (c === null) return null;
    // Danske Stednavne only when the card shows one of its names
    const official = typeof c === "object" && showsOfficialName(c, shoreRows(c));
    const source = h(
      "p",
      { class: "note" },
      official
        ? "OpenStreetMap og Danske Stednavne (Klimadatastyrelsen) – kan være ufuldstændigt."
        : "OpenStreetMap – kan være ufuldstændigt.",
    );
    if (c === "loading") return this.card(title, h("p", { class: "loading" }, "Henter…"));
    if (c === "error") {
      const pin = this.pin;
      return this.card(
        title,
        h("p", { class: "error" }, "Kunne ikke hentes lige nu."),
        pin
          ? h(
              "button",
              {
                type: "button",
                class: "retry",
                onclick: () => {
                  // the button is about to go: the focus moves to its card
                  this.focusCoast = true;
                  this.fetchCoast(pin, this.abort?.signal ?? new AbortController().signal);
                },
              },
              "Prøv igen",
            )
          : null,
      );
    }
    const rows = shoreRows(c);
    const water = waterLine(c);
    if (!water && rows.length === 0)
      return this.card(title, h("p", { class: "coast__water" }, `${NONE_TEXT}.`), source);
    const row = (n: ShoreRow): HTMLElement =>
      h(
        "li",
        {},
        h("span", { class: "coast__kind" }, n.label),
        n.name
          ? h(
              "span",
              { class: n.joiner === " · " ? "coast__name coast__name--kind" : "coast__name" },
              `${n.joiner}${n.name}`,
            )
          : null,
        h("span", { class: "coast__dist" }, distText(n.distanceM)),
      );
    // The first few, the rest folded, so the risk factors below stay near.
    // never fold a single row: "+ 1 mere" hiding one line saves nothing
    const fold = rows.length > COAST_ROWS + 1;
    const shown = fold ? rows.slice(0, COAST_ROWS) : rows.slice(0, COAST_ROWS + 1);
    const more = fold ? rows.slice(COAST_ROWS, 8) : [];
    const folded = more.length
      ? h(
          "details",
          {
            class: "coast__more",
            open: this.coastMoreOpen,
            ontoggle: (e: Event) => (this.coastMoreOpen = (e.target as HTMLDetailsElement).open),
          },
          h(
            "summary",
            {},
            h("span", { class: "coast__more-closed" }, `+ ${more.length} flere`),
            h("span", { class: "coast__more-open" }, "Vis færre"),
          ),
          h("ul", { class: "coast__list" }, ...more.map(row)),
        )
      : null;
    return this.card(
      title,
      water ? h("p", { class: "coast__water" }, h("strong", {}, water)) : null,
      shown.length
        ? h("ul", { class: "coast__list" }, ...shown.map(row))
        : h(
            "p",
            {},
            `Ingen strande, havne, broer eller skrænter kortlagt inden for ${COAST_RADIUS_M / 1000} km.`,
          ),
      folded,
      source,
    );
  }

  private windCard(): HTMLElement {
    const title = "Vind og opskyllet tang";
    const w = this.wind;
    const status = this.status(w);
    if (status) return this.card(title, status);
    const summary = w as WindSummary | null;
    const advice = h(
      "p",
      { class: "note" },
      "Vurder altid friskheden grundigt (lugt, udseende, konsistens), og husk at opskyllet tang kan være drevet langvejs fra – det er på eget ansvar.",
    );
    if (!summary) return this.card(title, h("p", {}, "Ingen DMI-vindmåling i nærheden."), advice);
    const strong = summary.lastStrong;
    const ms = (v: number) => `${String(Math.round(v * 10) / 10).replace(".", ",")} m/s`;
    const sea = this.sea ? describeSea(this.sea) : null;
    const kind = this.sea ? "hård pålandsvind" : "hård vind";
    const seaLine =
      sea === null
        ? h(
            "p",
            { class: "note" },
            "Kunne ikke afgøre, hvilken vej havet ligger – al vind er medtaget.",
          )
        : sea === ""
          ? h(
              "p",
              { class: "note" },
              "Nålen ligger ikke ved kysten, så ingen vind tæller som pålandsvind.",
            )
          : h("p", { class: "note" }, `Havet ligger mod ${sea}; kun vind derfra tæller.`);
    const now = new Date();
    return this.card(
      title,
      strong
        ? h(
            "p",
            {},
            `Sidste ${kind} (mindst ${ms(STRONG_WIND_MS)}): `,
            h("strong", {}, daysAgo(strong.at, now)),
            `, op til ${ms(strong.peakMs)}${strong.fromDeg !== null ? ` fra ${compass(strong.fromDeg)}` : ""}.`,
          )
        : h(
            "p",
            {},
            `Ingen ${kind} (mindst ${ms(STRONG_WIND_MS)}) de seneste ${WINDOW_DAYS} dage – opskyllet tang her kan være ældre end det.`,
          ),
      strong
        ? h(
            "p",
            {},
            stillFresh(strong.at, now)
              ? "Tang, der er skyllet op ved denne blæst, kan stadig være frisk (ca. 1 døgn)."
              : "Tang, der er skyllet op ved denne blæst, er sandsynligvis ikke frisk længere (ca. 1 døgn).",
          )
        : null,
      seaLine,
      h(
        "p",
        { class: "note" },
        `Målt ved DMI-station ${summary.stationName ?? summary.stationId}, ${formatDistance(summary.distanceM)} væk – den station inden for 40 km, der målte mest vind.`,
      ),
      advice,
    );
  }

  private card(title: string, ...body: (Node | string | null)[]): HTMLElement {
    return h("section", { class: "card" }, h("h3", {}, title), ...body);
  }

  private status<T>(v: Pending<T>): HTMLElement | null {
    if (v === "loading") return h("p", { class: "loading" }, "Henter…");
    if (v === "error")
      return h("p", { class: "error" }, "Kunne ikke hentes lige nu. Tjek selv kilden.");
    return null;
  }

  private rainCard(): HTMLElement {
    const r = this.rain;
    const body =
      this.status(r) ??
      (r === null || typeof r !== "object"
        ? h("p", {}, "Ingen DMI-station med nedbørsmålinger i nærheden.")
        : h(
            "div",
            {},
            h(
              "dl",
              { class: "rain" },
              ...(
                [
                  ["24 timer", r.mm24],
                  ["48 timer", r.mm48],
                  ["72 timer", r.mm72],
                ] as const
              ).flatMap(([label, mm]) => [
                h("dt", {}, label),
                h("dd", {}, `${String(mm).replace(".", ",")} mm`),
              ]),
            ),
            h(
              "p",
              { class: "note" },
              `DMI-station ${r.stationName ?? r.stationId}, ${formatDistance(r.distanceM)} væk${r.hours < 72 ? ` (${r.hours} af 72 timer målt)` : ""}.`,
            ),
          ));
    return this.card(
      "Nedbør",
      body,
      h("p", { class: "note" }, "Regn øger afstrømningen fra marker og risikoen for kloakoverløb."),
    );
  }

  private waterCard(): HTMLElement {
    const w = this.water;
    const status = this.status(w);
    if (status) return this.card("Kystvandet", status);
    const result = w as LiveResult<WaterBody>;
    if (!result.ok) return this.card("Kystvandet", this.status("error"));
    if (result.items.length === 0)
      return this.card("Kystvandet", h("p", {}, "Nålen ligger ikke ved et kortlagt kystvand."));
    return this.card(
      "Kystvandet",
      ...result.items.map((b) =>
        h(
          "div",
          { class: "water" },
          h("p", {}, h("strong", {}, b.name)),
          h(
            "p",
            {},
            b.chemical ?? "Kemisk tilstand ukendt",
            h("br"),
            b.ecological ?? "Økologisk tilstand ukendt",
          ),
          b.link ? h("p", { class: "note" }, extLink(b.link, "Hvorfor? (vandplandata.dk)")) : null,
        ),
      ),
      h(
        "p",
        { class: "note" },
        "Fra vandområdeplanerne 2021–2027. Kemisk tilstand handler om miljøfarlige stoffer i vandet. Næsten alle danske kystvande (121 af 123) har ikke-god kemisk tilstand.",
      ),
    );
  }

  private groups(): HTMLElement {
    if (this.items === "loading") return h("p", { class: "loading" }, "Henter kilder…");
    if (this.items === "error")
      return h("p", { class: "error" }, "Kunne ikke hente kortlagte kilder.");
    const groups = groupNearby(this.items, this.radiusM);
    return h(
      "ul",
      { class: "groups" },
      ...groups.map((g) =>
        h(
          "li",
          { class: g.count ? "group" : "group group--none" },
          h(
            "details",
            { open: g.count > 0 && g.count <= 3 },
            h(
              "summary",
              {},
              h("span", {
                class: "dot",
                "data-group": g.key,
                style: `background:${riskColor(g.key)}`,
              }),
              h("span", { class: "group__label" }, g.label),
              h(
                "span",
                { class: "group__count" },
                g.count
                  ? `${g.count} · nærmeste ${formatDistance(g.nearest[0].distanceM)}`
                  : "ingen",
              ),
            ),
            h("p", { class: "note" }, g.why),
            ...g.nearest.map((item) =>
              h(
                "button",
                { type: "button", class: "item", onclick: () => this.hooks.onFocus(item) },
                h("span", { class: "item__title" }, item.title),
                h("span", { class: "item__dist" }, formatDistance(item.distanceM)),
                item.detail ? h("span", { class: "item__detail" }, item.detail) : null,
              ),
            ),
            g.count > g.nearest.length
              ? h("p", { class: "note" }, `+ ${g.count - g.nearest.length} flere på kortet`)
              : null,
          ),
        ),
      ),
    );
  }

  private streamCard(): HTMLElement {
    const title = `Vandløb og å-udløb (inden for ${formatDistance(STREAM_RADIUS_M)})`;
    const status = this.status(this.namedStreams);
    if (status) return this.card(title, status);
    const found = this.streams();
    if (found === null) return this.card(title, this.status("error"));
    const any = found.names.length + found.unnamed > 0;
    return this.card(
      title,
      any
        ? h(
            "p",
            {},
            found.names.length ? h("strong", {}, found.names.join(", ")) : null,
            found.unnamed
              ? (found.names.length ? " og " : "") + "et mindre beskyttet vandløb"
              : null,
            ".",
          )
        : h("p", {}, "Ingen kortlagte vandløb ved nålen."),
      this.smallStreams === "loading"
        ? h("p", { class: "loading" }, "Tjekker også mindre vandløb…")
        : null,
      h(
        "p",
        { class: "note" },
        "Vandløb fører afstrømning fra marker, dræn og byer ud i havet – især efter regn. Fødevarestyrelsen råder til at undgå at samle tang ved åer.",
      ),
    );
  }

  private soilCard(): HTMLElement {
    const title = `Kortlagt jordforurening (inden for ${formatDistance(SOIL_RADIUS_M)})`;
    const s = this.soil;
    const status = this.status(s);
    if (status) return this.card(title, status);
    const result = s as LiveResult<SoilSite>;
    if (!result.ok) return this.card(title, this.status("error"));
    const v2 = result.items.filter((i) => i.level === "V2");
    const v1 = result.items.filter((i) => i.level === "V1");
    return this.card(
      title,
      result.items.length === 0
        ? h("p", {}, "Ingen kortlagte grunde.")
        : h(
            "p",
            {},
            `${v2.length} V2-grunde (dokumenteret forurening) og ${v1.length} V1-grunde (mulig forurening fra tidligere aktiviteter).`,
          ),
      v2.length
        ? h(
            "ul",
            { class: "plain" },
            ...v2.slice(0, 5).map((i) => h("li", {}, i.address ?? i.locality)),
          )
        : null,
      h(
        "p",
        { class: "note" },
        "Historisk forurening kan påvirke kysten, selv uden synlig industri i dag.",
      ),
    );
  }

  private protectionCard(): HTMLElement {
    const title = "Naturbeskyttelse";
    const p = this.protectedAreas;
    const status = this.status(p);
    if (status) return this.card(title, status);
    const result = p as LiveResult<ProtectedArea>;
    if (!result.ok) return this.card(title, this.status("error"));
    const kindLabel = {
      habitat: "Natura 2000, habitatområde",
      fugle: "Natura 2000, fuglebeskyttelsesområde",
      fredning: "Fredning",
    };
    return this.card(
      title,
      result.items.length === 0
        ? h("p", {}, "Nålen ligger ikke i et Natura 2000-område eller en fredning.")
        : h(
            "ul",
            { class: "plain" },
            ...result.items.map((a) =>
              h(
                "li",
                {},
                h("strong", {}, a.name),
                ` – ${kindLabel[a.kind]}${a.detail ? ` (${a.detail})` : ""} `,
                a.link ? extLink(a.link, "fredningen") : null,
              ),
            ),
          ),
      h(
        "p",
        { class: "note" },
        "Det handler om regler for indsamling, ikke forurening. Undersøg de konkrete regler for området.",
      ),
    );
  }

  private linksCard(): HTMLElement {
    return this.card(
      "Tjek også selv",
      h(
        "ul",
        { class: "plain" },
        h(
          "li",
          {},
          extLink("https://www.badevand.dk/", "Badevand.dk"),
          " – aktuelle badevandsvarsler (kun i badesæsonen).",
        ),
        h(
          "li",
          {},
          extLink("https://www.ditbadevand.dk/", "Ditbadevand.dk"),
          " – modelberegnet risiko for kloakoverløb efter regn (privat tjeneste, ikke en myndighed).",
        ),
        h("li", {}, "Kommunens spildevandsplan – søg “[kommune] spildevandsplan kort”."),
        h("li", {}, "Lokale advarsler om algeopblomstring."),
      ),
    );
  }
}

/** Give the focus back to `was` after a redraw: the same element when the
 * card was kept (it is), else the element in the same place among the new
 * card's focusable ones, else the card. Never moves a focus on a link or
 * button inside the card to the card itself while that element is there. */
function refocus(card: HTMLElement, was: HTMLElement): void {
  if (card.contains(was)) {
    was.focus({ preventScroll: true });
    return;
  }
  const focusable = "a[href], button, [tabindex]";
  const old = was.closest("#place-card");
  const i = old ? [...old.querySelectorAll(focusable)].indexOf(was) : -1;
  const same = i >= 0 ? card.querySelectorAll<HTMLElement>(focusable)[i] : undefined;
  (same ?? card).focus({ preventScroll: true });
}
