import React from "react";
import { useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";

const TECHNOLOGIES = [
  // Row 1
  ["RKE2", "Flux CD", "Istio", "Kyverno"],
  // Row 2
  ["Prometheus", "Grafana", "Loki", "Tempo"],
  // Row 3
  ["NeuVector", "Harbor", "Trivy", "Cosign"],
  // Row 4
  ["OpenBao", "cert-manager", "Keycloak", "Velero"],
  // Row 5
  ["OpenTofu", "Ansible", "Packer", "Backstage"],
];

const CARD_WIDTH = 180;
const CARD_HEIGHT = 100;
const GAP_X = 24;
const GAP_Y = 20;
const COLS = 4;
const ROWS = 5;
const STAGGER_FRAMES = 20;
const GLOW_COLOR = "#00d4ff";

const TechCard: React.FC<{
  name: string;
  index: number;
}> = ({ name, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enterFrame = 40 + index * STAGGER_FRAMES;

  const scale = spring({
    frame: frame - enterFrame,
    fps,
    config: {
      damping: 12,
      stiffness: 120,
      mass: 0.8,
    },
  });

  const glowOpacity = interpolate(
    frame,
    [enterFrame, enterFrame + 15, enterFrame + 40],
    [0, 0.9, 0.4],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const cardOpacity = interpolate(
    frame,
    [enterFrame, enterFrame + 10],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        borderRadius: 12,
        border: "1px solid rgba(255, 255, 255, 0.15)",
        backgroundColor: "rgba(17, 24, 39, 0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transform: `scale(${scale})`,
        opacity: cardOpacity,
        boxShadow: `0 0 ${20 * glowOpacity}px ${8 * glowOpacity}px ${GLOW_COLOR}`,
        position: "relative",
      }}
    >
      <span
        style={{
          color: "#ffffff",
          fontSize: 18,
          fontWeight: 600,
          fontFamily: "Inter, SF Pro Display, system-ui, sans-serif",
          letterSpacing: "0.02em",
          textAlign: "center",
          lineHeight: 1.2,
          padding: "0 8px",
        }}
      >
        {name}
      </span>
    </div>
  );
};

export const TechStackScene: React.FC = () => {
  const frame = useCurrentFrame();

  const titleOpacity = interpolate(frame, [0, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleY = interpolate(frame, [0, 40], [20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const subtitleOpacity = interpolate(frame, [440, 470], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const subtitleY = interpolate(frame, [440, 470], [15, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const gridWidth = COLS * CARD_WIDTH + (COLS - 1) * GAP_X;
  const gridHeight = ROWS * CARD_HEIGHT + (ROWS - 1) * GAP_Y;

  return (
    <div
      style={{
        width: 1920,
        height: 1080,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Title */}
      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          marginBottom: 48,
        }}
      >
        <h1
          style={{
            color: "#ffffff",
            fontSize: 52,
            fontWeight: 700,
            fontFamily: "Inter, SF Pro Display, system-ui, sans-serif",
            letterSpacing: "0.12em",
            textAlign: "center",
            margin: 0,
          }}
        >
          TECHNOLOGY STACK
        </h1>
      </div>

      {/* Grid */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: GAP_Y,
          width: gridWidth,
        }}
      >
        {TECHNOLOGIES.map((row, rowIndex) => (
          <div
            key={rowIndex}
            style={{
              display: "flex",
              gap: GAP_X,
              justifyContent: "center",
            }}
          >
            {row.map((tech, colIndex) => {
              const flatIndex = rowIndex * COLS + colIndex;
              return (
                <TechCard key={tech} name={tech} index={flatIndex} />
              );
            })}
          </div>
        ))}
      </div>

      {/* Subtitle */}
      <div
        style={{
          opacity: subtitleOpacity,
          transform: `translateY(${subtitleY}px)`,
          marginTop: 48,
        }}
      >
        <p
          style={{
            color: GLOW_COLOR,
            fontSize: 26,
            fontWeight: 500,
            fontFamily: "Inter, SF Pro Display, system-ui, sans-serif",
            letterSpacing: "0.08em",
            textAlign: "center",
            margin: 0,
          }}
        >
          100% Open Source &bull; Zero Vendor Lock-in
        </p>
      </div>
    </div>
  );
};
