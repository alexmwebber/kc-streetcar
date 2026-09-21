// KC Streetcar is a single out-and-back line between River Market (Riverfront,
// the north terminus) and UMKC (the south terminus). Empirically, GTFS-RT
// direction_id 0 always progresses toward Riverfront and 1 toward UMKC
// (checked against a live trip-updates sample) - if Swiftly ever flips this,
// swap the two values below; everything that cares about the mapping (stop
// arrival labels, vehicle heading) reads from here so it stays in sync.

export const TOWARD_RIVERFRONT = 0;
export const TOWARD_UMKC = 1;

export const DIRECTION_LABELS: Record<number, string> = {
  [TOWARD_RIVERFRONT]: "Toward Riverfront",
  [TOWARD_UMKC]: "Toward UMKC",
};

// Compass bearing a vehicle scheduled in each direction must actually be
// heading. The route's stored polyline coordinates run north-to-south (see
// routeMatch.ts), so "toward Riverfront" is the reverse of that stored order.
const DIRECTION_REFERENCE_BEARING: Record<number, number> = {
  [TOWARD_RIVERFRONT]: 0, // north
  [TOWARD_UMKC]: 180, // south
};

/** Reference compass bearing for a scheduled trip direction, or undefined
 *  when the vehicle has no assigned direction (e.g. a deadhead move). */
export function directionReferenceBearing(directionId: number | null | undefined): number | undefined {
  if (directionId == null) return undefined;
  return DIRECTION_REFERENCE_BEARING[directionId];
}
