import React from "react";
import {
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from "remotion";

const ACCENT = "#00d4ff";

/* ------------------------------------------------------------------ */
/*  SVG icon builders (inline, no external deps)                      */
/* ------------------------------------------------------------------ */

const TerminalIcon: React.FC<{ size: number; color: string }> = ({
  size,
  color,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="3" width="20" height="18" rx="2" />
    <polyline points="7 9 10 12 7 15" />
    <line x1="13" y1="15" x2="17" y2="15" />
  </svg>
);

const SyncIcon: React.FC<{
  size: number;
  color: string;
  rotation: number;
}> = ({ size, color, rotation }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ transform: `rotate(${rotation}deg)` }}
  >
    <path d="M21 2v6h-6" />
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M3 22v-6h6" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
  </svg>
);

const KubeIcon: React.FC<{ size: number; color: string }> = ({
  size,
  color,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
    <line x1="12" y1="22" x2="12" y2="15.5" />
    <polyline points="22 8.5 12 15.5 2 8.5" />
    <polyline points="2 15.5 12 8.5 22 15.5" />
    <line x1="12" y1="2" x2="12" y2="8.5" />
  </svg>
);

const RadarIcon: React.FC<{ size: number; color: string }> = ({
  size,
  color,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
    <line x1="12" y1="2" x2="12" y2="12" />
  </svg>
);

const RewindIcon: React.FC<{ size: number; color: string }> = ({
  size,
  color,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polygon points="11 19 2 12 11 5 11 19" />
    <polygon points="22 19 13 12 22 5 22 19" />
  </svg>
);

const DocIcon: React.FC<{ size: number; color: string }> = ({
  size,
  color,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <line x1="10" y1="9" x2="8" y2="9" />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Animated arrow with flowing dots                                  */
/* ------------------------------------------------------------------ */

const FlowArrow: React.FC<{
  x: number;
  y: number;
  width: number;
  startFrame: number;
}> = ({ x, y, width, startFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const arrowProgress = spring({
    frame: frame - startFrame,
    fps,
    config: { damping: 18, stiffness: 60, mass: 0.8 },
  });

  const dashOpacity = interpolate(arrowProgress, [0, 0.3, 1], [0, 0.5, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const lineWidth = interpolate(arrowProgress, [0, 1], [0, width], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Flowing dots along the arrow
  const dotCount = 3;
  const dots = [];
  for (let i = 0; i < dotCount; i++) {
    const cycleLength = 40;
    const offset = (i * cycleLength) / dotCount;
    const dotFrame = Math.max(0, frame - startFrame - 15);
    const dotPosition = ((dotFrame + offset) % cycleLength) / cycleLength;
    const dotOpacity =
      frame > startFrame + 15
        ? interpolate(dotPosition, [0, 0.1, 0.9, 1], [0, 1, 1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        : 0;

    dots.push(
      <div
        key={i}
        style={{
          position: "absolute",
          left: dotPosition * width - 4,
          top: -4,
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: ACCENT,
          opacity: dotOpacity * dashOpacity,
          boxShadow: `0 0 8px ${ACCENT}`,
        }}
      />
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height: 2,
        opacity: dashOpacity,
      }}
    >
      {/* Dashed line */}
      <div
        style={{
          width: lineWidth,
          height: 2,
          background: `repeating-linear-gradient(90deg, ${ACCENT} 0px, ${ACCENT} 8px, transparent 8px, transparent 16px)`,
          opacity: 0.6,
        }}
      />
      {/* Arrowhead */}
      <div
        style={{
          position: "absolute",
          right: width - lineWidth - 2,
          top: -6,
          width: 0,
          height: 0,
          borderLeft: `10px solid ${ACCENT}`,
          borderTop: "7px solid transparent",
          borderBottom: "7px solid transparent",
          opacity: arrowProgress > 0.9 ? 1 : 0,
          transition: "opacity 0.1s",
        }}
      />
      {/* Flowing dots */}
      {dots}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Stage card                                                         */
/* ------------------------------------------------------------------ */

interface StageData {
  title: string;
  subtitle: string;
  color: string;
  glowColor: string;
  delay: number;
}

const stages: StageData[] = [
  {
    title: "GIT PUSH",
    subtitle: "git push origin main",
    color: "#8b5cf6",
    glowColor: "rgba(139, 92, 246, 0.3)",
    delay: 50,
  },
  {
    title: "FLUX CD RECONCILE",
    subtitle: "HelmRelease \u2192 Kustomization",
    color: "#3b82f6",
    glowColor: "rgba(59, 130, 246, 0.3)",
    delay: 180,
  },
  {
    title: "CLUSTER DEPLOY",
    subtitle: "Pods Running \u2022 mTLS Encrypted",
    color: "#10b981",
    glowColor: "rgba(16, 185, 129, 0.3)",
    delay: 310,
  },
];

const StageCard: React.FC<{ stage: StageData; index: number }> = ({
  stage,
  index,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const cardWidth = 350;
  const cardHeight = 250;

  const appear = spring({
    frame: frame - stage.delay,
    fps,
    config: { damping: 14, stiffness: 80, mass: 0.8 },
  });

  const scale = interpolate(appear, [0, 1], [0.7, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const opacity = interpolate(appear, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const yOffset = interpolate(appear, [0, 1], [40, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Sync icon rotation for stage 2
  const syncRotation =
    index === 1
      ? interpolate(frame, [stage.delay, stage.delay + 480], [0, 720], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 0;

  // Glow pulse after card fully appears
  const glowPulse =
    frame > stage.delay + 30
      ? 0.3 +
        0.2 * Math.sin(((frame - stage.delay - 30) / 30) * Math.PI * 2)
      : 0;

  // Card x-position: evenly distributed across 1920 width
  const totalGap = 1920 - 3 * cardWidth;
  const gap = totalGap / 4;
  const cardX = gap + index * (cardWidth + gap);

  return (
    <div
      style={{
        position: "absolute",
        left: cardX,
        top: 280,
        width: cardWidth,
        height: cardHeight,
        borderRadius: 20,
        background: `linear-gradient(145deg, ${stage.color}22, ${stage.color}11)`,
        border: `2px solid ${stage.color}88`,
        boxShadow: `0 0 ${30 + glowPulse * 40}px ${stage.glowColor}, 0 8px 32px rgba(0,0,0,0.4)`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        opacity,
        transform: `scale(${scale}) translateY(${yOffset}px)`,
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          background: `${stage.color}33`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {index === 0 && <TerminalIcon size={36} color={stage.color} />}
        {index === 1 && (
          <SyncIcon size={36} color={stage.color} rotation={syncRotation} />
        )}
        {index === 2 && <KubeIcon size={36} color={stage.color} />}
      </div>

      {/* Title */}
      <div
        style={{
          fontFamily: "Inter, sans-serif",
          fontWeight: 800,
          fontSize: 22,
          color: "#ffffff",
          letterSpacing: 3,
          textAlign: "center",
        }}
      >
        {stage.title}
      </div>

      {/* Subtitle */}
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 400,
          fontSize: 14,
          color: stage.color,
          textAlign: "center",
          opacity: 0.9,
          padding: "0 20px",
        }}
      >
        {stage.subtitle}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Feature badge                                                      */
/* ------------------------------------------------------------------ */

interface FeatureBadge {
  label: string;
  icon: "radar" | "rewind" | "doc";
  delay: number;
}

const featureBadges: FeatureBadge[] = [
  { label: "Drift Detection", icon: "radar", delay: 430 },
  { label: "Auto Rollback", icon: "rewind", delay: 460 },
  { label: "Audit Trail", icon: "doc", delay: 490 },
];

const Badge: React.FC<{ badge: FeatureBadge; index: number }> = ({
  badge,
  index,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const appear = spring({
    frame: frame - badge.delay,
    fps,
    config: { damping: 16, stiffness: 100, mass: 0.6 },
  });

  const opacity = interpolate(appear, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const yOffset = interpolate(appear, [0, 1], [30, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const badgeWidth = 240;
  const totalWidth = 3 * badgeWidth + 2 * 40;
  const startX = (1920 - totalWidth) / 2;
  const badgeX = startX + index * (badgeWidth + 40);

  return (
    <div
      style={{
        position: "absolute",
        left: badgeX,
        top: 700,
        width: badgeWidth,
        height: 70,
        borderRadius: 12,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(0, 212, 255, 0.25)",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        opacity,
        transform: `translateY(${yOffset}px)`,
      }}
    >
      {badge.icon === "radar" && <RadarIcon size={22} color={ACCENT} />}
      {badge.icon === "rewind" && <RewindIcon size={22} color={ACCENT} />}
      {badge.icon === "doc" && <DocIcon size={22} color={ACCENT} />}
      <div
        style={{
          fontFamily: "Inter, sans-serif",
          fontWeight: 600,
          fontSize: 16,
          color: ACCENT,
          letterSpacing: 1,
        }}
      >
        {badge.label}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main scene                                                         */
/* ------------------------------------------------------------------ */

export const GitOpsFlowScene: React.FC = () => {
  const frame = useCurrentFrame();

  const titleOpacity = interpolate(frame, [0, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleY = interpolate(frame, [0, 50], [-20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Arrow positions: between stage cards
  // Cards are 350px wide, arranged with even gaps
  const cardWidth = 350;
  const totalGap = 1920 - 3 * cardWidth;
  const gap = totalGap / 4;
  const arrowWidth = gap - 30;
  const arrowY = 280 + 125; // vertically centered on cards (card top + half height)

  const arrow1X = gap + cardWidth + 15;
  const arrow2X = gap + cardWidth + gap + cardWidth + 15;

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

      {/* Radial glow behind flow */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "45%",
          width: 1200,
          height: 600,
          transform: "translate(-50%, -50%)",
          background:
            "radial-gradient(ellipse, rgba(59,130,246,0.06) 0%, transparent 70%)",
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
          GITOPS DEPLOYMENT FLOW
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
          FROM COMMIT TO PRODUCTION IN MINUTES
        </div>
      </div>

      {/* Stage cards */}
      {stages.map((stage, index) => (
        <StageCard key={stage.title} stage={stage} index={index} />
      ))}

      {/* Animated arrows between stages */}
      <FlowArrow
        x={arrow1X}
        y={arrowY}
        width={arrowWidth}
        startFrame={120}
      />
      <FlowArrow
        x={arrow2X}
        y={arrowY}
        width={arrowWidth}
        startFrame={250}
      />

      {/* Step numbers below arrows */}
      {[0, 1, 2].map((i) => {
        const stepDelay = stages[i].delay;
        const stepOpacity = interpolate(
          frame,
          [stepDelay + 10, stepDelay + 30],
          [0, 0.4],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );

        const cardX = gap + i * (cardWidth + gap);

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: cardX,
              top: 540,
              width: cardWidth,
              textAlign: "center",
              fontFamily: "Inter, sans-serif",
              fontWeight: 700,
              fontSize: 14,
              color: "#ffffff",
              letterSpacing: 4,
              opacity: stepOpacity,
            }}
          >
            STEP {i + 1}
          </div>
        );
      })}

      {/* Horizontal divider line above badges */}
      <div
        style={{
          position: "absolute",
          left: 200,
          right: 200,
          top: 630,
          height: 1,
          background: `linear-gradient(90deg, transparent, ${ACCENT}33, transparent)`,
          opacity: interpolate(frame, [410, 430], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />

      {/* "BUILT-IN SAFEGUARDS" label */}
      <div
        style={{
          position: "absolute",
          top: 650,
          left: 0,
          right: 0,
          textAlign: "center",
          opacity: interpolate(frame, [415, 435], [0, 0.6], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div
          style={{
            fontFamily: "Inter, sans-serif",
            fontWeight: 600,
            fontSize: 13,
            color: ACCENT,
            letterSpacing: 4,
          }}
        >
          BUILT-IN SAFEGUARDS
        </div>
      </div>

      {/* Feature badges */}
      {featureBadges.map((badge, index) => (
        <Badge key={badge.label} badge={badge} index={index} />
      ))}
    </div>
  );
};
