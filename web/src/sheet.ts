// The phone bottom sheet: #panel dragged between three snap points. Ported
// from Svampekortet (624fb8b, web/src/sheet.ts), with the snap and flick
// decisions pulled out as pure functions so they can be tested.
//
//   peek  only the header shows (grab handle, pin readout, the three tabs)
//   half  just over half the app height; the map keeps the rest
//   full  up to just below the address search (or the top of the screen)
//
// The sheet is laid out at its full height and moved with a transform, so a
// drag never reflows the content. Once it settles, the part hanging below the
// screen is taken off the scroll area (--sheet-hidden), so the content can
// always be scrolled to its end by wheel, keyboard or assistive tech, at any
// snap. By touch the usual map-app rule applies: a vertical drag on the content
// moves the sheet until it is fully open, and only then scrolls; pulling down
// from the top of the content collapses it again.
//
// From 720px wide (and on short landscape phones from 560px) the same element
// is a static sidebar (style.css) and everything here is switched off.

export type Snap = "peek" | "half" | "full";
export type SnapHeights = Record<Snap, number>;

export interface Sheet {
  /** True while the phone layout (and so the draggable sheet) is in effect. */
  isActive(): boolean;
  snap(): Snap;
  snapTo(snap: Snap, animate?: boolean): void;
  /** Raise to `snap` if the sheet is currently lower. No-op on desktop. */
  atLeast(snap: Snap, animate?: boolean): void;
  /** Lower to `snap` if the sheet is currently higher. No-op on desktop. */
  atMost(snap: Snap): void;
  /** Visible height of the sheet at the half snap, in px (0 on desktop). */
  halfHeight(): number;
  /** Re-measure on the next frame (something outside the sheet moved it). */
  relayout(): void;
}

interface SheetOptions {
  app: HTMLElement;
  sheet: HTMLElement;
  header: HTMLElement;
  handle: HTMLButtonElement;
  body: HTMLElement;
  /** Called when the geometry changes (first layout, resize, breakpoint). */
  onLayout?: () => void;
  /** Called after every snap (not during a drag). */
  onSnap?: (snap: Snap) => void;
}

export const ORDER: readonly Snap[] = ["peek", "half", "full"];
// The phone layout, as in style.css: narrower than 720px, except short
// landscape screens from 560px wide, which get the sidebar instead.
export const PHONE_LAYOUT =
  "(max-width: 559.98px), (max-width: 719.98px) and (min-height: 520.02px)";
export const HALF_FRACTION = 0.53; // of the app height; style.css fallbacks assume the same
// Below this app height a half-open sheet would leave no usable map, so the
// sheet has only two stops: peek and full.
export const MIN_HEIGHT_FOR_HALF = 520;
/** The half snap shows at least this much content below the header. */
const MIN_HALF_CONTENT = 140;
export const STALE_MS = 90; // a release this long after the last movement is not a flick
export const FLICK_VELOCITY = 0.45; // px/ms
const DRAG_SLOP = 6; // px of movement before a press becomes a drag
const SETTLE_MS = 340; // a little over --dur-sheet in style.css

/** What activating the handle does next, as its accessible name. */
const HANDLE_LABEL: Record<Snap, string> = {
  peek: "Åbn panelet halvt",
  half: "Åbn panelet helt",
  full: "Skjul panelet",
};

// ---- pure helpers (sheet.test.ts) -------------------------------------------

/** The visible sheet height at each snap, in px. `full`: the sheet's laid-out
 * height; `header`: its header; `safeBottom`: the home-indicator inset;
 * `appHeight`: the whole app. */
export function snapHeights(
  full: number,
  header: number,
  safeBottom: number,
  appHeight: number,
): SnapHeights {
  const peek = Math.min(full, header + safeBottom);
  const half =
    appHeight >= MIN_HEIGHT_FOR_HALF
      ? Math.round(Math.min(full, Math.max(appHeight * HALF_FRACTION, peek + MIN_HALF_CONTENT)))
      : peek;
  return { peek, half, full };
}

/** The stops the sheet has: on very short screens "half" is where "peek" is. */
export function stopsFor(heights: SnapHeights): readonly Snap[] {
  return heights.half <= heights.peek ? ["peek", "full"] : ORDER;
}

