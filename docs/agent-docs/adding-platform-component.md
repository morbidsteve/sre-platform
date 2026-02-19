# Adding a New Platform Component

When adding a new service to the SRE platform, follow these steps exactly.

## 1. Create the directory structure

```
platform/core/<component-name>/
├── namespace.yaml              # Namespace with Istio injection label
├── helmrelease.yaml            # Flux HelmRelease
├── helmrepository.yaml         # Flux HelmRepository source
├── kustomization.yaml          # Flux Kustomization (NOT Kustomize kustomization.yaml)
├── network-policies/
│   ├── default-deny.yaml       # Deny all ingress/egress by default
│   └── allow-ingress.yaml      # Explicit ingress allows
├── values/
│   ├── values.yaml             # Default values (used in dev)
│   └── values-production.yaml  # Production overrides (via Flux valuesFrom)
└── README.md                   # What it does, config options, troubleshooting
```

## 2. Namespace

Every component gets its own namespace with Istio injection enabled:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: <component-name>
  labels:
    istio-injection: enabled
    app.kubernetes.io/part-of: sre-platform
```

## 3. HelmRepository

Point to the upstream chart repository:

```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: HelmRepository
metadata:
  name: <component-name>
  namespace: <component-name>
spec:
  interval: 1h
  url: https://charts.example.com  # Replace with actual chart repo URL
```

## 4. HelmRelease

ALWAYS include these fields — do not skip any:

```yaml
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: <component-name>
  namespace: <component-name>
spec:
  interval: 10m
  chart:
    spec:
      chart: <chart-name>
      version: "x.y.z"  # ALWAYS pin — never use * or ranges
      sourceRef:
        kind: HelmRepository
        name: <component-name>
  dependsOn:
    - name: istio
      namespace: istio-system
    # Add other dependencies as needed (monitoring, cert-manager, etc.)
  install:
    remediation:
      retries: 3
  upgrade:
    remediation:
      retries: 3
  values:
    # Inline values here
  valuesFrom:
    - kind: ConfigMap
      name: <component-name>-values
      optional: true
```

## 5. Flux Kustomization

This is the Flux CRD, NOT a Kustomize kustomization.yaml:

```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: sre-<component-name>
  namespace: flux-system
spec:
  interval: 10m
  path: ./platform/core/<component-name>
  prune: true
  sourceRef:
    kind: GitRepository
    name: sre-platform
  healthChecks:
    - apiVersion: apps/v1
      kind: Deployment
      name: <component-name>
      namespace: <component-name>
  dependsOn:
    - name: sre-istio
```

## 6. Network Policies

Start with deny-all, then add explicit allows:

```yaml
# default-deny.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: <component-name>
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

```yaml
# allow-ingress.yaml — customize per component
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-ingress-from-monitoring
  namespace: <component-name>
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
```

## 7. Required integrations checklist

Every component MUST integrate with all of these before it is considered complete:

- [ ] **Istio**: Namespace has `istio-injection: enabled`, PeerAuthentication set to STRICT
- [ ] **Monitoring**: ServiceMonitor created for Prometheus scraping
- [ ] **Logging**: Application outputs structured JSON logs to stdout/stderr
- [ ] **Network Policies**: Default deny + explicit allows for required traffic
- [ ] **Kyverno**: Any component-specific policies added to `policies/`
- [ ] **README**: Documents what it is, how to configure, and how to troubleshoot

## 8. Register the component

Add the new component's Flux Kustomization to `platform/core/kustomization.yaml` so Flux discovers it.

## 9. Validate

```bash
task lint                    # YAML/HCL lint
task validate                # Policy and compliance checks
flux diff kustomization sre-platform --path platform/core/<component>  # Dry-run
```
