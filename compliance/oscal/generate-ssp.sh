#!/usr/bin/env bash
# generate-ssp.sh — Generate OSCAL System Security Plan from live cluster state
# Queries the Kubernetes cluster for evidence of NIST 800-53 control implementation
# and outputs a machine-readable OSCAL SSP in JSON format.
#
# Usage:
#   ./generate-ssp.sh                    # Full SSP to stdout
#   ./generate-ssp.sh -o ssp.json        # Write to file
#   ./generate-ssp.sh --skip-cluster     # Generate structure without live checks
#
# NIST Controls: CA-7, CM-2, CM-3

set -euo pipefail

OUTPUT_FILE=""
SKIP_CLUSTER=false
SCAN_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SSP_UUID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "00000000-0000-0000-0000-000000000000")

while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--output) OUTPUT_FILE="$2"; shift 2 ;;
    --skip-cluster) SKIP_CLUSTER=true; shift ;;
    -h|--help)
      echo "Usage: $0 [-o output.json] [--skip-cluster]"
      echo "  -o, --output FILE    Write SSP JSON to file (default: stdout)"
      echo "  --skip-cluster       Skip live cluster checks (generate structure only)"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# Helper: run kubectl and return result or "unavailable" if cluster unreachable
kube_check() {
  if [ "$SKIP_CLUSTER" = true ]; then
    echo "skipped"
    return
  fi
  local result
  if result=$(kubectl "$@" 2>/dev/null); then
    echo "$result"
  else
    echo "unavailable"
  fi
}

# Helper: count resources matching a query
kube_count() {
  if [ "$SKIP_CLUSTER" = true ]; then
    echo "0"
    return
  fi
  local result
  if result=$(kubectl "$@" --no-headers 2>/dev/null | wc -l); then
    echo "$result"
  else
    echo "0"
  fi
}

# --- Gather cluster evidence ---

# AC: Access Control
RBAC_ROLES=$(kube_count get clusterroles -l "app.kubernetes.io/part-of=sre-platform")
RBAC_BINDINGS=$(kube_count get clusterrolebindings -l "app.kubernetes.io/part-of=sre-platform")
AUTHZ_POLICIES=$(kube_count get authorizationpolicies.security.istio.io -A)
NETWORK_POLICIES=$(kube_count get networkpolicies -A)
KEYCLOAK_STATUS="planned"
if [ "$SKIP_CLUSTER" = false ]; then
  if kubectl get deployment -n keycloak keycloak --no-headers 2>/dev/null | grep -q "1/1\|2/2\|3/3"; then
    KEYCLOAK_STATUS="implemented"
  elif kubectl get namespace keycloak 2>/dev/null | grep -q "Active"; then
    KEYCLOAK_STATUS="partially-implemented"
  fi
fi

# AU: Audit and Accountability
LOKI_STATUS="planned"
if [ "$SKIP_CLUSTER" = false ]; then
  if kubectl get statefulset -n logging loki --no-headers 2>/dev/null | grep -qE "[1-9]+/[1-9]+"; then
    LOKI_STATUS="implemented"
  elif kubectl get namespace logging 2>/dev/null | grep -q "Active"; then
    LOKI_STATUS="partially-implemented"
  fi
fi
ALLOY_PODS=$(kube_count get pods -n logging -l "app.kubernetes.io/name=alloy" --field-selector=status.phase=Running)
AUDIT_POLICY=$(kube_check get configmap -n kube-system audit-policy -o name)

# CA: Assessment, Authorization, and Monitoring
KYVERNO_POLICIES=$(kube_count get clusterpolicies)
POLICY_REPORTS=$(kube_count get policyreport -A)
CLUSTER_POLICY_REPORTS=$(kube_count get clusterpolicyreport)
KUBE_BENCH_CM=$(kube_check get configmap -n monitoring kube-bench-results -o name)
NEUVECTOR_STATUS="planned"
if [ "$SKIP_CLUSTER" = false ]; then
  if kubectl get deployment -n neuvector neuvector-controller-pod --no-headers 2>/dev/null | grep -qE "[1-9]+/[1-9]+"; then
    NEUVECTOR_STATUS="implemented"
  elif kubectl get namespace neuvector 2>/dev/null | grep -q "Active"; then
    NEUVECTOR_STATUS="partially-implemented"
  fi
fi

