#!/usr/bin/env bash
# Generate a Cosign keypair and store it as a Kubernetes secret for Kyverno verification.
# The public key is also saved to policies/custom/ for the verify-image-signatures policy.
#
# Usage: ./scripts/generate-cosign-keypair.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! command -v cosign &>/dev/null; then
    echo "ERROR: cosign is not installed. Install from https://docs.sigstore.dev/cosign/installation/"
    exit 1
fi

KEYS_DIR="/tmp/cosign-keys-$$"
mkdir -p "$KEYS_DIR"
trap 'rm -rf "$KEYS_DIR"' EXIT

echo "==> Generating Cosign keypair..."
COSIGN_PASSWORD="" cosign generate-key-pair --output-key-prefix="$KEYS_DIR/sre" 2>&1

echo ""
echo "==> Storing private key as Kubernetes secret (cosign-signing-key in flux-system)..."
kubectl create secret generic cosign-signing-key \
    --namespace=flux-system \
    --from-file=cosign.key="$KEYS_DIR/sre.key" \
    --from-file=cosign.pub="$KEYS_DIR/sre.pub" \
    --dry-run=client -o yaml | kubectl apply -f -

echo ""
echo "==> Updating Kyverno verify-image-signatures policy with public key..."
PUBLIC_KEY=$(cat "$KEYS_DIR/sre.pub")

cat > "$REPO_DIR/policies/custom/verify-image-signatures.yaml" << POLICY
---
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-image-signatures
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/policy-category: custom
  annotations:
    policies.kyverno.io/title: Verify Image Signatures
    policies.kyverno.io/description: >-
      Verifies that all container images from harbor.sre.internal are signed
      using Cosign. This ensures only trusted, verified images are deployed to
      the cluster as part of the supply chain security controls.
    policies.kyverno.io/category: Supply Chain
    policies.kyverno.io/severity: critical
    sre.io/nist-controls: "SA-10, SI-7"
spec:
  validationFailureAction: Enforce
  background: true
  webhookTimeoutSeconds: 30
  rules:
    - name: verify-cosign-signature
      match:
        any:
          - resources:
              kinds:
                - Pod
      exclude:
        any:
          - resources:
              namespaces:
                - kube-system
                - kube-public
                - kube-node-lease
                - istio-system
                - flux-system
                - kyverno
                - cert-manager
                - monitoring
                - logging
                - tempo
                - openbao
                - external-secrets
                - neuvector
                - harbor
                - velero
                - keycloak
                - sre-dashboard
                - local-path-storage
                - metallb-system
      verifyImages:
        - imageReferences:
            - "harbor.sre.internal/*"
          mutateDigest: false
          verifyDigest: false
          attestors:
            - entries:
                - keys:
                    publicKeys: |-
$(echo "$PUBLIC_KEY" | sed 's/^/                      /')
POLICY

echo ""
echo "==> Public key saved to policy. Private key stored in cluster secret."
echo ""
echo "To use in GitHub Actions, add these secrets to your repo:"
echo "  COSIGN_PRIVATE_KEY: $(base64 -w0 < "$KEYS_DIR/sre.key")"
echo "  COSIGN_PASSWORD: (empty string)"
echo ""
echo "Done."
