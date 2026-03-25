# Structured Logging Guide

This guide covers how to produce structured logs that integrate with the SRE platform's Loki + Grafana logging stack. Structured JSON logs ensure your application's output is searchable, filterable, and correlatable across services.

## Required Log Fields

Every log line must be JSON with at minimum these fields:

| Field | Description | Example |
|-------|-------------|---------|
| `level` | Log severity | `info`, `warn`, `error`, `debug` |
| `msg` | Human-readable message | `"user login succeeded"` |
| `ts` | ISO 8601 timestamp | `"2026-03-25T14:30:00.000Z"` |

Recommended additional fields:

| Field | Description | Example |
|-------|-------------|---------|
| `service` | Application name | `"order-api"` |
| `trace_id` | OpenTelemetry trace ID | `"abc123def456"` |
| `span_id` | OpenTelemetry span ID | `"789ghi"` |
| `request_id` | HTTP request correlation ID | `"req-12345"` |
| `user_id` | Authenticated user (never log secrets) | `"user-42"` |
| `err` | Error message or stack trace | `"connection refused"` |

## Language Examples

### Node.js (pino)

[Pino](https://github.com/pinojs/pino) is the recommended logger for Node.js services on SRE. It produces JSON by default with minimal overhead.

```bash
npm install pino
```

```javascript
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  base: {
    service: process.env.APP_NAME || 'my-app',
  },
});

// Basic logging
logger.info('server started');
// {"level":"info","ts":"2026-03-25T14:30:00.000Z","service":"my-app","msg":"server started"}

// With context
logger.info({ userId: 'user-42', action: 'login' }, 'user login succeeded');

// Error logging (includes stack trace)
try {
  await db.connect();
} catch (err) {
  logger.error({ err, host: db.host }, 'database connection failed');
}

// Child logger with request context
app.use((req, res, next) => {
  req.log = logger.child({
    requestId: req.headers['x-request-id'],
    traceId: req.headers['x-b3-traceid'],
  });
  next();
});
```

For Express, use `pino-http` for automatic request/response logging:

```javascript
const pinoHttp = require('pino-http');

app.use(pinoHttp({
  logger,
  autoLogging: true,
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
}));
```

### Python (structlog)

[structlog](https://www.structlog.org/) produces structured JSON logs and integrates with the standard library.

```bash
pip install structlog
```

```python
import structlog
import logging

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", key="ts"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
    logger_factory=structlog.PrintLoggerFactory(),
)

logger = structlog.get_logger(service="order-api")

# Basic logging
logger.info("server started", port=8080)
# {"service":"order-api","level":"info","ts":"2026-03-25T14:30:00.000Z","msg":"server started","port":8080}

# With context
logger.info("order created", order_id="ord-123", user_id="user-42", total=99.99)

# Error logging
try:
    db.connect()
except Exception:
    logger.exception("database connection failed", host=db_host)

# Bind context for a request lifecycle
log = logger.bind(request_id=request.headers.get("x-request-id"),
                  trace_id=request.headers.get("x-b3-traceid"))
log.info("processing request")
```

### Go (slog)

Go 1.21+ includes the `log/slog` package in the standard library. No external dependencies required.

```go
package main

import (
	"log/slog"
	"os"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	// Basic logging
	slog.Info("server started", "port", 8080)
	// {"time":"2026-03-25T14:30:00.000Z","level":"INFO","msg":"server started","port":8080}

	// With context
	slog.Info("order created",
		"order_id", "ord-123",
		"user_id", "user-42",
		"total", 99.99,
	)

	// Error logging
	if err := db.Connect(); err != nil {
		slog.Error("database connection failed",
			"err", err,
			"host", dbHost,
		)
	}

	// Request-scoped logger with trace context
	reqLogger := slog.With(
		"request_id", r.Header.Get("X-Request-Id"),
		"trace_id", r.Header.Get("X-B3-Traceid"),
		"service", "order-api",
	)
	reqLogger.Info("processing request", "method", r.Method, "path", r.URL.Path)
}
```

### Java (logstash-logback-encoder)

For Spring Boot / JVM applications, use the [logstash-logback-encoder](https://github.com/logfellow/logstash-logback-encoder) to produce JSON logs.

Add to `pom.xml`:

```xml
<dependency>
    <groupId>net.logstash.logback</groupId>
    <artifactId>logstash-logback-encoder</artifactId>
    <version>7.4</version>
</dependency>
```

Configure `src/main/resources/logback.xml`:

```xml
<configuration>
  <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
    <encoder class="net.logstash.logback.encoder.LogstashEncoder">
      <timestampPattern>yyyy-MM-dd'T'HH:mm:ss.SSS'Z'</timestampPattern>
      <fieldNames>
        <timestamp>ts</timestamp>
        <message>msg</message>
      </fieldNames>
      <customFields>{"service":"order-api"}</customFields>
    </encoder>
  </appender>
  <root level="INFO">
    <appender-ref ref="STDOUT" />
  </root>
</configuration>
```

```java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import static net.logstash.logback.argument.StructuredArguments.kv;

Logger log = LoggerFactory.getLogger(OrderController.class);

// Basic logging
log.info("server started");

// With context
log.info("order created", kv("orderId", "ord-123"), kv("userId", "user-42"));

// Error logging
try {
    db.connect();
} catch (Exception e) {
    log.error("database connection failed", kv("host", dbHost), e);
}
```

## What NOT to Log

- Passwords, tokens, API keys, or any secret material
- Full credit card numbers, SSNs, or PII (mask or omit)
- Raw request/response bodies containing user data
- Health check requests (they generate noise -- filter at the HTTP middleware level)

## Querying Logs in Grafana (Loki)

Access Grafana at `https://grafana.apps.sre.example.com` and open the **Explore** view with the Loki data source.

### LogQL query examples

```logql
# All logs from a specific app
{namespace="team-alpha", app="my-app"}

# Filter by log level
{namespace="team-alpha", app="my-app"} | json | level="error"

# Search for a specific message
{namespace="team-alpha"} |= "database connection failed"

# Filter by structured field
{namespace="team-alpha", app="my-app"} | json | user_id="user-42"

# Count errors per minute
count_over_time({namespace="team-alpha", app="my-app"} | json | level="error" [1m])

# Top 10 error messages
topk(10, count_over_time({namespace="team-alpha"} | json | level="error" [1h]) by (msg))

# Cross-namespace trace correlation
{namespace=~"team-alpha|team-beta"} | json | trace_id="abc123def456"
```

### Useful Grafana dashboard panels

- **Error rate**: `sum(count_over_time({app="my-app"} | json | level="error" [5m]))`
- **Log volume by level**: `sum by (level) (count_over_time({app="my-app"} | json [5m]))`
- **Slow requests**: `{app="my-app"} | json | duration > 1000`

## Log Retention

| Environment | Retention |
|-------------|-----------|
| Dev | 7 days |
| Staging | 30 days |
| Production | 90 days |
| Audit logs | 365 days |

## Related Guides

- [OpenTelemetry Tracing Guide](tracing-guide.md) -- correlate logs with distributed traces
- [Developer Guide](developer-guide.md) -- general deployment and configuration
- [Operator Guide](operator-guide.md) -- Loki infrastructure and retention configuration
