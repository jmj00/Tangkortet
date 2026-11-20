// "Arter" tab: the species list (sorted by finds near the pin once one is set)
// and a species sheet with finds, depth, harvest, season and warnings.

import { h, extLink } from "./dom";
import { ALGAE_COLOR } from "./layers";
import {
  accumulationText,
  depthText,
  findsNear,
  harvestText,
  NEAR_PIN_M,
  seasonText,
  type FieldText,
} from "./species";
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

export interface SpeciesPanelHooks {
  /** Called on open/close and when the visible find types change. */
  onSelect(doc: SpeciesDoc | null, visible: Set<Attachment>): void;
  loadDoc(summary: SpeciesSummary): Promise<SpeciesDoc>;
}

export class SpeciesPanel {
  private pin: [number, number] | null = null;
  private docs: Map<string, SpeciesDoc> = new Map();
  private selected: SpeciesDoc | null = null;
  private visible = new Set<Attachment>(["attached", "drift", "unknown"]);

  constructor(
    private root: HTMLElement,
    private manifest: Manifest,
    private hooks: SpeciesPanelHooks,
  ) {
    this.render();
  }

  setPin(pin: [number, number], allDocs: SpeciesDoc[]): void {
    this.pin = pin;
    for (const d of allDocs) this.docs.set(d.slug, d);
    this.render();
  }

  /** Slug of the open species sheet, or null on the list. */
  get selectedSlug(): string | null {
    return this.selected?.slug ?? null;
  }

  selectBySlug(slug: string): void {
    const summary = this.manifest.species.find((s) => s.slug === slug);
    if (summary) void this.select(summary);
  }

  private async select(summary: SpeciesSummary): Promise<void> {
    const doc = this.docs.get(summary.slug) ?? (await this.hooks.loadDoc(summary));
    this.docs.set(doc.slug, doc);
    this.selected = doc;
    this.hooks.onSelect(doc, this.visible);
    this.render();
  }

  private back(): void {
    this.selected = null;
    this.hooks.onSelect(null, this.visible);
    this.render();
  }

  private render(): void {
    this.root.replaceChildren(this.selected ? this.sheet(this.selected) : this.list());
  }

  private list(): HTMLElement {
    const rows = this.manifest.species.map((s) => {
      const doc = this.docs.get(s.slug);
      const near = this.pin && doc ? findsNear(doc, this.pin) : null;
      return { s, near };
    });
    if (this.pin) rows.sort((a, b) => (b.near?.total ?? 0) - (a.near?.total ?? 0));

    return h(
      "div",
      {},
      h(
        "p",
        { class: "hint" },
        this.pin
          ? `Sorteret efter fund inden for ${NEAR_PIN_M / 1000} km af nålen.`
          : "Vælg en art for at se, hvor den er fundet. Sæt en nål ved kysten for at se arter i nærheden.",
      ),
      h(
        "ul",
        { class: "rows" },
        ...rows.map(({ s, near }) =>
          h(
            "li",
            {},
            h(
              "button",
              { type: "button", class: "row", onclick: () => void this.select(s) },
              h("span", { class: "dot", style: `background:${ALGAE_COLOR[s.group] ?? "#888"}` }),
              h(
                "span",
                { class: "row__main" },
                h("span", { class: "row__name" }, s.danish_name),
                h("span", { class: "row__sci" }, s.scientific_name),
              ),
              h(
                "span",
                { class: "row__meta" },
                near
                  ? near.total
                    ? `${near.total} fund nær`
                    : "ingen nær"
                  : `${s.observation_count} fund`,
              ),
            ),
          ),
        ),
      ),
    );
  }

  private field(label: string, value: FieldText, note?: string): HTMLElement {
    const badge = STATUS_LABEL[value.status];
    return h(
      "div",
      { class: "field" },
      h(
        "h3",
        {},
        label,
        badge ? h("span", { class: `badge badge--${value.status}` }, badge) : null,
      ),
      h("p", { class: value.status === "pending" ? "pending" : "" }, value.text),
      note ? h("p", { class: "note" }, note) : null,
    );
  }

