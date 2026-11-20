import { describe, expect, it } from "vitest";

import { initNavigation, plan, readNavState, type HistoryLike, type Snapshot } from "./nav";

// Adapted from Svampekortet (624fb8b, web/src/nav.test.ts).

const LIST: Snapshot = { detail: null };
const sp = (slug: string): Snapshot => ({ detail: slug });
const dlg = (s: Snapshot): Snapshot => ({ ...s, dialog: true });

describe("plan", () => {
  it("does nothing when nothing changed", () => {
    expect(plan([LIST], LIST)).toEqual({ kind: "none" });
  });

  it("pushes an entry for a species sheet", () => {
    expect(plan([LIST], sp("x"))).toEqual({ kind: "ops", ops: [{ op: "push", snap: sp("x") }] });
  });

  it("steps back through that entry when the sheet is closed by its own button", () => {
    expect(plan([LIST, sp("x")], LIST)).toEqual({ kind: "back", to: 0 });
  });

  it("replaces when the entry behind is not the list", () => {
    expect(plan([sp("x")], LIST)).toEqual({ kind: "ops", ops: [{ op: "replace", snap: LIST }] });
  });

  it("replaces when one species follows another", () => {
    expect(plan([LIST, sp("x")], sp("y"))).toEqual({
      kind: "ops",
      ops: [{ op: "replace", snap: sp("y") }],
    });
  });

  it("writes the first entry in place", () => {
    expect(plan([], LIST)).toEqual({ kind: "ops", ops: [{ op: "replace", snap: LIST }] });
  });
});

describe("plan with a dialog", () => {
  it("pushes an entry for a dialog over the same view", () => {
    expect(plan([sp("x")], dlg(sp("x")))).toEqual({
      kind: "ops",
      ops: [{ op: "push", snap: dlg(sp("x")) }],
    });
  });

  it("steps back past the dialog's entry when it is closed", () => {
    expect(plan([LIST, dlg(LIST)], LIST)).toEqual({ kind: "back", to: 0 });
  });

  it("changes under an open dialog replace (a shared link's species loading)", () => {
    expect(plan([LIST, dlg(LIST)], dlg(sp("x")))).toEqual({
      kind: "ops",
      ops: [{ op: "replace", snap: dlg(sp("x")) }],
    });
  });

  it("closing after such a change keeps the view and drops the dialog in place", () => {
    expect(plan([LIST, dlg(sp("x"))], sp("x"))).toEqual({
      kind: "ops",
      ops: [{ op: "replace", snap: sp("x") }],
    });
  });
});

describe("readNavState", () => {
  it("accepts its own state", () => {
    expect(readNavState({ tgk: 1, stack: [LIST, dlg(sp("x"))] })).toEqual({
      tgk: 1,
      stack: [LIST, dlg(sp("x"))],
    });
  });

  it("rejects anything else", () => {
    expect(readNavState(null)).toBeNull();
    expect(readNavState({ svk: 1, stack: [LIST] })).toBeNull();
    expect(readNavState({ tgk: 1, stack: [] })).toBeNull();
    expect(readNavState({ tgk: 1, stack: [{ detail: 3 }] })).toBeNull();
  });

  it("drops stray fields", () => {
    expect(readNavState({ tgk: 1, stack: [{ detail: null, dialog: false, x: 1 }] })).toEqual({
      tgk: 1,
      stack: [LIST],
    });
  });
});

