import React from "react";
import {
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
  Easing,
} from "remotion";

interface GateData {
  id: number;
  label: string;
  subtitle: string;
}

const gates: GateData[] = [
  { id: 1, label: "SAST", subtitle: "Static Analysis" },
  { id: 2, label: "SECRETS", subtitle: "Secret Detection" },
  { id: 3, label: "BUILD", subtitle: "Container Build" },
  { id: 4, label: "SBOM", subtitle: "Bill of Materials" },
  { id: 5, label: "CVE SCAN", subtitle: "Vulnerability Scanning" },
  { id: 6, label: "DAST", subtitle: "Dynamic Analysis" },
  { id: 7, label: "ISSM REVIEW", subtitle: "Security Review" },
  { id: 8, label: "IMAGE SIGN", subtitle: "Cosign Signing" },
];

const COLORS = {
  bg: "#0a0e1a",
  inactive: "#374151",
  active: "#10b981",
  line: "#4b5563",
  pulse: "#00d4ff",
  accent: "#00d4ff",
};

const GATE_WIDTH = 200;
const GATE_HEIGHT = 80;
const FRAMES_PER_GATE = 60;
const PIPELINE_START_FRAME = 60;

const HexagonGate: React.FC<{
  gate: GateData;
  x: number;
  y: number;
  isActive: boolean;
  isPulsing: boolean;
  pulseProgress: number;
  entryOpacity: number;
  entryScale: number;
}> = ({ gate, x, y, isActive, isPulsing, pulseProgress, entryOpacity, entryScale }) => {
  const glowIntensity = isPulsing
    ? interpolate(pulseProgress, [0, 0.5, 1], [0, 1, 0.6], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : isActive
      ? 0.6
      : 0;

  const borderColor = isActive ? COLORS.active : COLORS.inactive;
  const bgColor = isActive
    ? "rgba(16, 185, 129, 0.15)"
    : "rgba(55, 65, 81, 0.3)";

  const boxShadow = isPulsing
    ? `0 0 ${20 + glowIntensity * 30}px rgba(16, 185, 129, ${0.3 + glowIntensity * 0.5}), inset 0 0 ${10 + glowIntensity * 15}px rgba(16, 185, 129, ${0.1 + glowIntensity * 0.2})`
    : isActive
      ? `0 0 20px rgba(16, 185, 129, 0.3), inset 0 0 10px rgba(16, 185, 129, 0.1)`
      : "0 4px 20px rgba(0, 0, 0, 0.4)";

  const checkOpacity = isActive && !isPulsing ? 1 : 0;

  return (
    <div
      style={{
        position: "absolute",
        left: x - GATE_WIDTH / 2,
        top: y - GATE_HEIGHT / 2,
        width: GATE_WIDTH,
        height: GATE_HEIGHT,
        opacity: entryOpacity,
        transform: `scale(${entryScale})`,
      }}
    >
      {/* Gate box with clipped corners for hexagonal feel */}
      <div
        style={{
          width: "100%",
          height: "100%",
          background: bgColor,
          border: `2px solid ${borderColor}`,
          borderRadius: 12,
          clipPath:
            "polygon(12px 0%, calc(100% - 12px) 0%, 100% 50%, calc(100% - 12px) 100%, 12px 100%, 0% 50%)",
          boxShadow,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Pulse sweep effect */}
        {isPulsing && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `linear-gradient(90deg, transparent ${pulseProgress * 100 - 30}%, rgba(0, 212, 255, 0.15) ${pulseProgress * 100}%, transparent ${pulseProgress * 100 + 30}%)`,
            }}
          />
        )}

        {/* Gate number badge */}
        <div
          style={{
            position: "absolute",
            top: 6,
            left: 20,
            fontFamily: "Inter, sans-serif",
            fontWeight: 700,
            fontSize: 10,
            color: isActive ? COLORS.active : "#6b7280",
            letterSpacing: 1,
          }}
        >
          GATE {gate.id}
        </div>

        {/* Check mark */}
        <div
          style={{
            position: "absolute",
            top: 6,
            right: 20,
            fontFamily: "Inter, sans-serif",
            fontWeight: 700,
            fontSize: 14,
            color: COLORS.active,
            opacity: checkOpacity,
            transition: "opacity 0.2s",
          }}
        >
          \u2713
        </div>

        {/* Gate label */}
        <div
          style={{
            fontFamily: "Inter, sans-serif",
            fontWeight: 800,
            fontSize: 18,
            color: isActive ? "#ffffff" : "#9ca3af",
            letterSpacing: 2,
            marginTop: 4,
          }}
        >
          {gate.label}
        </div>

        {/* Gate subtitle */}
        <div
          style={{
            fontFamily: "Inter, sans-serif",
            fontWeight: 400,
            fontSize: 11,
            color: isActive ? "rgba(16, 185, 129, 0.9)" : "#6b7280",
            letterSpacing: 1,
            marginTop: 2,
          }}
        >
          {gate.subtitle}
        </div>
      </div>
    </div>
  );
};

