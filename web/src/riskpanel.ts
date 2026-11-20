// "Risiko" tab: what the app can find around the pin. ADR-0005: a traffic
// light on top (verdict.ts, rules in verdict-rules.json, reviewed by the expert)
// as a summary,
// and the list of factors -- nearest first, each with its source -- as the
// reasoning behind it.

import { loadRiskCell } from "./data";
import { h, extLink } from "./dom";
import { bboxAround, cellKeys, formatDistance } from "./geo";
import { RISK_COLOR } from "./layers";
import {
  queryProtected,
  querySoil,
  parseStreams,
  queryNamedStreams,
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
import { fetchRain, type RainSummary } from "./rain";
import { groupNearby, riskItems, type RiskItem } from "./risk";
import type { Manifest } from "./types";
import { evaluate, LEVEL_TEXT, RULES } from "./verdict";
import { compass, daysAgo, fetchWind, STRONG_WIND_MS, WINDOW_DAYS, type WindSummary } from "./wind";

export const RADII_M = [1000, 2000, 5000] as const;

export const DISCLAIMER =
  "Kort og varslinger er værktøjer til at identificere potentielle risici – ikke en garanti for, at en lokalitet eller den indsamlede tang er fri for forurening.";

export interface RiskPanelHooks {
  onItems(pin: [number, number], radiusM: number, items: RiskItem[]): void;
  onFocus(item: RiskItem): void;
}

type Pending<T> = T | "loading" | "error";

export class RiskPanel {
  private pin: [number, number] | null = null;
  private radiusM: number = RADII_M[1];
  private items: RiskItem[] | "loading" | "error" = "loading";
  private rain: Pending<RainSummary | null> = "loading";
  private wind: Pending<WindSummary | null> = "loading";
  private water: Pending<LiveResult<WaterBody>> = "loading";
  private soil: Pending<LiveResult<SoilSite>> = "loading";
  /** Raw answers of the two watercourse queries (see live.ts). */
  private namedStreams: Pending<unknown | null> = "loading";
  private smallStreams: Pending<unknown | null> = "loading";
  private protectedAreas: Pending<LiveResult<ProtectedArea>> = "loading";
  private abort: AbortController | null = null;

  constructor(
    private root: HTMLElement,
    private manifest: Manifest,
    private hooks: RiskPanelHooks,
  ) {
    this.render();
  }

  setPin(pin: [number, number]): void {
    this.pin = pin;
    this.abort?.abort();
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.items = this.rain = this.wind = this.water = this.soil = this.protectedAreas = "loading";
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
    void fetchWind(pin, signal).then(
      done((w) => (this.wind = w)),
      done(() => (this.wind = "error")),
    );
    void queryWaterBodies(pin, signal).then(done((r) => (this.water = r)));
    void querySoil(pin, signal).then(done((r) => (this.soil = r)));
    void queryNamedStreams(pin, signal).then(done((r) => (this.namedStreams = r)));
    void querySmallStreams(pin, signal).then(done((r) => (this.smallStreams = r)));
    void queryProtected(pin, signal).then(done((r) => (this.protectedAreas = r)));
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
          "Sæt en nål ved kysten – tryk på kortet eller søg en adresse – for at se mulige forureningskilder i nærheden.",
        ),
        h("p", { class: "disclaimer" }, DISCLAIMER),
      );
      return;
    }
    this.root.replaceChildren(
      this.verdictCard(),
      h("p", { class: "disclaimer" }, DISCLAIMER),
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
      this.linksCard(),
    );
  }

  /** Watercourses known so far; null if the named query failed. Small streams
   * count once their (slow) query has answered. */
  private streams(): Streams | null {
    if (this.namedStreams === "loading" || this.namedStreams === null) return null;
    const small = this.smallStreams === "loading" ? null : this.smallStreams;
    return parseStreams(this.namedStreams, small);
  }

  private verdictCard(): HTMLElement {
    // The small-stream query is slow and only supplementary: don't wait for it.
    const settled = [this.items, this.rain, this.soil, this.namedStreams].every(
      (v) => v !== "loading",
    );
    if (!settled) {
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

  private windCard(): HTMLElement {
    const title = "Vind og opskyllet tang";
    const w = this.wind;
    const status = this.status(w);
    if (status) return this.card(title, status);
    const summary = w as WindSummary | null;
    const advice = h(
      "p",
      { class: "note" },
      "Opskyllet tang er sandsynligvis kommet op ved sidste kraftige blæst og kan være drevet langvejs fra. Vurder friskheden grundigt (lugt, udseende, konsistens) – det er på eget ansvar.",
    );
    if (!summary) return this.card(title, h("p", {}, "Ingen DMI-vindmåling i nærheden."), advice);
    const strong = summary.lastStrong;
    const ms = (v: number) => `${String(Math.round(v * 10) / 10).replace(".", ",")} m/s`;
    return this.card(
      title,
      strong
        ? h(
            "p",
            {},
            `Sidste hårde vind (mindst ${ms(STRONG_WIND_MS)}): `,
            h("strong", {}, daysAgo(strong.at, new Date())),
            `, op til ${ms(strong.peakMs)}${strong.fromDeg !== null ? ` fra ${compass(strong.fromDeg)}` : ""}.`,
          )
        : h(
            "p",
            {},
            `Ingen hård vind (mindst ${ms(STRONG_WIND_MS)}) de seneste ${WINDOW_DAYS} dage – opskyllet tang kan være ældre end det.`,
          ),
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
              h("span", { class: "dot", style: `background:${RISK_COLOR[g.key]}` }),
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
