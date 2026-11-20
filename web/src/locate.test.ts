import { describe, expect, it } from "vitest";

import {
  createLocateGate,
  locateErrorMessage,
  LOCATION_DENIED_MESSAGE,
  LOCATION_FAILED_MESSAGE,
} from "./locate";

// From Svampekortet (624fb8b, web/src/locate.test.ts), plus the messages.
describe("createLocateGate", () => {
  it("lets the answer to a request set the pin, once", () => {
    const gate = createLocateGate();
    gate.asked();
    expect(gate.accept()).toBe(true);
    // a further position (a stray or repeated fix) does not move the pin
    expect(gate.accept()).toBe(false);
  });

  it("ignores a position nobody asked for", () => {
    expect(createLocateGate().accept()).toBe(false);
  });

  it("drops an answer still on its way when the user chose a spot meanwhile", () => {
    const gate = createLocateGate();
    gate.asked();
    gate.superseded(); // a tap on the map, an address, a shared link
    expect(gate.accept()).toBe(false);
  });

  it("answers again after a new request", () => {
    const gate = createLocateGate();
    gate.asked();
    gate.accept();
    gate.superseded();
    gate.asked();
    expect(gate.accept()).toBe(true);
  });
});

describe("locateErrorMessage", () => {
  it("tells a refusal from a failed fix", () => {
    expect(locateErrorMessage(1)).toBe(LOCATION_DENIED_MESSAGE);
    expect(locateErrorMessage(2)).toBe(LOCATION_FAILED_MESSAGE);
    expect(locateErrorMessage(3)).toBe(LOCATION_FAILED_MESSAGE);
    expect(LOCATION_DENIED_MESSAGE).toMatch(/indstillinger/);
  });
});
