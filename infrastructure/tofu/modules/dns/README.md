# DNS Module

Manages DNS zones and records for the SRE platform. Creates records for the Kubernetes API endpoint, Istio ingress gateway, and wildcard entries for application routing.

## Resources Created

- DNS zone (Route53 / Azure DNS)
- A/CNAME records for K8s API endpoint
- Wildcard record for `*.apps.<domain>` pointing to Istio ingress LB
- Records for platform UIs (Grafana, Harbor, Keycloak, etc.)
