import { describe, expect, it } from "vitest";

import { pickSnap, releaseVelocity, snapHeights, STALE_MS, stopsFor } from "./sheet";

describe("snapHeights", () => {
  it("puts half at 53 % of the app on a tall phone", () => {
    const h = snapHeights(780, 96, 0, 844);
    expect(h).toEqual({ peek: 96, half: Math.round(844 * 0.53), full: 780 });
    expect(stopsFor(h)).toEqual(["peek", "half", "full"]);
  });

  it("adds the home-indicator inset to the peek", () => {
    expect(snapHeights(780, 96, 34, 844).peek).toBe(130);
  });

  it("keeps at least some content visible at half", () => {
    // a big header (large text) on a short phone: half is never just the header
    const h = snapHeights(600, 200, 0, 560);
    expect(h.half).toBe(340);
  });

  it("never sets half above full", () => {
    expect(snapHeights(300, 96, 0, 600).half).toBe(300);
  });

  it("has only peek and full on a short screen", () => {
    const h = snapHeights(470, 96, 0, 500);
    expect(h.half).toBe(h.peek);
    expect(stopsFor(h)).toEqual(["peek", "full"]);
  });
});

describe("releaseVelocity", () => {
  it("measures an upward flick as positive px/ms", () => {
    const samples = [
      { y: 500, t: 0 },
      { y: 450, t: 50 },
      { y: 400, t: 100 },
    ];
    expect(releaseVelocity(samples, 110)).toBe(1);
  });

  it("is zero when the finger paused before lifting", () => {
    const samples = [
      { y: 500, t: 0 },
      { y: 300, t: 60 },
    ];
    expect(releaseVelocity(samples, 60 + STALE_MS + 1)).toBe(0);
    expect(releaseVelocity(samples, 60 + STALE_MS - 1)).toBeGreaterThan(0);
  });

  it("is zero for a single sample or no elapsed time", () => {
    expect(releaseVelocity([{ y: 1, t: 5 }], 5)).toBe(0);
    expect(
      releaseVelocity(
        [
          { y: 1, t: 5 },
          { y: 9, t: 5 },
        ],
        5,
      ),
    ).toBe(0);
  });
});

describe("pickSnap", () => {
  const heights = { peek: 100, half: 450, full: 780 };
  const three = stopsFor(heights);

  it("goes to the nearest stop on a slow release", () => {
    expect(pickSnap(heights, three, 120, 0)).toBe("peek");
    expect(pickSnap(heights, three, 400, 0.2)).toBe("half");
    expect(pickSnap(heights, three, 700, -0.2)).toBe("full");
  });

  it("goes to the next stop in the direction of a flick", () => {
    // just above peek, flicked up: half, not full
    expect(pickSnap(heights, three, 130, 1.2)).toBe("half");
    // just below full, flicked down: half
    expect(pickSnap(heights, three, 760, -1.2)).toBe("half");
    // between half and full, flicked up
    expect(pickSnap(heights, three, 500, 0.8)).toBe("full");
    // at half exactly, flicked down
    expect(pickSnap(heights, three, 450, -0.8)).toBe("peek");
  });

  it("stays at the end stops when flicked past them", () => {
    expect(pickSnap(heights, three, 780, 2)).toBe("full");
    expect(pickSnap(heights, three, 100, -2)).toBe("peek");
  });

  it("skips half on a two-stop screen", () => {
    const short = { peek: 100, half: 100, full: 420 };
    const two = stopsFor(short);
    expect(pickSnap(short, two, 150, 1)).toBe("full");
    expect(pickSnap(short, two, 300, 0)).toBe("full");
    expect(pickSnap(short, two, 200, 0)).toBe("peek");
  });
});
