// "My location" as a single answer, not a mode. Ported from Svampekortet
// (624fb8b, web/src/locate.ts; the fix was its PR #5).
//
// MapLibre's GeolocateControl with `trackUserLocation: true` keeps a GPS
// watch running and re-fires "geolocate" on every update. Any camera move it
// did not make itself puts it in a "background" state in which the watch goes
// on, so a pin the user tapped elsewhere was put straight back on their own
// position by the next GPS update.
//
// The button is now one of our own (locatecontrol.ts): each press asks for one
// position with getCurrentPosition, never a watch, shows it as a dot and moves
// nothing. This module decides what that one answer may do: set the pin and
// frame it, unless the user has chosen a spot of their own since asking (a
// slow cold-start fix must neither undo a tap nor take the view away from it).

export interface LocateGate {
  /** A position was asked for (the button). */
  asked(): void;
  /** The user chose a spot themselves (a tap, an address, a shared link): an
   * answer still on its way no longer sets the pin. */
  superseded(): void;
  /** A position arrived: whether it should set the pin. Only the first
   * answer to a request does. */
  accept(): boolean;
}

export function createLocateGate(): LocateGate {
  let waiting = false;
  return {
    asked() {
      waiting = true;
    },
    superseded() {
      waiting = false;
    },
    accept() {
      if (!waiting) return false;
      waiting = false;
      return true;
    },
  };
}

/** Said when the browser refuses (permission denied): otherwise the button
 * would just do nothing. */
export const LOCATION_DENIED_MESSAGE =
  "Placering er slået fra for siden. Slå den til i browserens indstillinger, eller tryk på kortet for at sætte en nål.";

/** Said when the position could not be found (no fix, or it took too long). */
export const LOCATION_FAILED_MESSAGE =
  "Kunne ikke finde din placering. Prøv igen, eller tryk på kortet for at sætte en nål.";

/** Said when the browser has no geolocation at all. */
export const LOCATION_UNSUPPORTED_MESSAGE =
  "Din browser kan ikke oplyse din placering. Tryk på kortet for at sætte en nål.";

/** The message for a failed request, by GeolocationPositionError code. */
export function locateErrorMessage(code: number): string {
  return code === 1 ? LOCATION_DENIED_MESSAGE : LOCATION_FAILED_MESSAGE;
}