export interface Sample {
  y: number;
  t: number;
}

/** Release velocity in px/ms, upwards positive, from the last few pointer
 * samples. A finger that stopped before lifting has no velocity, however fast
 * it moved earlier. */
export function releaseVelocity(samples: readonly Sample[], now: number): number {
  if (samples.length < 2) return 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dt = last.t - first.t;
  if (dt <= 0 || now - last.t > STALE_MS) return 0;
  return (first.y - last.y) / dt;
}

/** Where a drag released at `visible` px with `velocity` comes to rest: a
 * flick goes to the next stop in its direction, anything else to the nearest. */
export function pickSnap(
  heights: SnapHeights,
  stops: readonly Snap[],
  visible: number,
  velocity: number,
): Snap {
  if (Math.abs(velocity) > FLICK_VELOCITY) {
    if (velocity > 0) return stops.find((s) => heights[s] > visible + 1) ?? "full";
    return [...stops].reverse().find((s) => heights[s] < visible - 1) ?? "peek";
  }
  return stops.reduce((best, s) =>
    Math.abs(heights[s] - visible) < Math.abs(heights[best] - visible) ? s : best,
  );
}

// ---- the sheet ----------------------------------------------------------------

export function initSheet(opts: SheetOptions): Sheet {
  const { app, sheet, header, handle, body } = opts;
  const phone = window.matchMedia(PHONE_LAYOUT);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const coarsePointer = window.matchMedia("(pointer: coarse)");

  let active = false;
  let current: Snap = "half";
  /** The snap last asked for. On a two-stop screen "half" is shown as peek or
   * full; this remembers it, so half comes back when there is room again. */
  let wanted: Snap = "half";
  let heights: SnapHeights = { peek: 0, half: 0, full: 0 };
  let visible = 0;
  let settleTimer: number | undefined;
  let laidOut = false;

  function measure(): void {
    // The home-indicator inset, read off a probe (#panel::after in style.css).
    const safeBottom = parseFloat(getComputedStyle(sheet, "::after").height) || 0;
    heights = snapHeights(sheet.offsetHeight, header.offsetHeight, safeBottom, app.clientHeight);
  }

  const twoStops = (): boolean => stopsFor(heights).length === 2;

  function place(px: number): void {
    visible = px;
    sheet.style.setProperty("--sheet-y", `${heights.full - px}px`);
    // Map controls ride the sheet's top edge up to the half snap; above that
    // the sheet simply slides over them. camera.ts reads the same property.
    app.style.setProperty("--map-inset-bottom", `${Math.round(Math.min(px, heights.half))}px`);
  }

  function setHidden(px: number): void {
    sheet.style.setProperty("--sheet-hidden", `${Math.max(0, px)}px`);
  }

  function settle(): void {
    window.clearTimeout(settleTimer);
    settleTimer = undefined;
    setHidden(heights.full - heights[current]);
    // At peek the content is entirely below the screen: keep it out of the tab
    // order and away from assistive tech until the sheet is raised again.
    body.inert = current === "peek";
  }

  /** `halfMeans`: where a request for "half" goes when there are only two stops. */
  function snapTo(next: Snap, animate = true, halfMeans: "peek" | "full" = "full"): void {
    if (!active) return;
    wanted = next;
    if (next === "half" && twoStops()) next = halfMeans;
    const rising = heights[next] > visible;
    if (next === "peek" && body.contains(document.activeElement)) handle.focus();
    current = next;
    sheet.dataset.snap = next;
    // With two stops, the step up from peek is all the way.
    handle.setAttribute("aria-label", HANDLE_LABEL[next === "peek" && twoStops() ? "half" : next]);
    handle.setAttribute("aria-expanded", String(next !== "peek"));
    delete app.dataset.sheetDragging;
    window.clearTimeout(settleTimer);
    if (rising) {
      // Give the content its new, larger scroll area before it slides into view.
      body.inert = false;
      setHidden(heights.full - heights[next]);
    }
    if (!animate || reducedMotion.matches) {
      // Really instant: the CSS transitions are off while this attribute is set.
      app.dataset.sheetDragging = "";
      place(heights[next]);
      void sheet.offsetHeight; // commit the position before transitions return
      delete app.dataset.sheetDragging;
      settle();
    } else {
      place(heights[next]);
      settleTimer = window.setTimeout(settle, SETTLE_MS);
    }
    opts.onSnap?.(next);
  }

  function layout(): void {
    const wasActive = active;
    active = phone.matches;
    if (!active) {
      window.clearTimeout(settleTimer);
      sheet.style.removeProperty("--sheet-y");
      sheet.style.removeProperty("--sheet-hidden");
      app.style.removeProperty("--map-inset-bottom");
      delete app.dataset.sheetDragging;
      delete app.dataset.sheetReady;
      delete sheet.dataset.snap;
      handle.removeAttribute("aria-expanded");
      body.inert = false;
      if (wasActive || !laidOut) opts.onLayout?.();
      laidOut = true;
      return;
    }
    laidOut = true;
    measure();
    snapTo(wanted, false, "peek"); // a short screen opens on the map, not the list
    opts.onLayout?.();
    // Transitions only switch on after the first placement, so the sheet does
    // not animate in from its CSS fallback position on load.
    if (app.dataset.sheetReady === undefined) {
      requestAnimationFrame(() => {
        if (active) app.dataset.sheetReady = "";
      });
    }
  }

  // ---- dragging -----------------------------------------------------------
  let dragStartY = 0;
  let dragStartVisible = 0;
  let samples: Sample[] = [];

  let dragging = false;
  let layoutPending = false;

  function dragStart(y: number): void {
    dragging = true;
    window.clearTimeout(settleTimer);
    app.dataset.sheetDragging = "";
    body.inert = false;
    setHidden(0); // full-height content while it moves; trimmed again on settle
    dragStartY = y;
    dragStartVisible = visible;
    samples = [{ y, t: performance.now() }];
  }

  function dragMove(y: number): void {
    const next = dragStartVisible + (dragStartY - y);
    place(Math.min(heights.full, Math.max(heights.peek, next)));
    samples.push({ y, t: performance.now() });
    if (samples.length > 5) samples.shift();
  }

  function dragEnd(): void {
    dragging = false;
    const velocity = releaseVelocity(samples, performance.now());
    snapTo(pickSnap(heights, stopsFor(heights), visible, velocity));
    if (layoutPending) relayout(); // a resize that arrived mid-drag
  }

  // Header (handle, readout, tabs): drag with touch, pen or mouse. A press
  // that never moves stays an ordinary click on whatever was under it.
  let headerPointer: number | null = null;
  let headerDown = 0;
  let headerDragging = false;

  header.addEventListener("pointerdown", (e) => {
    if (!active || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    headerPointer = e.pointerId;
    headerDown = e.clientY;
    headerDragging = false;
  });
  header.addEventListener("pointermove", (e) => {
    if (e.pointerId !== headerPointer) return;
    if (!headerDragging) {
      if (Math.abs(e.clientY - headerDown) < DRAG_SLOP) return;
      headerDragging = true;
      header.setPointerCapture(e.pointerId);
      dragStart(headerDown);
    }
    dragMove(e.clientY);
  });
  const headerRelease = (e: PointerEvent): void => {
    if (e.pointerId !== headerPointer) return;
    headerPointer = null;
    if (!headerDragging) return;
    headerDragging = false;
    dragEnd();
    // The release must not also count as a click on a tab or the handle.
    const swallow = (click: Event): void => {
      click.stopPropagation();
      click.preventDefault();
    };
    header.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => header.removeEventListener("click", swallow, { capture: true }), 0);
  };
  header.addEventListener("pointerup", headerRelease);
  header.addEventListener("pointercancel", headerRelease);

  // Content: touch only. Decide once per gesture whether it moves the sheet or
  // is left to the browser (scrolling the content, a sideways swipe).
  let touchX = 0;
  let touchY = 0;
  let touchMode: "undecided" | "sheet" | "native" = "native";

  function scrolledToTop(from: EventTarget | null): boolean {
    for (let el = from as HTMLElement | null; el && el !== sheet; el = el.parentElement) {
      if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) return false;
    }
    return true;
  }

  body.addEventListener(
    "touchstart",
    (e) => {
      if (!active || e.touches.length !== 1) {
        touchMode = "native";
        return;
      }
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
      touchMode = "undecided";
    },
    { passive: true },
  );
  body.addEventListener(
    "touchmove",
    (e) => {
      if (touchMode === "native" || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - touchX;
      const dy = e.touches[0].clientY - touchY;
      if (touchMode === "undecided") {
        if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
        const vertical = Math.abs(dy) > Math.abs(dx);
        const takesSheet = vertical && (current !== "full" || (dy > 0 && scrolledToTop(e.target)));
        if (!takesSheet) {
          touchMode = "native";
          return;
        }
        touchMode = "sheet";
        dragStart(touchY);
      }
      if (e.cancelable) e.preventDefault();
      dragMove(e.touches[0].clientY);
    },
    { passive: false },
  );
  const touchRelease = (): void => {
    if (touchMode === "sheet") dragEnd();
    touchMode = "native";
  };
  body.addEventListener("touchend", touchRelease);
  body.addEventListener("touchcancel", touchRelease);

  // ---- keyboard and focus -------------------------------------------------
  const step = (by: number): void => {
    const list = stopsFor(heights);
    const i = list.indexOf(current) + by;
    if (i >= 0 && i < list.length) snapTo(list[i]);
  };
  handle.addEventListener("click", () => {
    const list = stopsFor(heights);
    snapTo(list[(list.indexOf(current) + 1) % list.length]);
  });
  handle.addEventListener("keydown", (e) => {
    if (!active) return;
    if (e.key === "ArrowUp") step(1);
    else if (e.key === "ArrowDown") step(-1);
    else if (e.key === "Home") snapTo("full");
    else if (e.key === "End") snapTo("peek");
    else return;
    e.preventDefault();
  });

  // Focus that lands in the content (a script moving it there, or a text
  // field) opens the sheet at once, without animation: on a touch device the
  // on-screen keyboard covers about the lower half of the screen, which is
  // where a half-open sheet sits, and iOS decides where to scroll for the
  // keyboard from where the field is at this instant.
  body.addEventListener("focusin", (e) => {
    if (!active || current === "full") return;
    const t = e.target as HTMLElement;
    const typing =
      t instanceof HTMLTextAreaElement ||
      (t instanceof HTMLInputElement &&
        !["checkbox", "radio", "range", "button", "submit"].includes(t.type));
    if (typing && coarsePointer.matches) snapTo("full", false);
    else if (current === "peek") snapTo("half", false);
  });
  // iOS may still pan the page under the keyboard; the app is one fixed screen.
  window.visualViewport?.addEventListener("resize", () => {
    if (active && (window.scrollX !== 0 || window.scrollY !== 0)) window.scrollTo(0, 0);
  });

  // ---- geometry changes ---------------------------------------------------
  let frame = 0;
  const relayout = (): void => {
    if (dragging) {
      layoutPending = true; // never re-measure under a finger; dragEnd picks it up
      return;
    }
    layoutPending = false;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(layout);
  };
  window.addEventListener("resize", relayout);
  phone.addEventListener("change", relayout);
  if ("ResizeObserver" in window) {
    // The header (the readout wraps) and the sheet itself (its top follows
    // the address search, which can appear or grow late).
    const resized = new ResizeObserver(relayout);
    resized.observe(header);
    resized.observe(sheet, { box: "border-box" }); // not its padding (--sheet-hidden)
  }
  layout();

  const rank = (s: Snap): number => ORDER.indexOf(s);
  return {
    isActive: () => active,
    snap: () => current,
    snapTo: (s, animate = true) => snapTo(s, animate),
    atLeast: (s, animate = true) => {
      if (active && rank(current) < rank(s)) snapTo(s, animate);
    },
    atMost: (s) => {
      if (active && rank(current) > rank(s)) snapTo(s, true, "peek");
    },
    halfHeight: () => (active ? heights.half : 0),
    relayout,
  };
}