const ConnectingLine: React.FC<{
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isActive: boolean;
  pulseProgress: number;
  entryOpacity: number;
}> = ({ x1, y1, x2, y2, isActive, pulseProgress, entryOpacity }) => {
  const lineColor = isActive ? COLORS.active : COLORS.line;

  const minX = Math.min(x1, x2);
  const minY = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);

  const svgWidth = width + 20;
  const svgHeight = height + 20;

  const sx = x1 - minX + 10;
  const sy = y1 - minY + 10;
  const ex = x2 - minX + 10;
  const ey = y2 - minY + 10;

  return (
    <div
      style={{
        position: "absolute",
        left: minX - 10,
        top: minY - 10,
        width: svgWidth,
        height: svgHeight,
        opacity: entryOpacity,
        pointerEvents: "none",
      }}
    >
      <svg
        width={svgWidth}
        height={svgHeight}
        style={{ position: "absolute", top: 0, left: 0 }}
      >
        {/* Base line */}
        <line
          x1={sx}
          y1={sy}
          x2={ex}
          y2={ey}
          stroke={lineColor}
          strokeWidth={2}
          strokeOpacity={0.6}
        />
        {/* Pulse dot traveling along the line */}
        {pulseProgress > 0 && pulseProgress < 1 && (
          <circle
            cx={sx + (ex - sx) * pulseProgress}
            cy={sy + (ey - sy) * pulseProgress}
            r={4}
            fill={COLORS.pulse}
            opacity={0.9}
          >
            <animate
              attributeName="r"
              values="3;6;3"
              dur="0.5s"
              repeatCount="indefinite"
            />
          </circle>
        )}
        {/* Arrow head at end */}
        {isActive && (
          <polygon
            points={`${ex},${ey} ${ex - 8},${ey - 4} ${ex - 8},${ey + 4}`}
            fill={lineColor}
            opacity={0.8}
            transform={`rotate(${Math.atan2(ey - sy, ex - sx) * (180 / Math.PI)}, ${ex}, ${ey})`}
          />
        )}
      </svg>
    </div>
  );
};

