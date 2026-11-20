// Browser history for the few steps the Back button should undo: a step of
// the start screen (back to its home view), the start screen opened from the
// map (back to the map), an open species sheet (back to the species list) and
// a modal dialog (about). On a phone, Back (Android) and the edge swipe (iOS
// Safari) both arrive as a `popstate`, so without entries of our own they
// would leave the site. Adapted from Svampekortet (624fb8b, web/src/nav.ts);
// the start screen's part (`start`) is optional, so a snapshot without it is
// the main interface.
//
// What does not get an entry: the map itself (pin, camera), the phone sheet's
// height, and the Arter / Risiko / Råd og regler tabs. The tabs are views of the
// same place, each always one tap away; a tab in the history would make Back
// flip between them instead of leaving, which is not what a map app's Back
// does.
//
// The URL's hash (hash.ts: #pin=…&tab=…&art=…) is the shareable link and is
// left alone here: entries are pushed with the current address, and main.ts
// keeps the hash current with replaceState (passing this module's state on).
//
// The app reports its state as a Snapshot whenever it changes (`record`), and
// the controller turns the change into a push, a replace or a step back
// through entries it made itself (plan() below, pure and tested). A Back
// press brings an older snapshot, which the app is asked to show (`apply`).
// Every entry's state carries the whole stack of snapshots up to it, so the
// controller always knows what lies behind the current entry, also after a
// reload.

/** The start screen's view (start.ts), with the flow its place step is for;
 * null or absent: the start screen is closed. */
export type StartSnap = "home" | "place-risk" | "place-beach" | "species" | null;

const START_SNAPS: ReadonlySet<unknown> = new Set([
  "home",
  "place-risk",
  "place-beach",
  "species",
  null,
  undefined,
]);

export interface Snapshot {
  start?: StartSnap;
  /** The species whose sheet is open, or null for the list. */
  detail: string | null;
  /** A modal dialog (about) is open over the rest. */
  dialog?: boolean;
}

export interface NavState {
  tgk: 1;
  stack: Snapshot[];
}

export type Plan =
  | { kind: "none" }
  /** Go back through our own entries to this index, then plan again. */
  | { kind: "back"; to: number }
  | { kind: "ops"; ops: { op: "push" | "replace"; snap: Snapshot }[] };

const NONE: Plan = { kind: "none" };

/** How long a step back of our own may take before it counts as lost. */
const TRAVEL_TIMEOUT_MS = 1500;

const startOf = (s: Snapshot): StartSnap => s.start ?? null;

export function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return (
    startOf(a) === startOf(b) && a.detail === b.detail && Boolean(a.dialog) === Boolean(b.dialog)
  );
}

/** What lies under a dialog; `start` only while the start screen is open. */
const under = (s: Snapshot): Snapshot =>
  startOf(s) === null ? { detail: s.detail } : { start: startOf(s), detail: s.detail };

const isStep = (start: StartSnap): boolean => start !== null && start !== "home";

const replace = (snap: Snapshot): Plan => ({ kind: "ops", ops: [{ op: "replace", snap }] });
const push = (snap: Snapshot): Plan => ({ kind: "ops", ops: [{ op: "push", snap }] });

/** Pure: how the history follows the app from the top of `stack` to `next`.
 *  - a layer added (the start screen opened, a step of it, a species sheet,
 *    a dialog): a new entry, so that Back takes it away again;
 *  - a layer taken away by the app's own buttons (← Alle arter, Forside,
 *    Luk, Escape): back through the entry that added it, when that entry is
 *    ours and lies right behind;
 *  - the start screen left for the map: back to the entry under the start
 *    screen when it was opened over the map (then plan again from there); a
 *    start screen the page opened on stays behind the map, so Back from the
 *    map returns to it, and Back once more leaves the site;
 *  - anything else (one species to another): the current entry is changed in
 *    place. (The start-screen part is from Svampekortet 624fb8b.) */
export function plan(stack: readonly Snapshot[], next: Snapshot): Plan {
  const top = stack.length - 1;
  const cur = stack[top];
  if (!cur) return replace(next);
  if (sameSnapshot(cur, next)) return NONE;
  const behind = stack[top - 1];
  const backOrReplace = (): Plan =>
    behind && sameSnapshot(behind, next) ? { kind: "back", to: top - 1 } : replace(next);

  // A dialog has an entry of its own, so Back closes it and nothing else.
  if (Boolean(cur.dialog) !== Boolean(next.dialog)) {
    if (next.dialog) return sameSnapshot(under(cur), under(next)) ? push(next) : replace(next);
    // closed (its own button, Escape, a phone's own Back): back past its entry
    if (sameSnapshot(under(cur), next)) return backOrReplace();
    if (behind && sameSnapshot(behind, under(cur))) return { kind: "back", to: top - 1 };
    return replace(next);
  }
  if (cur.dialog) return replace(next);

  const curStart = startOf(cur);
  const nextStart = startOf(next);
  if (nextStart !== null) {
    if (curStart === null) return push(next);
    if (curStart === "home" && isStep(nextStart)) return push(next);
    if (isStep(curStart) && nextStart === "home") return backOrReplace();
    return replace(next);
  }

  if (curStart === null) {
    if (cur.detail === null && next.detail !== null) return push(next);
    if (cur.detail !== null && next.detail === null) return backOrReplace();
    return replace(next);
  }

  // Leaving the start screen. Its entries run down from the top to `first`.
  let first = top;
  while (first > 0 && startOf(stack[first - 1]) !== null) first--;
  if (first > 0) return { kind: "back", to: first - 1 };
  // The page opened on the start screen: keep its home view behind the map.
  if (top > 0) return { kind: "back", to: 0 };
  const ops: { op: "push" | "replace"; snap: Snapshot }[] = [];
  if (curStart !== "home") ops.push({ op: "replace", snap: { start: "home", detail: null } });
  ops.push({ op: "push", snap: { detail: null } });
  if (next.detail !== null) ops.push({ op: "push", snap: next });
  return { kind: "ops", ops };
}

