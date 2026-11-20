// "Om Tangkortet": what the app is and isn't, and where the data comes from.

import { h, extLink } from "./dom";
import { DISCLAIMER } from "./riskpanel";
import type { Manifest } from "./types";

export function openAbout(manifest: Manifest | null): void {
  const dialog = h(
    "dialog",
    { class: "about", "aria-labelledby": "about-title" },
    h("h2", { id: "about-title" }, "Om Tangkortet"),
    h(
      "p",
      {},
      "Tangkortet viser, hvor tangarter er fundet langs de danske kyster – fastsiddende på bunden eller skyllet op – og hvilke mulige forureningskilder der ligger nær et sted, du vil sanke.",
    ),
    h("p", { class: "disclaimer" }, DISCLAIMER),
    h(
      "p",
      {},
      "Appen siger aldrig, at et sted eller en tang er sikker at spise. Felter markeret “foreløbig” eller “afventer ekspert” er endnu ikke gennemgået af en fagperson.",
    ),
    h("h3", {}, "Data"),
    h(
      "ul",
      { class: "plain" },
      ...(manifest
        ? Object.values(manifest.attribution).map((a) => h("li", {}, a))
        : [h("li", {}, "Henter…")]),
      h(
        "li",
        {},
        "Kortlagt jordforurening: DKJord via ",
        extLink("https://kort.vd.dk", "Vejdirektoratets kortserver"),
      ),
      h("li", {}, "Naturbeskyttelse: Danmarks Miljøportal"),
    ),
    manifest ? h("p", { class: "note" }, `Dataversion ${manifest.version}`) : null,
    h("form", { method: "dialog" }, h("button", { type: "submit", class: "primary" }, "Luk")),
  );
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
