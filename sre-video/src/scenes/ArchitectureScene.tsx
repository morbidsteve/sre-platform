import React from "react";
import {
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from "remotion";

interface LayerData {
  title: string;
  color: string;
  components: string[];
  delay: number;
}

const layers: LayerData[] = [
  {
    title: "CLUSTER FOUNDATION",
    color: "#1a365d",
    components: ["RKE2", "Rocky Linux 9", "OpenTofu", "Ansible", "Packer"],
    delay: 60,
  },
  {
    title: "PLATFORM SERVICES",
    color: "#2a4365",
    components: [
      "Istio",
      "Kyverno",
      "Prometheus",
      "Grafana",
      "Loki",
      "NeuVector",
      "Harbor",
      "OpenBao",
    ],
    delay: 240,
  },
  {
    title: "DEVELOPER EXPERIENCE",
    color: "#2c5282",
    components: ["Flux CD GitOps", "Helm Templates", "Self-Service Deploy"],
    delay: 420,
  },
  {
    title: "SUPPLY CHAIN SECURITY",
    color: "#3182ce",
    components: [
      "Trivy Scanning",
      "Cosign Signing",
      "SBOM Generation",
      "Admission Control",
    ],
    delay: 600,
  },
];

const ACCENT = "#00d4ff";

const Layer: React.FC<{
  layer: LayerData;
  index: number;
  totalLayers: number;
}> = ({ layer, index, totalLayers }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const layerHeight = 140;
  const stackBottom = 160;
  const targetY =
    stackBottom + (totalLayers - 1 - index) * (layerHeight + 16);

  const slideProgress = spring({
    frame: frame - layer.delay,
    fps,
    config: {
      damping: 18,
      stiffness: 60,
      mass: 1.2,
    },
  });

  const startY = 1080 + 100;
  const currentY = interpolate(slideProgress, [0, 1], [startY, targetY]);

  const labelOpacity = interpolate(
    frame,
    [layer.delay + 60, layer.delay + 100],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        right: 120,
        top: currentY,
        height: layerHeight,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
      }}
    >
      {/* Cyan left accent border */}
      <div
        style={{
          width: 6,
          height: "100%",
          background: ACCENT,
          flexShrink: 0,
        }}
      />

      {/* Layer background */}
      <div
        style={{
          flex: 1,
          height: "100%",
          background: layer.color,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 40px",
        }}
      >
        {/* Layer title */}
        <div
          style={{
            fontFamily: "Inter, sans-serif",
            fontWeight: 800,
            fontSize: 28,
            color: "#ffffff",
            letterSpacing: 3,
            marginBottom: 12,
          }}
        >
          {layer.title}
        </div>

        {/* Component labels */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 12,
            opacity: labelOpacity,
          }}
        >
          {layer.components.map((comp, i) => {
            const compDelay = layer.delay + 70 + i * 10;
            const compOpacity = interpolate(
              frame,
              [compDelay, compDelay + 30],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            );

            return (
              <div
                key={comp}
                style={{
                  fontFamily: "Inter, sans-serif",
                  fontWeight: 500,
                  fontSize: 18,
                  color: ACCENT,
                  background: "rgba(0, 212, 255, 0.1)",
                  border: "1px solid rgba(0, 212, 255, 0.3)",
                  borderRadius: 6,
                  padding: "6px 16px",
                  opacity: compOpacity,
                }}
              >
                {comp}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const ArchitectureScene: React.FC = () => {
  const frame = useCurrentFrame();

  const titleOpacity = interpolate(frame, [0, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleY = interpolate(frame, [0, 60], [-20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#0a0e1a",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Subtle grid background */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(0,212,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,0.03) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* Title */}
      <div
        style={{
          position: "absolute",
          top: 60,
          left: 0,
          right: 0,
          textAlign: "center",
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
        }}
      >
        <div
          style={{
            fontFamily: "Inter, sans-serif",
            fontWeight: 900,
            fontSize: 52,
            color: "#ffffff",
            letterSpacing: 6,
          }}
        >
          PLATFORM ARCHITECTURE
        </div>
        <div
          style={{
            fontFamily: "Inter, sans-serif",
            fontWeight: 400,
            fontSize: 20,
            color: ACCENT,
            marginTop: 10,
            letterSpacing: 2,
            opacity: 0.8,
          }}
        >
          4-LAYER HARDENED KUBERNETES PLATFORM
        </div>
      </div>

      {/* Layers — rendered bottom to top */}
      {layers.map((layer, index) => (
        <Layer
          key={layer.title}
          layer={layer}
          index={index}
          totalLayers={layers.length}
        />
      ))}
    </div>
  );
};
