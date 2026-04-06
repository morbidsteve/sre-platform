package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	_ "github.com/lib/pq"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Task represents a task board item.
type Task struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// taskInput is the JSON body for create/update requests.
type taskInput struct {
	Title       *string `json:"title"`
	Description *string `json:"description"`
	Status      *string `json:"status"`
}

// jsonError writes a JSON error response.
func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// jsonOK writes a JSON success response.
func jsonOK(w http.ResponseWriter, data any, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(data)
}

// logEntry is the structured log format.
type logEntry struct {
	Time     string `json:"time"`
	Level    string `json:"level"`
	Method   string `json:"method,omitempty"`
	Path     string `json:"path,omitempty"`
	Status   int    `json:"status,omitempty"`
	Duration string `json:"duration,omitempty"`
	Msg      string `json:"msg"`
}

func logJSON(entry logEntry) {
	entry.Time = time.Now().UTC().Format(time.RFC3339)
	b, _ := json.Marshal(entry)
	fmt.Fprintln(os.Stdout, string(b))
}

// ── Prometheus metrics ───────────────────────────────────────────────────────

var (
	httpRequestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "demo_http_requests_total",
			Help: "Total number of HTTP requests.",
		},
		[]string{"method", "path", "status_code"},
	)
	httpRequestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "demo_http_request_duration_seconds",
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

// ── Response writer wrapper ──────────────────────────────────────────────────

type statusRecorder struct {
	http.ResponseWriter
	statusCode int
}

func (sr *statusRecorder) WriteHeader(code int) {
	sr.statusCode = code
	sr.ResponseWriter.WriteHeader(code)
}

// ── Middleware ────────────────────────────────────────────────────────────────

// corsMiddleware adds CORS headers for dev flexibility.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// metricsAndLogging wraps a handler with Prometheus metrics and structured JSON logging.
func metricsAndLogging(pattern string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, statusCode: http.StatusOK}
		next(rec, r)
		dur := time.Since(start)

		httpRequestsTotal.WithLabelValues(r.Method, pattern, fmt.Sprintf("%d", rec.statusCode)).Inc()
		httpRequestDuration.WithLabelValues(r.Method, pattern).Observe(dur.Seconds())

		logJSON(logEntry{
			Level:    "info",
			Method:   r.Method,
			Path:     r.URL.Path,
			Status:   rec.statusCode,
			Duration: dur.String(),
			Msg:      "request",
		})
	}
}

// ── Database ─────────────────────────────────────────────────────────────────

var db *sql.DB

