#!/usr/bin/env bash
# Build the SRE Dashboard container image and deploy to the cluster.
# Since there's no registry, we build a tarball locally and import it
# into containerd on each node via RKE2's ctr.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="sre-dashboard"
IMAGE_TAG="v1.0.0"
TARBALL="/tmp/${IMAGE_NAME}.tar"
SSH_USER="sre-admin"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/sre-lab}"

cd "$SCRIPT_DIR"

echo "==> Building Docker image..."
docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" .

echo "==> Saving image to tarball..."
docker save "${IMAGE_NAME}:${IMAGE_TAG}" -o "$TARBALL"

echo "==> Importing image to cluster nodes..."
for node_ip in $(kubectl get nodes -o jsonpath='{.items[*].status.addresses[?(@.type=="InternalIP")].address}'); do
    echo "    Importing to node ${node_ip}..."
    scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$TARBALL" "${SSH_USER}@${node_ip}:/tmp/${IMAGE_NAME}.tar"
    ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${SSH_USER}@${node_ip}" \
        "sudo /var/lib/rancher/rke2/bin/ctr --address /run/k3s/containerd/containerd.sock --namespace k8s.io images import /tmp/${IMAGE_NAME}.tar && rm -f /tmp/${IMAGE_NAME}.tar"
done

rm -f "$TARBALL"

echo "==> Applying Kubernetes manifests..."
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/rbac.yaml
kubectl apply -f k8s/network-policy.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/virtualservice.yaml

echo "==> Waiting for dashboard pod to be ready..."
kubectl rollout status deployment/sre-dashboard -n sre-dashboard --timeout=60s

echo ""
echo "==> SRE Dashboard deployed!"
echo ""
NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
HTTPS_PORT=$(kubectl get svc istio-gateway -n istio-system -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || echo "31443")
echo "    Ingress: https://dashboard.apps.sre.example.com:${HTTPS_PORT}"
echo "    (Add to /etc/hosts: ${NODE_IP} dashboard.apps.sre.example.com)"
echo ""
echo "    Or port-forward: kubectl port-forward -n sre-dashboard svc/sre-dashboard 3001:3001"
echo "    Then open: http://localhost:3001"
