import { describe, expect, it } from "vitest";

import { framingForNearest } from "./layers";

const near: [number, number] = [9.5, 56.2];
const far: [number, number] = [12.5, 55.7];
const farther: [number, number] = [15.2, 55.1];

describe("framingForNearest", () => {
  const view = (contains: boolean) => ({
    center: [9.4, 56.1] as [number, number],
    zoom: 13,
    contains: () => contains,
  });

  it("leaves the camera alone when a find is already on screen", () => {
    expect(framingForNearest(view(true), [near, far])).toBeNull();
  });

  it("leaves the camera alone when the species has no finds", () => {
    expect(framingForNearest(view(false), [])).toBeNull();
  });

  it("frames the current centre together with the nearest find", () => {
    const framing = framingForNearest(view(false), [far, near, farther]);
    expect(framing).not.toBeNull();
    expect(framing?.bounds).toEqual([
      [9.4, 56.1],
      [9.5, 56.2],
    ]);
  });

  it("never zooms in past the current zoom", () => {
    expect(framingForNearest(view(false), [far])?.maxZoom).toBe(13);
  });
});