func initDB() error {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return fmt.Errorf("DATABASE_URL environment variable is required")
	}

	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}

	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("ping database: %w", err)
	}

	_, err = db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS tasks (
			id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			title       TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			status      TEXT NOT NULL DEFAULT 'todo',
			created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`)
	if err != nil {
		return fmt.Errorf("create tasks table: %w", err)
	}

	return nil
}

// validStatus checks that a status string is one of the allowed values.
func validStatus(s string) bool {
	switch s {
	case "todo", "in-progress", "done":
		return true
	}
	return false
}

// ── Handlers ─────────────────────────────────────────────────────────────────

func handleHealthz(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]string{"status": "ok"}, http.StatusOK)
}

func handleReadyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		jsonError(w, "database unreachable", http.StatusServiceUnavailable)
		return
	}
	jsonOK(w, map[string]string{"status": "ok"}, http.StatusOK)
}

func handleListTasks(w http.ResponseWriter, r *http.Request) {
	rows, err := db.QueryContext(r.Context(),
		`SELECT id, title, description, status, created_at, updated_at
		 FROM tasks ORDER BY created_at DESC`)
	if err != nil {
		logJSON(logEntry{Level: "error", Msg: fmt.Sprintf("list tasks: %v", err)})
		jsonError(w, "failed to list tasks", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	tasks := make([]Task, 0)
	for rows.Next() {
		var t Task
		if err := rows.Scan(&t.ID, &t.Title, &t.Description, &t.Status, &t.CreatedAt, &t.UpdatedAt); err != nil {
			logJSON(logEntry{Level: "error", Msg: fmt.Sprintf("scan task: %v", err)})
			jsonError(w, "failed to read tasks", http.StatusInternalServerError)
			return
		}
		tasks = append(tasks, t)
	}
	if err := rows.Err(); err != nil {
		logJSON(logEntry{Level: "error", Msg: fmt.Sprintf("rows iteration: %v", err)})
		jsonError(w, "failed to read tasks", http.StatusInternalServerError)
		return
	}

	jsonOK(w, tasks, http.StatusOK)
}

func handleCreateTask(w http.ResponseWriter, r *http.Request) {
	var input taskInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		jsonError(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	if input.Title == nil || strings.TrimSpace(*input.Title) == "" {
		jsonError(w, "title is required", http.StatusBadRequest)
		return
	}

	status := "todo"
	if input.Status != nil {
		if !validStatus(*input.Status) {
			jsonError(w, "status must be one of: todo, in-progress, done", http.StatusBadRequest)
			return
		}
		status = *input.Status
	}

	description := ""
	if input.Description != nil {
		description = *input.Description
	}

	var t Task
	err := db.QueryRowContext(r.Context(),
		`INSERT INTO tasks (title, description, status)
		 VALUES ($1, $2, $3)
		 RETURNING id, title, description, status, created_at, updated_at`,
		strings.TrimSpace(*input.Title), description, status,
	).Scan(&t.ID, &t.Title, &t.Description, &t.Status, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		logJSON(logEntry{Level: "error", Msg: fmt.Sprintf("create task: %v", err)})
		jsonError(w, "failed to create task", http.StatusInternalServerError)
		return
	}

	jsonOK(w, t, http.StatusCreated)
}

func handleUpdateTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		jsonError(w, "task id is required", http.StatusBadRequest)
		return
	}

	var input taskInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		jsonError(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	// Check the task exists.
	var existing Task
	err := db.QueryRowContext(r.Context(),
		`SELECT id, title, description, status, created_at, updated_at
		 FROM tasks WHERE id = $1`, id,
	).Scan(&existing.ID, &existing.Title, &existing.Description, &existing.Status, &existing.CreatedAt, &existing.UpdatedAt)
	if err == sql.ErrNoRows {
		jsonError(w, "task not found", http.StatusNotFound)
		return
	}
	if err != nil {
		logJSON(logEntry{Level: "error", Msg: fmt.Sprintf("get task for update: %v", err)})
		jsonError(w, "failed to get task", http.StatusInternalServerError)
		return
	}

	// Apply partial updates.
	title := existing.Title
	if input.Title != nil {
		trimmed := strings.TrimSpace(*input.Title)
		if trimmed == "" {
			jsonError(w, "title cannot be empty", http.StatusBadRequest)
			return
		}
		title = trimmed
	}

	description := existing.Description
	if input.Description != nil {
		description = *input.Description
	}

	status := existing.Status
	if input.Status != nil {
		if !validStatus(*input.Status) {
			jsonError(w, "status must be one of: todo, in-progress, done", http.StatusBadRequest)
			return
		}
		status = *input.Status
	}

	var updated Task
	err = db.QueryRowContext(r.Context(),
		`UPDATE tasks SET title = $1, description = $2, status = $3, updated_at = now()
		 WHERE id = $4
		 RETURNING id, title, description, status, created_at, updated_at`,
		title, description, status, id,
	).Scan(&updated.ID, &updated.Title, &updated.Description, &updated.Status, &updated.CreatedAt, &updated.UpdatedAt)
	if err != nil {
		logJSON(logEntry{Level: "error", Msg: fmt.Sprintf("update task: %v", err)})
		jsonError(w, "failed to update task", http.StatusInternalServerError)
		return
	}

	jsonOK(w, updated, http.StatusOK)
}

func handleDeleteTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		jsonError(w, "task id is required", http.StatusBadRequest)
		return
	}

	result, err := db.ExecContext(r.Context(), `DELETE FROM tasks WHERE id = $1`, id)
	if err != nil {
		logJSON(logEntry{Level: "error", Msg: fmt.Sprintf("delete task: %v", err)})
		jsonError(w, "failed to delete task", http.StatusInternalServerError)
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		jsonError(w, "task not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ── Main ─────────────────────────────────────────────────────────────────────

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	logJSON(logEntry{Level: "info", Msg: "starting demo-fullstack backend"})

	// Initialize database connection.
	if err := initDB(); err != nil {
		logJSON(logEntry{Level: "fatal", Msg: fmt.Sprintf("database init failed: %v", err)})
		os.Exit(1)
	}
	defer db.Close()
	logJSON(logEntry{Level: "info", Msg: "database connected, tasks table ready"})

	// Set up routes using Go 1.22 enhanced routing.
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", metricsAndLogging("/healthz", handleHealthz))
	mux.HandleFunc("GET /readyz", metricsAndLogging("/readyz", handleReadyz))
	mux.Handle("GET /metrics", promhttp.Handler())

	mux.HandleFunc("GET /api/tasks", metricsAndLogging("/api/tasks", handleListTasks))
	mux.HandleFunc("POST /api/tasks", metricsAndLogging("/api/tasks", handleCreateTask))
	mux.HandleFunc("PUT /api/tasks/{id}", metricsAndLogging("/api/tasks/{id}", handleUpdateTask))
	mux.HandleFunc("DELETE /api/tasks/{id}", metricsAndLogging("/api/tasks/{id}", handleDeleteTask))

	// Handle preflight OPTIONS for all /api/ paths.
	mux.HandleFunc("OPTIONS /api/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.WriteHeader(http.StatusNoContent)
	})

	addr := ":" + envOrDefault("PORT", "8080")
	srv := &http.Server{
		Addr:         addr,
		Handler:      corsMiddleware(mux),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown on SIGTERM/SIGINT.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)

	go func() {
		logJSON(logEntry{Level: "info", Msg: fmt.Sprintf("listening on %s", addr)})
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logJSON(logEntry{Level: "fatal", Msg: fmt.Sprintf("server error: %v", err)})
			os.Exit(1)
		}
	}()

	sig := <-stop
	logJSON(logEntry{Level: "info", Msg: fmt.Sprintf("received signal %s, shutting down", sig)})

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logJSON(logEntry{Level: "error", Msg: fmt.Sprintf("shutdown error: %v", err)})
	}
	logJSON(logEntry{Level: "info", Msg: "server stopped"})
}
