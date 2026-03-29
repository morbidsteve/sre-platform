import React from "react";
import {
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from "remotion";

const CYAN = "#00d4ff";
const GREEN = "#10b981";
const DARK_BG = "#111827";
const CARD_BG = "#1f2937";
const BORDER = "#374151";
const WHITE = "#ffffff";
const DARK_NAVY = "#0a0e1a";

const TABS = [
  "Overview",
  "Deploy",
  "Applications",
  "Security",
  "Operations",
  "Compliance",
  "Admin",
];

const DEPLOYMENTS = [
  { name: "wireshark", namespace: "team-alpha", status: "Running", time: "2m ago" },
  { name: "statusboard", namespace: "team-alpha", status: "Running", time: "14m ago" },
  { name: "unifi", namespace: "team-alpha", status: "Running", time: "1h ago" },
];

const ProgressRing: React.FC<{ progress: number; size: number }> = ({
  progress,
  size,
}) => {
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress / 100);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Background ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={BORDER}
        strokeWidth={strokeWidth}
      />
      {/* Progress ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={CYAN}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{
          filter: `drop-shadow(0 0 6px ${CYAN})`,
        }}
      />
      {/* Center text */}
      <text
        x={size / 2}
        y={size / 2 - 8}
        textAnchor="middle"
        dominantBaseline="central"
        fill={WHITE}
        fontSize={36}
        fontWeight={800}
        fontFamily="Inter, SF Pro Display, system-ui, sans-serif"
      >
        {Math.round(progress)}%
      </text>
      <text
        x={size / 2}
        y={size / 2 + 22}
        textAnchor="middle"
        dominantBaseline="central"
        fill={CYAN}
        fontSize={13}
        fontWeight={500}
        fontFamily="Inter, SF Pro Display, system-ui, sans-serif"
        letterSpacing="0.08em"
      >
        HEALTHY
      </text>
    </svg>
  );
};

const StatusDot: React.FC<{ color: string }> = ({ color }) => (
  <div
    style={{
      width: 10,
      height: 10,
      borderRadius: "50%",
      backgroundColor: color,
      boxShadow: `0 0 8px ${color}`,
      flexShrink: 0,
    }}
  />
);

const MetricCard: React.FC<{
  label: string;
  value: string;
  dotColor: string;
  opacity: number;
  translateY: number;
}> = ({ label, value, dotColor, opacity, translateY }) => (
  <div
    style={{
      backgroundColor: CARD_BG,
      border: `1px solid ${BORDER}`,
      borderRadius: 8,
      padding: "14px 18px",
      display: "flex",
      alignItems: "center",
      gap: 12,
      opacity,
      transform: `translateY(${translateY}px)`,
    }}
  >
    <StatusDot color={dotColor} />
    <div>
      <div
        style={{
          color: "rgba(255,255,255,0.5)",
          fontSize: 11,
          fontWeight: 500,
          fontFamily: "Inter, SF Pro Display, system-ui, sans-serif",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: WHITE,
          fontSize: 18,
          fontWeight: 700,
          fontFamily: "Inter, SF Pro Display, system-ui, sans-serif",
        }}
      >
        {value}
      </div>
    </div>
  </div>
);

