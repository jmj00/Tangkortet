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

/** "Foto: Name · CC BY 4.0 · iNaturalist", the last part a link to the
 * observation (or the photo) on iNaturalist, as CC BY asks. */
export function creditParts(img: SpeciesImage): (string | HTMLElement)[] {
  const parts: (string | HTMLElement)[] = [`Foto: ${img.credit} · ${img.license} · `];
  const href = img.observation_url ?? img.photo_url;
  if (href) {
    parts.push(
      h(
        "a",
        {
          href,
          target: "_blank",
          rel: "noopener",
          title: "Se fundet og fotoet hos iNaturalist (nyt vindue)",
        },
        "iNaturalist",
      ),
    );
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

/** Full-screen photo viewer. A native modal <dialog>, so focus is trapped
 * while it is open, Escape closes it, and main.ts gives it a history entry (a
 * phone's Back closes it). `onClose` gets the photo shown last, so the hero
 * can follow and take the focus back. */
export function openViewer(
  name: string,
  images: readonly SpeciesImage[],
  start: number,
  onClose: (index: number) => void,
): void {
  let index = start;
  const n = images.length;

  const dialog = h("dialog", { class: "photo-viewer", "aria-label": `Fotos af ${name}` });
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
    const el = photoImg(heroSources(img.url), "100vw", "eager");
    el.className = "photo-viewer__img";
    el.alt = photoAlt(name, img, index, n);
    status.hidden = false;
    status.textContent = "Henter foto …";
    el.addEventListener("load", () => {
      if (el === image) status.hidden = true;
    });
    el.addEventListener("error", () => {
      if (el === image) status.textContent = "Fotoet kan ikke hentes lige nu.";
    });
    if (image) image.replaceWith(el);
    else stage.prepend(el);
    image = el;
    counter.textContent = n > 1 ? `${index + 1} / ${n}` : "";
    caption.replaceChildren(...creditParts(img));
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
  const unreviewed = anyUnreviewed(images);
  dialog.append(
    h(
      "div",
      { class: "photo-viewer__foot" },
      caption,
      unreviewed ? h("p", { class: "photo-viewer__note" }, UNREVIEWED_NOTE) : null,
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
