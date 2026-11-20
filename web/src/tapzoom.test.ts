import { describe, expect, it } from "vitest";

import { PIN_MIN_ZOOM, TAP_FLY_ZOOM, tapAgainMessage, tapIntent } from "./tapzoom";

describe("tapIntent", () => {
  it("flies in from far out instead of setting a pin", () => {
    expect(tapIntent(5.5)).toBe("zoom-in");
    expect(tapIntent(9.99)).toBe("zoom-in");
  });

  it("sets the pin from zoom 10", () => {
    expect(tapIntent(PIN_MIN_ZOOM)).toBe("pin");
    expect(tapIntent(15)).toBe("pin");
  });

  it("flies in close enough that the next tap pins", () => {
    expect(tapIntent(TAP_FLY_ZOOM)).toBe("pin");
  });
});

describe("tapAgainMessage", () => {
  it("uses the device's verb", () => {
    expect(tapAgainMessage("tryk")).toMatch(/Tryk igen/);
    expect(tapAgainMessage("klik")).toMatch(/Klik igen/);
  });
});
