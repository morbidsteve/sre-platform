import React from "react";
import {
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
  Easing,
} from "remotion";

const CYAN = "#00d4ff";
const DARK_NAVY = "#0a0e1a";
const WHITE = "#ffffff";
const GRAY = "#9ca3af";

const PILLS = ["Open Source", "Government Ready", "Zero Trust"];

export const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // --- Global fade out (frames 320-390) ---
  const globalOpacity = interpolate(frame, [320, 390], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // --- Shield spring animation ---
  const shieldScale = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 80, mass: 0.8 },
  });

  const shieldGlow = interpolate(frame, [0, 50, 100], [0, 20, 30], {
    extrapolateRight: "clamp",
  });

  // --- Background radial glow ---
  const bgGlowOpacity = interpolate(frame, [0, 100], [0, 0.35], {
    extrapolateRight: "clamp",
  });

  // --- "SECURE RUNTIME ENVIRONMENT" fade in at frame 50 ---
  const titleOpacity = interpolate(frame, [50, 80], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleY = interpolate(frame, [50, 80], [15, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // --- "Fighting Smart Cyber" fade in at frame 100 ---
  const subtitleOpacity = interpolate(frame, [100, 130], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const subtitleY = interpolate(frame, [100, 130], [15, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // --- Divider line expands from center at frame 150 ---
  const lineWidth = interpolate(frame, [150, 190], [0, 500], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const lineOpacity = interpolate(frame, [150, 165], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const lineGlow = interpolate(frame, [150, 190], [0, 15], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // --- Feature pills at frame 190 ---
  const pillOpacity = interpolate(frame, [190, 240], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const pillY = interpolate(frame, [190, 240], [20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // --- GitHub URL at frame 260 ---
  const urlOpacity = interpolate(frame, [260, 290], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const urlY = interpolate(frame, [260, 290], [10, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // Shield SVG path
  const shieldPath =
    "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5L12 1z";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: DARK_NAVY,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
        fontFamily:
          "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
        opacity: globalOpacity,
      }}
    >
      {/* Background radial gradient glow behind shield */}
      <div
        style={{
          position: "absolute",
          top: "38%",
          left: "50%",
          width: 900,
          height: 900,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${CYAN}25 0%, ${CYAN}08 35%, transparent 70%)`,
          transform: "translate(-50%, -50%)",
          opacity: bgGlowOpacity,
        }}
      />

      {/* Shield icon */}
      <div
        style={{
          transform: `scale(${shieldScale})`,
          marginBottom: 32,
          filter: `drop-shadow(0 0 ${shieldGlow}px ${CYAN})`,
        }}
      >
        <svg
          width={140}
          height={140}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Outer shield glow */}
          <path
            d={shieldPath}
            fill="none"
            stroke={CYAN}
            strokeWidth={1.2}
            opacity={0.3}
          />
          {/* Shield filled */}
          <path
            d={shieldPath}
            fill={`${CYAN}18`}
            stroke={CYAN}
            strokeWidth={0.8}
          />
          {/* Inner shield ring */}
          <path
            d={shieldPath}
            fill="none"
            stroke={CYAN}
            strokeWidth={0.3}
            opacity={0.5}
            transform="scale(0.85) translate(1.8, 2)"
          />
          {/* Checkmark inside shield */}
          <path
            d="M8.5 12.5l2.5 2.5 5-5"
            fill="none"
            stroke={CYAN}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.95}
          />
        </svg>
      </div>

      {/* "SECURE RUNTIME ENVIRONMENT" */}
      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          marginBottom: 12,
        }}
      >
        <span
          style={{
            fontSize: 48,
            fontWeight: 800,
            letterSpacing: 6,
            color: WHITE,
            textShadow: `0 0 30px ${CYAN}40, 0 0 60px ${CYAN}20`,
          }}
        >
          SECURE RUNTIME ENVIRONMENT
        </span>
      </div>

      {/* "Fighting Smart Cyber" */}
      <div
        style={{
          opacity: subtitleOpacity,
          transform: `translateY(${subtitleY}px)`,
          marginBottom: 28,
        }}
      >
        <span
          style={{
            fontSize: 28,
            fontWeight: 400,
            letterSpacing: 6,
            color: CYAN,
            textShadow: `0 0 20px ${CYAN}60`,
          }}
        >
          Fighting Smart Cyber
        </span>
      </div>

      {/* Horizontal divider line */}
      <div
        style={{
          width: lineWidth,
          height: 2,
          backgroundColor: CYAN,
          opacity: lineOpacity,
          boxShadow: `0 0 ${lineGlow}px ${CYAN}, 0 0 ${lineGlow * 2}px ${CYAN}40`,
          borderRadius: 1,
          marginBottom: 32,
        }}
      />

      {/* Feature pills */}
      <div
        style={{
          display: "flex",
          gap: 20,
          opacity: pillOpacity,
          transform: `translateY(${pillY}px)`,
          marginBottom: 40,
        }}
      >
        {PILLS.map((label, i) => {
          const stagger = interpolate(
            frame,
            [190 + i * 20, 220 + i * 20],
            [0, 1],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }
          );

          const pillScale = spring({
            frame: Math.max(0, frame - 190 - i * 20),
            fps,
            config: { damping: 14, stiffness: 120, mass: 0.6 },
          });

          return (
            <div
              key={label}
              style={{
                padding: "10px 28px",
                borderRadius: 30,
                border: `1.5px solid ${CYAN}`,
                backgroundColor: `${CYAN}0a`,
                opacity: stagger,
                transform: `scale(${pillScale})`,
              }}
            >
              <span
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  letterSpacing: 2,
                  color: WHITE,
                  textTransform: "uppercase",
                }}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* GitHub URL */}
      <div
        style={{
          opacity: urlOpacity,
          transform: `translateY(${urlY}px)`,
        }}
      >
        <span
          style={{
            fontSize: 18,
            fontWeight: 400,
            letterSpacing: 1.5,
            color: GRAY,
          }}
        >
          github.com/morbidsteve/sre-platform
        </span>
      </div>
    </div>
  );
};
