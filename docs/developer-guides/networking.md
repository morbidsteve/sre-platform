# Networking

## Overview

The SRE platform uses a default-deny network posture. Every tenant namespace starts with these baseline NetworkPolicies:

- **default-deny-all**: Blocks all ingress and egress by default. Every allowed path must be explicitly declared.
- **allow-dns**: Permits DNS resolution (UDP/TCP 53) to kube-system so pods can resolve service names.
- **allow-monitoring**: Permits Prometheus scraping from the monitoring namespace.
- **allow-istio-gateway**: Permits ingress from the Istio ingress gateway (`istio-system` namespace, pods labeled `istio: gateway`).
- **allow-same-namespace**: Permits intra-namespace communication on all ports (both ingress and egress).
- **allow-istio-control-plane**: Permits Istio sidecar communication with istiod (ports 15012, 15014) in `istio-system`.
- **allow-https-egress**: Permits HTTPS egress (TCP 443) to any IP, so pods can reach external APIs without additional configuration.

These baseline policies are applied via Kustomize from `apps/tenants/_base/network-policies/` when a tenant namespace is created. They ensure that every pod in the namespace can resolve DNS, be scraped by Prometheus, talk to pods in the same namespace, and reach external HTTPS endpoints -- but nothing else, unless you declare it.

When you deploy an app via the SRE Helm charts (`web-app`, `api-service`, `worker`, `cronjob`), the chart generates a per-app NetworkPolicy that includes its own set of rules. These per-app policies work alongside the baseline policies. Because Kubernetes NetworkPolicies are additive (if any policy allows a connection, it is allowed), the baseline rules are always in effect and the per-app rules add service-specific allows on top.

---

## Per-Chart Default Rules

Each chart type generates a NetworkPolicy with a different set of built-in rules. The table below summarizes what each chart includes out of the box (before any custom configuration):

| Rule | web-app | api-service | worker | cronjob |
|------|---------|-------------|--------|---------|
| DNS egress to kube-system | Yes | Yes | Yes | Yes |
| Same-namespace egress | Yes | Yes | Yes | Yes |
| HTTPS egress (TCP 443) | Yes | Yes | Yes | Yes |
| Ingress from Istio gateway | Yes | No | No | No |
| Ingress from monitoring | Yes | Yes | If serviceMonitor enabled | If serviceMonitor enabled |
| Ingress from same namespace | Yes | Yes | No | No |
| Ingress from authorizationPolicy callers | No | Yes | No | No |

Key differences:

- **web-app** accepts traffic from the Istio gateway, the monitoring namespace, and all pods in the same namespace.
- **api-service** does not accept traffic from the Istio gateway (it is an internal service). It accepts traffic from the same namespace, the monitoring namespace, and from namespaces listed in `authorizationPolicy.allowedNamespaces` and `authorizationPolicy.allowedCallers`.
- **worker** and **cronjob** accept ingress only from the monitoring namespace (and only if `serviceMonitor.enabled` is true). They are not meant to receive traffic from other services.

---

## Declaring Service Dependencies (allowedServices)

When your app needs to call another service (beyond same-namespace pods and external HTTPS endpoints, which are already allowed), declare it in your App Contract or Helm values under `networkPolicy.allowedServices`:

```yaml
networkPolicy:
  allowedServices:
    - name: user-service
      port: 8080
    - name: auth-service
      namespace: team-platform
      port: 8080
```

Each entry generates a NetworkPolicy egress rule that allows traffic to the named service. The `name` field matches the target service's `app.kubernetes.io/name` label on its pods.

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | Yes | -- | Target service name (matches `app.kubernetes.io/name` label on target pods) |
| `namespace` | No | Same namespace | Target service's namespace. Omit for services in the same namespace. |
| `port` | No | 8080 | Target port (TCP) |

Available in: `web-app`, `api-service`, `worker`. Not available in `cronjob` (use `additionalEgress` instead).

Via App Contract, the equivalent uses the `services` field for platform-managed services and `externalApis` for external endpoints. For service-to-service calls within the cluster, use `networkPolicy.allowedServices` in the Helm values directly.

---

## Accepting Traffic from Callers (allowedCallers)

When your app needs to receive traffic from specific services beyond the baseline allows, the mechanism depends on the chart type.

### web-app

The `web-app` chart already allows ingress from the Istio gateway and the same namespace. If you need to accept traffic from pods in a different namespace, use `networkPolicy.allowedCallers`:

