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

const TITLE_TEXT = "SECURE RUNTIME ENVIRONMENT";

export const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // --- Shield icon animation ---
  const shieldScale = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 80, mass: 0.8 },
  });

  const shieldGlow = interpolate(frame, [0, 20, 40, 60], [0, 15, 25, 20], {
    extrapolateRight: "clamp",
  });

  const shieldRotate = interpolate(frame, [0, 45], [-15, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.back(1.4)),
  });

  // --- Title typing/reveal effect ---
  const charsToShow = Math.floor(
    interpolate(frame, [50, 160], [0, TITLE_TEXT.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.quad),
    })
  );

  const titleOpacity = interpolate(frame, [50, 65], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Cursor blink for typing effect
  const cursorOpacity =
    frame >= 50 && frame <= 175
      ? Math.sin(frame * 0.4) > 0
        ? 1
        : 0
      : 0;

  // --- Subtitle fade in ---
  const subtitleOpacity = interpolate(frame, [180, 220], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const subtitleY = interpolate(frame, [180, 220], [20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // --- Accent line expansion ---
  const lineWidth = interpolate(frame, [140, 200], [0, 600], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const lineOpacity = interpolate(frame, [140, 155], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const lineGlow = interpolate(frame, [140, 200, 300], [0, 20, 12], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // --- Background grid pulse ---
  const gridOpacity = interpolate(frame, [0, 80, 200], [0, 0.04, 0.06], {
    extrapolateRight: "clamp",
  });

  // --- Background radial glow ---
  const bgGlowOpacity = interpolate(frame, [0, 100], [0, 0.3], {
    extrapolateRight: "clamp",
  });

  // --- Particle/dot decorations ---
  const particleOpacity = interpolate(frame, [60, 120], [0, 0.6], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Shield SVG path
  const shieldPath =
    "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5L12 1z";
  const lockBodyPath = "M9 11h6v5H9z";
  const lockArcPath = "M10 11V9a2 2 0 1 1 4 0v2";

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
      }}
    >
      {/* Background radial glow */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: 1200,
          height: 1200,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${CYAN}22 0%, transparent 70%)`,
          transform: "translate(-50%, -50%)",
          opacity: bgGlowOpacity,
        }}
      />

      {/* Subtle grid pattern overlay */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backgroundImage: `
            linear-gradient(${CYAN} 1px, transparent 1px),
            linear-gradient(90deg, ${CYAN} 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
          opacity: gridOpacity,
        }}
      />

      {/* Floating particles */}
      {[...Array(12)].map((_, i) => {
        const angle = (i / 12) * Math.PI * 2;
        const radius = 300 + (i % 3) * 80;
        const speed = 0.008 + (i % 4) * 0.003;
        const size = 2 + (i % 3) * 1.5;
        const px =
          960 + Math.cos(angle + frame * speed) * radius;
        const py =
          540 + Math.sin(angle + frame * speed) * radius * 0.6;

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
              backgroundColor: CYAN,
              opacity: particleOpacity * (0.3 + (i % 3) * 0.3),
              boxShadow: `0 0 ${size * 3}px ${CYAN}`,
            }}
          />
        );
      })}

      {/* Shield / Lock Icon */}
      <div
        style={{
          transform: `scale(${shieldScale}) rotate(${shieldRotate}deg)`,
          marginBottom: 40,
          filter: `drop-shadow(0 0 ${shieldGlow}px ${CYAN})`,
        }}
      >
        <svg
          width={120}
          height={120}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Shield outline */}
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
            fill={`${CYAN}15`}
            stroke={CYAN}
            strokeWidth={0.8}
          />
          {/* Inner shield glow ring */}
          <path
            d={shieldPath}
            fill="none"
            stroke={CYAN}
            strokeWidth={0.3}
            opacity={0.5}
            transform="scale(0.85) translate(1.8, 2)"
          />
          {/* Lock body */}
          <rect
            x={9}
            y={11}
            width={6}
            height={5}
            rx={0.5}
            fill={CYAN}
            opacity={0.9}
          />
          {/* Lock arc */}
          <path
            d={lockArcPath}
            fill="none"
            stroke={CYAN}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
          {/* Keyhole */}
          <circle cx={12} cy={13.5} r={0.8} fill={DARK_NAVY} />
          <rect
            x={11.6}
            y={13.5}
            width={0.8}
            height={1.5}
            rx={0.3}
            fill={DARK_NAVY}
          />
        </svg>
      </div>

      {/* Title with typing reveal */}
      <div
        style={{
          opacity: titleOpacity,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 60,
          position: "relative",
        }}
      >
        <span
          style={{
            fontSize: 52,
            fontWeight: 800,
            letterSpacing: 8,
            color: WHITE,
            textShadow: `0 0 30px ${CYAN}40, 0 0 60px ${CYAN}20`,
          }}
        >
          {TITLE_TEXT.slice(0, charsToShow)}
        </span>
        {/* Typing cursor */}
        <span
          style={{
            display: "inline-block",
            width: 3,
            height: 48,
            backgroundColor: CYAN,
            marginLeft: 4,
            opacity: cursorOpacity,
            boxShadow: `0 0 8px ${CYAN}`,
          }}
        />
      </div>

      {/* Glowing cyan accent line */}
      <div
        style={{
          width: lineWidth,
          height: 2,
          backgroundColor: CYAN,
          marginTop: 30,
          marginBottom: 30,
          opacity: lineOpacity,
          boxShadow: `0 0 ${lineGlow}px ${CYAN}, 0 0 ${lineGlow * 2}px ${CYAN}40`,
          borderRadius: 1,
        }}
      />

      {/* Subtitle */}
      <div
        style={{
          opacity: subtitleOpacity,
          transform: `translateY(${subtitleY}px)`,
        }}
      >
        <span
          style={{
            fontSize: 28,
            fontWeight: 300,
            letterSpacing: 12,
            color: CYAN,
            textTransform: "uppercase",
            textShadow: `0 0 20px ${CYAN}60`,
          }}
        >
          Fighting Smart Cyber
        </span>
      </div>

      {/* Bottom decorative line */}
      <div
        style={{
          position: "absolute",
          bottom: 60,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          opacity: interpolate(frame, [240, 280], [0, 0.5], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            style={{
              width: i === 1 ? 40 : 20,
              height: 2,
              backgroundColor: CYAN,
              borderRadius: 1,
              opacity: i === 1 ? 1 : 0.4,
            }}
          />
        ))}
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
          [220 + i * 15, 260 + i * 15],
          [0, 0.3],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }
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
              borderTop: isTop ? `2px solid ${CYAN}` : "none",
              borderBottom: !isTop ? `2px solid ${CYAN}` : "none",
              borderLeft: isLeft ? `2px solid ${CYAN}` : "none",
              borderRight: !isLeft ? `2px solid ${CYAN}` : "none",
            }}
          />
        );
      })}
    </div>
  );
};
