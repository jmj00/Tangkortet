// The species photos' credit line and full-screen viewer. From Svampekortet
// 624fb8b (web/src/detail.ts, openViewer / creditLine), adapted: iNaturalist
// links, and the note that the photos are not reviewed yet, which also shows
// here, where a photo is looked at closely.

import "./photoviewer.css";

import { h } from "./dom";
import { heroSources, photoImg } from "./thumb";
import type { SpeciesImage } from "./types";

/** Said wherever the photos are, until the expert has checked them: seaweeds
 * (Ulva especially) are hard to tell apart from a photo. */
export const UNREVIEWED_NOTE =
  "Fotos er ikke gennemgået af en fagperson endnu – brug dem ikke alene til at bestemme arten.";

export function anyUnreviewed(images: readonly SpeciesImage[]): boolean {
  return images.some((img) => !img.reviewed);
}

/** The licence deeds a credit links to (CC BY 4.0 §3(a)(1)(C)). */
const LICENSE_URL: Record<string, string> = {
  "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
  "CC0 1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
};

export function licenseUrl(license: string): string | null {
  return LICENSE_URL[license.trim()] ?? null;
}

function link(href: string, text: string, title: string): HTMLAnchorElement {
  return h("a", { href, target: "_blank", rel: "noopener", title }, text);
}

/** "Foto: Name · CC BY 4.0 · iNaturalist": the licence links to its deed, and
 * iNaturalist to the observation (or the photo), as CC BY asks. */
export function creditParts(img: SpeciesImage): (string | HTMLElement)[] {
  const deed = licenseUrl(img.license);
  const parts: (string | HTMLElement)[] = [
    `Foto: ${img.credit} · `,
    deed ? link(deed, img.license, "Licensen (nyt vindue)") : img.license,
    " · ",
  ];
  const href = img.observation_url ?? img.photo_url;
  if (href) {
    parts.push(link(href, "iNaturalist", "Se fundet og fotoet hos iNaturalist (nyt vindue)"));
  } else {
    parts.push("iNaturalist");
  }
  return parts;
}

/** The photo's text alternative. It names the species the photo was filed
 * under, not what it shows: unreviewed, it is no proof of the species. */
export function photoAlt(name: string, img: SpeciesImage, i: number, n: number): string {
  const which = n > 1 ? `Foto ${i + 1} af ${n}` : "Foto";
  return img.reviewed ? `${which}: ${name}` : `${which}, angivet som ${name} (ikke gennemgået)`;
}

const ICON = {
  close:
    '<path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  prev: '<path d="M12.5 4 6.5 10l6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  next: '<path d="m7.5 4 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
} as const;

function iconButton(className: string, label: string, name: keyof typeof ICON): HTMLButtonElement {
  const button = h("button", { type: "button", class: className, "aria-label": label });
  button.innerHTML = `<svg viewBox="0 0 20 20" width="22" height="22" aria-hidden="true" focusable="false">${ICON[name]}</svg>`;
  return button;
}

/** One photo for the viewer: its sources, text alternative and credit line. */
export interface ViewerPhoto {
  src: string;
  srcset?: string;
  alt: string;
  credit: (string | HTMLElement)[];
}

/** The species photos in the viewer, with the note that they are unreviewed. */
export function openViewer(
  name: string,
  images: readonly SpeciesImage[],
  start: number,
  onClose: (index: number) => void,
): void {
  const n = images.length;
  openPhotoViewer(
    `Fotos af ${name}`,
    images.map((img, i) => ({
      ...heroSources(img.url),
      alt: photoAlt(name, img, i, n),
      credit: creditParts(img),
    })),
    start,
    onClose,
    anyUnreviewed(images) ? UNREVIEWED_NOTE : null,
  );
}

/** Full-screen photo viewer. A native modal <dialog>, so focus is trapped
 * while it is open, Escape closes it, and main.ts gives it a history entry (a
 * phone's Back closes it). `onClose` gets the photo shown last, so the hero
 * can follow and take the focus back. Also the place cards' (placecard.ts). */
export function openPhotoViewer(
  label: string,
  images: readonly ViewerPhoto[],
  start: number,
  onClose: (index: number) => void,
  note: string | null = null,
): void {
  let index = start;
  const n = images.length;

  const dialog = h("dialog", { class: "photo-viewer", "aria-label": label });
  const close = iconButton("photo-viewer__btn photo-viewer__close", "Luk fotovisning", "close");
  const counter = h("p", { class: "photo-viewer__count", "aria-live": "polite" });
  const stage = h("div", { class: "photo-viewer__stage" });
  // "Henter foto …" until the photo is in, then nothing, or why not
  const status = h("p", { class: "photo-viewer__status" });
  const caption = h("p", { class: "photo-viewer__caption" });
  let image: HTMLImageElement | null = null;

  const show = (next: number) => {
    index = (next + n) % n;
    const img = images[index];
    // a new element per photo: the old one's late error must not hide this one
    // medium where it is enough (often cached already from the hero), large on
    // wide or dense screens
    const el = photoImg(img, "100vw", "eager");
    el.className = "photo-viewer__img";
    el.alt = img.alt;
    status.hidden = false;
    status.textContent = "Henter foto …";
    el.addEventListener("load", () => {
      if (el === image) status.hidden = true;
    });
    el.addEventListener("error", () => {
      // no broken-image icon or alt text over the message
      el.hidden = true;
      if (el === image) status.textContent = "Fotoet kan ikke hentes lige nu.";
    });
    if (image) image.replaceWith(el);
    else stage.prepend(el);
    image = el;
    counter.textContent = n > 1 ? `${index + 1} / ${n}` : "";
    caption.replaceChildren(...img.credit);
  };

  stage.append(status);
  dialog.append(h("div", { class: "photo-viewer__top" }, counter, close), stage);

  if (n > 1) {
    const prev = iconButton("photo-viewer__btn photo-viewer__prev", "Forrige foto", "prev");
    const next = iconButton("photo-viewer__btn photo-viewer__next", "Næste foto", "next");
    prev.addEventListener("click", () => show(index - 1));
    next.addEventListener("click", () => show(index + 1));
    stage.append(prev, next);

    dialog.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") show(index - 1);
      if (event.key === "ArrowRight") show(index + 1);
    });
    let touchX: number | null = null;
    stage.addEventListener("touchstart", (event) => (touchX = event.touches[0].clientX), {
      passive: true,
    });
    stage.addEventListener("touchend", (event) => {
      if (touchX === null) return;
      const dx = event.changedTouches[0].clientX - touchX;
      touchX = null;
      if (Math.abs(dx) > 40) show(index + (dx < 0 ? 1 : -1));
    });
  }
  dialog.append(
    h(
      "div",
      { class: "photo-viewer__foot" },
      caption,
      note ? h("p", { class: "photo-viewer__note" }, note) : null,
    ),
  );

  close.addEventListener("click", () => dialog.close());
  // a click on the dark area around the photo closes too
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || event.target === stage) dialog.close();
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    onClose(index);
  });

  show(start);
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
}
