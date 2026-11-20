// The combined traffic light (ADR-0005): a supplement to the list of factors,
// asked for by the expert so inexperienced foragers get a summary while
// experienced ones can see exactly why. Rules are data (verdict-rules.json),
// shown in the app and on the expert review page; status "udkast" until the
// expert has approved them.
//
// Green never means "safe": it means none of the rules matched the mapped data.

import { formatDistance } from "./geo";
import type { GroupKey, RiskItem } from "./risk";
import rulesFile from "./verdict-rules.json";

export type Level = "red" | "yellow" | "green" | "unknown";

export interface Rule {
  id: string;
  level: "red" | "yellow";
  type: "nearby" | "soil_v2" | "rain";
  text: string;
  groups?: string[];
  within_m?: number;
  kind_contains?: string;
  kinds?: string[];
  needs_rain?: boolean;
}

export interface RulesFile {
  status: string;
  version: string;
  rain_mm_48h: number;
  rules: Rule[];
}

export const RULES = rulesFile as RulesFile;

export interface VerdictInput {
  /** null = the grid cells failed to load. */
  items: RiskItem[] | null;
  /** mm in the last 48 h; null = unknown (DMI failed or no station). */
  rain48: number | null;
  /** V2 sites within 1 km; null = unknown. */
  soilV2: number | null;
}

export interface Reason {
  rule: Rule;
  /** e.g. "nærmeste: BK34U, 300 m" */
  evidence: string;
}

export interface Verdict {
  level: Level;
  reasons: Reason[];
  /** Rules that could not be checked because their data was missing. */
  unchecked: Rule[];
}

function matches(rule: Rule, item: RiskItem): boolean {
  if (!rule.groups?.includes(item.group as GroupKey)) return false;
  if (item.distanceM > (rule.within_m ?? 0)) return false;
  if (rule.kind_contains && !(item.kind ?? "").includes(rule.kind_contains)) return false;
  if (rule.kinds && !rule.kinds.includes(item.kind ?? "")) return false;
  return true;
}

const mm = (v: number) => `${String(Math.round(v * 10) / 10).replace(".", ",")} mm`;

export function evaluate(input: VerdictInput, file: RulesFile = RULES): Verdict {
  if (input.items === null) return { level: "unknown", reasons: [], unchecked: file.rules };
  const reasons: Reason[] = [];
  const unchecked: Rule[] = [];
  const rainy = input.rain48 !== null && input.rain48 >= file.rain_mm_48h;

  for (const rule of file.rules) {
    if (rule.type === "rain" || rule.needs_rain) {
      if (input.rain48 === null) {
        unchecked.push(rule);
        continue;
      }
      if (!rainy) continue;
    }
    if (rule.type === "rain") {
      reasons.push({ rule, evidence: `${mm(input.rain48 as number)} de seneste 48 timer` });
    } else if (rule.type === "soil_v2") {
      if (input.soilV2 === null) unchecked.push(rule);
      else if (input.soilV2 > 0)
        reasons.push({ rule, evidence: `${input.soilV2} grund${input.soilV2 > 1 ? "e" : ""}` });
    } else {
      const hits = input.items
        .filter((i) => matches(rule, i))
        .sort((a, b) => a.distanceM - b.distanceM);
      if (hits.length) {
        const n = hits[0];
        const more = hits.length > 1 ? ` (+${hits.length - 1} flere)` : "";
        reasons.push({
          rule,
          evidence: `nærmeste: ${n.title}, ${formatDistance(n.distanceM)}${more}`,
        });
      }
    }
  }

  // A rule satisfied at red also satisfies its yellow sibling (e.g. an overflow
  // at 300 m); show each finding once, at its most severe level.
  const redGroups = new Set(
    reasons.filter((r) => r.rule.level === "red").flatMap((r) => r.rule.groups ?? []),
  );
  const shown = reasons.filter(
    (r) =>
      r.rule.level === "red" ||
      r.rule.type !== "nearby" ||
      !(r.rule.groups ?? []).every((g) => redGroups.has(g)),
  );

  const level: Level = shown.some((r) => r.rule.level === "red")
    ? "red"
    : shown.length
      ? "yellow"
      : "green";
  return { level, reasons: shown, unchecked };
}

export const LEVEL_TEXT: Record<Level, { title: string; text: string }> = {
  red: {
    title: "Rød – høj risiko",
    text: "Vi fraråder at sanke her.",
  },
  yellow: {
    title: "Gul – vær opmærksom",
    text: "Der er kendte risikokilder i nærheden. Se hvorfor, og vurder selv.",
  },
  green: {
    title: "Grøn – få kendte risikokilder",
    text: "Ingen af reglerne slår ud på de kortlagte data. Det er ingen garanti.",
  },
  unknown: {
    title: "Kan ikke vurderes",
    text: "De kortlagte kilder kunne ikke hentes.",
  },
};
