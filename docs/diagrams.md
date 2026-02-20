# SRE Platform Diagrams

Visual reference for the Secure Runtime Environment architecture, workflows, and security controls. All diagrams use [Mermaid](https://mermaid.js.org/) and render natively on GitHub.

---

## Table of Contents

1. [Platform Architecture](#platform-architecture)
2. [Infrastructure Deployment Pipeline](#infrastructure-deployment-pipeline)
3. [Developer Workflow](#developer-workflow)
4. [Request Flow and Security Chain](#request-flow-and-security-chain)
5. [Supply Chain Security](#supply-chain-security)
6. [Secrets Lifecycle](#secrets-lifecycle)
7. [Observability Architecture](#observability-architecture)
8. [Network Security Model](#network-security-model)
9. [GitOps Reconciliation](#gitops-reconciliation)
10. [NIST 800-53 Compliance Coverage](#nist-800-53-compliance-coverage)

---

## Platform Architecture

The full platform stack from infrastructure through application deployment.

```mermaid
block-beta
    columns 1

    block:L4["Layer 4: Supply Chain Security"]:1
        columns 4
        Harbor["Harbor\n(Registry + Trivy)"]
        Cosign["Cosign\n(Image Signing)"]
        Syft["Syft\n(SBOM)"]
        KyvernoVerify["Kyverno\n(imageVerify)"]
    end

    block:L3["Layer 3: Developer Experience"]:1
        columns 4
        WebApp["sre-web-app\nHelm Chart"]
        APIService["sre-api-service\nHelm Chart"]
        Worker["sre-worker\nHelm Chart"]
        CronJob["sre-cronjob\nHelm Chart"]
    end

    block:L2["Layer 2: Platform Services (Flux CD GitOps)"]:1
        columns 5
        Istio["Istio\n(mTLS)"]
        Kyverno["Kyverno\n(Policy)"]
        Monitoring["Prometheus\nGrafana"]
        Logging["Loki\nAlloy"]
        Secrets["OpenBao\nESO"]
        CertMgr["cert-manager"]
        NeuVector["NeuVector\n(Runtime)"]
        Keycloak["Keycloak\n(SSO)"]
        Tempo["Tempo\n(Tracing)"]
        Velero["Velero\n(Backup)"]
    end

    block:L1["Layer 1: Cluster Foundation"]:1
        columns 4
        RKE2["RKE2 Kubernetes\n(FIPS + CIS + STIG)"]
        Rocky["Rocky Linux 9\n(STIG Hardened)"]
        Tofu["OpenTofu\n(Infrastructure)"]
        Ansible["Ansible\n(OS Hardening)"]
    end

    L4 --> L3
    L3 --> L2
    L2 --> L1
```

---

## Infrastructure Deployment Pipeline

How the platform goes from bare metal to a running, hardened Kubernetes cluster.

```mermaid
flowchart LR
    subgraph Workstation["Your Workstation"]
        Packer["Packer"]
        OpenTofu["OpenTofu"]
        AnsibleTool["Ansible"]
        FluxCLI["Flux CLI"]
    end

    subgraph Proxmox["Proxmox VE / Cloud Provider"]
        ISO["Rocky Linux 9\nISO"] --> Template["VM Template\n(STIG Hardened\n+ RKE2 Staged)"]
        Template --> CP["Control Plane\nVM(s)"]
        Template --> W1["Worker\nVM 1"]
        Template --> W2["Worker\nVM 2"]
    end

    subgraph Cluster["RKE2 Cluster"]
        K8s["Kubernetes\nAPI Server"]
        Flux["Flux CD\nControllers"]
        Platform["Platform\nServices"]
    end

    subgraph Git["Git Repository"]
        Repo["sre-platform\n(GitHub)"]
    end

    Packer -->|"1. Build\nTemplate"| Template
    OpenTofu -->|"2. Clone\nVMs"| CP
    OpenTofu -->|"2. Clone\nVMs"| W1
    OpenTofu -->|"2. Clone\nVMs"| W2
    AnsibleTool -->|"3. Harden OS\n+ Install RKE2"| CP
    AnsibleTool -->|"3. Harden OS\n+ Install RKE2"| W1
    AnsibleTool -->|"3. Harden OS\n+ Install RKE2"| W2
    FluxCLI -->|"4. Bootstrap\nFlux"| K8s
    Repo -->|"5. GitOps\nReconcile"| Flux
    Flux -->|"Deploy"| Platform

    style Packer fill:#4a9eff,color:#fff
    style OpenTofu fill:#7b4eff,color:#fff
    style AnsibleTool fill:#e74c3c,color:#fff
    style FluxCLI fill:#3498db,color:#fff
    style Template fill:#2ecc71,color:#fff
    style Platform fill:#2ecc71,color:#fff
```

---

## Developer Workflow

How an application developer goes from code to running on the platform.

```mermaid
flowchart TD
    subgraph Developer["Developer"]
        Code["Write\nCode"] --> Build["Build Container\nImage"]
    end

    subgraph CI["CI Pipeline"]
        Build --> Scan["Trivy Scan\n(Vulnerabilities)"]
        Scan -->|CRITICAL/HIGH| Fail["Fail Build"]
        Scan -->|Pass| SBOM["Generate SBOM\n(Syft)"]
        SBOM --> Sign["Sign Image\n(Cosign)"]
        Sign --> Push["Push to\nHarbor"]
    end

    subgraph GitOps["GitOps Repository"]
        Push --> Update["Update Image Tag\nin HelmRelease"]
        Update --> Commit["Git Commit\n+ Push"]
    end

    subgraph Platform["SRE Platform"]
        Commit --> Flux["Flux CD\nDetects Change"]
        Flux --> Validate["Kyverno\nValidation"]
        Validate -->|"Registry ✓\nSignature ✓\nSecurity Context ✓"| Deploy["Deploy Pod"]
        Validate -->|"Policy\nViolation"| Reject["Reject\nPod"]
        Deploy --> Mesh["Istio Sidecar\nInjected"]
        Mesh --> Running["App Running\n(mTLS + Monitoring\n+ Logging)"]
    end

    style Fail fill:#e74c3c,color:#fff
    style Reject fill:#e74c3c,color:#fff
    style Running fill:#2ecc71,color:#fff
    style Sign fill:#f39c12,color:#fff
    style Validate fill:#9b59b6,color:#fff
```

---

## Request Flow and Security Chain

Every request passes through multiple security layers before reaching your application.

```mermaid
flowchart LR
    User["External\nUser"] --> TLS["TLS\nTermination"]

    subgraph Gateway["Istio Ingress Gateway"]
        TLS --> Auth["Request\nAuthentication\n(JWT)"]
        Auth --> Route["Traffic\nRouting"]
    end

    subgraph Mesh["Service Mesh (mTLS Encrypted)"]
        Route --> AuthZ["Authorization\nPolicy"]
        AuthZ --> NP["Network\nPolicy"]
        NP --> Sidecar["Istio\nSidecar\nProxy"]
        Sidecar --> App["Application\nContainer"]
    end

    subgraph Admission["Admission Control (at deploy time)"]
        direction TB
        KV["Kyverno\nValidation"]
        KM["Kyverno\nMutation"]
        NVA["NeuVector\nAdmission"]
        KV --> KM --> NVA
    end

    subgraph Runtime["Runtime Protection"]
        NVR["NeuVector\nBehavioral\nMonitoring"]
        NVN["NeuVector\nNetwork\nDLP/WAF"]
    end

    App -.->|"Process/File\nMonitoring"| NVR
    Sidecar -.->|"Network\nInspection"| NVN

    style User fill:#3498db,color:#fff
    style Auth fill:#e67e22,color:#fff
    style AuthZ fill:#9b59b6,color:#fff
    style NP fill:#9b59b6,color:#fff
    style KV fill:#9b59b6,color:#fff
    style NVR fill:#e74c3c,color:#fff
    style NVN fill:#e74c3c,color:#fff
    style App fill:#2ecc71,color:#fff
```

**Security controls applied at each stage:**

| Stage | Control | NIST |
|-------|---------|------|
| TLS Termination | Encrypted transport | SC-8 |
| Request Authentication | JWT/OIDC validation via Keycloak | IA-2, IA-8 |
| Authorization Policy | Fine-grained service-to-service RBAC | AC-3, AC-4 |
| Network Policy | Layer 3/4 traffic filtering | SC-7 |
| Istio mTLS | Encrypted pod-to-pod, SPIFFE identity | SC-8, IA-3 |
| Kyverno Validation | Image registry, signature, security context | CM-7, SI-7 |
| NeuVector Admission | Vulnerability threshold check | RA-5 |
| NeuVector Runtime | Behavioral anomaly detection, DLP/WAF | SI-3, SI-4 |

---

## Supply Chain Security

End-to-end image integrity from source code to running container.

```mermaid
flowchart LR
    subgraph Build["Build Phase"]
        Source["Source\nCode"] --> Dockerfile["Dockerfile\n(Distroless\nBase)"]
        Dockerfile --> Image["Container\nImage"]
    end

    subgraph Verify["Verify Phase"]
        Image --> Trivy["Trivy Scan"]
        Trivy -->|"CRITICAL?"| Gate{Pass?}
        Gate -->|No| Block1["Block"]
        Gate -->|Yes| SBOMGen["SBOM\n(Syft)"]
        SBOMGen --> CosignSign["Cosign\nSign"]
    end

    subgraph Store["Store Phase"]
        CosignSign --> Harbor["Harbor\nRegistry"]
        Harbor --> HarborScan["Harbor\nTrivy Rescan"]
        Harbor --> SBOMStore["SBOM\nAttached\n(OCI Artifact)"]
        Harbor --> SigStore["Signature\nStored"]
    end

    subgraph Deploy["Deploy Phase"]
        Harbor --> KyvernoImg["Kyverno\nimageVerify"]
        KyvernoImg -->|"Signature\nValid?"| Gate2{Pass?}
        Gate2 -->|No| Block2["Reject\nPod"]
        Gate2 -->|Yes| Pod["Pod\nCreated"]
    end

    subgraph Monitor["Monitor Phase"]
        Pod --> NeuVector2["NeuVector\nRuntime Scan"]
        NeuVector2 --> Alert["CVE Alert\n(New Vuln)"]
    end

    style Block1 fill:#e74c3c,color:#fff
    style Block2 fill:#e74c3c,color:#fff
    style Alert fill:#e67e22,color:#fff
    style Pod fill:#2ecc71,color:#fff
    style CosignSign fill:#f39c12,color:#fff
    style KyvernoImg fill:#9b59b6,color:#fff
```

**What this prevents:**
- Untrusted images (registry restriction to `harbor.sre.internal` only)
- Unscanned images (Trivy gate in CI + Harbor rescan on push)
- Tampered images (Cosign cryptographic signature verified by Kyverno)
- Unknown dependencies (SBOM generated and attached as OCI artifact)
- Runtime vulnerabilities (NeuVector continuous scanning for new CVEs)
- Unversioned deployments (`:latest` tag blocked by Kyverno policy)

---

## Secrets Lifecycle

How secrets flow from a secure vault to application environment variables without touching Git.

```mermaid
flowchart LR
    subgraph Vault["OpenBao (Vault-Compatible)"]
        SecretStore["KV v2\nSecret Store"]
        PKI["PKI\nEngine"]
        DynCreds["Dynamic\nCredentials"]
        AuditLog["Audit\nLog"]
    end

    subgraph K8s["Kubernetes"]
        ESO["External Secrets\nOperator"]
        CSS["ClusterSecretStore\n(openbao-backend)"]
        ES["ExternalSecret\nCRD"]
        KSecret["Kubernetes\nSecret"]
    end

    subgraph App["Application Pod"]
        EnvVar["Environment\nVariable"]
    end

    subgraph GitRepo["Git Repository"]
        HelmValues["HelmRelease\nvalues:\n  env:\n    - name: DB_URL\n      secretRef: db-creds"]
    end

    Admin["Platform\nAdmin"] -->|"1. Store secret"| SecretStore
    HelmValues -->|"2. Reference\n(name only,\nno value)"| ES
    ESO -->|"3. Authenticate\n(K8s ServiceAccount)"| SecretStore
    ESO -->|"4. Fetch secret"| SecretStore
    ESO -->|"5. Create/Update"| KSecret
    KSecret -->|"6. Mount as\nenv var"| EnvVar
    SecretStore -.->|"Every action\nlogged"| AuditLog

    style Admin fill:#3498db,color:#fff
    style SecretStore fill:#f39c12,color:#fff
    style KSecret fill:#2ecc71,color:#fff
    style AuditLog fill:#95a5a6,color:#fff
```

**Key properties:**
- Secrets never appear in Git (only the secret name is referenced)
- ESO refreshes secrets every hour (configurable)
- All OpenBao access is audit-logged (NIST AU-2)
- Pods authenticate to OpenBao via Kubernetes ServiceAccount (no hardcoded credentials)
- Dynamic database credentials auto-rotate and expire
- PKI engine issues short-lived certificates for internal services

---

## Observability Architecture

Unified metrics, logs, and traces through a single Grafana interface.

```mermaid
flowchart TB
    subgraph Apps["Application Pods"]
        App1["/metrics\nendpoint"]
        App2["stdout/stderr\n(JSON logs)"]
        App3["Istio Sidecar\n(trace spans)"]
    end

    subgraph Collection["Collection Layer"]
        Prom["Prometheus\n(Scrape)"]
        Alloy["Alloy\n(DaemonSet)"]
        OTel["OpenTelemetry\nCollector"]
    end

    subgraph Storage["Storage Layer"]
        PromStore["Prometheus\nTSDB (15d)"]
        Loki["Loki\n(Log Store)"]
        Tempo["Tempo\n(Trace Store)"]
        S3["S3 / MinIO\n(Long-term)"]
    end

    subgraph UI["Visualization"]
        Grafana["Grafana\n(Unified UI)"]
        Dashboards["Pre-built\nDashboards"]
        Alerts["AlertManager\n→ Slack/PagerDuty/Email"]
    end

    subgraph Sources["Additional Sources"]
        K8sAudit["K8s Audit\nLog"]
        NodeJournal["Node\nJournald"]
        NVEvents["NeuVector\nEvents"]
        KyvernoReport["Kyverno\nPolicy Reports"]
    end

    App1 -->|"ServiceMonitor"| Prom
    App2 --> Alloy
    App3 --> OTel
    K8sAudit --> Alloy
    NodeJournal --> Alloy
    NVEvents --> Alloy
    KyvernoReport -->|"Metrics"| Prom

    Prom --> PromStore
    Alloy --> Loki
    OTel --> Tempo
    PromStore -->|"Thanos\nSidecar"| S3
    Loki --> S3

    PromStore --> Grafana
    Loki --> Grafana
    Tempo --> Grafana
    Grafana --> Dashboards
    Prom --> Alerts

    style Grafana fill:#f39c12,color:#fff
    style Prom fill:#e74c3c,color:#fff
    style Loki fill:#3498db,color:#fff
    style Tempo fill:#2ecc71,color:#fff
    style Alerts fill:#e67e22,color:#fff
```

**Pre-built dashboards:**

| Dashboard | What It Shows |
|-----------|--------------|
| Cluster Health | Node CPU/memory/disk, pod counts, API server latency |
| Namespace Overview | Resource consumption per team namespace |
| Istio Traffic | Request rates, latencies, error rates per service |
| Kyverno Compliance | Policy pass/fail rates, violation trends |
| NeuVector Security | Runtime alerts, network violations, CIS scan results |
| Flux GitOps | Reconciliation status, drift detection, deployment history |
| Certificate Expiry | cert-manager certificate status and renewal timeline |

---

## Network Security Model

Zero-trust networking with defense in depth across multiple layers.

```mermaid
flowchart TB
    Internet["Internet"] --> FW["Firewall / Cloud SG"]

    subgraph Cluster["Kubernetes Cluster"]
        subgraph IstioGW["Istio Ingress Gateway"]
            GW["TLS + JWT\nValidation"]
        end

        subgraph NS_Alpha["team-alpha namespace"]
            subgraph NP_Alpha["NetworkPolicy: default-deny"]
                Pod_A1["App A\n+ istio-proxy"]
                Pod_A2["App B\n+ istio-proxy"]
            end
        end

        subgraph NS_Beta["team-beta namespace"]
            subgraph NP_Beta["NetworkPolicy: default-deny"]
                Pod_B1["App C\n+ istio-proxy"]
            end
        end

        subgraph NS_Platform["Platform Namespaces"]
            Monitoring2["monitoring"]
            Logging2["logging"]
            IstioSys["istio-system"]
        end
    end

    FW --> GW
    GW -->|"mTLS"| Pod_A1
    Pod_A1 <-->|"mTLS\n(same ns)"| Pod_A2
    Pod_A1 x-->|"Blocked by\nNetworkPolicy"| Pod_B1
    Monitoring2 -.->|"Scrape\n(allowed)"| Pod_A1
    Monitoring2 -.->|"Scrape\n(allowed)"| Pod_B1

    style Internet fill:#e74c3c,color:#fff
    style GW fill:#e67e22,color:#fff
    style NP_Alpha fill:#1a1a2e,color:#fff,stroke:#9b59b6
    style NP_Beta fill:#1a1a2e,color:#fff,stroke:#9b59b6
    style Pod_A1 fill:#2ecc71,color:#fff
    style Pod_A2 fill:#2ecc71,color:#fff
    style Pod_B1 fill:#3498db,color:#fff
```

**Layers of network security:**

| Layer | Technology | What It Does |
|-------|-----------|--------------|
| Perimeter | Firewall / Security Groups | Restrict inbound to ports 443 (HTTPS) and 6443 (K8s API) |
| Ingress | Istio Gateway | TLS termination, JWT validation, rate limiting |
| Transport | Istio mTLS STRICT | All pod-to-pod traffic encrypted with SPIFFE identities |
| Segmentation | Kubernetes NetworkPolicy | Default deny-all per namespace, explicit allow rules |
| Authorization | Istio AuthorizationPolicy | Fine-grained service-to-service access control |
| Application | NeuVector DLP/WAF | Layer 7 inspection, PII detection, protocol validation |
| Egress | NetworkPolicy + Istio | Restrict outbound to approved destinations only |

---

## GitOps Reconciliation

How Flux CD continuously reconciles cluster state to match the Git repository.

```mermaid
flowchart LR
    subgraph Git["GitHub Repository"]
        Main["main branch"]
        PlatformDir["platform/\n  core/\n    istio/\n    kyverno/\n    monitoring/\n    ..."]
        AppsDir["apps/\n  tenants/\n    team-alpha/\n    team-beta/"]
    end

    subgraph FluxSystem["Flux Controllers (flux-system namespace)"]
        Source["Source\nController"]
        Kustomize["Kustomize\nController"]
        Helm["Helm\nController"]
    end

    subgraph Reconciliation["Reconciliation Loop (every 10 min)"]
        Fetch["Fetch Git\nRevision"]
        Diff["Diff Against\nCluster State"]
        Apply["Apply\nChanges"]
        Health["Health\nCheck"]
        Report["Report\nStatus"]
    end

    subgraph ClusterState["Cluster"]
        NS1["istio-system"]
        NS2["kyverno"]
        NS3["monitoring"]
        NS4["team-alpha"]
        NS5["team-beta"]
    end

    Main --> Source
    Source --> Fetch
    Fetch --> Diff
    Diff -->|"Drift\nDetected"| Apply
    Diff -->|"In Sync"| Report
    Apply --> Health
    Health -->|"Healthy"| Report
    Health -->|"Failed"| Retry["Retry\n(3x)"]
    Retry -->|"Still\nFailing"| Rollback["Auto\nRollback"]

    PlatformDir --> Kustomize
    AppsDir --> Helm
    Kustomize --> NS1
    Kustomize --> NS2
    Kustomize --> NS3
    Helm --> NS4
    Helm --> NS5

    style Rollback fill:#e74c3c,color:#fff
    style Report fill:#2ecc71,color:#fff
    style Source fill:#3498db,color:#fff
```

**GitOps guarantees:**
- Git is the single source of truth for all cluster state
- Manual `kubectl` changes are automatically reverted (drift correction)
- Every change is auditable via Git commit history
- Failed deployments auto-retry (3x) then rollback
- Dependency ordering ensures services deploy in the correct sequence

---

## NIST 800-53 Compliance Coverage

How platform components map to NIST 800-53 Rev 5 control families.

```mermaid
mindmap
    root["NIST 800-53 Rev 5\nControl Coverage"]
        AC["**AC** Access Control"]
            AC_impl["Keycloak SSO + MFA\nKubernetes RBAC\nIstio AuthorizationPolicy\nNetworkPolicy"]
        AU["**AU** Audit"]
            AU_impl["Loki log aggregation\nK8s audit logging\nauditd on nodes\nOpenBao audit log"]
        CA["**CA** Assessment"]
            CA_impl["Kyverno policy reports\nNeuVector CIS benchmarks\nOSCAL artifacts"]
        CM["**CM** Configuration Mgmt"]
            CM_impl["Git as source of truth\nFlux drift detection\nAnsible STIG roles\nKyverno policies"]
        IA["**IA** Identification"]
            IA_impl["Keycloak OIDC + MFA\nIstio mTLS + SPIFFE\ncert-manager rotation\nOpenBao auth"]
        IR["**IR** Incident Response"]
            IR_impl["NeuVector alerts\nAlertManager routing\nGrafana dashboards\nRunbooks"]
        RA["**RA** Risk Assessment"]
            RA_impl["Trivy image scanning\nNeuVector runtime scan\nKyverno violation reports"]
        SC["**SC** System Protection"]
            SC_impl["Istio mTLS STRICT\nFIPS 140-2 crypto\nNetworkPolicy isolation\nTLS everywhere"]
        SI["**SI** System Integrity"]
            SI_impl["Cosign image signatures\nKyverno imageVerify\nNeuVector process monitor\nFlux drift detection"]
        SA["**SA** Acquisition"]
            SA_impl["SBOM generation\nHarbor scan gates\nGitOps audit trail"]
```

---

## Component Dependency Chain

The order in which platform services are deployed, and their dependencies.

```mermaid
flowchart TD
    Istio["Istio\n(Service Mesh)"] --> CertMgr["cert-manager\n(Certificates)"]
    CertMgr --> Kyverno["Kyverno\n(Policy Engine)"]
    Kyverno --> Monitoring["Monitoring\n(Prometheus + Grafana)"]
    Monitoring --> Logging["Logging\n(Loki + Alloy)"]
    Logging --> OpenBao["OpenBao\n(Secrets)"]
    OpenBao --> ESO["External Secrets\nOperator"]
    ESO --> Harbor["Harbor\n(Registry)"]
    Harbor --> NeuVector["NeuVector\n(Runtime Security)"]
    NeuVector --> Keycloak["Keycloak\n(Identity + SSO)"]
    Keycloak --> Tempo["Tempo\n(Tracing)"]
    Tempo --> Velero["Velero\n(Backup)"]
    Velero --> Apps["App Templates\n+ Tenants"]

    Istio -.->|"mTLS for all"| CertMgr
    Istio -.->|"mTLS for all"| Kyverno
    Istio -.->|"mTLS for all"| Monitoring
    Monitoring -.->|"Scrapes all"| Kyverno
    Monitoring -.->|"Scrapes all"| Logging
    Monitoring -.->|"Scrapes all"| OpenBao

    style Istio fill:#4a9eff,color:#fff
    style Kyverno fill:#9b59b6,color:#fff
    style Monitoring fill:#e74c3c,color:#fff
    style Logging fill:#3498db,color:#fff
    style OpenBao fill:#f39c12,color:#fff
    style Harbor fill:#2ecc71,color:#fff
    style NeuVector fill:#e74c3c,color:#fff
    style Keycloak fill:#e67e22,color:#fff
    style Apps fill:#2ecc71,color:#fff
```

---

## Tenant Isolation Model

How multi-tenant workloads are isolated on the platform.

```mermaid
flowchart TB
    subgraph Platform["SRE Platform Cluster"]
        subgraph PlatformNS["Platform Namespaces (managed by platform team)"]
            IS["istio-system"]
            KY["kyverno"]
            MO["monitoring"]
            LO["logging"]
            FS["flux-system"]
        end

        subgraph TenantA["team-alpha (tenant namespace)"]
            direction TB
            RBAC_A["RBAC: edit → alpha-devs\nview → alpha-viewers"]
            Quota_A["Quota: 4 CPU / 8Gi"]
            NP_A["NetworkPolicy:\ndefault-deny"]
            AppA1["App 1\n+ istio-proxy"]
            AppA2["App 2\n+ istio-proxy"]
        end

        subgraph TenantB["team-beta (tenant namespace)"]
            direction TB
            RBAC_B["RBAC: edit → beta-devs\nview → beta-viewers"]
            Quota_B["Quota: 8 CPU / 16Gi"]
            NP_B["NetworkPolicy:\ndefault-deny"]
            AppB1["App 3\n+ istio-proxy"]
        end

        KY -->|"Enforce policies\n(cluster-wide)"| TenantA
        KY -->|"Enforce policies\n(cluster-wide)"| TenantB
        MO -.->|"Scrape metrics\n(allowed by NP)"| TenantA
        MO -.->|"Scrape metrics\n(allowed by NP)"| TenantB
        IS -->|"mTLS + routing"| TenantA
        IS -->|"mTLS + routing"| TenantB
    end

    Keycloak2["Keycloak\n(Identity)"] -->|"OIDC groups"| RBAC_A
    Keycloak2 -->|"OIDC groups"| RBAC_B

    TenantA x--x|"Blocked"| TenantB

    style TenantA fill:#1a1a2e,color:#fff,stroke:#3498db
    style TenantB fill:#1a1a2e,color:#fff,stroke:#2ecc71
    style PlatformNS fill:#2c3e50,color:#fff
```

**Isolation boundaries per tenant:**

| Boundary | Mechanism | Effect |
|----------|-----------|--------|
| Identity | Keycloak groups → RBAC RoleBindings | Only team members can access their namespace |
| Resource | ResourceQuota + LimitRange | Prevent one team from consuming all cluster resources |
| Network | NetworkPolicy (default deny) | Cross-namespace traffic blocked unless explicitly allowed |
| Encryption | Istio mTLS (SPIFFE per pod) | Even if network policy fails, traffic is identity-verified |
| Policy | Kyverno (cluster-wide) | All tenants must meet the same security baseline |
| Registry | Kyverno imageVerify | Only signed images from approved registries |
| Secrets | OpenBao path-based ACLs | Each team can only access `sre/<team-name>/*` secrets |
