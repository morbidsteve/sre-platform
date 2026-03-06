#!/usr/bin/env bash
# Create or destroy an ephemeral preview environment for a PR.
# Creates a temporary namespace with the app deployed from a branch.
#
# Usage:
#   ./scripts/preview-env.sh create <team> <app-name> <git-url> <branch> <pr-number>
#   ./scripts/preview-env.sh destroy <team> <app-name> <pr-number>
#
# Example:
#   ./scripts/preview-env.sh create team-alpha my-api https://github.com/org/my-api.git feat/new-endpoint 42
#   ./scripts/preview-env.sh destroy team-alpha my-api 42

set -euo pipefail

ACTION="${1:-}"
TEAM="${2:-}"
APP_NAME="${3:-}"

if [ -z "$ACTION" ] || [ -z "$TEAM" ] || [ -z "$APP_NAME" ]; then
    echo "Usage:"
    echo "  $0 create <team> <app-name> <git-url> <branch> <pr-number>"
    echo "  $0 destroy <team> <app-name> <pr-number>"
    exit 1
fi

case "$ACTION" in
    create)
        GIT_URL="${4:?Missing git-url}"
        BRANCH="${5:?Missing branch}"
        PR_NUM="${6:?Missing pr-number}"
        PREVIEW_NS="preview-${TEAM}-${APP_NAME}-pr${PR_NUM}"
        PREVIEW_HOST="pr-${PR_NUM}-${APP_NAME}.apps.sre.example.com"

        echo "==> Creating preview environment: $PREVIEW_NS"

        # Create namespace
        kubectl create namespace "$PREVIEW_NS" --dry-run=client -o yaml | \
            kubectl label -f - --dry-run=client -o yaml --local \
                istio-injection=enabled \
                sre.io/preview="true" \
                sre.io/team="$TEAM" \
                sre.io/pr="$PR_NUM" \
                pod-security.kubernetes.io/enforce=privileged | \
            kubectl apply -f -

        # Create network policies
        cat <<EOF | kubectl apply -f -
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: ${PREVIEW_NS}
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-preview-traffic
  namespace: ${PREVIEW_NS}
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
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - port: 53
          protocol: UDP
        - port: 53
          protocol: TCP
    - to:
        - namespaceSelector: {}
      ports:
        - port: 443
          protocol: TCP
        - port: 80
          protocol: TCP
EOF

        # Create GitRepository + Kustomization
        cat <<EOF | kubectl apply -f -
---
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: ${APP_NAME}-preview
  namespace: ${PREVIEW_NS}
spec:
  interval: 1m
  url: ${GIT_URL}
  ref:
    branch: ${BRANCH}
---
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: ${APP_NAME}-preview
  namespace: ${PREVIEW_NS}
spec:
  interval: 1m
  path: "./"
  prune: true
  sourceRef:
    kind: GitRepository
    name: ${APP_NAME}-preview
  targetNamespace: ${PREVIEW_NS}
EOF

        # Create VirtualService for preview URL
        cat <<EOF | kubectl apply -f -
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: ${APP_NAME}-preview
  namespace: ${PREVIEW_NS}
spec:
  hosts:
    - "${PREVIEW_HOST}"
  gateways:
    - istio-system/sre-gateway
  http:
    - route:
        - destination:
            host: ${APP_NAME}.${PREVIEW_NS}.svc.cluster.local
            port:
              number: 80
EOF

        echo ""
        echo "==> Preview environment created!"
        echo "    Namespace: $PREVIEW_NS"
        echo "    URL: https://$PREVIEW_HOST"
        echo "    Branch: $BRANCH"
        echo ""
        echo "    Add to /etc/hosts:"
        GATEWAY_IP=$(kubectl get svc istio-gateway -n istio-system -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "GATEWAY_IP")
        echo "    $GATEWAY_IP $PREVIEW_HOST"
        echo ""
        echo "    Auto-destroys: Set a TTL label or run: $0 destroy $TEAM $APP_NAME $PR_NUM"
        ;;

    destroy)
        PR_NUM="${4:?Missing pr-number}"
        PREVIEW_NS="preview-${TEAM}-${APP_NAME}-pr${PR_NUM}"

        echo "==> Destroying preview environment: $PREVIEW_NS"
        kubectl delete namespace "$PREVIEW_NS" --wait=false 2>/dev/null || true
        echo "    Namespace $PREVIEW_NS marked for deletion"
        ;;

    *)
        echo "Unknown action: $ACTION"
        echo "Use 'create' or 'destroy'"
        exit 1
        ;;
esac
