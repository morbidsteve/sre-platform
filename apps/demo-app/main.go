package main

import (
	"fmt"
	"html/template"
	"log"
	"net/http"
	"os"
	"sync/atomic"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	appName    string
	appVersion string
	startTime  time.Time
	readyTime  time.Time

	requestCount atomic.Int64

	httpRequestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total number of HTTP requests received.",
		},
		[]string{"method", "path", "status"},
	)

	httpRequestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "Duration of HTTP requests in seconds.",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"method", "path"},
	)
)

func init() {
	prometheus.MustRegister(httpRequestsTotal)
	prometheus.MustRegister(httpRequestDuration)
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func hostname() string {
	h, err := os.Hostname()
	if err != nil {
		return "unknown"
	}
	return h
}

func namespace() string {
	// Kubernetes injects the namespace via the downward API or a mounted file.
	if ns := os.Getenv("POD_NAMESPACE"); ns != "" {
		return ns
	}
	if data, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/namespace"); err == nil {
		return string(data)
	}
	return "local"
}

func uptime() string {
	d := time.Since(startTime)
	days := int(d.Hours()) / 24
	hours := int(d.Hours()) % 24
	minutes := int(d.Minutes()) % 60
	seconds := int(d.Seconds()) % 60
	if days > 0 {
		return fmt.Sprintf("%dd %dh %dm %ds", days, hours, minutes, seconds)
	}
	if hours > 0 {
		return fmt.Sprintf("%dh %dm %ds", hours, minutes, seconds)
	}
	if minutes > 0 {
		return fmt.Sprintf("%dm %ds", minutes, seconds)
	}
	return fmt.Sprintf("%ds", seconds)
}

// instrumentHandler wraps an http.Handler with Prometheus metrics collection.
func instrumentHandler(path string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next(rw, r)
		duration := time.Since(start).Seconds()

		httpRequestsTotal.WithLabelValues(r.Method, path, fmt.Sprintf("%d", rw.statusCode)).Inc()
		httpRequestDuration.WithLabelValues(r.Method, path).Observe(duration)
	}
}

type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

// ── Handlers ──────────────────────────────────────────────────────────────

func handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	count := requestCount.Add(1)

	data := struct {
		AppName      string
		AppVersion   string
		Hostname     string
		Namespace    string
		Uptime       string
		RequestCount int64
	}{
		AppName:      appName,
		AppVersion:   appVersion,
		Hostname:     hostname(),
		Namespace:    namespace(),
		Uptime:       uptime(),
		RequestCount: count,
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := indexTemplate.Execute(w, data); err != nil {
		log.Printf("template error: %v", err)
	}
}

func handleHealthz(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, `{"status":"ok"}`)
}

func handleReadyz(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if time.Now().Before(readyTime) {
		w.WriteHeader(http.StatusServiceUnavailable)
		fmt.Fprint(w, `{"status":"not_ready","reason":"startup_grace_period"}`)
		return
	}
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, `{"status":"ready"}`)
}

// ── Main ──────────────────────────────────────────────────────────────────

func main() {
	appName = envOrDefault("APP_NAME", "demo-app")
	appVersion = envOrDefault("APP_VERSION", "0.1.0")
	startTime = time.Now()
	readyTime = startTime.Add(3 * time.Second)

	mux := http.NewServeMux()
	mux.HandleFunc("/", instrumentHandler("/", handleIndex))
	mux.HandleFunc("/healthz", instrumentHandler("/healthz", handleHealthz))
	mux.HandleFunc("/readyz", instrumentHandler("/readyz", handleReadyz))
	mux.Handle("/metrics", promhttp.Handler())

	addr := ":8080"
	log.Printf("Starting %s %s on %s", appName, appVersion, addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

// ── HTML Template ─────────────────────────────────────────────────────────

var indexTemplate = template.Must(template.New("index").Parse(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{ .AppName }} - SRE Platform</title>
  <style>
    :root {
      --bg: #0f172a;
      --surface: #1e293b;
      --surface-hover: #334155;
      --border: #334155;
      --text: #e2e8f0;
      --text-dim: #94a3b8;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --green: #22c55e;
      --red: #ef4444;
      --yellow: #eab308;
      --radius: 8px;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .container {
      max-width: 600px;
      width: 100%;
    }

    .header {
      text-align: center;
      margin-bottom: 32px;
    }

    .header h1 {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 4px;
    }

    .header .version {
      color: var(--accent);
      font-size: 14px;
      font-weight: 500;
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      margin-bottom: 16px;
    }

    .card h2 {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 16px;
    }

    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    .info-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .info-item .label {
      font-size: 12px;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .info-item .value {
      font-size: 16px;
      font-weight: 600;
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      word-break: break-all;
    }

    .status-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 0;
      border-bottom: 1px solid var(--border);
    }

    .status-row:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }

    .status-row:first-child {
      padding-top: 0;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--green);
      flex-shrink: 0;
    }

    .status-label {
      flex: 1;
      font-size: 14px;
    }

    .status-value {
      font-size: 14px;
      color: var(--text-dim);
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    }

    .counter {
      text-align: center;
      padding: 24px;
    }

    .counter .number {
      font-size: 48px;
      font-weight: 700;
      color: var(--accent);
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    }

    .counter .label {
      font-size: 14px;
      color: var(--text-dim);
      margin-top: 4px;
    }

    .endpoints {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .endpoint {
      background: var(--surface-hover);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 13px;
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      color: var(--accent);
      text-decoration: none;
      transition: background 0.15s;
    }

    .endpoint:hover {
      background: var(--accent);
      color: white;
    }

    .footer {
      text-align: center;
      margin-top: 24px;
      font-size: 12px;
      color: var(--text-dim);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>{{ .AppName }}</h1>
      <div class="version">v{{ .AppVersion }} / SRE Platform</div>
    </div>

    <div class="card">
      <h2>Instance Info</h2>
      <div class="info-grid">
        <div class="info-item">
          <span class="label">Hostname</span>
          <span class="value">{{ .Hostname }}</span>
        </div>
        <div class="info-item">
          <span class="label">Namespace</span>
          <span class="value">{{ .Namespace }}</span>
        </div>
        <div class="info-item">
          <span class="label">Version</span>
          <span class="value">{{ .AppVersion }}</span>
        </div>
        <div class="info-item">
          <span class="label">Uptime</span>
          <span class="value">{{ .Uptime }}</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="counter">
        <div class="number">{{ .RequestCount }}</div>
        <div class="label">Total Requests</div>
      </div>
    </div>

    <div class="card">
      <h2>Health Status</h2>
      <div class="status-row">
        <div class="status-dot"></div>
        <span class="status-label">Liveness</span>
        <span class="status-value">/healthz</span>
      </div>
      <div class="status-row">
        <div class="status-dot"></div>
        <span class="status-label">Readiness</span>
        <span class="status-value">/readyz</span>
      </div>
      <div class="status-row">
        <div class="status-dot"></div>
        <span class="status-label">Metrics</span>
        <span class="status-value">/metrics</span>
      </div>
    </div>

    <div class="card">
      <h2>Endpoints</h2>
      <div class="endpoints">
        <a href="/" class="endpoint">GET /</a>
        <a href="/healthz" class="endpoint">GET /healthz</a>
        <a href="/readyz" class="endpoint">GET /readyz</a>
        <a href="/metrics" class="endpoint">GET /metrics</a>
      </div>
    </div>

    <div class="footer">
      Secure Runtime Environment &middot; NIST 800-53 Compliant
    </div>
  </div>
</body>
</html>
`))
