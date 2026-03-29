import React from "react";
import {
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from "remotion";

const DARK_NAVY = "#0a0e1a";
const WHITE = "#ffffff";
const ACCENT = "#00d4ff";

interface BadgeData {
  title: string;
  subtitle: string;
  color: string;
  delay: number;
}

const BADGES: BadgeData[] = [
  { title: "NIST 800-53", subtitle: "Rev 5", color: "#1e40af", delay: 80 },
  { title: "CMMC 2.0", subtitle: "Level 2", color: "#7c3aed", delay: 170 },
  { title: "FedRAMP", subtitle: "Moderate", color: "#dc2626", delay: 260 },
  { title: "DISA STIGs", subtitle: "RKE2 + RHEL9", color: "#059669", delay: 350 },
  { title: "FIPS 140-2", subtitle: "Validated", color: "#d97706", delay: 440 },
];

// Shield clip-path: rounded top, pointed bottom
const SHIELD_CLIP =
  "polygon(50% 0%, 95% 8%, 100% 15%, 100% 55%, 85% 75%, 50% 100%, 15% 75%, 0% 55%, 0% 15%, 5% 8%)";

const Badge: React.FC<{
  badge: BadgeData;
  x: number;
  y: number;
}> = ({ badge, x, y }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scaleSpring = spring({
    frame: frame - badge.delay,
    fps,
    config: { damping: 10, stiffness: 80, mass: 0.9 },
  });

  const opacity = interpolate(
    frame,
    [badge.delay, badge.delay + 15],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Subtle pulsing glow after appearing
  const glowPhase = Math.max(0, frame - badge.delay - 30);
  const pulseGlow = glowPhase > 0
    ? 12 + Math.sin(glowPhase * 0.08) * 6
    : 0;

  // Checkmark appears after badge
  const checkDelay = badge.delay + 30;
  const checkScale = spring({
    frame: frame - checkDelay,
    fps,
    config: { damping: 8, stiffness: 150, mass: 0.5 },
  });
  const checkOpacity = interpolate(
    frame,
    [checkDelay, checkDelay + 10],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const BADGE_W = 200;
  const BADGE_H = 240;

  return (
    <div
      style={{
        position: "absolute",
        left: x - BADGE_W / 2,
        top: y - BADGE_H / 2,
        width: BADGE_W,
        height: BADGE_H,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        transform: `scale(${scaleSpring})`,
        opacity,
      }}
    >
      {/* Shield shape */}
      <div
        style={{
          width: 170,
          height: 200,
          clipPath: SHIELD_CLIP,
          background: `linear-gradient(160deg, ${badge.color} 0%, ${badge.color}cc 60%, ${badge.color}88 100%)`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          boxShadow: `0 0 ${pulseGlow}px ${badge.color}, 0 4px 20px rgba(0,0,0,0.5)`,
          filter: `drop-shadow(0 0 ${pulseGlow}px ${badge.color})`,
        }}
      >
        {/* Inner border effect */}
        <div
          style={{
            position: "absolute",
            inset: 4,
            clipPath: SHIELD_CLIP,
            border: "1px solid rgba(255,255,255,0.25)",
            borderRadius: 2,
          }}
        />

        {/* Title text */}
        <span
          style={{
            fontFamily: "Inter, SF Pro Display, system-ui, sans-serif",
            fontWeight: 800,
            fontSize: 22,
            color: WHITE,
            textAlign: "center",
            letterSpacing: 1,
            lineHeight: 1.2,
            textShadow: "0 2px 4px rgba(0,0,0,0.4)",
            padding: "0 12px",
            marginTop: -6,
          }}
        >
          {badge.title}
        </span>

        {/* Divider line */}
        <div
          style={{
            width: 60,
            height: 1,
            backgroundColor: "rgba(255,255,255,0.4)",
            marginTop: 10,
            marginBottom: 8,
          }}
        />

        {/* Subtitle text */}
        <span
          style={{
            fontFamily: "Inter, SF Pro Display, system-ui, sans-serif",
            fontWeight: 400,
            fontSize: 14,
            color: "rgba(255,255,255,0.85)",
            textAlign: "center",
            letterSpacing: 0.5,
            textShadow: "0 1px 3px rgba(0,0,0,0.3)",
          }}
        >
          {badge.subtitle}
        </span>
      </div>

      {/* Checkmark circle */}
      <div
        style={{
          position: "absolute",
          top: -8,
          right: 6,
          width: 36,
          height: 36,
          borderRadius: "50%",
          backgroundColor: "#10b981",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${checkScale})`,
          opacity: checkOpacity,
          boxShadow: "0 2px 8px rgba(16,185,129,0.5)",
          border: `2px solid ${DARK_NAVY}`,
        }}
      >
        <span
          style={{
            color: WHITE,
            fontSize: 20,
            fontWeight: 700,
            lineHeight: 1,
            marginTop: -1,
          }}
        >
          {"\u2713"}
        </span>
      </div>
    </div>
  );
};

export const ComplianceScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // --- Title animation ---
  const titleOpacity = interpolate(frame, [0, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleY = interpolate(frame, [0, 60], [-20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // --- Badge positions in arc/pentagon layout ---
  // Center of the scene with a gentle arc arrangement
  const centerX = 960;
  const centerY = 460;
  const arcRadiusX = 380;
  const arcRadiusY = 160;

  // Position 5 badges in an arc: spread across roughly 180 degrees
  const badgePositions = BADGES.map((_, i) => {
    const angle = Math.PI + (Math.PI / (BADGES.length - 1)) * i;
    return {
      x: centerX + Math.cos(angle) * arcRadiusX,
      y: centerY + Math.sin(angle) * arcRadiusY,
    };
  });

  // --- Background grid ---
  const gridOpacity = interpolate(frame, [0, 60], [0, 0.04], {
    extrapolateRight: "clamp",
  });

  // --- Counter animations ---
  const counterStartFrame = 550;

  const counterContainerOpacity = interpolate(
    frame,
    [counterStartFrame, counterStartFrame + 30],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const counterContainerY = interpolate(
    frame,
    [counterStartFrame, counterStartFrame + 30],
    [20, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Count up: "10 NIST Control Families Covered"
  const familiesCount = Math.floor(
    interpolate(
      frame,
      [counterStartFrame + 20, counterStartFrame + 120],
      [0, 10],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    )
  );

  // Count up: "110+ Controls Mapped"
  const controlsCount = Math.floor(
    interpolate(
      frame,
      [counterStartFrame + 30, counterStartFrame + 120],
      [0, 110],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    )
  );

  // --- Accent line ---
  const lineWidth = interpolate(frame, [30, 70], [0, 500], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const lineOpacity = interpolate(frame, [30, 50], [0, 0.6], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // --- Background radial glow ---
  const bgGlowOpacity = interpolate(frame, [0, 60], [0, 0.2], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: DARK_NAVY,
        position: "relative",
        overflow: "hidden",
        fontFamily:
          "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* Background radial glow */}
      <div
        style={{
          position: "absolute",
          top: "40%",
          left: "50%",
          width: 1400,
          height: 1400,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${ACCENT}18 0%, transparent 65%)`,
          transform: "translate(-50%, -50%)",
          opacity: bgGlowOpacity,
        }}
      />

      {/* Subtle grid pattern */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `
            linear-gradient(${ACCENT} 1px, transparent 1px),
            linear-gradient(90deg, ${ACCENT} 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
          opacity: gridOpacity,
        }}
      />

      {/* Floating particles */}
      {[...Array(8)].map((_, i) => {
        const angle = (i / 8) * Math.PI * 2;
        const radius = 350 + (i % 3) * 60;
        const speed = 0.006 + (i % 4) * 0.002;
        const size = 2 + (i % 3);
        const px = 960 + Math.cos(angle + frame * speed) * radius;
        const py = 450 + Math.sin(angle + frame * speed) * radius * 0.5;

        const particleOpacity = interpolate(frame, [30, 70], [0, 0.4], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: px,
              top: py,
              width: size,
              height: size,
              borderRadius: "50%",
              backgroundColor: ACCENT,
              opacity: particleOpacity * (0.3 + (i % 3) * 0.25),
              boxShadow: `0 0 ${size * 3}px ${ACCENT}`,
            }}
          />
        );
      })}

      {/* Scene title */}
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
            fontWeight: 900,
            fontSize: 52,
            color: WHITE,
            letterSpacing: 6,
            textShadow: `0 0 30px ${ACCENT}30`,
          }}
        >
          COMPLIANCE & ACCREDITATION
        </div>

        {/* Accent line under title */}
        <div
          style={{
            width: lineWidth,
            height: 2,
            backgroundColor: ACCENT,
            margin: "20px auto 0",
            opacity: lineOpacity,
            boxShadow: `0 0 12px ${ACCENT}, 0 0 24px ${ACCENT}40`,
            borderRadius: 1,
          }}
        />

        <div
          style={{
            fontWeight: 400,
            fontSize: 20,
            color: ACCENT,
            marginTop: 14,
            letterSpacing: 3,
            opacity: titleOpacity * 0.8,
          }}
        >
          GOVERNMENT-READY SECURITY FRAMEWORKS
        </div>
      </div>

      {/* Compliance badges */}
      {BADGES.map((badge, i) => (
        <Badge
          key={badge.title}
          badge={badge}
          x={badgePositions[i].x}
          y={badgePositions[i].y}
        />
      ))}

      {/* Animated counters */}
      <div
        style={{
          position: "absolute",
          bottom: 120,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          gap: 120,
          opacity: counterContainerOpacity,
          transform: `translateY(${counterContainerY}px)`,
        }}
      >
        {/* Counter 1: Control Families */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 64,
              fontWeight: 900,
              color: ACCENT,
              lineHeight: 1,
              textShadow: `0 0 20px ${ACCENT}60`,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {familiesCount}
          </span>
          <span
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "rgba(255,255,255,0.8)",
              letterSpacing: 2,
              marginTop: 8,
              textTransform: "uppercase",
            }}
          >
            NIST Control Families Covered
          </span>
        </div>

        {/* Vertical divider */}
        <div
          style={{
            width: 1,
            height: 80,
            backgroundColor: "rgba(255,255,255,0.15)",
            alignSelf: "center",
          }}
        />

        {/* Counter 2: Controls Mapped */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 64,
              fontWeight: 900,
              color: ACCENT,
              lineHeight: 1,
              textShadow: `0 0 20px ${ACCENT}60`,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {controlsCount}+
          </span>
          <span
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "rgba(255,255,255,0.8)",
              letterSpacing: 2,
              marginTop: 8,
              textTransform: "uppercase",
            }}
          >
            Controls Mapped
          </span>
        </div>
      </div>

      {/* Corner accents */}
      {(
        [
          { top: 40, left: 40 },
          { top: 40, right: 40 },
          { bottom: 40, left: 40 },
          { bottom: 40, right: 40 },
        ] as React.CSSProperties[]
      ).map((pos, i) => {
        const cornerOpacity = interpolate(
          frame,
          [15 + i * 10, 50 + i * 10],
          [0, 0.2],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );

        const isTop = "top" in pos;
        const isLeft = "left" in pos;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              ...pos,
              width: 30,
              height: 30,
              opacity: cornerOpacity,
              borderTop: isTop ? `2px solid ${ACCENT}` : "none",
              borderBottom: !isTop ? `2px solid ${ACCENT}` : "none",
              borderLeft: isLeft ? `2px solid ${ACCENT}` : "none",
              borderRight: !isLeft ? `2px solid ${ACCENT}` : "none",
            }}
          />
        );
      })}
    </div>
  );
};
