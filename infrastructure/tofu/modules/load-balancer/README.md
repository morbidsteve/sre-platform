# Load Balancer Module

Provisions network load balancers (L4) for the SRE platform.

## Resources Created

- **K8s API LB** — TCP load balancer on port 6443, targeting control plane nodes
- **Istio Ingress LB** — TCP load balancer on ports 80/443, targeting worker nodes running the Istio ingress gateway
- Health checks for both target groups
- Access logging to S3 (for NIST AU-2 audit)