```yaml
networkPolicy:
  allowedCallers:
    - name: api-gateway
    - name: frontend-app
      namespace: team-platform
```

Each entry generates a NetworkPolicy ingress rule allowing the named service to reach your app on its configured port.

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | Yes | -- | Source service name (matches `app.kubernetes.io/name` label on caller pods) |
| `namespace` | No | Same namespace | Source service's namespace |

Note: The `allowedCallers` value is defined in the web-app `values.yaml` and schema. The shared library helper (`sre-lib.networkpolicy-ingress-allowed-callers`) renders the rules. If you find that callers are still blocked, verify the template is rendering correctly or use `additionalIngress` as a fallback.

### api-service

The `api-service` chart uses `authorizationPolicy` (Istio AuthorizationPolicy) to control who can call it. This creates both an Istio authorization rule and a corresponding NetworkPolicy ingress rule:

```yaml
authorizationPolicy:
  enabled: true
  allowedNamespaces:
    - namespace: team-alpha
    - namespace: team-beta
  allowedCallers:
    - namespace: team-alpha
      serviceAccounts:
        - frontend-sa
        - gateway-sa
```

`authorizationPolicy.allowedNamespaces` grants all pods in the listed namespaces access. `authorizationPolicy.allowedCallers` grants access to specific service accounts in specific namespaces. Both generate NetworkPolicy ingress rules automatically.

The api-service chart also has `networkPolicy.allowedCallers` in its values, which works the same as the web-app version for cases where you want a NetworkPolicy rule without an Istio AuthorizationPolicy.

### worker and cronjob

Workers and cronjobs are not designed to receive inbound traffic. If you have an unusual case, use `additionalIngress`.

---

## Common Patterns

### Frontend calls backend API (same namespace)

Both apps are in `team-alpha`. Since same-namespace traffic is allowed by default (both by the baseline policy and by the per-app chart rules), no additional configuration is needed.

Frontend contract (no extra config required):
```yaml
# Same-namespace egress is allowed by default.
# No allowedServices entry needed.
```

Backend contract (no extra config required):
```yaml
# Same-namespace ingress is allowed by default for web-app and api-service.
# No allowedCallers entry needed.
```

### Frontend calls backend API (cross-namespace)

Frontend in `team-alpha` needs to call `order-api` in `team-beta`:

Frontend values:
```yaml
networkPolicy:
  allowedServices:
    - name: order-api
      namespace: team-beta
      port: 8080
```

Backend (api-service) values in `team-beta`:
```yaml
authorizationPolicy:
  enabled: true
  allowedNamespaces:
    - namespace: team-alpha
```

### Worker reads from shared database proxy (cross-namespace)

Worker in `team-alpha` calls a database proxy in `team-platform`:

Worker values:
```yaml
networkPolicy:
  allowedServices:
    - name: db-proxy
      namespace: team-platform
      port: 5432
```

The `db-proxy` service in `team-platform` must also allow ingress from `team-alpha` (via `allowedCallers`, `authorizationPolicy`, or `additionalIngress`).

### API calls an external payment provider

External HTTPS APIs are already handled by the baseline HTTPS egress rule (TCP 443 to any IP). No NetworkPolicy configuration is needed.

However, you should declare external APIs in your values so the platform creates Istio ServiceEntry resources. Without a ServiceEntry, Istio's sidecar proxy will block the connection even though the NetworkPolicy allows it:

```yaml
externalServices:
  - host: api.stripe.com
    port: 443
```

Or in an App Contract:
```yaml
spec:
  externalApis:
    - api.stripe.com
```

---

## Cross-Namespace Communication

Cross-namespace communication requires both sides to agree:

1. **Caller side**: Must have an `allowedServices` entry with the target's `namespace` field set.
2. **Callee side**: Must have an ingress rule allowing the caller's namespace -- via `allowedCallers`, `authorizationPolicy.allowedNamespaces`, `authorizationPolicy.allowedCallers`, or `additionalIngress`.

If only one side is configured, traffic will be blocked by the missing rule on the other side.

Example -- service A in `team-alpha` calls service B in `team-beta`:

Service A (caller) in `team-alpha`:
```yaml
networkPolicy:
  allowedServices:
    - name: service-b
      namespace: team-beta
      port: 8080
```

Service B (callee) in `team-beta`:
```yaml
# For api-service chart:
authorizationPolicy:
  enabled: true
  allowedNamespaces:
    - namespace: team-alpha

# OR for web-app chart:
networkPolicy:
  allowedCallers:
    - name: service-a
      namespace: team-alpha
```

