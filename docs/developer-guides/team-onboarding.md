# Team Onboarding

## Overview

A Team Contract is a simple YAML file that describes a new team's namespace and resource allocation. Running `task onboard-team` processes the contract and generates all Kubernetes resources needed: namespace, RBAC, resource quotas, limit ranges, and network policies.

The contract abstracts away the platform internals. You describe _who_ your team is and _how much_ capacity they need. The platform decides _how_ to wire up namespace isolation, RBAC bindings, network segmentation, and monitoring integration.

---

## Team Contract Format

Below is the full contract schema. Required fields are marked; everything else has sensible defaults.

```yaml
apiVersion: sre.io/v1alpha1
kind: TeamContract
metadata:
  name: team-phoenix           # Required. Must start with "team-".
spec:
  displayName: "Phoenix Team"  # Optional. Human-readable name for dashboards and reports.
  contactEmail: phoenix@co.com # Optional. Team contact for alerts and notifications.
  quota: medium                # Required. small | medium | large | custom
  customQuota:                 # Required only when quota: custom.
    cpu: "16"
    memory: "32Gi"
    pods: 50
    services: 20
    pvcs: 20
```

### Field reference

| Field | Required | Description |
|-------|----------|-------------|
| `metadata.name` | Yes | Team identifier. Must start with `team-`. Kebab-case, lowercase. |
| `spec.displayName` | No | Human-readable name shown in dashboards and compliance reports. |
| `spec.contactEmail` | No | Contact email for quota alerts and incident notifications. |
| `spec.quota` | Yes | Resource quota preset: `small`, `medium`, `large`, or `custom`. |
| `spec.customQuota` | Only when `quota: custom` | Explicit CPU, memory, pod, service, and PVC limits. |

---

## Quota Presets

| Preset | CPU Request | Memory Request | CPU Limit | Memory Limit | Pods | Services | PVCs |
|--------|-------------|----------------|-----------|--------------|------|----------|------|
| small  | 4           | 8Gi            | 8         | 16Gi         | 20   | 10       | 10   |
| medium | 8           | 16Gi           | 16        | 32Gi         | 40   | 20       | 20   |
| large  | 16          | 32Gi           | 32        | 64Gi         | 80   | 40       | 40   |

Use `custom` when none of the presets fit. Custom quotas require all five fields (`cpu`, `memory`, `pods`, `services`, `pvcs`) to be specified explicitly.

---

## Step-by-Step Onboarding

### Step 1: Create the Team Contract

Create a YAML file describing the team. Place it in `apps/contracts/examples/` or any convenient location.

```yaml
# team-phoenix.yaml
apiVersion: sre.io/v1alpha1
kind: TeamContract
metadata:
  name: team-phoenix
spec:
  displayName: "Phoenix Team"
  contactEmail: phoenix@example.com
  quota: medium
```

### Step 2: Run the onboarding script

```bash
task onboard-team -- apps/contracts/examples/team-phoenix.yaml
```

This reads the contract and generates the full tenant directory at `apps/tenants/team-phoenix/` with namespace, RBAC, quotas, limit ranges, and network policies.

### Step 3: Create Keycloak groups

