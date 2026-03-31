=== Deploy Script Capability Assessment ===

| Capability | Flag | Status |
|------------|------|--------|
| Multiple containers (sidecar) | N/A (Istio auto-injects) | OK |
| Database (PostgreSQL) | --persist + --env | OK |
| Database (MySQL/MongoDB) | --persist + --run-as-root + --env | OK |
| Environment from Secret | --env-from-secret | OK |
| Multiple ports | --extra-port | OK |
| ConfigMap mount | --config-file | OK |
| Init containers | NOT SUPPORTED | Gap (use extraContainers in HelmRelease) |
| StatefulSet | NOT SUPPORTED | Gap (deploy as Deployment with PVC) |
| gRPC probes | --probe-type grpc | OK |
| Custom command/args | --command / --args | OK |
| Service-to-service deps | Same-namespace DNS | OK |
| Custom resources | --cpu-request / --memory-limit | OK |
| Auto PolicyException | --run-as-root auto-generates | OK |
| Startup probe | --startup-probe | OK |
| Persistence | --persist (multiple supported) | OK |
| Writable root | --writable-root | OK |
| Capabilities | --add-capability | OK |

**Assessment: 15/17 capabilities supported. 2 gaps (init containers, StatefulSet) are non-critical — workarounds exist.**