  private sheet(doc: SpeciesDoc): HTMLElement {
    const near = this.pin ? findsNear(doc, this.pin) : null;
    const toggles = (["attached", "drift", "unknown"] as Attachment[]).map((a) =>
      h(
        "label",
        { class: `toggle toggle--${a}`, title: ATTACHMENT_HELP[a] },
        h("input", {
          type: "checkbox",
          checked: this.visible.has(a),
          onchange: (e: Event) => {
            if ((e.target as HTMLInputElement).checked) this.visible.add(a);
            else this.visible.delete(a);
            this.hooks.onSelect(doc, this.visible);
          },
        }),
        h("span", { class: "swatch", style: `--c:${ALGAE_COLOR[doc.group] ?? "#888"}` }),
        `${ATTACHMENT_LABEL[a]} (${doc.attachment_counts[a]})`,
      ),
    );

    return h(
      "article",
      { class: "sheet" },
      h("button", { type: "button", class: "back", onclick: () => this.back() }, "← Alle arter"),
      h(
        "h2",
        {},
        doc.danish_name,
        !doc.danish_name_verified
          ? h(
              "span",
              { class: "badge badge--provisional", title: "Navnet er ikke bekræftet mod arter.dk" },
              "Navn ikke bekræftet",
            )
          : null,
      ),
      h("p", { class: "sci" }, doc.scientific_name, ` · ${doc.group}`),

      h(
        "section",
        {},
        h("h3", {}, "Fund på kortet"),
        h("div", { class: "toggles" }, ...toggles),
        near
          ? h(
              "p",
              { class: "note" },
              `Inden for ${NEAR_PIN_M / 1000} km af nålen: ${near.attached} fastsiddende, ${near.drift} opskyllede, ${near.unknown} ukendte.`,
            )
          : null,
        h(
          "p",
          { class: "note" },
          "Fastsiddende/opskyllet er vurderet automatisk ud fra fundenes dybde og beskrivelse. Mange fund er gamle herbarieindsamlinger – se årstal ved at trykke på et fund.",
        ),
        h(
          "p",
          { class: "expert-note" },
          h("strong", {}, "Opskyllet tang (ekspertens råd): "),
          "Fundene viser, at arten sandsynligvis gror i nærheden. Opskyllet tang kan sankes, men kun efter en grundig vurdering af friskheden (lugt, udseende, konsistens) set i forhold til, hvornår det sidst blæste kraftigt – se Risiko-fanen. Den kan også komme langvejs fra, så det er på eget ansvar.",
        ),
      ),

      this.field("Dybde", depthText(doc)),
      this.field("Høstmetode", harvestText(doc)),
      this.field("Bedste sæson", seasonText(doc)),
      this.field(
        "Ophobning",
        accumulationText(doc),
        "Tang kan ophobe arsen, cadmium og jod forskelligt alt efter art, voksested og sæson.",
      ),

      h(
        "section",
        { class: "sources" },
        h("h3", {}, "Kilder"),
        h(
          "ul",
          {},
          ...doc.datasets.map((d) =>
            h(
              "li",
              {},
              d.title,
              d.license ? h("span", { class: "license" }, ` – ${licenseName(d.license)}`) : null,
            ),
          ),
        ),
        h("p", {}, extLink(`https://www.gbif.org/species/${doc.gbif_usage_key}`, "Arten på GBIF")),
      ),
    );
  }
}

export function licenseName(url: string): string {
  if (/publicdomain\/zero/.test(url) || /CC0/i.test(url)) return "CC0";
  const m = url.match(/licenses\/(by(?:-[a-z]+)*)\/(\d\.\d)/i);
  if (m) return `CC ${m[1].toUpperCase()} ${m[2]}`;
  return url.replace(/^https?:\/\//, "");
}
