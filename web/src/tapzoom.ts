// What a tap on the map (not on a find) means, by how far out the map is.
// From far out a fingertip covers kilometres of coast, so the tap says
// "about here", not "exactly here": the map flies in and a second tap sets
// the pin. Only a tap from close enough sets the pin (and with it a risk
// verdict). Applies everywhere: the main map and the start screen alike.

/** From this zoom a tap sets the pin. */
export const PIN_MIN_ZOOM = 10;
/** Where a far-out tap flies in to. */
export const TAP_FLY_ZOOM = 12;

export type TapIntent = "pin" | "zoom-in";

export function tapIntent(zoom: number): TapIntent {
  return zoom >= PIN_MIN_ZOOM ? "pin" : "zoom-in";
}

/** Said after a far-out tap has flown the map in. `verb`: "tryk" by touch,
 * "klik" with a mouse. */
export function tapAgainMessage(verb: "tryk" | "klik"): string {
  return verb === "klik"
    ? "Kortet er zoomet ind. Klik igen på kysten for at sætte nålen."
    : "Kortet er zoomet ind. Tryk igen på kysten for at sætte nålen.";
}
