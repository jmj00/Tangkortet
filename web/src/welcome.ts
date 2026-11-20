// The welcome message, asked for by the expert (review page, round 2): what the
// app is, that it is a noncommercial hobby project, and an invitation to report
// finds. Its words are the expert's and stay as they are. It was a first-visit
// dialog; the start screen (start.ts) now carries it on every visit, and "Om
// Tangkortet" (about.ts) shows the same text.

import { h, extLink } from "./dom";

/** The expert's line under the welcome; the start screen's safety line. */
export const WELCOME_DISCLAIMER =
  "Kortet viser mulige risici – det er ingen garanti for, at et sted eller tangen er fri for forurening.";

export function welcomeText(): HTMLElement[] {
  return [
    h(
      "p",
      {},
      "Tangkortet er et ikke-kommercielt hobbyprojekt, der skal gøre det nemmere for almindelige danskere at sanke tang langs de danske kyster.",
    ),
    h(
      "p",
      {},
      "Finder du tang gennem appen, så registrér gerne fundet, fx på ",
      extLink("https://arter.dk", "arter.dk"),
      ", ",
      extLink("https://www.inaturalist.org", "iNaturalist"),
      " eller ",
      extLink("https://www.naturbasen.dk", "Naturbasen"),
      ". Dine fund gør kortet bedre for alle.",
    ),
  ];
}
