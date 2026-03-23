# MetalLB

## What It Does

MetalLB provides LoadBalancer service support for bare-metal Kubernetes clusters. In cloud environments, LoadBalancer services are handled by the cloud provider. On bare metal (like the Proxmox lab), MetalLB assigns external IPs from a configured pool.

## Configuration

- **IP Pool**: 192.168.2.200-210 (configured in metallb-config)
- **Mode**: Layer 2 (ARP-based)
- **Chart**: metallb (from metallb Helm repository)

## Helm Chart Version

MetalLB chart is pinned to version `0.14.9`.

## Dependencies

- Istio (MetalLB provides the external IP for Istio's ingress gateway)

## NIST Controls

| Control | Implementation |
|---------|---------------|
| SC-7 | Controls external network access points |

## Troubleshooting

```bash
# Check MetalLB pods
kubectl get pods -n metallb-system

# Check IP address assignments
kubectl get svc -A | grep LoadBalancer

# Check MetalLB speaker logs
kubectl logs -n metallb-system -l app.kubernetes.io/component=speaker
```
