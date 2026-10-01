import React from "react";
import { Lottie, LottieAnimationData } from "@remotion/lottie";
import idle from "../public/lottie/idle.json";
import generating from "../public/lottie/generating.json";
import fetchExternal from "../public/lottie/fetch-external.json";
import check from "../public/lottie/check.json";
import scan from "../public/lottie/scan.json";
import { C } from "./theme";

// Animations du badge Leo de legaleo-ai (components/design-system/LeoBadge/
// lottie). Embouts ronds forcés, comme sur la homepage (js/main.js : les
// traits se terminent sinon par une encoche).
const roundCaps = <T,>(node: T): T => {
  if (Array.isArray(node)) node.forEach(roundCaps);
  else if (node && typeof node === "object") {
    const n = node as Record<string, unknown>;
    if (n.ty === "st" || n.ty === "gs") n.lc = 2;
    Object.values(n).forEach(roundCaps);
  }
  return node;
};

const ANIMS = {
  idle: roundCaps(idle),
  generating: roundCaps(generating),
  searching: roundCaps(fetchExternal),
  done: roundCaps(check),
  scan: roundCaps(scan),
} as unknown as Record<string, LottieAnimationData>;

export type LeoAnim = keyof typeof ANIMS;

/** Tuile Leo : carré #00383c aux coins arrondis, animation au centre. */
export const LeoIcon: React.FC<{ size: number; anim?: LeoAnim; loop?: boolean; radius?: number }> = ({
  size,
  anim = "idle",
  loop = true,
  radius,
}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: radius ?? size * 0.24,
      background: C.leo,
      display: "grid",
      placeItems: "center",
      flexShrink: 0,
    }}
  >
    <div style={{ width: size * 0.62, height: size * 0.62 }}>
      <Lottie animationData={ANIMS[anim]} loop={loop} style={{ width: "100%", height: "100%" }} />
    </div>
  </div>
);