/** A browser history in miniature: entries, an index, and popstate on go(). */
function fakeBrowser(initial: unknown[] = [null]) {
  const entries: unknown[] = [...initial];
  let index = entries.length - 1;
  const listeners: ((e: { state: unknown }) => void)[] = [];
  const pending: (() => void)[] = [];
  const history: HistoryLike = {
    get state() {
      return entries[index];
    },
    pushState(state: unknown) {
      entries.splice(index + 1);
      entries.push(state);
      index++;
    },
    replaceState(state: unknown) {
      entries[index] = state;
    },
    go(delta = 0) {
      // like the browser: the popstate comes later, not inside go()
      pending.push(() => {
        index = Math.max(0, Math.min(entries.length - 1, index + delta));
        for (const l of listeners) l({ state: entries[index] });
      });
    },
  } as HistoryLike;
  return {
    history,
    events: {
      addEventListener: (_: string, l: (e: { state: unknown }) => void) => listeners.push(l),
    },
    back: () => history.go(-1),
    /** Let queued popstates happen (and anything they start). */
    async settle() {
      for (let i = 0; i < 20 && pending.length; i++) {
        pending.shift()?.();
        await Promise.resolve();
        await Promise.resolve();
      }
    },
    top: () => (entries[index] as { stack: Snapshot[] }).stack.slice(-1)[0],
    length: () => entries.length,
    index: () => index,
  };
}

/** The app in miniature: a snapshot that changes, recorded as the real one is. */
function fakeApp(browser: ReturnType<typeof fakeBrowser>, start: Snapshot) {
  let shown = start;
  const nav = initNavigation({
    history: browser.history,
    events: browser.events as unknown as Pick<Window, "addEventListener">,
    current: () => shown,
    apply: (snap) => {
      shown = snap;
    },
  });
  return {
    get shown() {
      return shown;
    },
    go(next: Snapshot) {
      shown = next;
      nav.record();
    },
  };
}

describe("initNavigation", () => {
  it("Back closes a species sheet, then leaves", async () => {
    const b = fakeBrowser();
    const app = fakeApp(b, LIST);
    app.go(sp("x"));
    expect(b.length()).toBe(2);
    b.back();
    await b.settle();
    expect(app.shown).toEqual(LIST);
    expect(b.index()).toBe(0);
  });

  it("the sheet's own back button steps back through its entry", async () => {
    const b = fakeBrowser();
    const app = fakeApp(b, LIST);
    app.go(sp("x"));
    app.go(LIST); // "← Alle arter"
    await b.settle();
    expect(b.index()).toBe(0);
    expect(b.top()).toEqual(LIST);
  });

  it("Back with the welcome dialog open closes the dialog only", async () => {
    const b = fakeBrowser();
    const app = fakeApp(b, LIST);
    app.go(dlg(LIST)); // the welcome dialog opens on a first visit
    expect(b.length()).toBe(2);
    b.back();
    await b.settle();
    expect(app.shown).toEqual(LIST);
    expect(b.index()).toBe(0);
  });

  it("about over a species sheet: Back closes about, Back again the sheet", async () => {
    const b = fakeBrowser();
    const app = fakeApp(b, LIST);
    app.go(sp("x"));
    app.go(dlg(sp("x")));
    expect(b.length()).toBe(3);
    b.back();
    await b.settle();
    expect(app.shown).toEqual(sp("x"));
    b.back();
    await b.settle();
    expect(app.shown).toEqual(LIST);
  });

  it("a dialog closed with Escape leaves no entry behind", async () => {
    const b = fakeBrowser();
    const app = fakeApp(b, LIST);
    app.go(dlg(LIST));
    app.go(LIST);
    await b.settle();
    expect(b.index()).toBe(0);
  });

  it("a reload shows the entry it reloaded, with the entries behind it", async () => {
    const b = fakeBrowser([
      { tgk: 1, stack: [LIST] },
      { tgk: 1, stack: [LIST, sp("x")] },
    ]);
    const app = fakeApp(b, LIST);
    await b.settle();
    expect(app.shown).toEqual(sp("x"));
    app.go(LIST);
    await b.settle();
    expect(b.index()).toBe(0);
  });

  it("leaves entries it did not make alone", async () => {
    const b = fakeBrowser([null]);
    const app = fakeApp(b, LIST);
    expect(b.top()).toEqual(LIST); // the first entry carries our state
    app.go(sp("x"));
    b.back();
    await b.settle();
    expect(app.shown).toEqual(LIST);
  });
});
