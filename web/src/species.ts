// Display logic for a species: finds near a pin, and the expert-dependent fields
// with their "afventer ekspert" / "foreløbig" fallbacks. Pure, for testing.

import { distanceM } from "./geo";
import type { ExpertFields, SpeciesDoc } from "./types";

export const NEAR_PIN_M = 10_000;

export const PENDING = "Afventer ekspert";

const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

/** Finds within `radiusM` of the pin, split by attachment. */
export function findsNear(
  doc: SpeciesDoc,
  pin: [number, number],
  radiusM = NEAR_PIN_M,
): { attached: number; drift: number; unknown: number; total: number } {
  const counts = { attached: 0, drift: 0, unknown: 0, total: 0 };
  for (const [lon, lat, , a] of doc.observations) {
    if (distanceM(pin, [lon, lat]) > radiusM) continue;
    counts.total++;
    if (a === 0) counts.attached++;
    else if (a === 1) counts.drift++;
    else counts.unknown++;
  }
  return counts;
}

const num = (v: number) => String(v).replace(".", ",");

export interface FieldText {
  text: string;
  /** "expert" = signed off; "provisional" = expert value not yet verified;
   * "data" = derived from finds only; "pending" = nothing yet. */
  status: "expert" | "provisional" | "data" | "pending";
}

function expertStatus(e: ExpertFields): FieldText["status"] {
  return e.verified ? "expert" : "provisional";
}

export function depthText(doc: SpeciesDoc): FieldText {
  const e = doc.expert;
  if (e.depth_m) {
    return { text: `${num(e.depth_m[0])}–${num(e.depth_m[1])} m`, status: expertStatus(e) };
  }
  const d = doc.observed_depth;
  if (d) {
    return {
      text: `Ifølge fund: typisk ${num(d.p10)}–${num(d.p90)} m (median ${num(d.median)} m, ${d.n} fund med dybde)`,
      status: "data",
    };
  }
  return { text: PENDING, status: "pending" };
}

const HARVEST: Record<string, string> = {
  klip_skudspids: "Klip skudspidserne af med saks – arten vokser fra spidserne.",
  hel_plade: "Høst hele bladpladen eller tæt ved stipes (stammen) – arten vokser fra bladpladen.",
  andet: "Se noter.",
};

export function harvestText(doc: SpeciesDoc): FieldText {
  const m = doc.expert.harvest_method;
  return m
    ? { text: HARVEST[m], status: expertStatus(doc.expert) }
    : { text: PENDING, status: "pending" };
}

export function seasonText(doc: SpeciesDoc): FieldText {
  const months = doc.expert.season_months;
  if (!months?.length) return { text: PENDING, status: "pending" };
  return {
    text: [...months]
      .sort((a, b) => a - b)
      .map((m) => MONTHS[m - 1])
      .join(", "),
    status: expertStatus(doc.expert),
  };
}

const ACCUMULATION: Record<string, string> = { jod: "jod", arsen: "arsen", cadmium: "cadmium" };

export function accumulationText(doc: SpeciesDoc): FieldText {
  const a = doc.expert.accumulation;
  if (!a) return { text: PENDING, status: "pending" };
  if (a.length === 0) return { text: "Ingen særlig advarsel.", status: expertStatus(doc.expert) };
  return {
    text: `Kan ophobe ${a.map((x) => ACCUMULATION[x]).join(", ")}.`,
    status: expertStatus(doc.expert),
  };
}
