import { TOWARD_RIVERFRONT, TOWARD_UMKC } from "./tripDirection.js";
import type { Theme } from "./useTheme.js";

// One colour per direction, shared by every chart that splits by direction so a
// direction reads the same everywhere on the page. Categorical slots 1 and 2 -
// distinct hues, not steps of the speed ramp (which encodes magnitude and would
// collide in meaning).
export const SERIES_COLORS: Record<Theme, Record<number, string>> = {
  light: { [TOWARD_UMKC]: "#2a78d6", [TOWARD_RIVERFRONT]: "#eb6834" },
  dark: { [TOWARD_UMKC]: "#3987e5", [TOWARD_RIVERFRONT]: "#d95926" },
};
