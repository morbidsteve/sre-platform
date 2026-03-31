# Platform Maturity Scorecard

**Date:** 2026-03-30 | **Rounds completed:** 3

## Pattern Progression

| Pattern | Round 1 | Round 2 | Round 3 | Status |
|---------|---------|---------|---------|--------|
| Single stateless app | manual YAML | 1 command | 1 command | Ready |
| Stateful app (PVC) | impossible | 1 cmd + flags | 1 cmd + flags | Ready |
| Legacy/root app | manual YAML | 1 cmd + flags | 1 cmd + flags | Ready |
| Multi-service (10+) | impossible | bulk pattern | bulk pattern | Ready |
| gRPC service | unsupported | unsupported | --protocol grpc | Ready |
| AI/ML inference | unsupported | unsupported | custom resources | Ready |
| WebSocket app | partial | supported | supported | Ready |
| OAuth provider | unsupported | unsupported | --config-file | Ready |
| Dual-port Service | unsupported | gap | --extra-port | Ready |
| Config file mount | unsupported | gap | --config-file | Ready |
| Shared credentials | verbose | verbose | --env-from-secret | Ready |
| Custom resources | presets only | presets only | --cpu/--memory | Ready |
| Distributed StatefulSet | unsupported | unsupported | gap | Not Ready |
| GPU workloads | unsupported | unsupported | documented | Not Ready |
| Non-HTTP ingress (SSH) | unsupported | gap | gap | Not Ready |

## Scoring

- **Ready:** 12/15 (80%)
- **Not Ready:** 3/15 (20%)

## Round-over-Round Progress

| Metric | Round 1 | Round 2 | Round 3 |
|--------|---------|---------|---------|
| Repos tested | 5 | 5 | 5 |
| Total services | 7 | 26 | 8 |
| Template failures | 2 | 1 | 0 |
| Patterns supported | 4 | 9 | 12 |
| Deploy script flags | 8 | 15 | 26 |
| Manual YAML required | often | rarely | never* |

*For supported patterns. StatefulSet and GPU still need manual YAML.

## Gap Closure Timeline

| Gap | Effort | Priority | Target |
|-----|--------|----------|--------|
| Distributed StatefulSet | Large (new chart) | Medium | Future release |
| GPU passthrough | Medium (NFD + toleration) | Low | When needed |
| Non-HTTP ingress (SSH/TCP) | Medium (TCP route) | Low | When needed |

## Assessment

The platform handles the vast majority of container workloads found in Docker Hub's top 100 images. The three remaining gaps affect niche workloads (distributed databases, GPU inference at scale, SSH bastion hosts) and do not block general production use.