# CM: Configuration Management
FLUX_KUSTOMIZATIONS=$(kube_count get kustomizations.kustomize.toolkit.fluxcd.io -A)
FLUX_HELMRELEASES=$(kube_count get helmreleases.helm.toolkit.fluxcd.io -A)
FLUX_HEALTHY=0
if [ "$SKIP_CLUSTER" = false ]; then
  FLUX_HEALTHY=$(kubectl get helmreleases.helm.toolkit.fluxcd.io -A --no-headers 2>/dev/null | grep -c "True" || echo "0")
fi
KYVERNO_ENFORCE=$(kube_check get clusterpolicies -o jsonpath='{range .items[*]}{.spec.validationFailureAction}{"\n"}{end}' 2>/dev/null | grep -c "Enforce" || echo "0")

# IA: Identification and Authentication
MTLS_STATUS="planned"
if [ "$SKIP_CLUSTER" = false ]; then
  PA_MODE=$(kubectl get peerauthentication -n istio-system default -o jsonpath='{.spec.mtls.mode}' 2>/dev/null || echo "")
  if [ "$PA_MODE" = "STRICT" ]; then
    MTLS_STATUS="implemented"
  elif [ -n "$PA_MODE" ]; then
    MTLS_STATUS="partially-implemented"
  fi
fi
CERT_MANAGER_STATUS="planned"
if [ "$SKIP_CLUSTER" = false ]; then
  if kubectl get deployment -n cert-manager cert-manager --no-headers 2>/dev/null | grep -qE "[1-9]+/[1-9]+"; then
    CERT_MANAGER_STATUS="implemented"
  elif kubectl get namespace cert-manager 2>/dev/null | grep -q "Active"; then
    CERT_MANAGER_STATUS="partially-implemented"
  fi
fi
CERTIFICATES=$(kube_count get certificates -A)
CLUSTER_ISSUERS=$(kube_count get clusterissuers)

# IR: Incident Response
ALERTMANAGER_STATUS="planned"
if [ "$SKIP_CLUSTER" = false ]; then
  if kubectl get statefulset -n monitoring alertmanager-kube-prometheus-stack-alertmanager --no-headers 2>/dev/null | grep -qE "[1-9]+/[1-9]+"; then
    ALERTMANAGER_STATUS="implemented"
  elif kubectl get pods -n monitoring -l "app.kubernetes.io/name=alertmanager" --no-headers 2>/dev/null | grep -q "Running"; then
    ALERTMANAGER_STATUS="implemented"
  fi
fi
PROM_RULES=$(kube_count get prometheusrules -A)

# RA: Risk Assessment
HARBOR_STATUS="planned"
if [ "$SKIP_CLUSTER" = false ]; then
  if kubectl get deployment -n harbor harbor-core --no-headers 2>/dev/null | grep -qE "[1-9]+/[1-9]+"; then
    HARBOR_STATUS="implemented"
  elif kubectl get namespace harbor 2>/dev/null | grep -q "Active"; then
    HARBOR_STATUS="partially-implemented"
  fi
fi

# SA: System and Services Acquisition
SERVICE_MONITORS=$(kube_count get servicemonitors -A)
IMAGE_VERIFY_POLICY="planned"
if [ "$SKIP_CLUSTER" = false ]; then
  if kubectl get clusterpolicy verify-image-signatures --no-headers 2>/dev/null | grep -q "verify-image-signatures"; then
    IMAGE_VERIFY_POLICY="implemented"
  fi
fi

# SC: System and Communications Protection
ISTIO_STATUS="planned"
if [ "$SKIP_CLUSTER" = false ]; then
  if kubectl get deployment -n istio-system istiod --no-headers 2>/dev/null | grep -qE "[1-9]+/[1-9]+"; then
    ISTIO_STATUS="implemented"
  elif kubectl get namespace istio-system 2>/dev/null | grep -q "Active"; then
    ISTIO_STATUS="partially-implemented"
  fi
fi
OPENBAO_STATUS="planned"
if [ "$SKIP_CLUSTER" = false ]; then
  if kubectl get statefulset -n openbao openbao --no-headers 2>/dev/null | grep -qE "[1-9]+/[1-9]+"; then
    OPENBAO_STATUS="implemented"
  elif kubectl get namespace openbao 2>/dev/null | grep -q "Active"; then
    OPENBAO_STATUS="partially-implemented"
  fi
fi

# SI: System and Information Integrity
MONITORING_STATUS="planned"
if [ "$SKIP_CLUSTER" = false ]; then
  if kubectl get statefulset -n monitoring prometheus-kube-prometheus-stack-prometheus --no-headers 2>/dev/null | grep -qE "[1-9]+/[1-9]+"; then
    MONITORING_STATUS="implemented"
  elif kubectl get pods -n monitoring -l "app.kubernetes.io/name=prometheus" --no-headers 2>/dev/null | grep -q "Running"; then
    MONITORING_STATUS="implemented"
  fi