/** Our own state on a history entry, or null for anything else. */
export function readNavState(state: unknown): NavState | null {
  if (typeof state !== "object" || state === null) return null;
  const { tgk, stack } = state as Partial<NavState>;
  if (tgk !== 1 || !Array.isArray(stack) || stack.length === 0 || stack.length > 64) return null;
  for (const snap of stack) {
    if (typeof snap !== "object" || snap === null) return null;
    if (!START_SNAPS.has(snap.start)) return null;
    if (snap.detail !== null && (typeof snap.detail !== "string" || snap.detail.length > 120)) {
      return null;
    }
  }
  return {
    tgk: 1,
    stack: stack.map((s) => (s.dialog === true ? { ...under(s), dialog: true } : under(s))),
  };
}

/** The part of `window.history` used here, so tests can drive a fake one. */
export type HistoryLike = Pick<History, "state" | "pushState" | "replaceState" | "go">;

export interface Navigation {
  /** The app's state changed: follow it in the history. */
  record(): void;
}

export function initNavigation(opts: {
  history?: HistoryLike;
  /** Where `popstate` arrives (the window). */
  events?: Pick<Window, "addEventListener">;
  /** What the app shows right now. */
  current(): Snapshot;
  /** Show this snapshot (Back/Forward, or a reload of a later entry). May take
   * a moment (a species sheet loads); changes reported meanwhile wait. */
  apply(snap: Snapshot): Promise<void> | void;
}): Navigation {
  const history = opts.history ?? window.history;
  const events = opts.events ?? window;
  let stack: Snapshot[];
  /** A step back of our own is on its way: plan again when it lands. */
  let travelling = false;
  let travelTimer: ReturnType<typeof setTimeout> | undefined;
  /** An older snapshot is being shown: what the app reports meanwhile is the
   * way there, not a change of its own. */
  let applying = 0;

  const write = (op: "push" | "replace", next: Snapshot[]): void => {
    const state: NavState = { tgk: 1, stack: next };
    // keep the address as it is (the hash link and all)
    if (op === "push") history.pushState(state, "");
    else history.replaceState(state, "");
    stack = next;
  };

  function flush(): void {
    if (travelling || applying > 0) return;
    const result = plan(stack, opts.current());
    if (result.kind === "back") {
      const delta = result.to - (stack.length - 1);
      if (delta >= 0) return;
      travelling = true;
      // A step back that never lands (entries that are not there after all)
      // must not stop the history for good: then the entry is just rewritten.
      clearTimeout(travelTimer);
      travelTimer = setTimeout(() => {
        if (!travelling) return;
        travelling = false;
        write("replace", [opts.current()]);
      }, TRAVEL_TIMEOUT_MS);
      history.go(delta);
      return;
    }
    if (result.kind === "ops") {
      for (const { op, snap } of result.ops) {
        write(op, op === "push" ? [...stack, snap] : [...stack.slice(0, -1), snap]);
      }
    }
  }

  async function show(snap: Snapshot): Promise<void> {
    applying++;
    try {
      await opts.apply(snap);
    } catch (err) {
      console.error("could not go back", err);
    } finally {
      applying--;
    }
    flush(); // whatever the app could not show is written over
  }

  events.addEventListener("popstate", (event) => {
    const state = readNavState((event as PopStateEvent).state);
    if (!state) return;
    stack = state.stack;
    if (travelling) {
      // our own step back has landed: the app already shows where it goes
      travelling = false;
      clearTimeout(travelTimer);
      flush();
      return;
    }
    void show(stack[stack.length - 1]);
  });

  const saved = readNavState(history.state);
  if (saved) {
    // a reload: show what this entry was, with the entries behind it intact
    // (a dialog is not reopened after a reload; flush() then steps past it)
    stack = saved.stack;
    const top = stack[stack.length - 1];
    if (!sameSnapshot(top, opts.current())) void show(top.dialog ? under(top) : top);
  } else {
    stack = [];
    write("replace", [opts.current()]);
  }

  return { record: flush };
}
