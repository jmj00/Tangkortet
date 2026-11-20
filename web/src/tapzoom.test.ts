import { describe, expect, it } from "vitest";

import {
  PIN_MIN_ZOOM,
  TAP_FLY_ZOOM,
  pointerKind,
  tapAgainMessage,
  tapIntent,
  type Pointer,
} from "./tapzoom";

describe("tapIntent", () => {
  it("flies in from far out instead of setting a pin", () => {
    expect(tapIntent(5.5, "fine")).toBe("zoom-in");
    expect(tapIntent(9.99, "fine")).toBe("zoom-in");
    expect(tapIntent(10.5, "coarse")).toBe("zoom-in");
  });

  it("sets the pin from zoom 10 with a mouse, 11 by touch", () => {
    expect(tapIntent(10, "fine")).toBe("pin");
    expect(tapIntent(10, "coarse")).toBe("zoom-in");
    expect(tapIntent(11, "coarse")).toBe("pin");
    expect(tapIntent(15, "coarse")).toBe("pin");
  });

  it("always flies in past the threshold, so the second tap pins", () => {
    for (const p of ["fine", "coarse"] as Pointer[]) {
      expect(TAP_FLY_ZOOM[p]).toBeGreaterThan(PIN_MIN_ZOOM[p]);
      expect(tapIntent(TAP_FLY_ZOOM[p], p)).toBe("pin");
    }
  });

  it("reads the pointer kind", () => {
    expect(pointerKind(true)).toBe("coarse");
    expect(pointerKind(false)).toBe("fine");
  });
});

describe("tapAgainMessage", () => {
  it("is true while the flight is on, with the device's verb", () => {
    expect(tapAgainMessage("tryk")).toBe("Zoomer ind – tryk igen på kysten for at sætte nålen.");
    expect(tapAgainMessage("klik")).toMatch(/^Zoomer ind – klik igen/);
  });
});