In the Keycloak admin console (https://keycloak.apps.sre.example.com):

1. Navigate to SRE realm > Groups.
2. Create group: `team-phoenix-developers`.
3. Create group: `team-phoenix-viewers`.
4. Add team members to the appropriate groups.

The RBAC bindings generated in Step 2 reference these exact group names. If the groups do not exist in Keycloak, team members will not have access to their namespace.

### Step 4: Create Harbor project

In Harbor (https://harbor.apps.sre.example.com):

1. Create project: `team-phoenix`.
2. Create a robot account for CI pushes (e.g., `robot$team-phoenix-ci`).
3. Share the robot credentials with the team for use in their CI pipelines.

The Kyverno image registry policy restricts pods to images from `harbor.sre.internal` (or `harbor.apps.sre.example.com`). Teams must push images to their Harbor project before deploying.

### Step 5: Create OpenBao policy

Create a secrets policy scoped to the team's path:

```bash
bao policy write team-phoenix - <<EOF
path "sre/data/team-phoenix/*" {
  capabilities = ["read", "list"]
}
path "sre/metadata/team-phoenix/*" {
  capabilities = ["read", "list"]
}
EOF
```

This allows pods in the `team-phoenix` namespace (authenticated via Kubernetes auth) to read secrets under `sre/data/team-phoenix/`. Teams cannot access secrets belonging to other teams.

### Step 6: Commit and push

```bash
git add apps/tenants/team-phoenix/
git commit -m "feat(tenants): onboard team-phoenix"
git push
```

Flux reconciles within minutes and creates all resources in the cluster. Verify with:

```bash
flux get kustomizations -A | grep tenant
kubectl get namespace team-phoenix
```

---

## What Gets Created

The onboarding script generates a Kustomize overlay under `apps/tenants/team-phoenix/` that produces the following resources:

| Resource | Name | Description |
|----------|------|-------------|
| Namespace | `team-phoenix` | Isolated namespace with `istio-injection: enabled` label. |
| RoleBinding | `team-phoenix-developers` | Maps Keycloak group `team-phoenix-developers` to the `edit` ClusterRole. |
| RoleBinding | `team-phoenix-viewers` | Maps Keycloak group `team-phoenix-viewers` to the `view` ClusterRole. |
| ResourceQuota | `team-phoenix-quota` | CPU, memory, pod, service, and PVC limits based on the selected preset. |
| LimitRange | `team-phoenix-limits` | Default and max container resource limits. Prevents runaway pods. |
| NetworkPolicy | 7 policies | `default-deny` plus selective allows for DNS, monitoring, Istio, same-namespace, and HTTPS egress. |

### Network policies in detail

| Policy | Purpose |
|--------|---------|
| `default-deny-all` | Denies all ingress and egress by default. |
| `allow-dns` | Permits egress to `kube-dns` in `kube-system` on port 53 (TCP/UDP). |
| `allow-monitoring` | Permits ingress from `monitoring` namespace for Prometheus scraping. |
| `allow-istio-system` | Permits ingress from `istio-system` for gateway and sidecar traffic. |
| `allow-same-namespace` | Permits pod-to-pod communication within the team namespace. |
| `allow-https-egress` | Permits egress on port 443 for external API calls. |
| `allow-istiod` | Permits egress to `istiod` for sidecar configuration and certificate rotation. |

---

## After Onboarding

Once the namespace is created, team members can deploy applications using any of these methods:

- **App Contract**: Write a short YAML contract and run `task deploy-app -- my-app-contract.yaml`. See [App Contract Guide](app-contract.md).
- **Portal Quick Deploy**: Fill out the form at https://portal.apps.sre.example.com.
- **DSOP Wizard**: Full security pipeline at https://dsop.apps.sre.example.com. Walks through all 8 security gates.
- **CI Pipeline**: Push images from CI using Harbor robot credentials and the provided pipeline templates. See [CI Pipeline Guide](ci-pipeline.md).

---

## Troubleshooting

### "Tenant directory already exists"

The team has already been onboarded. The script will not overwrite existing tenant directories. To re-onboard, first back up any application deployments in the existing directory, remove the directory, and run the script again.

### Namespace not appearing after push

Check Flux reconciliation status:

```bash
flux get kustomizations -A | grep tenant
```

If the kustomization is not listed, verify that the tenant directory is referenced in the parent kustomization file. If it shows `False` in the Ready column, check the message for details:

```bash
flux get kustomization sre-tenants -n flux-system
```

### RBAC not working

Verify Keycloak groups exist and have the exact names `<team-name>-developers` and `<team-name>-viewers`. The group names are case-sensitive and must match the RoleBinding subjects exactly.

Also verify that the user's Keycloak token includes the `groups` claim. In Keycloak, confirm that the `groups` scope is assigned to the relevant OIDC clients.

### Quota exceeded

Check current usage against the quota:

```bash
kubectl describe resourcequota -n <team-name>
```

To increase quota, update the team contract with a larger preset (or switch to `custom` with explicit values) and re-run the onboarding script. The script will update the existing quota resources in place. Commit and push for Flux to reconcile.

### Pods stuck in Pending

Common causes:

- **ResourceQuota exhausted**: Check with `kubectl describe resourcequota -n <team-name>`.
- **LimitRange violation**: The pod requests or limits exceed the LimitRange maximums. Check with `kubectl describe limitrange -n <team-name>`.
- **No available nodes**: Check node capacity with `kubectl describe nodes`.

### Network connectivity issues

If pods cannot reach external services or other namespaces, verify the network policies allow the required traffic. The default-deny policy blocks everything not explicitly permitted. See [Networking Guide](networking.md) for details on adding custom network policy rules.
