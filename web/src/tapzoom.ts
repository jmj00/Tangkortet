// What a tap on the map (not on a find) means, by how far out the map is.
// From far out a fingertip covers kilometres of coast, so the tap says
// "about here", not "exactly here": the map flies in and a second tap sets
// the pin. Only a tap from close enough sets the pin (and with it a risk
// verdict). Applies everywhere: the main map and the start screen alike.

export type Pointer = "coarse" | "fine";

/** From this zoom a tap sets the pin. A fingertip at zoom 10 can land about
 * a kilometre off, and the risk rules look 1 km out, so touch needs 11. */
export const PIN_MIN_ZOOM: Record<Pointer, number> = { fine: 10, coarse: 11 };
/** Where a far-out tap flies in to: always past the pin threshold, so the
 * second tap pins. */
export const TAP_FLY_ZOOM: Record<Pointer, number> = { fine: 12, coarse: 13 };

export type TapIntent = "pin" | "zoom-in";

export function tapIntent(zoom: number, pointer: Pointer): TapIntent {
  return zoom >= PIN_MIN_ZOOM[pointer] ? "pin" : "zoom-in";
}

/** The pointer kind of this device (`(pointer: coarse)` = touch). */
export function pointerKind(coarse: boolean): Pointer {
  return coarse ? "coarse" : "fine";
}

/** Said as a far-out tap starts flying the map in. `verb`: "tryk" by touch,
 * "klik" with a mouse. */
export function tapAgainMessage(verb: "tryk" | "klik"): string {
  return `Zoomer ind – ${verb} igen på kysten for at sætte nålen.`;
}
