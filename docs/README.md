# SRE Platform Documentation

## For Developers

**New to SRE? Start here:**

1. **[Getting Started](getting-started-developer.md)** -- Install tools, get credentials, connect to the cluster (~30 min)
2. **[Developer Guide](developer-guide.md)** -- Deploy your first app via Dashboard, CLI, or YAML (~15 min)
3. **[CI/CD Pipeline Setup](../ci/README.md)** -- Set up automated builds with all 8 RAISE 2.0 security gates

**Quick deploy:**
- **[Quickstart](quickstart.md)** -- Copy-paste-able tutorial to deploy your first app in ~20 minutes

**Specialized guides:**
- [Deploy from Git](developer-deployment-guide.md) -- Auto-deploy from a Git URL (supports Dockerfile, Docker Compose, Helm)
- [Team Onboarding](onboarding-guide.md) -- Request a new team namespace (for team leads/managers)
- [Troubleshooting](troubleshooting.md) -- Solutions to common issues

## For Platform Operators

- [Operator Guide](operator-guide.md) -- Day-2 operations, monitoring, upgrades, backup/restore
- [Security Guide](security-guide.md) -- Security architecture, threat model, incident response
- [Architecture](architecture.md) -- Full platform architecture and design decisions
- [ADRs](decisions.md) -- Architectural Decision Records

## For ISSMs and Compliance Officers

- [Compliance Mapping](agent-docs/compliance-mapping.md) -- NIST 800-53 control mapping
- [Policy Exceptions](../policies/custom/policy-exceptions/README.md) -- Formal exception process

## For Platform Developers

- [Adding a Component](agent-docs/adding-platform-component.md)
- [Flux Patterns](agent-docs/flux-patterns.md)
- [Kyverno Patterns](agent-docs/kyverno-patterns.md)
- [Helm Conventions](agent-docs/helm-conventions.md)
- [Compliance Mapping](agent-docs/compliance-mapping.md)

## Additional Guides

- [Proxmox Lab Setup](getting-started-proxmox.md)
- [Air-Gap Deployment](airgap-guide.md)
- [Multi-Cluster](multi-cluster.md)
- [SSO Integration](app-sso-integration-guide.md)
- [Production Deployment](production-deployment-guide.md)
- [Cloudflare Tunnel](cloudflare-tunnel-guide.md)
