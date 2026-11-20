// First-visit message, asked for by the expert (review page, round 2): what the
// app is, that it is a noncommercial hobby project, and an invitation to report
// finds. Shown once per browser; the same text is in "Om Tangkortet".

import { h, extLink } from "./dom";

const SEEN_KEY = "tangkortet.welcome.v1";

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

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true; // storage blocked: don't nag on every visit
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // ignore: private mode or blocked storage
  }
}

/** Show the welcome dialog unless this browser has seen it. */
export function maybeWelcome(): void {
  if (seen()) return;
  const dialog = h(
    "dialog",
    { class: "about welcome", "aria-labelledby": "welcome-title" },
    h("h2", { id: "welcome-title" }, "Velkommen til Tangkortet"),
    ...welcomeText(),
    h(
      "p",
      { class: "disclaimer" },
      "Kortet viser mulige risici – det er ingen garanti for, at et sted eller tangen er fri for forurening.",
    ),
    h(
      "form",
      { method: "dialog" },
      h("button", { type: "submit", class: "primary" }, "Kom i gang"),
    ),
  );
  dialog.addEventListener("close", () => {
    markSeen();
    dialog.remove();
  });
  document.body.append(dialog);
  dialog.showModal();
}
