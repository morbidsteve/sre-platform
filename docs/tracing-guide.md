# OpenTelemetry Tracing Guide

This guide covers how to instrument your application with OpenTelemetry (OTel) to send distributed traces to the SRE platform's Tempo backend, viewable in Grafana.

## How Tracing Works on SRE

```
Your App (OTel SDK) ---> OTel Collector (Alloy) ---> Tempo ---> Grafana
```

1. Your app creates spans using the OTel SDK
2. Spans are exported to the OpenTelemetry Collector (Grafana Alloy) running as a DaemonSet
3. Alloy forwards traces to Tempo for storage
4. You query and visualize traces in Grafana

Istio automatically generates spans for all mesh traffic. App-level instrumentation adds detail within your service boundaries.

## Environment Variables

Set these environment variables in your HelmRelease values. The OTel SDK reads them automatically -- no code configuration needed for the exporter endpoint.

```yaml
app:
  env:
    - name: OTEL_EXPORTER_OTLP_ENDPOINT
      value: "http://alloy.logging.svc.cluster.local:4317"
    - name: OTEL_EXPORTER_OTLP_PROTOCOL
      value: "grpc"
    - name: OTEL_SERVICE_NAME
      value: "my-app"
    - name: OTEL_RESOURCE_ATTRIBUTES
      value: "deployment.environment=production,team=team-alpha"
```

## Language Examples

### Node.js

Install the OTel packages:

```bash
npm install @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-grpc
```

Create `tracing.js` (load this before your app code):

```javascript
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': { enabled: true },
      '@opentelemetry/instrumentation-express': { enabled: true },
      '@opentelemetry/instrumentation-pg': { enabled: true },
    }),
  ],
});

sdk.start();

process.on('SIGTERM', () => sdk.shutdown());
```

Start your app with tracing:

```bash
node --require ./tracing.js server.js
```

Add custom spans for business logic:

```javascript
const { trace } = require('@opentelemetry/api');

const tracer = trace.getTracer('my-app');

async function processOrder(orderId) {
  return tracer.startActiveSpan('process-order', async (span) => {
    span.setAttribute('order.id', orderId);
    try {
      const result = await db.query('SELECT * FROM orders WHERE id = $1', [orderId]);
      span.setAttribute('order.status', result.status);
      return result;
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: 2, message: err.message }); // ERROR status
      throw err;
    } finally {
      span.end();
    }
  });
}
```

### Python

Install the OTel packages:

```bash
pip install opentelemetry-sdk \
  opentelemetry-exporter-otlp-proto-grpc \
  opentelemetry-instrumentation-flask \
  opentelemetry-instrumentation-requests \
  opentelemetry-instrumentation-psycopg2
```

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.flask import FlaskInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor

# Initialize (reads OTEL_* env vars automatically)
provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(provider)

# Auto-instrument frameworks
FlaskInstrumentor().instrument()
RequestsInstrumentor().instrument()

# Custom spans
tracer = trace.get_tracer("my-app")

def process_order(order_id: str):
    with tracer.start_as_current_span("process-order") as span:
        span.set_attribute("order.id", order_id)
        try:
            result = db.execute("SELECT * FROM orders WHERE id = %s", (order_id,))
            span.set_attribute("order.status", result["status"])
            return result
        except Exception as e:
            span.record_exception(e)
            span.set_status(trace.StatusCode.ERROR, str(e))
            raise
```

### Go

Install the OTel packages:

```bash
go get go.opentelemetry.io/otel \
  go.opentelemetry.io/otel/sdk/trace \
  go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc \
  go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp
```

```go
package main

import (
	"context"
	"log"
	"net/http"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

func initTracer() func() {
	exporter, err := otlptracegrpc.New(context.Background())
	if err != nil {
		log.Fatal(err)
	}
	tp := trace.NewTracerProvider(trace.WithBatcher(exporter))
	otel.SetTracerProvider(tp)
	return func() { tp.Shutdown(context.Background()) }
}

func main() {
	cleanup := initTracer()
	defer cleanup()

	// Wrap HTTP handlers for automatic span creation
	handler := otelhttp.NewHandler(http.HandlerFunc(orderHandler), "GET /orders")
	http.Handle("/orders", handler)
	http.ListenAndServe(":8080", nil)
}

func orderHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tracer := otel.Tracer("my-app")

	ctx, span := tracer.Start(ctx, "process-order")
	defer span.End()

	span.SetAttributes(
		attribute.String("order.id", r.URL.Query().Get("id")),
	)

	// Use ctx for downstream calls to propagate trace context
	result, err := db.QueryContext(ctx, "SELECT * FROM orders WHERE id = $1", orderID)
	if err != nil {
		span.RecordError(err)
	}
}
```

## Querying Traces in Grafana

Open Grafana at `https://grafana.apps.sre.example.com` and select the **Tempo** data source in the Explore view.

### Search by trace ID

If you have a trace ID from a log line (see [Structured Logging Guide](logging-guide.md)), paste it directly into the Tempo search bar.

### Search by attributes

Use TraceQL to query traces by service, duration, or custom attributes:

```
# Find all traces for a service
{resource.service.name = "my-app"}

# Find slow traces (over 1 second)
{resource.service.name = "my-app" && duration > 1s}

# Find traces with errors
{resource.service.name = "my-app" && status = error}

# Find traces for a specific order
{resource.service.name = "my-app" && span.order.id = "ord-123"}

# Find traces crossing service boundaries
{resource.service.name = "my-app"} >> {resource.service.name = "order-api"}
```

### Correlating logs and traces

When your logs include `trace_id` (see [Structured Logging Guide](logging-guide.md)), Grafana can jump from a log line directly to its trace:

1. In the Loki Explore view, find a log line of interest
2. Click the `trace_id` field value
3. Grafana opens the corresponding trace in Tempo

This works in reverse too -- from a Tempo trace, click "Logs for this span" to see associated log lines.

## Istio Automatic Tracing

Istio's sidecar proxy automatically generates spans for all HTTP/gRPC traffic entering and leaving your pod. These spans appear in Tempo without any application code changes. To connect Istio spans to your application spans, propagate the trace context headers in your outgoing requests:

- `x-b3-traceid`
- `x-b3-spanid`
- `x-b3-parentspanid`
- `x-b3-sampled`
- `traceparent` (W3C format, preferred)

The OTel SDKs handle this automatically when you use instrumented HTTP clients.

## Sampling

By default, 100% of traces are sampled in dev and staging. In production, you may want to reduce sampling to control storage costs:

```yaml
app:
  env:
    - name: OTEL_TRACES_SAMPLER
      value: "parentbased_traceidratio"
    - name: OTEL_TRACES_SAMPLER_ARG
      value: "0.1"   # Sample 10% of traces
```

Always sample 100% of error traces regardless of ratio -- the OTel SDK does this by default with `parentbased_traceidratio`.

## Related Guides

- [Structured Logging Guide](logging-guide.md) -- correlate logs with trace IDs
- [Developer Guide](developer-guide.md) -- general deployment and configuration
- [Developer Guide: Health Check Configuration](developer-guide.md#health-check-configuration) -- probe setup
