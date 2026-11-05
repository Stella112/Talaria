import { Composition } from "remotion";
import { Video, FPS } from "./Video";
import timeline from "./timeline.json";

export const Root = () => (
  <Composition id="Talaria" component={Video} durationInFrames={Math.ceil(timeline.total * FPS) + 15} fps={FPS} width={1920} height={1080} />
);
