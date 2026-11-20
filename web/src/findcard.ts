// The card for a tapped find on the map (a MapLibre popup, main.ts): the
// species, attached or washed up, the year and the depth when recorded.
// Styled in map.css (.find-card), after Svampekortet 624fb8b's find card.

import type { Attachment } from "./types";

export interface FindProps {
  a: Attachment | string;
  year: number | null;
  depth: number | null;
}

export const ATTACHMENT_TEXT: Record<Attachment, string> = {
  attached: "Fastsiddende",
  drift: "Opskyllet",
  unknown: "Ukendt om fastsiddende",
};

/** The card's lines after the name: attachment, year, depth. Pure. */
export function findLines(p: FindProps): string[] {
  const lines = [
    ATTACHMENT_TEXT[p.a as Attachment] ?? p.a,
    typeof p.year === "number" && p.year > 0 ? `Fundet ${p.year}` : "Årstal ukendt",
  ];
  if (typeof p.depth === "number") lines.push(`Dybde ${String(p.depth).replace(".", ",")} m`);
  return lines;
}

/** The popup's content. `onClose` closes the popup (the close button). */
export function findCard(
  name: string | null,
  props: FindProps,
  color: string,
  onClose: () => void,
): HTMLElement {
  const card = document.createElement("div");
  card.className = "find-card__content";

  const head = document.createElement("div");
  head.className = "find-card__head";
  const title = document.createElement("h2");
  title.className = "find-card__title";
  title.textContent = name ?? "Fund";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "find-card__close";
  close.setAttribute("aria-label", "Luk fundet");
  close.textContent = "×";
  close.addEventListener("click", onClose);
  head.append(title, close);

  const [kind, ...rest] = findLines(props);
  const kindLine = document.createElement("p");
  kindLine.className = "find-card__line find-card__kind";
  const mark = document.createElement("span");
  const a = (props.a in ATTACHMENT_TEXT ? props.a : "unknown") as Attachment;
  mark.className = `map-key__dot map-key__dot--${a}`;
  mark.style.setProperty("--c", color);
  mark.setAttribute("aria-hidden", "true");
  kindLine.append(mark, kind);

  card.append(head, kindLine);
  for (const line of rest) {
    const p = document.createElement("p");
    p.className = "find-card__line";
    p.textContent = line;
    card.append(p);
  }
  return card;
}
