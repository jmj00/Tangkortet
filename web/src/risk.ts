// Risk factors near a pin, from the precomputed grid cells (pipeline/ingest/risk.py).
//
// ADR-0004: shown as a list of factors with distance and source, never a
// combined verdict. The group order below is a placeholder until the expert
// weighs the factors on the review page (review/, "Risikofaktorer"); it lives in
// one array so that answer is a one-line change.

import { distanceM } from "./geo";
import type { RiskCell, RiskIndex } from "./types";

export type GroupKey =
  "overloeb" | "rens" | "industri" | "havne" | "klapplads" | "akvakultur" | "regnvand" | "badevand";

export interface GroupInfo {
  key: GroupKey;
  label: string;
  /** Why it matters, from the expert's brief (§1-2). */
  why: string;
}

export const GROUPS: readonly GroupInfo[] = [
  {
    key: "overloeb",
    label: "Kloakoverløb",
    why: "Ved kraftig regn kan opspædet, urenset spildevand løbe ud her (fækal forurening).",
  },
  {
    key: "rens",
    label: "Renseanlæg",
    why: "Udleder renset spildevand; kan bidrage med fækal forurening og kemiske reststoffer.",
  },
  {
    key: "industri",
    label: "Industriudledning",
    why: "Direkte udledning af industrispildevand.",
  },
  {
    key: "havne",
    label: "Havn",
    why: "Bundmaling, kobber, zink, olie, brændstof og PAH'er kan være relevante.",
  },
  {
    key: "klapplads",
    label: "Klapplads",
    why: "Her dumpes (eller blev dumpet) opgravet havnesediment, som kan være forurenet.",
  },
  {
    key: "akvakultur",
    label: "Fiskeopdræt",
    why: "Udleder næringsstoffer og evt. medicinrester.",
  },
  {
    key: "regnvand",
    label: "Regnvandsudløb",
    why: "Regnvand fra veje og befæstede arealer; afstrømning øges ved kraftig regn.",
  },
  {
    key: "badevand",
    label: "Badevand",
    why: "EU-klassificeringen siger noget om bakterier, men intet om tangens kemiske sikkerhed.",
  },
];

export interface RiskItem {
  group: GroupKey;
  lon: number;
  lat: number;
  /** Metres from the pin; 0 when the pin is inside an area (klapplads). */
  distanceM: number;
  title: string;
  detail: string;
  link?: string;
  /** Sub-type the traffic-light rules can match on (verdict.ts): the harbour
   * type ("Erhvervshavn", ...), "aktiv" / "nedlagt" for a dumping site, the EU
   * bathing-water class digit ("1" ... "4", "0"). */
  kind?: string;
}

type Row = Record<string, unknown>;

function rows(cell: RiskCell, index: RiskIndex, layer: string): Row[] {
  const fields = index.layers[layer]?.fields;
  if (!fields) return [];
  return (cell[layer] ?? []).map((values) =>
    Object.fromEntries(fields.map((name, i) => [name, values[i]])),
  );
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function formatVolume(m3: unknown): string | null {
  if (typeof m3 !== "number" || m3 <= 0) return null;
  const rounded = m3 >= 10_000 ? Math.round(m3 / 1000) * 1000 : Math.round(m3 / 100) * 100;
  return `ca. ${rounded.toLocaleString("da-DK")} m³ pr. år (beregnet normalår)`;
}

const BATHING_QUALITY: Record<string, string> = {
  "1": "Udmærket",
  "2": "God",
  "3": "Tilfredsstillende",
  "4": "Ringe",
  "0": "Ikke klassificeret",
};

export function bathingQuality(raw: unknown): string {
  const code = str(raw)?.trim().charAt(0) ?? "";
  return BATHING_QUALITY[code] ?? "Ukendt";
}

function join(...parts: (string | null)[]): string {
  return parts.filter(Boolean).join(" · ");
}

/** Every layer row in `cells` turned into a RiskItem, with its distance to `pin`. */
export function riskItems(cells: RiskCell[], index: RiskIndex, pin: [number, number]): RiskItem[] {
  const items: RiskItem[] = [];
  const at = (r: Row): [number, number] => [r.lon as number, r.lat as number];
  const push = (
    group: GroupKey,
    r: Row,
    title: string,
    detail: string,
    link?: string,
    kind?: string,
  ) => {
    let d = distanceM(pin, at(r));
    if (typeof r.radius_m === "number") d = Math.max(0, d - r.radius_m);
    items.push({
      group,
      lon: r.lon as number,
      lat: r.lat as number,
      distanceM: d,
      title,
      detail,
      link,
      kind,
    });
  };

  for (const cell of cells) {
    for (const r of rows(cell, index, "rbu")) {
      const group = r.kind === "regnvand" ? "regnvand" : "overloeb";
      const type = r.kind === "ukendt" ? `type ${str(r.code) ?? "ukendt"}` : null;
      push(
        group,
        r,
        str(r.name) ?? "Udløb",
        join(str(r.owner), type, formatVolume(r.volume_m3_per_year)),
      );
    }
    for (const r of rows(cell, index, "rens")) {
      const pe =
        typeof r.capacity_pe === "number" ? `${r.capacity_pe.toLocaleString("da-DK")} PE` : null;
      push("rens", r, str(r.name) ?? "Renseanlæg", join(str(r.owner), pe, str(r.treatment)));
    }
    for (const r of rows(cell, index, "industri")) {
      push("industri", r, str(r.name) ?? "Industri", join(str(r.owner), str(r.discharge_type)));
    }
    for (const r of rows(cell, index, "akvakultur")) {
      push("akvakultur", r, str(r.name) ?? "Fiskeopdræt", join(str(r.owner), str(r.kind)));
    }
    for (const r of rows(cell, index, "havne")) {
      push(
        "havne",
        r,
        str(r.name) ?? "Havn",
        str(r.kind) ?? "",
        undefined,
        str(r.kind) ?? undefined,
      );
    }
    for (const r of rows(cell, index, "klapplads")) {
      push(
        "klapplads",
        r,
        str(r.name) ?? "Klapplads",
        r.active ? "Aktiv" : "Nedlagt",
        undefined,
        r.active ? "aktiv" : "nedlagt",
      );
    }
    for (const r of rows(cell, index, "badevand")) {
      const season = str(r.season);
      push(
        "badevand",
        r,
        str(r.name) ?? "Badested",
        `EU-klassificering: ${bathingQuality(r.quality)}${season ? ` (${season})` : ""}`,
        str(r.profile_url) ?? undefined,
        str(r.quality)?.trim().charAt(0),
      );
    }
  }
  return items;
}

export interface GroupResult extends GroupInfo {
  count: number;
  nearest: RiskItem[];
}

/** Items within `radiusM`, grouped in `GROUPS` order, nearest first. */
export function groupNearby(items: RiskItem[], radiusM: number, perGroup = 5): GroupResult[] {
  return GROUPS.map((g) => {
    const inGroup = items
      .filter((i) => i.group === g.key && i.distanceM <= radiusM)
      .sort((a, b) => a.distanceM - b.distanceM);
    return { ...g, count: inGroup.length, nearest: inGroup.slice(0, perGroup) };
  });
}
