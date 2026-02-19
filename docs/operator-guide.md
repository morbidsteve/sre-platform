# SRE Platform Operator Guide

This guide covers day-2 operations for the Secure Runtime Environment (SRE) platform. It is intended for platform operators and cluster administrators responsible for maintaining, monitoring, upgrading, and troubleshooting the SRE platform after initial deployment.

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [Day-2 Operations: Monitoring](#2-day-2-operations-monitoring)
3. [Day-2 Operations: Logging](#3-day-2-operations-logging)
4. [Day-2 Operations: Alerting](#4-day-2-operations-alerting)
5. [Component Upgrades](#5-component-upgrades)
6. [Certificate Management](#6-certificate-management)
7. [Secret Rotation](#7-secret-rotation)
8. [Backup and Restore](#8-backup-and-restore)
9. [Scaling](#9-scaling)
10. [Tenant Management](#10-tenant-management)
11. [Flux CD Operations](#11-flux-cd-operations)
12. [Troubleshooting](#12-troubleshooting)
13. [Runbooks](#13-runbooks)

---

## 1. Platform Overview

### Architecture Layers

The SRE platform is composed of four layers:

```
+-----------------------------------------------------------------------+
|  Layer 4: Supply Chain Security                                       |
|  Harbor (Trivy) + Cosign + SBOM + Kyverno imageVerify                 |
+-----------------------------------------------------------------------+
|  Layer 3: Developer Experience                                        |
|  Helm chart templates + Tenant namespaces + GitOps app deployment     |
+-----------------------------------------------------------------------+
|  Layer 2: Platform Services                                           |
|  Istio | Kyverno | Prometheus | Grafana | Loki | Alloy | Tempo       |
|  OpenBao | ESO | cert-manager | NeuVector | Keycloak | Velero        |
+-----------------------------------------------------------------------+
|  Layer 1: Cluster Foundation                                          |
|  RKE2 (FIPS, CIS-hardened) on Rocky Linux 9 (DISA STIG)             |
|  Provisioned via OpenTofu + Ansible + Packer                          |
+-----------------------------------------------------------------------+
```

### Component Dependency Chain

All platform services are deployed via Flux CD. The dependency chain controls installation and upgrade ordering:

```
istio-base
  |
  +-- istiod
  |     |
  |     +-- istio-gateway
  |
  +-- cert-manager
  |     |
  |     +-- kyverno
  |           |
  |           +-- monitoring (kube-prometheus-stack)
  |                 |
  |                 +-- logging (Loki + Alloy)
  |                 |
  |                 +-- openbao
  |                 |     |
  |                 |     +-- external-secrets (ESO)
  |                 |
  |                 +-- runtime-security (NeuVector)
  |                 |
  |                 +-- tempo
  |                 |
  |                 +-- backup (Velero)
```

### Namespaces

Each platform component runs in its own namespace:

| Namespace           | Component                     | Purpose                              |
|---------------------|-------------------------------|--------------------------------------|
| `flux-system`       | Flux CD controllers           | GitOps reconciliation engine         |
| `istio-system`      | Istio control plane + gateway | Service mesh, mTLS, ingress          |
| `cert-manager`      | cert-manager                  | TLS certificate lifecycle            |
| `kyverno`           | Kyverno                       | Policy enforcement and reporting     |
| `monitoring`        | Prometheus + Grafana + AM     | Metrics, dashboards, alerting        |
| `logging`           | Loki + Alloy                  | Log aggregation and collection       |
| `openbao`           | OpenBao                       | Secrets management (HA Raft)         |
| `external-secrets`  | External Secrets Operator     | Syncs OpenBao secrets to K8s Secrets |
| `neuvector`         | NeuVector                     | Runtime security and network DLP     |
| `tempo`             | Grafana Tempo                 | Distributed tracing                  |
| `velero`            | Velero                        | Cluster backup and disaster recovery |

### Key Files and Directories

| Path                                      | Description                                  |
|-------------------------------------------|----------------------------------------------|
| `platform/core/kustomization.yaml`        | Root Kustomization listing all core services |
| `platform/core/<component>/`              | Manifests for each platform component        |
| `platform/flux-system/`                   | Flux bootstrap and GitRepository config      |
| `apps/tenants/<team>/`                    | Per-team namespace and RBAC config           |
| `policies/`                               | All Kyverno policies (baseline/restricted)   |
| `compliance/`                             | OSCAL, STIG checklists, NIST mappings        |

---

## 2. Day-2 Operations: Monitoring

### Accessing Grafana

Grafana is the unified UI for metrics, logs, and traces. It is deployed in the `monitoring` namespace by the kube-prometheus-stack HelmRelease.

**Port-forward to access locally:**

```bash
kubectl port-forward svc/monitoring-grafana -n monitoring 3000:80
```

Then open `http://localhost:3000` in your browser.

**Credentials:**

Admin credentials are stored in a Kubernetes Secret created by ESO from OpenBao:

```bash
kubectl get secret grafana-admin-credentials -n monitoring -o jsonpath='{.data.admin-user}' | base64 -d
kubectl get secret grafana-admin-credentials -n monitoring -o jsonpath='{.data.admin-password}' | base64 -d
```

### Key Dashboards

The following dashboards are auto-provisioned via Grafana sidecar (any ConfigMap labeled `grafana_dashboard: "1"` is discovered):

| Dashboard                   | What It Shows                                               |
|-----------------------------|-------------------------------------------------------------|
| Kubernetes / Cluster        | Node health, resource utilization, pod counts               |
| Kubernetes / Namespace      | CPU, memory, network per namespace                          |
| Kubernetes / Pods           | Individual pod resource usage and restart counts            |
| Istio / Mesh                | Request rates, latency, error rates across the mesh         |
| Istio / Service             | Per-service traffic metrics, mTLS status                    |
| Kyverno / Policy Reports    | Policy violations by namespace, severity, and trend         |
| Flux / Reconciliation       | HelmRelease and Kustomization reconciliation status         |
| NeuVector / Security Events | Runtime alerts, network violations, vulnerability findings  |
| cert-manager / Certificates | Certificate status, expiry countdown, issuance failures     |
| Node Exporter               | OS-level metrics (CPU, memory, disk, network per node)      |

### Prometheus Configuration

Prometheus is configured with 2 replicas, 15 days of in-cluster retention, and 50Gi persistent storage per replica:

```bash
# Check Prometheus status
kubectl get prometheus -n monitoring

# View active targets
kubectl port-forward svc/monitoring-kube-prometheus-prometheus -n monitoring 9090:9090
# Then open http://localhost:9090/targets

# Query Prometheus directly
kubectl exec -n monitoring prometheus-monitoring-kube-prometheus-prometheus-0 -- \
  promtool query instant http://localhost:9090 'up'
```

**ServiceMonitor discovery:** Prometheus discovers ServiceMonitors across all namespaces. To verify a ServiceMonitor is being scraped:

```bash
kubectl get servicemonitor -A
```

### Checking Component Health via Metrics

```bash
# Check all platform pods
kubectl get pods -A -l app.kubernetes.io/part-of=sre-platform

# Quick health summary via Prometheus
kubectl port-forward svc/monitoring-kube-prometheus-prometheus -n monitoring 9090:9090 &
curl -s 'http://localhost:9090/api/v1/query?query=up' | jq '.data.result[] | {instance: .metric.instance, job: .metric.job, up: .value[1]}'
```

---

## 3. Day-2 Operations: Logging

### Architecture

Logs are collected by Alloy (DaemonSet on every node) and shipped to Loki (Simple Scalable mode). Grafana provides the query UI.

```
Pod stdout/stderr ---> Alloy (DaemonSet) ---> Loki Gateway ---> Loki Write Path ---> S3 Storage
Node journal -------/                                            |
                                                                 v
                                                          Loki Read Path <--- Grafana Explore
```

### Accessing Logs via Grafana

1. Open Grafana (port-forward or via Istio ingress).
2. Navigate to **Explore** in the left sidebar.
3. Select the **Loki** datasource.
4. Use LogQL to query.

### Common LogQL Queries

```logql
# All logs from a specific namespace
{namespace="team-alpha"}

# Logs from a specific pod
{namespace="team-alpha", pod="my-app-7d4f5b6c8-x2k9m"}

# Error logs across the cluster
{namespace=~".+"} |= "error"

# Logs from a specific container with JSON parsing
{namespace="monitoring", container="grafana"} | json | level="error"

# Kubernetes API audit logs
{job="systemd-journal", unit="rke2-server.service"} |= "audit"

# Rate of error logs per namespace over 5 minutes
sum(rate({namespace=~".+"} |= "error" [5m])) by (namespace)

# Logs from the last hour for a specific team
{team="team-alpha"} | json

# All logs from NeuVector runtime events
{namespace="neuvector"}
```

### Log Retention

Loki is configured with the following retention settings:

| Setting                        | Value    | Location                                        |
|--------------------------------|----------|-------------------------------------------------|
| Default retention              | 720h (30 days) | `platform/core/logging/helmrelease-loki.yaml` |
| Reject samples older than      | 168h (7 days)  | `limits_config.reject_old_samples_max_age`    |
| Storage backend                | S3 (MinIO dev) | `loki.storage.s3`                             |

To change retention, update the HelmRelease values and let Flux reconcile:

```yaml
# In platform/core/logging/helmrelease-loki.yaml
loki:
  limits_config:
    retention_period: "2160h"  # 90 days for compliance
```

### Verifying Log Collection

```bash
# Check Alloy pods are running on all nodes
kubectl get pods -n logging -l app.kubernetes.io/name=alloy -o wide

# Check Loki components
kubectl get pods -n logging

# Verify Loki is receiving logs
kubectl logs -n logging -l app.kubernetes.io/component=write --tail=20

# Check Loki ingestion rate via Prometheus
# metric: loki_distributor_bytes_received_total
```

---

## 4. Day-2 Operations: Alerting

### AlertManager Configuration

AlertManager is deployed with 2 replicas as part of the kube-prometheus-stack. The routing configuration is defined in the HelmRelease values at `platform/core/monitoring/helmrelease.yaml`.

Current routing structure:

```
All alerts
  |
  +-- severity: critical --> critical-webhook (repeat: 1h)
  |
  +-- default route ------> default-webhook (repeat: 12h)
       grouped by: namespace, alertname
       group_wait: 30s
       group_interval: 5m
```

### Adding a Slack Receiver

Edit `platform/core/monitoring/helmrelease.yaml` and add under `alertmanager.config.receivers`:

```yaml
alertmanager:
  config:
    receivers:
      - name: "slack-platform"
        slack_configs:
          - api_url: "https://hooks.slack.com/services/REPLACE_ME"
            channel: "#sre-alerts"
            send_resolved: true
            title: '{{ "{{" }} .Status | toUpper {{ "}}" }}: {{ "{{" }} .CommonLabels.alertname {{ "}}" }}'
            text: >-
              {{ "{{" }} range .Alerts {{ "}}" }}
              *Alert:* {{ "{{" }} .Labels.alertname {{ "}}" }}
              *Severity:* {{ "{{" }} .Labels.severity {{ "}}" }}
              *Namespace:* {{ "{{" }} .Labels.namespace {{ "}}" }}
              *Description:* {{ "{{" }} .Annotations.description {{ "}}" }}
              {{ "{{" }} end {{ "}}" }}
    route:
      routes:
        - receiver: "slack-platform"
          match:
            severity: "warning"
```

**Important:** Store the Slack webhook URL in OpenBao and reference it via `valuesFrom` with a Secret. Never put webhook URLs in Git.

### Adding a PagerDuty Receiver

```yaml
receivers:
  - name: "pagerduty-critical"
    pagerduty_configs:
      - service_key: "REPLACE_ME"
        severity: '{{ "{{" }} .CommonLabels.severity {{ "}}" }}'
        description: '{{ "{{" }} .CommonLabels.alertname {{ "}}" }} in {{ "{{" }} .CommonLabels.namespace {{ "}}" }}'
```

### Adding an Email Receiver

```yaml
alertmanager:
  config:
    global:
      smtp_smarthost: "smtp.example.com:587"
      smtp_from: "sre-alerts@example.com"
      smtp_auth_username: "REPLACE_ME"
      smtp_auth_password: "REPLACE_ME"
      smtp_require_tls: true
    receivers:
      - name: "email-ops"
        email_configs:
          - to: "ops-team@example.com"
            send_resolved: true
```

### Silencing Alerts

During planned maintenance, silence alerts via the AlertManager UI:

```bash
kubectl port-forward svc/monitoring-kube-prometheus-alertmanager -n monitoring 9093:9093
# Open http://localhost:9093/#/silences
```

Or via CLI:

```bash
# Create a silence for 2 hours
amtool silence add --alertmanager.url=http://localhost:9093 \
  --author="operator" \
  --comment="Planned maintenance window" \
  --duration="2h" \
  alertname="TargetDown" namespace="monitoring"
```

### Viewing Active Alerts

```bash
# Via Prometheus
kubectl port-forward svc/monitoring-kube-prometheus-prometheus -n monitoring 9090:9090 &
curl -s http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | {alertname: .labels.alertname, state: .state, severity: .labels.severity}'

# Via AlertManager
kubectl port-forward svc/monitoring-kube-prometheus-alertmanager -n monitoring 9093:9093 &
curl -s http://localhost:9093/api/v2/alerts | jq '.[] | {alertname: .labels.alertname, status: .status.state}'
```

---

## 5. Component Upgrades

All platform components are managed by Flux CD HelmReleases. The upgrade procedure is the same for every component: update the chart version in the HelmRelease manifest, commit to Git, and let Flux reconcile.

### Upgrade Procedure

**Step 1: Check the current version.**

```bash
flux get helmreleases -A
```

This shows every HelmRelease, its current revision, and reconciliation status.

**Step 2: Review the upstream changelog.**

Before upgrading, review the release notes for the target chart version. Check for breaking changes, deprecated values, and new required configuration.

**Step 3: Update the chart version in the HelmRelease.**

Edit the relevant HelmRelease file. For example, to upgrade kube-prometheus-stack:

```yaml
# platform/core/monitoring/helmrelease.yaml
spec:
  chart:
    spec:
      chart: kube-prometheus-stack
      version: "58.0.0"    # Updated from 57.2.0
```

**Step 4: Commit and push.**

```bash
git add platform/core/monitoring/helmrelease.yaml
git commit -m "feat(monitoring): upgrade kube-prometheus-stack to 58.0.0"
git push
```

**Step 5: Monitor the reconciliation.**

```bash
# Watch Flux reconcile the change
flux get helmrelease monitoring -n monitoring --watch

# Check for events
kubectl events -n monitoring --for helmrelease/monitoring

# Verify pods are rolling out
kubectl rollout status deployment/monitoring-grafana -n monitoring
kubectl rollout status statefulset/prometheus-monitoring-kube-prometheus-prometheus -n monitoring
```

**Step 6: Validate post-upgrade.**

```bash
# Run validation
task validate

# Check Grafana is accessible
kubectl port-forward svc/monitoring-grafana -n monitoring 3000:80

# Verify metrics are flowing
kubectl port-forward svc/monitoring-kube-prometheus-prometheus -n monitoring 9090:9090
```

### Rollback Procedure

If an upgrade fails, Flux automatically retries up to 3 times (configured via `upgrade.remediation.retries`). If all retries fail, the HelmRelease enters a failed state.

**Option A: Revert the Git commit (preferred).**

```bash
git revert HEAD
git push
# Flux will reconcile back to the previous version
```

**Option B: Manually rollback via Flux.**

```bash
# Suspend the HelmRelease to stop Flux from reconciling
flux suspend helmrelease monitoring -n monitoring

# Rollback the Helm release
helm rollback monitoring -n monitoring

# Fix the HelmRelease in Git, then resume
flux resume helmrelease monitoring -n monitoring
```

### Upgrade Order

When upgrading multiple components, respect the dependency chain. Upgrade in this order:

1. Istio (base, then istiod, then gateway)
2. cert-manager
3. Kyverno
4. Monitoring (kube-prometheus-stack)
5. Logging (Loki, then Alloy)
6. OpenBao
7. External Secrets Operator
8. NeuVector
9. Tempo
10. Velero

Wait for each component to fully reconcile before proceeding to the next.

### Pinned Versions Reference

Current chart versions (update this table after each upgrade):

| Component           | Chart                    | Version  | Repository          |
|---------------------|--------------------------|----------|---------------------|
| Istio Base          | base                     | Pinned   | istio               |
| Istiod              | istiod                   | Pinned   | istio               |
| cert-manager        | cert-manager             | 1.14.4   | jetstack            |
| Kyverno             | kyverno                  | Pinned   | kyverno             |
| Monitoring          | kube-prometheus-stack    | 57.2.0   | prometheus-community|
| Loki                | loki                     | 5.47.2   | grafana             |
| Alloy               | alloy                    | 0.3.2    | grafana             |
| OpenBao             | openbao                  | 0.6.0    | openbao             |
| External Secrets    | external-secrets         | 0.9.13   | external-secrets    |
| NeuVector           | core                     | 2.7.3    | neuvector           |
| Tempo               | tempo                    | 1.7.2    | grafana             |
| Velero              | velero                   | 6.0.0    | vmware-tanzu        |

---

## 6. Certificate Management

### cert-manager Overview

cert-manager runs in the `cert-manager` namespace with 2 replicas of the controller, webhook, and CA injector. It manages TLS certificate lifecycle for the entire platform.

### Viewing Certificates

```bash
# List all certificates across the cluster
kubectl get certificates -A

# Check certificate details including expiry
kubectl describe certificate <name> -n <namespace>

# List all certificate requests
kubectl get certificaterequests -A

# List ClusterIssuers
kubectl get clusterissuers
```

### ClusterIssuers

The platform configures two ClusterIssuers:

1. **Internal CA (self-signed)** -- For internal service-to-service TLS and dev environments.
2. **Let's Encrypt Staging** -- For dev/staging environments with publicly-resolvable hostnames.

For production, configure a Let's Encrypt production ClusterIssuer or an internal enterprise CA:

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-production
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: platform-team@example.com
    privateKeySecretRef:
      name: letsencrypt-production-key
    solvers:
      - http01:
          ingress:
            class: istio
```

### Monitoring Certificate Expiry

cert-manager exports metrics via its ServiceMonitor. Key metrics:

```promql
# Certificates expiring within 30 days
certmanager_certificate_expiration_timestamp_seconds - time() < 30 * 24 * 3600

# Failed certificate issuances
certmanager_certificate_ready_status{condition="False"}

# Certificate renewal failures
rate(certmanager_certificate_renewal_errors_total[1h]) > 0
```

These are exposed in the cert-manager Grafana dashboard.

### Manual Certificate Renewal

cert-manager renews certificates automatically 30 days before expiry. To force a renewal:

```bash
# Delete the certificate's Secret to trigger re-issuance
kubectl delete secret <certificate-secret-name> -n <namespace>

# Or use cmctl (cert-manager CLI)
cmctl renew <certificate-name> -n <namespace>

# Verify the new certificate
kubectl get certificate <name> -n <namespace> -o jsonpath='{.status.conditions}'
```

### Troubleshooting Certificate Issues

```bash
# Check cert-manager controller logs
kubectl logs -n cert-manager -l app.kubernetes.io/name=cert-manager --tail=50

# Check for failed CertificateRequests
kubectl get certificaterequests -A | grep -v True

# Describe a stuck certificate
kubectl describe certificate <name> -n <namespace>

# Check for ACME challenges (Let's Encrypt)
kubectl get challenges -A
```

---

## 7. Secret Rotation

### OpenBao (Secrets Management)

OpenBao runs in HA mode with 3 replicas using Raft storage. It provides centralized secret management for the platform.

**Accessing the OpenBao UI:**

```bash
kubectl port-forward svc/openbao -n openbao 8200:8200
# Open https://localhost:8200
```

**Accessing via CLI:**

```bash
# Set the OpenBao address
export BAO_ADDR="https://openbao.openbao.svc:8200"

# Authenticate via Kubernetes auth
bao login -method=kubernetes role=platform-admin

# Or port-forward and authenticate locally
kubectl port-forward svc/openbao -n openbao 8200:8200 &
export BAO_ADDR="http://127.0.0.1:8200"
bao login -method=token token=<root-token>
```

### Rotating Static Secrets

To rotate a secret stored in OpenBao KV v2:

```bash
# Write the new secret value
bao kv put sre/<team>/<secret-name> value="new-secret-value"

# Verify the update
bao kv get sre/<team>/<secret-name>

# ESO will pick up the change on its next sync interval
# Default refresh interval is 1h -- see ExternalSecret spec.refreshInterval
```

### ESO Refresh Intervals

External Secrets Operator syncs secrets from OpenBao to Kubernetes Secrets based on the `refreshInterval` in each ExternalSecret:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: my-app-db
spec:
  refreshInterval: 1h    # How often ESO checks OpenBao for changes
```

To force an immediate sync:

```bash
# Annotate the ExternalSecret to trigger refresh
kubectl annotate externalsecret <name> -n <namespace> \
  force-sync=$(date +%s) --overwrite

# Verify the sync
kubectl get externalsecret <name> -n <namespace> -o jsonpath='{.status.conditions}'
```

### Listing All ExternalSecrets

```bash
# All ExternalSecrets and their sync status
kubectl get externalsecrets -A

# Check the ClusterSecretStore connection
kubectl get clustersecretstore -o jsonpath='{.items[*].status.conditions}'
```

### Rotating Platform Credentials

When rotating credentials for platform components (Grafana admin, Loki S3 keys, Velero S3 keys):

1. Update the secret in OpenBao.
2. Wait for ESO to sync (or force sync).
3. Restart the affected pods to pick up the new secret:

```bash
# Restart a deployment to load new secrets
kubectl rollout restart deployment/<name> -n <namespace>

# For statefulsets
kubectl rollout restart statefulset/<name> -n <namespace>
```

### OpenBao Seal Status

If OpenBao becomes sealed (e.g., after a node restart without auto-unseal), you must unseal it:

```bash
# Check seal status
kubectl exec -n openbao openbao-0 -- bao status

# If auto-unseal is configured (recommended), it should unseal automatically
# If manual unseal is needed:
kubectl exec -n openbao openbao-0 -- bao operator unseal <unseal-key-1>
kubectl exec -n openbao openbao-0 -- bao operator unseal <unseal-key-2>
kubectl exec -n openbao openbao-0 -- bao operator unseal <unseal-key-3>
```

---

## 8. Backup and Restore

### Velero Overview

Velero runs in the `velero` namespace and provides cluster backup and disaster recovery. Backups are stored in S3-compatible object storage.

### Backup Schedules

The platform ships with three automated backup schedules:

| Schedule        | Cron             | Retention | Scope                                     |
|-----------------|------------------|-----------|--------------------------------------------|
| `daily-backup`  | `0 2 * * *`      | 7 days    | All namespaces except kube-system, flux-system |
| `weekly-backup` | `0 3 * * 0`      | 28 days   | All namespaces except kube-system, flux-system |
| `monthly-backup`| `0 4 1 * *`      | 90 days   | All namespaces except kube-system, flux-system |

All schedules include cluster-scoped resources (CRDs, ClusterRoles, etc.) and volume snapshots.

### Viewing Backup Status

```bash
# List all backups
velero backup get

# Describe a specific backup
velero backup describe daily-backup-20260219020000

# View backup logs
velero backup logs daily-backup-20260219020000

# List backup schedules
velero schedule get

# Check backup storage location status
velero backup-location get
```

### Creating a Manual Backup

Before major operations (upgrades, tenant deletion, etc.), create an ad-hoc backup:

```bash
# Full cluster backup
velero backup create pre-upgrade-$(date +%Y%m%d) \
  --exclude-namespaces kube-system,flux-system \
  --include-cluster-resources=true \
  --snapshot-volumes=true \
  --wait

# Backup a single namespace
velero backup create team-alpha-backup-$(date +%Y%m%d) \
  --include-namespaces team-alpha \
  --snapshot-volumes=true \
  --wait

# Verify backup completed
velero backup describe pre-upgrade-$(date +%Y%m%d)
```

### Restore Procedure

**Restore an entire cluster (disaster recovery):**

```bash
# List available backups
velero backup get

# Restore from the most recent backup
velero restore create --from-backup daily-backup-20260219020000 --wait

# Check restore status
velero restore describe <restore-name>
velero restore logs <restore-name>
```

**Restore a single namespace:**

```bash
velero restore create team-alpha-restore \
  --from-backup daily-backup-20260219020000 \
  --include-namespaces team-alpha \
  --wait
```

**Restore specific resources:**

```bash
velero restore create configmap-restore \
  --from-backup daily-backup-20260219020000 \
  --include-resources configmaps \
  --include-namespaces team-alpha \
  --wait
```

### Restore Testing

Regularly test that backups are restorable. Restore to a temporary namespace and validate:

```bash
# Restore to a test namespace
velero restore create restore-test-$(date +%Y%m%d) \
  --from-backup daily-backup-20260219020000 \
  --include-namespaces team-alpha \
  --namespace-mappings team-alpha:restore-test \
  --wait

# Validate the restored resources
kubectl get all -n restore-test

# Clean up test namespace
kubectl delete namespace restore-test
```

### Backup Storage Troubleshooting

```bash
# Check backup storage location connectivity
velero backup-location get

# If storage location shows "Unavailable":
kubectl logs -n velero -l app.kubernetes.io/name=velero --tail=50

# Check the S3 credentials secret
kubectl get secret velero-s3-credentials -n velero -o jsonpath='{.data}' | base64 -d
```

---

## 9. Scaling

### Node Scaling

Nodes are provisioned via OpenTofu. To scale the cluster:

**Step 1: Update the instance count in the environment variables.**

```hcl
# tofu/environments/dev/terraform.tfvars
worker_instance_count = 5    # Scaled from 3
```

**Step 2: Run OpenTofu plan and apply.**

```bash
task infra-plan ENV=dev
task infra-apply ENV=dev
```

**Step 3: Run Ansible to configure new nodes.**

```bash
ansible-playbook -i ansible/inventory/dev/hosts.yml ansible/playbooks/site.yml --limit new-workers
```

**Step 4: Verify nodes joined the cluster.**

```bash
kubectl get nodes -o wide
```

### HPA Tuning

Application Horizontal Pod Autoscalers are defined in the Helm chart templates. To adjust HPA settings for a tenant application:

```bash
# Check current HPA status
kubectl get hpa -n <namespace>

# Describe an HPA for detailed metrics
kubectl describe hpa <name> -n <namespace>
```

To change HPA thresholds, update the application's Helm values:

```yaml
# apps/tenants/<team>/values.yaml
autoscaling:
  enabled: true
  minReplicas: 3     # Increase minimum
  maxReplicas: 20    # Increase maximum
  targetCPUUtilization: 70    # Lower threshold = scale earlier
```

### Resource Quota Management

Each tenant namespace has a ResourceQuota. To view current usage against quotas:

```bash
# Check quota usage for a namespace
kubectl describe resourcequota -n team-alpha

# Example output:
# Name:                   team-alpha-quota
# Resource                Used    Hard
# --------                ----    ----
# limits.cpu              2       8
# limits.memory           4Gi     16Gi
# pods                    8       20
# requests.cpu            800m    4
# requests.memory         1Gi     8Gi
```

To adjust a quota, edit the tenant's resource-quota.yaml:

```yaml
# apps/tenants/team-alpha/resource-quota.yaml
spec:
  hard:
    requests.cpu: "8"        # Doubled from 4
    requests.memory: 16Gi    # Doubled from 8Gi
    limits.cpu: "16"         # Doubled from 8
    limits.memory: 32Gi      # Doubled from 16Gi
    pods: "40"               # Doubled from 20
```

Commit and push. Flux will reconcile the change.

### LimitRange Defaults

Each tenant namespace has default resource limits and requests via LimitRange:

```bash
kubectl describe limitrange -n team-alpha
```

Current defaults per container:

| Setting          | Value   |
|------------------|---------|
| Default CPU      | 500m    |
| Default Memory   | 512Mi   |
| Default Request CPU    | 100m    |
| Default Request Memory | 128Mi   |
| Max CPU          | 2       |
| Max Memory       | 4Gi     |
| Min CPU          | 50m     |
| Min Memory       | 64Mi    |

---

## 10. Tenant Management

### Adding a New Tenant

To onboard a new team, create the tenant directory structure under `apps/tenants/`:

**Step 1: Create the namespace manifest.**

```yaml
# apps/tenants/<team-name>/namespace.yaml
---
apiVersion: v1
kind: Namespace
metadata:
  name: <team-name>
  labels:
    istio-injection: enabled
    app.kubernetes.io/part-of: sre-platform
    sre.io/team: <team-name>
    sre.io/network-policy-configured: "true"
```

**Step 2: Create the resource quota.**

```yaml
# apps/tenants/<team-name>/resource-quota.yaml
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: <team-name>-quota
  namespace: <team-name>
spec:
  hard:
    requests.cpu: "4"
    requests.memory: 8Gi
    limits.cpu: "8"
    limits.memory: 16Gi
    pods: "20"
    services: "10"
    persistentvolumeclaims: "10"
```

**Step 3: Create the limit range.**

```yaml
# apps/tenants/<team-name>/limit-range.yaml
---
apiVersion: v1
kind: LimitRange
metadata:
  name: <team-name>-limits
  namespace: <team-name>
spec:
  limits:
    - type: Container
      default:
        cpu: 500m
        memory: 512Mi
      defaultRequest:
        cpu: 100m
        memory: 128Mi
      max:
        cpu: "2"
        memory: 4Gi
      min:
        cpu: 50m
        memory: 64Mi
```

**Step 4: Create RBAC bindings.**

```yaml
# apps/tenants/<team-name>/rbac.yaml
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: <team-name>-developers
  namespace: <team-name>
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: edit
subjects:
  - apiGroup: rbac.authorization.k8s.io
    kind: Group
    name: <team-name>-developers
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: <team-name>-viewers
  namespace: <team-name>
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: view
subjects:
  - apiGroup: rbac.authorization.k8s.io
    kind: Group
    name: <team-name>-viewers
```

**Step 5: Create network policies.**

```yaml
# apps/tenants/<team-name>/network-policies/default-deny.yaml
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: <team-name>
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

```yaml
# apps/tenants/<team-name>/network-policies/allow-base.yaml
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-base-traffic
  namespace: <team-name>
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: istio-system
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
        - podSelector: {}
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - port: 53
          protocol: UDP
        - port: 53
          protocol: TCP
    - to:
        - podSelector: {}
```

**Step 6: Create the Kustomize kustomization.yaml.**

```yaml
# apps/tenants/<team-name>/kustomization.yaml
---
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - namespace.yaml
  - resource-quota.yaml
  - limit-range.yaml
  - rbac.yaml
  - network-policies/default-deny.yaml
  - network-policies/allow-base.yaml
```

**Step 7: Create the Keycloak group.**

In Keycloak, create groups `<team-name>-developers` and `<team-name>-viewers` and assign users to them. These groups map to the RBAC RoleBindings created above.

**Step 8: Commit, push, and verify.**

```bash
git add apps/tenants/<team-name>/
git commit -m "feat(tenants): onboard <team-name>"
git push

# Verify Flux reconciled the tenant
kubectl get namespace <team-name>
kubectl get resourcequota -n <team-name>
kubectl get networkpolicy -n <team-name>
kubectl get rolebinding -n <team-name>
```

### Removing a Tenant

**Step 1: Create a backup of the tenant namespace.**

```bash
velero backup create <team-name>-final-backup \
  --include-namespaces <team-name> \
  --snapshot-volumes=true \
  --wait
```

**Step 2: Remove the tenant directory from Git.**

```bash
git rm -r apps/tenants/<team-name>/
git commit -m "feat(tenants): offboard <team-name>"
git push
```

**Step 3: Flux will prune the namespace and all resources within it** (if `prune: true` is set on the Kustomization).

**Step 4: Remove the Keycloak groups and user assignments.**

**Step 5: Clean up any OpenBao secret paths for the team.**

```bash
bao kv metadata delete sre/<team-name>
```

### Adjusting Tenant RBAC

To grant a team additional permissions (e.g., access to create Ingress resources), create a custom Role:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ingress-manager
  namespace: <team-name>
rules:
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: <team-name>-ingress-manager
  namespace: <team-name>
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: ingress-manager
subjects:
  - apiGroup: rbac.authorization.k8s.io
    kind: Group
    name: <team-name>-developers
```

---

## 11. Flux CD Operations

### Checking Overall Platform Status

```bash
# All HelmReleases and their status
flux get helmreleases -A

# All Kustomizations and their status
flux get kustomizations -A

# All sources (GitRepository, HelmRepository)
flux get sources all -A

# Quick health check: are any components not ready?
flux get helmreleases -A --status-selector ready=false
flux get kustomizations -A --status-selector ready=false
```

### Suspend and Resume

Suspend a component to prevent Flux from reconciling it (useful during debugging or manual changes):

```bash
# Suspend a HelmRelease
flux suspend helmrelease monitoring -n monitoring

# Suspend a Kustomization
flux suspend kustomization sre-monitoring -n flux-system

# Resume
flux resume helmrelease monitoring -n monitoring
flux resume kustomization sre-monitoring -n flux-system
```

**Warning:** Suspended resources will not be reconciled. Remember to resume after debugging.

### Force Reconciliation

To force Flux to reconcile immediately (instead of waiting for the next interval):

```bash
# Reconcile a specific HelmRelease
flux reconcile helmrelease monitoring -n monitoring

# Reconcile a specific Kustomization
flux reconcile kustomization sre-monitoring -n flux-system

# Reconcile the GitRepository source (pulls latest from Git)
flux reconcile source git sre-platform -n flux-system

# Reconcile a HelmRepository (checks for new chart versions)
flux reconcile source helm prometheus-community -n flux-system
```

### Viewing Flux Logs

```bash
# Logs for a specific HelmRelease
flux logs --kind=HelmRelease --name=monitoring -n monitoring

# Logs for the Flux source-controller
kubectl logs -n flux-system -l app=source-controller --tail=50

# Logs for the Flux helm-controller
kubectl logs -n flux-system -l app=helm-controller --tail=50

# Logs for the Flux kustomize-controller
kubectl logs -n flux-system -l app=kustomize-controller --tail=50
```

### Troubleshooting Failed HelmReleases

```bash
# Get detailed status
flux get helmrelease <name> -n <namespace>

# Show recent events
kubectl events -n <namespace> --for helmrelease/<name>

# Check the Helm history
helm history <name> -n <namespace>

# If the release is stuck in a failed state, sometimes you need to
# delete the Helm secret and let Flux reinstall
kubectl delete secret -n <namespace> -l name=<release-name>,owner=helm

# Then force reconcile
flux reconcile helmrelease <name> -n <namespace>
```

### Drift Detection

Flux automatically detects and corrects configuration drift. To check for drift:

```bash
# See what Flux would change
flux diff kustomization sre-monitoring --path platform/core/monitoring
```

To temporarily allow manual changes (e.g., for emergency patching), suspend the component, make changes, then fix the manifests in Git and resume.

---

## 12. Troubleshooting

### Common Issues and Diagnostics

#### Pods Stuck in Pending State

```bash
# Check events for the pod
kubectl describe pod <name> -n <namespace>

# Common causes:
# 1. Insufficient resources -> check node capacity
kubectl top nodes
kubectl describe node <node-name> | grep -A 10 "Allocated resources"

# 2. ResourceQuota exceeded -> check quota
kubectl describe resourcequota -n <namespace>

# 3. No available PVs -> check storage
kubectl get pv
kubectl get pvc -n <namespace>
```

#### Pods Rejected by Kyverno

```bash
# Check policy reports for violations
kubectl get policyreport -n <namespace> -o yaml

# Check cluster-wide policy reports
kubectl get clusterpolicyreport -o yaml

# View recent Kyverno admission events
kubectl get events -A --field-selector reason=PolicyViolation

# Check Kyverno controller logs for detailed rejection reasons
kubectl logs -n kyverno -l app.kubernetes.io/component=admission-controller --tail=50
```

#### Istio Sidecar Issues

```bash
# Verify sidecar injection is enabled for the namespace
kubectl get namespace <namespace> -o jsonpath='{.metadata.labels.istio-injection}'

# Check if sidecar is present in a pod
kubectl get pod <name> -n <namespace> -o jsonpath='{.spec.containers[*].name}'
# Should show: <app-container> istio-proxy

# Check Istio proxy status
istioctl proxy-status

# Analyze a specific pod for Istio issues
istioctl analyze -n <namespace>

# Check mTLS status
istioctl x describe pod <pod-name> -n <namespace>
```

#### HelmRelease Not Reconciling

```bash
# Check the HelmRelease status
flux get helmrelease <name> -n <namespace>

# Check if the HelmRepository source is available
flux get sources helm -A

# Check if Flux controllers are running
kubectl get pods -n flux-system

# Check helm-controller logs for errors
kubectl logs -n flux-system -l app=helm-controller --tail=100 | grep -i error
```

#### Loki Not Receiving Logs

```bash
# Check Alloy pods are running
kubectl get pods -n logging -l app.kubernetes.io/name=alloy

# Check Alloy logs for errors
kubectl logs -n logging -l app.kubernetes.io/name=alloy --tail=50

# Check Loki write path is healthy
kubectl get pods -n logging -l app.kubernetes.io/component=write

# Check Loki gateway
kubectl logs -n logging -l app.kubernetes.io/component=gateway --tail=20

# Verify S3 connectivity from Loki
kubectl logs -n logging -l app.kubernetes.io/component=backend --tail=50 | grep -i "error\|s3"
```

#### OpenBao Sealed

```bash
# Check seal status on all replicas
for i in 0 1 2; do
  echo "openbao-$i:"
  kubectl exec -n openbao openbao-$i -- bao status 2>/dev/null || echo "  Unreachable"
done

# If auto-unseal is configured but failing, check for KMS connectivity
kubectl logs -n openbao openbao-0 --tail=50 | grep -i "seal\|unseal\|error"
```

#### Certificates Not Issuing

```bash
# Check certificate status
kubectl get certificates -A

# Check for failed certificate requests
kubectl get certificaterequests -A -o wide

# Check ACME orders and challenges (Let's Encrypt)
kubectl get orders -A
kubectl get challenges -A

# cert-manager controller logs
kubectl logs -n cert-manager -l app.kubernetes.io/name=cert-manager --tail=100
```

### Diagnostic Command Quick Reference

```bash
# Cluster health
kubectl get nodes -o wide
kubectl top nodes
kubectl top pods -A --sort-by=memory | head -20

# All failing pods
kubectl get pods -A --field-selector status.phase!=Running,status.phase!=Succeeded

# Recent events (last 1 hour)
kubectl get events -A --sort-by=.lastTimestamp | tail -50

# Resource usage by namespace
kubectl resource-capacity --sort cpu.util --util

# Check all platform component health
flux get helmreleases -A
flux get kustomizations -A

# Network policy debugging
kubectl get networkpolicy -A
```

### Log Locations

| Log Source                    | How to Access                                                    |
|-------------------------------|------------------------------------------------------------------|
| Application logs              | Grafana Explore (Loki datasource), `{namespace="<ns>"}`         |
| Kubernetes API audit          | Grafana Explore, `{job="systemd-journal"} \|= "audit"`          |
| Node system journals          | Grafana Explore, `{job="systemd-journal", hostname="<node>"}`   |
| Flux controller logs          | `kubectl logs -n flux-system -l app=<controller>`               |
| Istio proxy logs              | `kubectl logs <pod> -n <ns> -c istio-proxy`                     |
| Kyverno admission logs        | `kubectl logs -n kyverno -l app.kubernetes.io/component=admission-controller` |
| OpenBao audit logs            | OpenBao audit device (file or syslog) -> forwarded to Loki      |
| NeuVector security events     | NeuVector UI or `{namespace="neuvector"}`                       |
| cert-manager logs             | `kubectl logs -n cert-manager -l app.kubernetes.io/name=cert-manager` |

---

## 13. Runbooks

### Runbook: Emergency Platform Component Restart

When a platform component is unresponsive and needs an immediate restart.

```bash
# 1. Identify the failing component
flux get helmreleases -A --status-selector ready=false

# 2. Suspend Flux reconciliation to prevent interference
flux suspend helmrelease <name> -n <namespace>

# 3. Restart the component
kubectl rollout restart deployment/<name> -n <namespace>
# or for statefulsets:
kubectl rollout restart statefulset/<name> -n <namespace>

# 4. Wait for rollout
kubectl rollout status deployment/<name> -n <namespace>

# 5. Resume Flux
flux resume helmrelease <name> -n <namespace>
```

### Runbook: Full Platform Health Check

Run this daily or before/after maintenance windows.

```bash
#!/usr/bin/env bash
echo "=== Node Health ==="
kubectl get nodes -o wide

echo ""
echo "=== Flux HelmReleases ==="
flux get helmreleases -A

echo ""
echo "=== Flux Kustomizations ==="
flux get kustomizations -A

echo ""
echo "=== Failing Pods ==="
kubectl get pods -A --field-selector status.phase!=Running,status.phase!=Succeeded | grep -v Completed

echo ""
echo "=== Certificate Expiry ==="
kubectl get certificates -A -o custom-columns=\
NAMESPACE:.metadata.namespace,\
NAME:.metadata.name,\
READY:.status.conditions[0].status,\
EXPIRY:.status.notAfter

echo ""
echo "=== Velero Backup Status ==="
velero backup get --output=table | head -10

echo ""
echo "=== OpenBao Seal Status ==="
kubectl exec -n openbao openbao-0 -- bao status 2>/dev/null | grep -E "Sealed|HA"

echo ""
echo "=== Kyverno Policy Violations ==="
kubectl get policyreport -A -o custom-columns=\
NAMESPACE:.metadata.namespace,\
PASS:.summary.pass,\
FAIL:.summary.fail,\
WARN:.summary.warn

echo ""
echo "=== Resource Usage ==="
kubectl top nodes
```

### Runbook: Rotate Grafana Admin Password

```bash
# 1. Generate a new password
NEW_PASSWORD=$(openssl rand -base64 24)

# 2. Update the secret in OpenBao
bao kv put sre/platform/grafana-admin admin-user=admin admin-password="$NEW_PASSWORD"

# 3. Wait for ESO to sync (or force it)
kubectl annotate externalsecret grafana-admin-credentials -n monitoring \
  force-sync=$(date +%s) --overwrite

# 4. Verify the secret updated
kubectl get secret grafana-admin-credentials -n monitoring -o jsonpath='{.data.admin-password}' | base64 -d

# 5. Restart Grafana to pick up the new password
kubectl rollout restart deployment/monitoring-grafana -n monitoring
kubectl rollout status deployment/monitoring-grafana -n monitoring
```

### Runbook: Recover from Failed Flux Reconciliation

When Flux is stuck in a reconciliation loop.

```bash
# 1. Check which resources are failing
flux get helmreleases -A --status-selector ready=false
flux get kustomizations -A --status-selector ready=false

# 2. Check the events for details
kubectl events -n <namespace> --for helmrelease/<name>

# 3. Check the helm-controller logs
kubectl logs -n flux-system -l app=helm-controller --tail=100 | grep <name>

# 4. If the Helm release is in a broken state, reset it
flux suspend helmrelease <name> -n <namespace>
helm uninstall <name> -n <namespace>

# 5. Resume and let Flux reinstall
flux resume helmrelease <name> -n <namespace>
flux reconcile helmrelease <name> -n <namespace>

# 6. Watch for successful reconciliation
flux get helmrelease <name> -n <namespace> --watch
```

### Runbook: Node Replacement

When a node needs to be replaced (hardware failure, OS corruption).

```bash
# 1. Cordon the node (prevent new pods from scheduling)
kubectl cordon <node-name>

# 2. Drain the node (evict existing pods)
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data --timeout=300s

# 3. Verify pods have been rescheduled
kubectl get pods -A -o wide | grep <node-name>

# 4. Remove the node from the cluster
kubectl delete node <node-name>

# 5. Provision a replacement via OpenTofu
task infra-apply ENV=<environment>

# 6. Run Ansible on the new node
ansible-playbook -i ansible/inventory/<env>/hosts.yml \
  ansible/playbooks/site.yml --limit <new-node>

# 7. Verify the new node joined
kubectl get nodes -o wide

# 8. Uncordon if the old node name was reused
kubectl uncordon <node-name>
```

### Runbook: Investigate Kyverno Policy Violation

When a deployment is blocked by Kyverno.

```bash
# 1. Find the violation details
kubectl get events -n <namespace> --field-selector reason=PolicyViolation

# 2. Check the policy report for specifics
kubectl get policyreport -n <namespace> -o yaml | grep -A 20 "result: fail"

# 3. Identify which policy is blocking
# The event message will include the policy name and rule

# 4. Review the policy
kubectl get clusterpolicy <policy-name> -o yaml

# 5. Fix the resource to comply, for example:
#    - Add missing labels
#    - Add security context (runAsNonRoot, drop ALL capabilities)
#    - Change image to use harbor.sre.internal registry
#    - Pin image tag (remove :latest)

# 6. If the policy needs an exception for a valid reason:
# Add an exclude block to the policy in policies/<category>/<policy>.yaml
# and create a corresponding ADR documenting the exception
```

### Runbook: Istio mTLS Troubleshooting

When services cannot communicate through the mesh.

```bash
# 1. Check PeerAuthentication policy
kubectl get peerauthentication -A

# 2. Verify both pods have Istio sidecars
kubectl get pod <pod-a> -n <ns> -o jsonpath='{.spec.containers[*].name}'
kubectl get pod <pod-b> -n <ns> -o jsonpath='{.spec.containers[*].name}'

# 3. Check mTLS mode between services
istioctl x describe pod <pod-a> -n <ns>

# 4. Check AuthorizationPolicies
kubectl get authorizationpolicy -n <namespace>

# 5. Test connectivity from inside the mesh
kubectl exec <pod-a> -n <ns> -c istio-proxy -- \
  curl -v http://<service-b>.<ns>.svc.cluster.local:<port>

# 6. Check Istio proxy logs for TLS handshake errors
kubectl logs <pod-a> -n <ns> -c istio-proxy --tail=50 | grep -i "tls\|ssl\|connect"

# 7. If needed, temporarily set mTLS to PERMISSIVE for debugging
# (remember to revert to STRICT afterward)
kubectl apply -f - <<EOF
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: debug-permissive
  namespace: <namespace>
spec:
  mtls:
    mode: PERMISSIVE
EOF

# 8. After resolving, delete the debug policy
kubectl delete peerauthentication debug-permissive -n <namespace>
```

---

## Appendix: Key Contacts and Escalation

| Role                | Responsibility                                | Escalation Path         |
|---------------------|-----------------------------------------------|-------------------------|
| Platform Operator   | Day-to-day operations, monitoring, tenant mgmt | On-call rotation        |
| Platform Engineer   | Component upgrades, policy changes, debugging  | Platform team lead      |
| Security Engineer   | Policy exceptions, vulnerability response      | CISO / Security lead    |
| Compliance Officer  | Audit artifacts, STIG reviews, ATO evidence    | Compliance team lead    |

## Appendix: Useful Aliases

Add these to your shell profile for common operations:

```bash
# Flux shortcuts
alias fhr='flux get helmreleases -A'
alias fks='flux get kustomizations -A'
alias fsa='flux get sources all -A'
alias frh='flux reconcile helmrelease'
alias frk='flux reconcile kustomization'

# Kubernetes shortcuts
alias kgpa='kubectl get pods -A'
alias kgna='kubectl get nodes -o wide'
alias kevents='kubectl get events -A --sort-by=.lastTimestamp | tail -30'
alias kfailing='kubectl get pods -A --field-selector status.phase!=Running,status.phase!=Succeeded | grep -v Completed'

# Velero
alias vbg='velero backup get'
alias vsg='velero schedule get'

# Quick platform health
alias sre-health='flux get helmreleases -A && echo "---" && flux get kustomizations -A'
```