fi

# Count namespaces with network policies vs total non-system namespaces
TOTAL_NS=0
NS_WITH_NETPOL=0
if [ "$SKIP_CLUSTER" = false ]; then
  ALL_NS=$(kubectl get namespaces --no-headers -o custom-columns=":metadata.name" 2>/dev/null | grep -v "^kube-" | grep -v "^default$" || echo "")
  for ns in $ALL_NS; do
    TOTAL_NS=$((TOTAL_NS + 1))
    NP_COUNT=$(kubectl get networkpolicies -n "$ns" --no-headers 2>/dev/null | wc -l)
    if [ "$NP_COUNT" -gt 0 ]; then
      NS_WITH_NETPOL=$((NS_WITH_NETPOL + 1))
    fi
  done
fi

# Count active policy exceptions
POLICY_EXCEPTIONS=$(kube_count get policyexceptions -A)

# --- Build OSCAL SSP JSON ---

build_control() {
  local id="$1"
  local title="$2"
  local status="$3"
  local description="$4"
  cat <<CTRL
    {
      "control-id": "${id}",
      "title": "${title}",
      "implementation-status": "${status}",
      "description": "${description}"
    }
CTRL
}

SSP_JSON=$(cat <<OSCAL
{
  "system-security-plan": {
    "uuid": "${SSP_UUID}",
    "metadata": {
      "title": "Secure Runtime Environment (SRE) System Security Plan",
      "last-modified": "${SCAN_DATE}",
      "version": "1.0.0",
      "oscal-version": "1.1.2",
      "roles": [
        {"id": "system-owner", "title": "System Owner"},
        {"id": "platform-admin", "title": "Platform Administrator"},
        {"id": "security-officer", "title": "Information System Security Officer"}
      ]
    },
    "system-characteristics": {
      "system-name": "Secure Runtime Environment (SRE)",
      "description": "A government-compliant, open-source Kubernetes platform providing a hardened runtime for deploying applications. Built on RKE2, Flux CD, and the CNCF ecosystem.",
      "security-sensitivity-level": "moderate",
      "system-information": {
        "information-types": [
          {
            "title": "Controlled Unclassified Information (CUI)",
            "confidentiality-impact": {"base": "moderate"},
            "integrity-impact": {"base": "moderate"},
            "availability-impact": {"base": "moderate"}
          }
        ]
      },
      "security-impact-level": {
        "security-objective-confidentiality": "moderate",
        "security-objective-integrity": "moderate",
        "security-objective-availability": "moderate"
      },
      "authorization-boundary": {
        "description": "The SRE platform boundary includes the RKE2 Kubernetes cluster, all platform services (Istio, Kyverno, monitoring, logging, secrets management, registry, runtime security), and tenant application namespaces."
      }
    },
    "system-implementation": {
      "components": [
        {"title": "RKE2 Kubernetes", "type": "software", "status": "${ISTIO_STATUS}"},
        {"title": "Istio Service Mesh", "type": "software", "status": "${ISTIO_STATUS}"},
        {"title": "Kyverno Policy Engine", "type": "software", "status": "$([ "$KYVERNO_POLICIES" -gt 0 ] && echo "implemented" || echo "planned")"},
        {"title": "Prometheus + Grafana", "type": "software", "status": "${MONITORING_STATUS}"},
        {"title": "Loki + Alloy", "type": "software", "status": "${LOKI_STATUS}"},
        {"title": "OpenBao", "type": "software", "status": "${OPENBAO_STATUS}"},
        {"title": "cert-manager", "type": "software", "status": "${CERT_MANAGER_STATUS}"},
        {"title": "Harbor", "type": "software", "status": "${HARBOR_STATUS}"},
        {"title": "NeuVector", "type": "software", "status": "${NEUVECTOR_STATUS}"},
        {"title": "Keycloak", "type": "software", "status": "${KEYCLOAK_STATUS}"},
        {"title": "Velero", "type": "software", "status": "$(kube_check get deployment -n velero velero -o name >/dev/null 2>&1 && echo "implemented" || echo "planned")"},
        {"title": "Flux CD", "type": "software", "status": "$([ "$FLUX_HELMRELEASES" -gt 0 ] && echo "implemented" || echo "planned")"}
      ],
      "cluster-evidence": {
        "scan-date": "${SCAN_DATE}",
        "flux-kustomizations": ${FLUX_KUSTOMIZATIONS},
        "flux-helmreleases": ${FLUX_HELMRELEASES},
        "flux-healthy-releases": ${FLUX_HEALTHY},
        "kyverno-cluster-policies": ${KYVERNO_POLICIES},
        "kyverno-enforce-policies": ${KYVERNO_ENFORCE},
        "policy-reports": ${POLICY_REPORTS},
        "policy-exceptions": ${POLICY_EXCEPTIONS},
        "network-policies": ${NETWORK_POLICIES},
        "namespaces-with-netpol": ${NS_WITH_NETPOL},
        "total-app-namespaces": ${TOTAL_NS},
        "certificates": ${CERTIFICATES},
        "cluster-issuers": ${CLUSTER_ISSUERS},
        "service-monitors": ${SERVICE_MONITORS},
        "prometheus-rules": ${PROM_RULES}
      }
    },
    "control-implementation": {
      "description": "NIST 800-53 Rev 5 control implementation for the SRE platform at MODERATE baseline.",
      "implemented-requirements": [
        $(build_control "AC-2" "Account Management" "$KEYCLOAK_STATUS" "Keycloak provides centralized identity management with group-based access control. OIDC integration with Kubernetes API server for user authentication. Automated group-to-RBAC mapping."),
        $(build_control "AC-3" "Access Enforcement" "$([ "$RBAC_ROLES" -gt 0 ] && echo "implemented" || echo "planned")" "Kubernetes RBAC with ${RBAC_ROLES} ClusterRoles and ${RBAC_BINDINGS} ClusterRoleBindings. Istio AuthorizationPolicy (${AUTHZ_POLICIES} policies). Kyverno namespace isolation policies."),
        $(build_control "AC-4" "Information Flow Enforcement" "$MTLS_STATUS" "Istio mTLS STRICT mode encrypts all in-cluster traffic. ${NETWORK_POLICIES} NetworkPolicies enforce network segmentation. Default-deny policies in ${NS_WITH_NETPOL}/${TOTAL_NS} namespaces."),
        $(build_control "AC-6" "Least Privilege" "$([ "$KYVERNO_POLICIES" -gt 0 ] && echo "implemented" || echo "planned")" "Kyverno policies enforce non-root containers, drop ALL capabilities, read-only root filesystem. RBAC roles scoped to namespace. ServiceAccount per workload with automountServiceAccountToken disabled."),
        $(build_control "AC-14" "Permitted Actions Without Identification" "$MTLS_STATUS" "Istio PeerAuthentication set to STRICT mode. No unauthenticated service-to-service communication allowed within the mesh."),
        $(build_control "AC-17" "Remote Access" "$KEYCLOAK_STATUS" "Keycloak SSO with MFA for all management interfaces. Istio gateway with TLS termination for external access."),
        $(build_control "AU-2" "Audit Events" "$LOKI_STATUS" "Kubernetes API server audit logging captures all authentication events and resource operations. Istio access logs capture all mesh traffic. Logs collected by Alloy (${ALLOY_PODS} pods running)."),
        $(build_control "AU-3" "Content of Audit Records" "$LOKI_STATUS" "All platform components output structured JSON logs with timestamp, source, user identity, action, resource, and outcome fields."),
        $(build_control "AU-4" "Audit Storage Capacity" "$LOKI_STATUS" "Loki configured with S3-compatible object storage backend. Configurable retention policies per namespace."),
        $(build_control "AU-6" "Audit Review and Analysis" "$MONITORING_STATUS" "Grafana dashboards provide audit log analysis. Pre-built compliance queries for security events. ${SERVICE_MONITORS} ServiceMonitors collecting metrics."),
        $(build_control "AU-8" "Time Stamps" "implemented" "NTP enforced on all cluster nodes via Ansible OS hardening role. All logs use UTC timestamps."),
        $(build_control "AU-9" "Protection of Audit Information" "$LOKI_STATUS" "Loki log storage encrypted at rest. RBAC restricts log access to authorized roles only."),
        $(build_control "AU-12" "Audit Generation" "$LOKI_STATUS" "All platform components output structured JSON to stdout/stderr. Alloy DaemonSet collects from all nodes and containers."),
        $(build_control "CA-7" "Continuous Monitoring" "$MONITORING_STATUS" "Prometheus with ${PROM_RULES} PrometheusRules for real-time alerting. NeuVector (${NEUVECTOR_STATUS}) for runtime anomaly detection. ${KYVERNO_POLICIES} Kyverno policies for continuous compliance. kube-bench CIS scanning ($([ "$KUBE_BENCH_CM" != "unavailable" ] && echo "results available" || echo "scheduled"))."),
        $(build_control "CA-8" "Penetration Testing" "$NEUVECTOR_STATUS" "NeuVector vulnerability scanning for running containers. Trivy image scanning in Harbor (${HARBOR_STATUS})."),
        $(build_control "CM-2" "Baseline Configuration" "$([ "$FLUX_KUSTOMIZATIONS" -gt 0 ] && echo "implemented" || echo "planned")" "Git repository is the authoritative baseline. Flux CD reconciles cluster state to match Git (${FLUX_KUSTOMIZATIONS} Kustomizations, ${FLUX_HELMRELEASES} HelmReleases, ${FLUX_HEALTHY} healthy)."),
        $(build_control "CM-3" "Configuration Change Control" "$([ "$FLUX_KUSTOMIZATIONS" -gt 0 ] && echo "implemented" || echo "planned")" "All changes go through Git PR workflow with branch protection. Flux provides audit trail of all reconciliation events. Conventional commits enforced."),
        $(build_control "CM-5" "Access Restrictions for Change" "$([ "$FLUX_KUSTOMIZATIONS" -gt 0 ] && echo "implemented" || echo "planned")" "Branch protection rules on Git repository. Flux RBAC restricts who can modify platform namespaces. Kyverno prevents unauthorized kubectl changes."),
        $(build_control "CM-6" "Configuration Settings" "$([ "$KYVERNO_POLICIES" -gt 0 ] && echo "implemented" || echo "planned")" "Ansible STIG roles harden OS baseline. RKE2 CIS benchmark profile enabled. ${KYVERNO_POLICIES} Kyverno policies enforce Kubernetes configuration standards (${KYVERNO_ENFORCE} in Enforce mode)."),
        $(build_control "CM-7" "Least Functionality" "$([ "$KYVERNO_POLICIES" -gt 0 ] && echo "implemented" || echo "planned")" "Kyverno restricts container capabilities, volume types, and host access. NeuVector (${NEUVECTOR_STATUS}) blocks unexpected processes."),
        $(build_control "CM-8" "System Component Inventory" "$([ "$FLUX_HELMRELEASES" -gt 0 ] && echo "implemented" || echo "planned")" "Flux tracks all deployed components with version pinning. Harbor maintains image inventory with SBOMs. ${FLUX_HELMRELEASES} HelmReleases tracked."),
        $(build_control "CM-11" "User-Installed Software" "$([ "$KYVERNO_POLICIES" -gt 0 ] && echo "implemented" || echo "planned")" "Kyverno image registry restriction policy limits images to approved Harbor registry. Image signature verification via Cosign (${IMAGE_VERIFY_POLICY})."),
        $(build_control "IA-2" "Identification and Authentication" "$KEYCLOAK_STATUS" "Keycloak SSO with MFA enforcement. OIDC integration with Kubernetes API server for user authentication."),
        $(build_control "IA-3" "Device Identification" "$MTLS_STATUS" "Istio mTLS with SPIFFE identities for all workloads. Every pod in the mesh has a cryptographic identity."),
        $(build_control "IA-5" "Authenticator Management" "$CERT_MANAGER_STATUS" "cert-manager automates certificate rotation (${CERTIFICATES} certificates, ${CLUSTER_ISSUERS} ClusterIssuers). OpenBao (${OPENBAO_STATUS}) manages secret rotation."),
        $(build_control "IA-8" "Non-Organizational User Authentication" "$MTLS_STATUS" "Istio gateway enforces authentication for all external traffic. RequestAuthentication validates JWT tokens."),
        $(build_control "IR-4" "Incident Handling" "$ALERTMANAGER_STATUS" "AlertManager (${ALERTMANAGER_STATUS}) routes alerts by severity. NeuVector (${NEUVECTOR_STATUS}) provides runtime security events. Runbooks linked from alert annotations."),
        $(build_control "IR-5" "Incident Monitoring" "$MONITORING_STATUS" "NeuVector runtime security events, Kyverno policy violations (${POLICY_REPORTS} reports), Prometheus alert history with ${PROM_RULES} alerting rules."),
        $(build_control "RA-5" "Vulnerability Scanning" "$HARBOR_STATUS" "Harbor with Trivy scanning on image push. NeuVector (${NEUVECTOR_STATUS}) for runtime container scanning. kube-bench for CIS benchmark scanning."),
        $(build_control "SA-10" "Developer Configuration Management" "$([ "$FLUX_KUSTOMIZATIONS" -gt 0 ] && echo "implemented" || echo "planned")" "GitOps workflow ensures all changes are tracked in Git. Flux reconciliation provides continuous audit trail."),
        $(build_control "SA-11" "Developer Testing" "$([ "$KYVERNO_POLICIES" -gt 0 ] && echo "implemented" || echo "planned")" "Kyverno policy tests validate policy behavior. Helm chart unit tests. Infrastructure validation pipeline."),
        $(build_control "SC-3" "Security Function Isolation" "$([ "$NETWORK_POLICIES" -gt 0 ] && echo "implemented" || echo "planned")" "Kubernetes namespace isolation. ${NETWORK_POLICIES} NetworkPolicies enforce network segmentation. Istio AuthorizationPolicy for service-level isolation."),
        $(build_control "SC-7" "Boundary Protection" "$ISTIO_STATUS" "Istio gateway as single ingress point. Default-deny NetworkPolicies on egress. NeuVector (${NEUVECTOR_STATUS}) network segmentation visualization."),
        $(build_control "SC-8" "Transmission Confidentiality" "$MTLS_STATUS" "Istio mTLS STRICT encrypts all in-cluster traffic. TLS termination at Istio gateway for external traffic."),
        $(build_control "SC-12" "Cryptographic Key Management" "$CERT_MANAGER_STATUS" "cert-manager automates certificate lifecycle (${CERTIFICATES} active certificates). OpenBao (${OPENBAO_STATUS}) manages secrets and rotation."),
        $(build_control "SC-13" "Cryptographic Protection" "implemented" "RKE2 built with FIPS 140-2 compliant BoringCrypto module. FIPS crypto policy enforced on Rocky Linux 9 via Ansible."),
        $(build_control "SC-28" "Protection of Information at Rest" "$OPENBAO_STATUS" "Kubernetes Secrets encrypted at rest by RKE2. OpenBao (${OPENBAO_STATUS}) provides encrypted secret storage. Loki object storage encrypted."),
        $(build_control "SI-2" "Flaw Remediation" "$HARBOR_STATUS" "Harbor with Trivy scanning produces vulnerability reports. Severity-based alerting. Flux enables automated image updates."),
        $(build_control "SI-3" "Malicious Code Protection" "$NEUVECTOR_STATUS" "NeuVector runtime protection blocks unauthorized processes and file system modifications."),
        $(build_control "SI-4" "System Monitoring" "$MONITORING_STATUS" "Prometheus metrics (${SERVICE_MONITORS} ServiceMonitors), Loki logs (${LOKI_STATUS}), Tempo traces, NeuVector runtime events (${NEUVECTOR_STATUS}), Kyverno policy reports (${POLICY_REPORTS})."),
        $(build_control "SI-6" "Security Function Verification" "$NEUVECTOR_STATUS" "NeuVector CIS benchmark scanning for running containers. Kyverno background policy scanning reports on existing non-compliant resources. kube-bench CIS Kubernetes benchmark ($([ "$KUBE_BENCH_CM" != "unavailable" ] && echo "results available" || echo "scheduled"))."),
        $(build_control "SI-7" "Software Integrity" "$IMAGE_VERIFY_POLICY" "Cosign image signature verification enforced by Kyverno. SBOM generation and storage in Harbor. Flux detects drift from Git-defined state.")
      ]
    }
  }
}
OSCAL
)

if [ -n "$OUTPUT_FILE" ]; then
  echo "$SSP_JSON" > "$OUTPUT_FILE"
  echo "OSCAL SSP written to ${OUTPUT_FILE}" >&2
  echo "Scan date: ${SCAN_DATE}" >&2
  CONTROL_COUNT=$(echo "$SSP_JSON" | grep -c '"control-id"' || echo "0")
  IMPLEMENTED=$(echo "$SSP_JSON" | grep -c '"implementation-status": "implemented"' || echo "0")
  PARTIAL=$(echo "$SSP_JSON" | grep -c '"implementation-status": "partially-implemented"' || echo "0")
  PLANNED=$(echo "$SSP_JSON" | grep -c '"implementation-status": "planned"' || echo "0")
  echo "Controls: ${CONTROL_COUNT} total, ${IMPLEMENTED} implemented, ${PARTIAL} partial, ${PLANNED} planned" >&2
else
  echo "$SSP_JSON"
fi