export const SecurityPipelineScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Title animation
  const titleOpacity = interpolate(frame, [0, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleY = interpolate(frame, [0, 50], [-20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Gate positions: two rows of 4
  const rowTopY = 380;
  const rowBottomY = 600;
  const startX = 300;
  const gapX = 360;

  const getGatePosition = (index: number): { x: number; y: number } => {
    if (index < 4) {
      return { x: startX + index * gapX, y: rowTopY };
    }
    return { x: startX + (index - 4) * gapX, y: rowBottomY };
  };

  // Connection pairs: sequential flow through the pipeline
  const connections: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 7], // top row end connects down to bottom row end (right to right)
    [7, 6], // bottom row flows right to left visually but we reverse
    [6, 5],
    [5, 4],
  ];

  // Actually, let's do the flow more naturally:
  // Top row left-to-right: 0->1->2->3
  // Then 3 drops down to 4 (bottom-left): 3->4 (diagonal)
  // But a cleaner approach: top row L-R, connect last top to first bottom, bottom L-R
  // Gates 1-4 top (indices 0-3), Gates 5-8 bottom (indices 4-7)
  // Flow: 0->1->2->3 (top), 3 connects down to 4 (first bottom), 4->5->6->7 (bottom)
  const pipelineConnections: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4], // drops from top-right to bottom-left
    [4, 5],
    [5, 6],
    [6, 7],
  ];

  // Calculate gate activation timing
  const getGateActivationFrame = (gateIndex: number): number => {
    return PIPELINE_START_FRAME + gateIndex * FRAMES_PER_GATE;
  };

  // Subtitle fade in after all gates are lit
  const allGatesLitFrame = getGateActivationFrame(7) + FRAMES_PER_GATE;

  const subtitleOpacity = interpolate(
    frame,
    [allGatesLitFrame, allGatesLitFrame + 30],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const subtitleY = interpolate(
    frame,
    [allGatesLitFrame, allGatesLitFrame + 30],
    [10, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Shield animation
  const shieldFrame = allGatesLitFrame + 10;
  const shieldScale = spring({
    frame: frame - shieldFrame,
    fps,
    config: {
      damping: 10,
      stiffness: 100,
      mass: 0.6,
    },
  });

  const shieldOpacity = interpolate(
    frame,
    [shieldFrame, shieldFrame + 15],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Shield glow pulse after appearing
  const shieldGlowPhase = frame - shieldFrame;
  const shieldGlow =
    shieldGlowPhase > 20
      ? interpolate(
          Math.sin(shieldGlowPhase * 0.1),
          [-1, 1],
          [0.3, 0.8],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        )
      : 0;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: COLORS.bg,
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

      {/* Radial glow behind pipeline */}
      <div
        style={{
          position: "absolute",
          top: "40%",
          left: "50%",
          width: 1200,
          height: 600,
          transform: "translate(-50%, -50%)",
          background:
            "radial-gradient(ellipse, rgba(0, 212, 255, 0.04) 0%, transparent 70%)",
          pointerEvents: "none",
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
          DEVSECOPS PIPELINE
        </div>
      </div>

      {/* Row labels */}
      <div
        style={{
          position: "absolute",
          left: 80,
          top: rowTopY - 14,
          fontFamily: "Inter, sans-serif",
          fontWeight: 600,
          fontSize: 13,
          color: "#6b7280",
          letterSpacing: 2,
          opacity: interpolate(frame, [40, 58], [0, 0.7], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        BUILD PHASE
      </div>
      <div
        style={{
          position: "absolute",
          left: 80,
          top: rowBottomY - 14,
          fontFamily: "Inter, sans-serif",
          fontWeight: 600,
          fontSize: 13,
          color: "#6b7280",
          letterSpacing: 2,
          opacity: interpolate(frame, [40, 58], [0, 0.7], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        VERIFY PHASE
      </div>

      {/* Connecting lines */}
      {pipelineConnections.map(([fromIdx, toIdx], connIdx) => {
        const fromPos = getGatePosition(fromIdx);
        const toPos = getGatePosition(toIdx);

        // Connection activates when the source gate is active
        const connActivationFrame = getGateActivationFrame(fromIdx);
        const connProgress = interpolate(
          frame,
          [connActivationFrame, connActivationFrame + FRAMES_PER_GATE],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );

        const isConnActive = frame >= connActivationFrame + FRAMES_PER_GATE;

        // Entry animation for lines
        const lineEntryOpacity = interpolate(
          frame,
          [40, 58],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );

        // Adjust start/end points to gate edges
        let x1 = fromPos.x + GATE_WIDTH / 2 - 12; // right edge of hex
        let y1 = fromPos.y;
        let x2 = toPos.x - GATE_WIDTH / 2 + 12; // left edge of hex
        let y2 = toPos.y;

        // For the vertical connection (gate 3 to gate 4), adjust points
        if (fromIdx === 3 && toIdx === 4) {
          x1 = fromPos.x;
          y1 = fromPos.y + GATE_HEIGHT / 2;
          x2 = toPos.x;
          y2 = toPos.y - GATE_HEIGHT / 2;
        }

        return (
          <ConnectingLine
            key={`conn-${connIdx}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            isActive={isConnActive}
            pulseProgress={connProgress}
            entryOpacity={lineEntryOpacity}
          />
        );
      })}

      {/* Gates */}
      {gates.map((gate, index) => {
        const pos = getGatePosition(index);
        const activationFrame = getGateActivationFrame(index);
        const isActive = frame >= activationFrame + FRAMES_PER_GATE;
        const isPulsing =
          frame >= activationFrame && frame < activationFrame + FRAMES_PER_GATE;
        const pulseProgress = isPulsing
          ? interpolate(
              frame,
              [activationFrame, activationFrame + FRAMES_PER_GATE],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            )
          : 0;

        // Staggered entry animation
        const entryDelay = 30 + index * 5;
        const entryScale = spring({
          frame: frame - entryDelay,
          fps,
          config: {
            damping: 14,
            stiffness: 120,
            mass: 0.5,
          },
        });

        const entryOpacity = interpolate(
          frame,
          [entryDelay, entryDelay + 12],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );

        return (
          <HexagonGate
            key={gate.id}
            gate={gate}
            x={pos.x}
            y={pos.y}
            isActive={isActive}
            isPulsing={isPulsing}
            pulseProgress={pulseProgress}
            entryOpacity={entryOpacity}
            entryScale={entryScale}
          />
        );
      })}

      {/* Progress counter */}
      {(() => {
        const activeCount = gates.filter((_, index) => {
          const activationFrame = getGateActivationFrame(index);
          return frame >= activationFrame + FRAMES_PER_GATE;
        }).length;

        const counterOpacity = interpolate(
          frame,
          [PIPELINE_START_FRAME, PIPELINE_START_FRAME + 10],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );

        if (frame < PIPELINE_START_FRAME) return null;

        return (
          <div
            style={{
              position: "absolute",
              top: 150,
              right: 120,
              fontFamily: "Inter, sans-serif",
              fontWeight: 700,
              fontSize: 18,
              color: activeCount === 8 ? COLORS.active : COLORS.accent,
              letterSpacing: 2,
              opacity: counterOpacity,
            }}
          >
            {activeCount} / 8 GATES PASSED
          </div>
        );
      })()}

      {/* Status bar under pipeline */}
      <div
        style={{
          position: "absolute",
          left: startX - GATE_WIDTH / 2,
          top: rowBottomY + GATE_HEIGHT / 2 + 40,
          width: 3 * gapX + GATE_WIDTH,
          height: 4,
          background: "rgba(55, 65, 81, 0.4)",
          borderRadius: 2,
          overflow: "hidden",
          opacity: interpolate(frame, [45, 58], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${interpolate(
              frame,
              [
                PIPELINE_START_FRAME,
                getGateActivationFrame(7) + FRAMES_PER_GATE,
              ],
              [0, 100],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.linear }
            )}%`,
            background: `linear-gradient(90deg, ${COLORS.active}, ${COLORS.pulse})`,
            borderRadius: 2,
            boxShadow: `0 0 8px rgba(16, 185, 129, 0.5)`,
          }}
        />
      </div>

      {/* Subtitle */}
      <div
        style={{
          position: "absolute",
          bottom: 160,
          left: 0,
          right: 0,
          textAlign: "center",
          opacity: subtitleOpacity,
          transform: `translateY(${subtitleY}px)`,
        }}
      >
        <div
          style={{
            fontFamily: "Inter, sans-serif",
            fontWeight: 400,
            fontSize: 22,
            color: COLORS.accent,
            letterSpacing: 3,
          }}
        >
          8 Security Gates &bull; Zero Trust Supply Chain
        </div>
      </div>

      {/* Shield icon */}
      <div
        style={{
          position: "absolute",
          bottom: 80,
          left: "50%",
          transform: `translateX(-50%) scale(${shieldScale})`,
          opacity: shieldOpacity,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Shield SVG */}
        <svg
          width={60}
          height={68}
          viewBox="0 0 60 68"
          fill="none"
          style={{
            filter: `drop-shadow(0 0 ${10 + shieldGlow * 15}px rgba(16, 185, 129, ${0.4 + shieldGlow * 0.4}))`,
          }}
        >
          <path
            d="M30 4L6 16V32C6 48.5 16.5 60.5 30 64C43.5 60.5 54 48.5 54 32V16L30 4Z"
            fill="rgba(16, 185, 129, 0.15)"
            stroke={COLORS.active}
            strokeWidth={2.5}
          />
          {/* Check mark inside shield */}
          <path
            d="M20 34L27 41L40 26"
            stroke={COLORS.active}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
        <div
          style={{
            fontFamily: "Inter, sans-serif",
            fontWeight: 700,
            fontSize: 16,
            color: COLORS.active,
            marginLeft: 12,
            letterSpacing: 2,
          }}
        >
          VERIFIED
        </div>
      </div>
    </div>
  );
};
