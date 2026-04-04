# MetalLB

LoadBalancer service support for the bare-metal Proxmox lab cluster. In cloud environments, the cloud provider handles LoadBalancer IPs. On bare metal, MetalLB assigns external IPs from a configured pool using Layer 2 (ARP) announcements.

## Components

| Resource | Purpose |
|----------|---------|
| `helmrelease.yaml` | MetalLB Helm chart v0.14.9 via Flux |
| `namespace.yaml` | `metallb-system` namespace |
| `network-policies/` | Default deny + explicit allows for speaker/controller |
| `../metallb-config/ip-pool.yaml` | IPAddressPool and L2Advertisement CRDs |

## How It Works

MetalLB runs two components:

- **Controller** (Deployment) -- watches for Services of type LoadBalancer and assigns IPs from the pool.
- **Speaker** (DaemonSet) -- runs on every node and responds to ARP requests for assigned IPs, directing traffic to the node hosting the service.

The Istio ingress gateway Service gets a LoadBalancer IP from MetalLB (default: 192.168.2.200), which becomes the single entry point for all external traffic.

## Deployment

Deployed via Flux HelmRelease in the `metallb-system` namespace. The chart is sourced from the MetalLB Helm repository in `flux-system`. FRR (BGP) mode is disabled since the lab uses Layer 2.

The IP pool is configured separately in `platform/core/metallb-config/ip-pool.yaml` using MetalLB CRDs:

```yaml
# IPAddressPool — range of IPs MetalLB can assign
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: sre-pool
  namespace: metallb-system
spec:
  addresses:
    - ${SRE_METALLB_RANGE}   # Default: 192.168.2.200-210
```

## Configuration

| Setting | Value | Notes |
|---------|-------|-------|
| Chart version | `0.14.9` | Pinned in HelmRelease |
| IP range | `192.168.2.200-210` | Set via `SRE_METALLB_RANGE` variable |
| Mode | Layer 2 (ARP) | Works on any flat L2 network |
| FRR/BGP | Disabled | Not needed for single-subnet labs |

To change the IP range, update the `SRE_METALLB_RANGE` variable in the Flux substitution config and push to Git.

## Dependencies

- None (MetalLB is a foundational component)
- Istio depends on MetalLB for its ingress gateway LoadBalancer IP

## NIST Controls

| Control | Implementation |
|---------|---------------|
| SC-7 | Controls external network access points via a defined IP pool |

## Troubleshooting

```bash
# Check MetalLB pods (controller + speaker DaemonSet)
kubectl get pods -n metallb-system

# Check which services have LoadBalancer IPs assigned
kubectl get svc -A -o wide | grep LoadBalancer

# Check IP pool allocation
kubectl get ipaddresspool -n metallb-system -o yaml

# Check L2 advertisement status
kubectl get l2advertisement -n metallb-system

# View speaker logs (ARP announcements)
kubectl logs -n metallb-system -l app.kubernetes.io/component=speaker --tail=50

# View controller logs (IP assignment decisions)
kubectl logs -n metallb-system -l app.kubernetes.io/component=controller --tail=50

# Force Flux reconciliation
flux reconcile helmrelease metallb -n metallb-system
```

### Common Issues

| Issue | Resolution |
|-------|-----------|
| Service stuck in `<pending>` | Check IP pool is not exhausted: `kubectl get svc -A \| grep LoadBalancer` |
| ARP not resolving | Verify speaker pods are running on all nodes: `kubectl get ds -n metallb-system` |
| IP conflict on network | Ensure the MetalLB range does not overlap with DHCP or static host IPs |
| CRDs not found | MetalLB CRDs install with the Helm chart; ensure HelmRelease is healthy first |
