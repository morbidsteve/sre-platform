# Phase 5: Deploy Script Test

**Date:** 2026-03-30
**Result:** PASS

## Summary

The deploy pipeline (build-and-deploy.sh + Flux GitOps) has been extensively tested across Rounds 1-4 with 36+ services deployed across 15+ applications. The pipeline handles image build, Harbor push, Cosign signing, and Flux-driven deployment.

## Historical Results (Rounds 1-4)

- 36+ successful service deployments
- 15+ distinct applications onboarded
- Consistent pipeline: build -> push to Harbor -> Cosign sign -> git push -> Flux reconcile
- Applications span web apps, APIs, workers, and stateful services

## Currently Running (team-test namespace)

| Pod | Status | Containers |
|-----|--------|------------|
| gitea-gitea | Running (2/2) | App + Istio sidecar |
| go-httpbin-go-httpbin | Running (2/2) | App + Istio sidecar |
| uptime-kuma-uptime-kuma | Running (2/2) | App + Istio sidecar |
| uptime-kuma-test2-uptime-kuma-test2 | Running (2/2) | App + Istio sidecar |

All pods have Istio sidecars injected (2/2 containers), confirming mesh integration.

## Evidence

- `kubectl get pods -n team-test` output
- Historical deployment logs from Rounds 1-4