---

## The Escape Hatch

For cases that do not fit the `allowedServices` / `allowedCallers` model, use raw NetworkPolicy rules:

```yaml
networkPolicy:
  additionalEgress:
    - to:
        - ipBlock:
            cidr: 10.0.0.0/8
      ports:
        - port: 5432
          protocol: TCP
  additionalIngress:
    - from:
        - namespaceSelector:
            matchLabels:
              environment: staging
      ports:
        - port: 8080
          protocol: TCP
```

These are appended directly to the generated NetworkPolicy. Use them sparingly -- prefer `allowedServices` and `allowedCallers` for auditability.

Available fields by chart type:

| Chart | `additionalIngress` | `additionalEgress` |
|-------|--------------------|--------------------|
| web-app | Yes | Yes |
| api-service | Yes | Yes |
| worker | No | Yes (via `additionalEgress` only, no `additionalIngress` in values) |
| cronjob | No | Yes |

---

## Debugging

### List policies

```bash
# List all NetworkPolicies in your namespace
kubectl get networkpolicy -n team-alpha

# Show details of a specific policy (look at the ingress/egress rules)
kubectl describe networkpolicy <app-name> -n team-alpha
```

### Test connectivity

```bash
# Check if your pod can reach a service in the same namespace
kubectl exec -n team-alpha <pod> -- curl -v http://user-service:8080/healthz

# Check if your pod can reach a service in a different namespace
kubectl exec -n team-alpha <pod> -- curl -v http://order-api.team-beta.svc.cluster.local:8080/healthz

# Check if your pod can reach an external HTTPS endpoint
kubectl exec -n team-alpha <pod> -- curl -v https://api.stripe.com
```

### Troubleshooting checklist

If traffic is being blocked:

1. Verify the caller has an `allowedServices` egress rule for the target (or that same-namespace egress covers it).
2. Verify the callee has an ingress rule allowing the caller -- via `allowedCallers`, `authorizationPolicy`, or `additionalIngress`.
3. For cross-namespace calls, verify both sides have the `namespace` field set correctly.
4. Check that the `app.kubernetes.io/name` label on the target pods matches the `name` field in your `allowedServices` or `allowedCallers` entry.
5. Check if Istio is blocking the connection independently of NetworkPolicy. If the target is an external host, make sure you have a ServiceEntry for it. If the target is an internal api-service, make sure its `authorizationPolicy` allows your namespace.
6. Remember that NetworkPolicies and Istio AuthorizationPolicies are independent layers. Traffic must be allowed by both to succeed.

### Viewing the generated NetworkPolicy

To see exactly what the Helm chart will generate before deploying:

```bash
helm template my-release apps/templates/web-app/ \
  -f my-values.yaml \
  --show-only templates/networkpolicy.yaml
```

---

## Reference

### Default egress rules (all chart types)

| Destination | Port | Protocol | Description |
|-------------|------|----------|-------------|
| kube-system (DNS) | 53 | UDP, TCP | DNS resolution |
| Same namespace (all pods) | All | All | Intra-namespace communication |
| Any IP (0.0.0.0/0) | 443 | TCP | HTTPS egress for external APIs |

### Default ingress rules (by chart type)

| Source | web-app | api-service | worker | cronjob |
|--------|---------|-------------|--------|---------|
| Istio gateway (`istio-system`, label `istio: gateway`) | Yes (app port) | No | No | No |
| Monitoring namespace | Yes (app port) | Yes (app port) | If serviceMonitor enabled (metrics port) | If serviceMonitor enabled (metrics port) |
| Same namespace (all pods) | Yes (app port) | Yes (app port) | No | No |
| authorizationPolicy namespaces | No | Yes (app port) | No | No |

### Relevant files

| File | Description |
|------|-------------|
| `apps/tenants/_base/network-policies/default-deny.yaml` | Baseline deny-all policy applied to every tenant namespace |
| `apps/tenants/_base/network-policies/allow-base.yaml` | Baseline allow rules (DNS, monitoring, Istio, same-namespace, HTTPS egress) |
| `apps/templates/sre-lib/templates/_networkpolicy.tpl` | Shared Helm library with NetworkPolicy helpers |
| `apps/templates/<chart>/templates/networkpolicy.yaml` | Per-chart NetworkPolicy template |
| `apps/templates/<chart>/values.yaml` | Default values including `networkPolicy` section |
| `apps/templates/<chart>/values.schema.json` | JSON Schema validating `networkPolicy` values |
