import React from "react";
import { Audio, Sequence, staticFile } from "remotion";
import { IntroScene } from "./scenes/IntroScene";
import { ArchitectureScene } from "./scenes/ArchitectureScene";
import { TechStackScene } from "./scenes/TechStackScene";
import { SecurityPipelineScene } from "./scenes/SecurityPipelineScene";
import { GitOpsFlowScene } from "./scenes/GitOpsFlowScene";
import { ComplianceScene } from "./scenes/ComplianceScene";
import { DashboardScene } from "./scenes/DashboardScene";
import { OutroScene } from "./scenes/OutroScene";

// Scene durations matched to narration audio lengths + padding
const INTRO = { start: 0, duration: 360 };          // 12s (audio: 10.8s)
const ARCH = { start: 360, duration: 1050 };         // 35s (audio: 33.5s)
const TECH = { start: 1410, duration: 570 };         // 19s (audio: 17.5s)
const SECURITY = { start: 1980, duration: 660 };     // 22s (audio: 20.8s)
const GITOPS = { start: 2640, duration: 660 };       // 22s (audio: 20.8s)
const COMPLIANCE = { start: 3300, duration: 840 };   // 28s (audio: 26.5s)
const DASHBOARD = { start: 4140, duration: 480 };    // 16s (audio: 14.9s)
const OUTRO = { start: 4620, duration: 390 };        // 13s (audio: 11.9s)
// Total: 5010 frames = 167s

export const SREVideo: React.FC = () => {
  return (
    <div style={{ flex: 1, background: "#0a0e1a" }}>
      {/* Visual scenes */}
      <Sequence from={INTRO.start} durationInFrames={INTRO.duration}>
        <IntroScene />
      </Sequence>
      <Sequence from={ARCH.start} durationInFrames={ARCH.duration}>
        <ArchitectureScene />
      </Sequence>
      <Sequence from={TECH.start} durationInFrames={TECH.duration}>
        <TechStackScene />
      </Sequence>
      <Sequence from={SECURITY.start} durationInFrames={SECURITY.duration}>
        <SecurityPipelineScene />
      </Sequence>
      <Sequence from={GITOPS.start} durationInFrames={GITOPS.duration}>
        <GitOpsFlowScene />
      </Sequence>
      <Sequence from={COMPLIANCE.start} durationInFrames={COMPLIANCE.duration}>
        <ComplianceScene />
      </Sequence>
      <Sequence from={DASHBOARD.start} durationInFrames={DASHBOARD.duration}>
        <DashboardScene />
      </Sequence>
      <Sequence from={OUTRO.start} durationInFrames={OUTRO.duration}>
        <OutroScene />
      </Sequence>

      {/* Narration audio tracks */}
      <Sequence from={INTRO.start} durationInFrames={INTRO.duration}>
        <Audio src={staticFile("narration-intro.mp3")} volume={1} />
      </Sequence>
      <Sequence from={ARCH.start} durationInFrames={ARCH.duration}>
        <Audio src={staticFile("narration-architecture.mp3")} volume={1} />
      </Sequence>
      <Sequence from={TECH.start} durationInFrames={TECH.duration}>
        <Audio src={staticFile("narration-techstack.mp3")} volume={1} />
      </Sequence>
      <Sequence from={SECURITY.start} durationInFrames={SECURITY.duration}>
        <Audio src={staticFile("narration-security.mp3")} volume={1} />
      </Sequence>
      <Sequence from={GITOPS.start} durationInFrames={GITOPS.duration}>
        <Audio src={staticFile("narration-gitops.mp3")} volume={1} />
      </Sequence>
      <Sequence from={COMPLIANCE.start} durationInFrames={COMPLIANCE.duration}>
        <Audio src={staticFile("narration-compliance.mp3")} volume={1} />
      </Sequence>
      <Sequence from={DASHBOARD.start} durationInFrames={DASHBOARD.duration}>
        <Audio src={staticFile("narration-dashboard.mp3")} volume={1} />
      </Sequence>
      <Sequence from={OUTRO.start} durationInFrames={OUTRO.duration}>
        <Audio src={staticFile("narration-outro.mp3")} volume={1} />
      </Sequence>
    </div>
  );
};
