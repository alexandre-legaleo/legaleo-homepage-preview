import { loadFont as loadFraunces } from "@remotion/google-fonts/Fraunces";
import { loadFont as loadManrope } from "@remotion/google-fonts/Manrope";

// Mêmes polices et couleurs que la homepage (css/tokens.css) et que le
// badge Leo de legaleo-ai (LeoBadge.module.css : #00383c).
export const serif = loadFraunces("normal", { weights: ["500", "600"] }).fontFamily;
// Italique chargée aussi (même famille « Fraunces », à utiliser avec
// fontStyle: "italic").
loadFraunces("italic", { weights: ["500", "600"] });
export const sans = loadManrope("normal", { weights: ["500", "600", "700", "800"] }).fontFamily;

export const C = {
  cream: "#fffefb",
  beige: "#f7f4ef",
  ink: "#1f120e",
  muted: "#6f6757",
  teal: "#087f83",
  tealDeep: "#0f4a48",
  cyan: "#62e7eb",
  cyanLight: "#d9fdfb",
  lime: "#e2e62f",
  leo: "#00383c",
  leoText: "#d0f5f8",
};
