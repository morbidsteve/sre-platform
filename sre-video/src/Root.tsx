import { Composition } from "remotion";
import { SREVideo } from "./SREVideo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="SREVideo"
        component={SREVideo}
        durationInFrames={5010}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
