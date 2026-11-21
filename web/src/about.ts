// "Om Tangkortet": what the app is and isn't, and where the data comes from.

import { h, extLink } from "./dom";
import { welcomeText } from "./welcome";
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
    ...welcomeText(),
    h("h3", {}, "Data"),
    h(
      "ul",
      { class: "plain" },
      ...(manifest
        ? Object.entries(manifest.attribution).map(([key, a]) =>
            // the coast cells (ODbL) and the names (CC BY 4.0): link the licence
            key === "coast" && manifest.coast?.license_url
              ? h("li", {}, `${a} (`, extLink(manifest.coast.license_url, "licensen"), ")")
              : key === "names" && manifest.names?.license_url
                ? h("li", {}, `${a} (`, extLink(manifest.names.license_url, "licensen"), ")")
                : key === "places" && manifest.place_info?.license_url
                  ? h(
                      "li",
                      {},
                      `${a} (`,
                      extLink(manifest.place_info.license_url, "tekstlicensen"),
                      ", ",
                      // the outlines and shores are derived from OpenStreetMap
                      extLink("https://opendatacommons.org/licenses/odbl/1-0/", "ODbL"),
                      ")",
                    )
                  : h("li", {}, a),
          )
        : [h("li", {}, "Henter…")]),
      h(
        "li",
        {},
        "Kortlagt jordforurening: DKJord via ",
        extLink("https://kort.vd.dk", "Vejdirektoratets kortserver"),
      ),
      h("li", {}, "Naturbeskyttelse: Danmarks Miljøportal"),
      h(
        "li",
        {},
        "Byer, postnumre og stednavne i søgningen: Indeholder data fra Klimadatastyrelsen (CC BY 4.0)",
      ),
      // the "Luftfoto" button exists only with the Datafordeler key (map.ts)
      import.meta.env.VITE_DATAFORDELER_API_KEY
        ? h(
            "li",
            {},
            "Luftfoto: GeoDanmark Ortofoto forår, Klimadatastyrelsen (CC BY 4.0), via Datafordeler",
          )
        : null,
    ),
    manifest ? h("p", { class: "note" }, `Dataversion ${manifest.version}`) : null,
    h("form", { method: "dialog" }, h("button", { type: "submit", class: "primary" }, "Luk")),
  );
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