export const DashboardScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // --- Frame fade in + scale (frames 20-80) ---
  const frameScale = spring({
    frame: Math.max(0, frame - 20),
    fps,
    config: { damping: 14, stiffness: 80, mass: 0.8 },
    from: 0.8,
    to: 1,
  });

  const frameOpacity = interpolate(frame, [20, 80], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // --- Title and subtitle ---
  const titleOpacity = interpolate(frame, [0, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleY = interpolate(frame, [0, 40], [-20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const subtitleOpacity = interpolate(frame, [360, 400], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const subtitleY = interpolate(frame, [360, 400], [15, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // --- Nav tabs animation (frames 60-100) ---
  const tabsOpacity = interpolate(frame, [60, 100], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // --- Progress ring animation (frames 80-200) ---
  const ringProgress = interpolate(frame, [80, 200], [0, 98], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // --- Metric cards stagger (frames 140-250, ~35 frame stagger) ---
  const metric1Opacity = interpolate(frame, [140, 175], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const metric1Y = interpolate(frame, [140, 175], [15, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const metric2Opacity = interpolate(frame, [175, 210], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const metric2Y = interpolate(frame, [175, 210], [15, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const metric3Opacity = interpolate(frame, [210, 250], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const metric3Y = interpolate(frame, [210, 250], [15, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // --- Deployments table (frames 250-290) ---
  const tableOpacity = interpolate(frame, [250, 290], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // --- Background grid ---
  const gridOpacity = interpolate(frame, [0, 80], [0, 0.04], {
    extrapolateRight: "clamp",
  });

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
        fontFamily: "Inter, SF Pro Display, system-ui, sans-serif",
      }}
    >
      {/* Subtle grid background */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `
            linear-gradient(${CYAN} 1px, transparent 1px),
            linear-gradient(90deg, ${CYAN} 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
          opacity: gridOpacity,
        }}
      />

      {/* Background radial glow */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: 1400,
          height: 1400,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${CYAN}10 0%, transparent 70%)`,
          transform: "translate(-50%, -50%)",
          opacity: 0.4,
        }}
      />

      {/* Scene title */}
      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          marginBottom: 28,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 48,
            fontWeight: 900,
            color: WHITE,
            letterSpacing: 6,
          }}
        >
          UNIFIED DASHBOARD
        </div>
      </div>

      {/* Browser frame container */}
      <div
        style={{
          transform: `scale(${frameScale})`,
          opacity: frameOpacity,
          width: 1400,
        }}
      >
        {/* Browser chrome - top bar */}
        <div
          style={{
            backgroundColor: "#1a1f2e",
            borderTopLeftRadius: 14,
            borderTopRightRadius: 14,
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          {/* Traffic light dots */}
          <div style={{ display: "flex", gap: 7 }}>
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                backgroundColor: "#ff5f57",
              }}
            />
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                backgroundColor: "#febc2e",
              }}
            />
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                backgroundColor: "#28c840",
              }}
            />
          </div>

          {/* URL bar */}
          <div
            style={{
              flex: 1,
              backgroundColor: "#0d1117",
              borderRadius: 6,
              padding: "6px 14px",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {/* Lock icon */}
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none">
              <rect
                x={6}
                y={11}
                width={12}
                height={10}
                rx={2}
                fill={GREEN}
                opacity={0.8}
              />
              <path
                d="M8 11V8a4 4 0 1 1 8 0v3"
                stroke={GREEN}
                strokeWidth={2}
                strokeLinecap="round"
                fill="none"
              />
            </svg>
            <span
              style={{
                color: "rgba(255,255,255,0.5)",
                fontSize: 13,
                fontWeight: 400,
              }}
            >
              https://dashboard.apps.sre.example.com
            </span>
          </div>
        </div>

        {/* Dashboard content area */}
        <div
          style={{
            backgroundColor: DARK_BG,
            borderBottomLeftRadius: 14,
            borderBottomRightRadius: 14,
            overflow: "hidden",
          }}
        >
          {/* Navigation tabs */}
          <div
            style={{
              backgroundColor: "#0d1117",
              display: "flex",
              alignItems: "center",
              padding: "0 20px",
              borderBottom: `1px solid ${BORDER}`,
              opacity: tabsOpacity,
            }}
          >
            {TABS.map((tab) => {
              const isActive = tab === "Overview";
              return (
                <div
                  key={tab}
                  style={{
                    padding: "12px 18px",
                    fontSize: 14,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? CYAN : "rgba(255,255,255,0.45)",
                    borderBottom: isActive
                      ? `2px solid ${CYAN}`
                      : "2px solid transparent",
                    cursor: "default",
                    letterSpacing: "0.02em",
                  }}
                >
                  {tab}
                </div>
              );
            })}
          </div>

          {/* Main content grid */}
          <div
            style={{
              display: "flex",
              padding: 24,
              gap: 24,
              minHeight: 420,
            }}
          >
            {/* Left: Cluster Health card */}
            <div
              style={{
                flex: 1,
                backgroundColor: CARD_BG,
                border: `1px solid ${BORDER}`,
                borderRadius: 10,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: 32,
              }}
            >
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.6)",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginBottom: 24,
                }}
              >
                Cluster Health
              </div>
              <ProgressRing progress={ringProgress} size={180} />
            </div>

            {/* Right: Metric cards */}
            <div
              style={{
                width: 340,
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              <MetricCard
                label="Pods Running"
                value="47"
                dotColor={GREEN}
                opacity={metric1Opacity}
                translateY={metric1Y}
              />
              <MetricCard
                label="Flux Synced"
                value="26/26"
                dotColor={GREEN}
                opacity={metric2Opacity}
                translateY={metric2Y}
              />
              <MetricCard
                label="Security Gates"
                value="8/8 PASS"
                dotColor={GREEN}
                opacity={metric3Opacity}
                translateY={metric3Y}
              />
            </div>
          </div>

          {/* Bottom: Recent Deployments */}
          <div
            style={{
              padding: "0 24px 24px 24px",
              opacity: tableOpacity,
            }}
          >
            <div
              style={{
                backgroundColor: CARD_BG,
                border: `1px solid ${BORDER}`,
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              {/* Table header */}
              <div
                style={{
                  padding: "12px 20px",
                  borderBottom: `1px solid ${BORDER}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "rgba(255,255,255,0.6)",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  Recent Deployments
                </div>
              </div>

              {/* Table rows */}
              {DEPLOYMENTS.map((dep, i) => {
                const rowDelay = 260 + i * 30;
                const rowOpacity = interpolate(
                  frame,
                  [rowDelay, rowDelay + 30],
                  [0, 1],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
                );

                return (
                  <div
                    key={dep.name}
                    style={{
                      padding: "10px 20px",
                      display: "flex",
                      alignItems: "center",
                      borderBottom:
                        i < DEPLOYMENTS.length - 1
                          ? `1px solid ${BORDER}`
                          : "none",
                      opacity: rowOpacity,
                    }}
                  >
                    <StatusDot color={GREEN} />
                    <span
                      style={{
                        color: WHITE,
                        fontSize: 14,
                        fontWeight: 600,
                        marginLeft: 12,
                        width: 160,
                      }}
                    >
                      {dep.name}
                    </span>
                    <span
                      style={{
                        color: "rgba(255,255,255,0.4)",
                        fontSize: 13,
                        width: 140,
                      }}
                    >
                      {dep.namespace}
                    </span>
                    <span
                      style={{
                        color: GREEN,
                        fontSize: 13,
                        fontWeight: 500,
                        width: 100,
                      }}
                    >
                      {dep.status}
                    </span>
                    <span
                      style={{
                        color: "rgba(255,255,255,0.3)",
                        fontSize: 13,
                        marginLeft: "auto",
                      }}
                    >
                      {dep.time}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Subtitle below frame */}
      <div
        style={{
          opacity: subtitleOpacity,
          transform: `translateY(${subtitleY}px)`,
          marginTop: 28,
          textAlign: "center",
        }}
      >
        <span
          style={{
            fontSize: 24,
            fontWeight: 500,
            color: CYAN,
            letterSpacing: "0.08em",
          }}
        >
          One-Button Deploy &bull; Real-Time Monitoring
        </span>
      </div>
    </div>
  );
};
