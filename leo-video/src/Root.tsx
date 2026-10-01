import React from "react";
import { Composition } from "remotion";
import { LeoPromo, DURATION } from "./LeoPromo";

export const Root: React.FC = () => (
  <Composition id="LeoPromo" component={LeoPromo} durationInFrames={DURATION} fps={30} width={1920} height={1080} />
);
