# Glossary

Terms you might see in the SRE platform. You don't need to memorize these -- they're here when you need them.

---

**ATO (Authority to Operate)** -- Official government approval that says a system meets security requirements and is allowed to run in production. The whole platform is designed to help your app get this approval.

**Bundle** -- The package you submit to deploy your app. Contains your Docker image and a short config file (`bundle.yaml`) describing what your app needs.

**CMMC (Cybersecurity Maturity Model Certification)** -- A Department of Defense framework that measures how well an organization protects sensitive data. The platform satisfies Level 2 requirements automatically.

**Component** -- In the bundle spec, a separate service that runs independently alongside your main app (e.g., a background worker or a separate API). Each component gets its own resources and can scale independently.

**Cosign** -- A tool that digitally signs container images so the platform can verify they haven't been tampered with. This happens automatically in the pipeline -- you don't interact with it directly.

**CRD (Custom Resource Definition)** -- A way to extend what the platform understands. When you see references to `HelmRelease` or `Kustomization`, those are CRDs. You don't create these -- the platform operators do.

**CVE (Common Vulnerabilities and Exposures)** -- A publicly known security flaw in software, identified by a number like CVE-2024-1234. The security scan checks your image for these.

**DAST (Dynamic Application Security Testing)** -- A security test that runs your app and probes it for vulnerabilities like a real attacker would. One of the automated pipeline steps.

**DSOP Pipeline (DevSecOps Pipeline)** -- The automated security pipeline your bundle goes through before deployment. It runs 8 checks: static code analysis, secret detection, container build, software inventory, vulnerability scan, dynamic testing, ISSM review, and image signing.

**FedRAMP (Federal Risk and Authorization Management Program)** -- A government program that standardizes security requirements for cloud services. The platform's controls align with FedRAMP requirements.

**FIPS (Federal Information Processing Standards)** -- Cryptographic standards required by the US government. The platform uses FIPS-validated encryption for all data in transit and at rest.

**Flux** -- The system that watches the Git repository and automatically deploys changes to the cluster. When your app is approved, Flux is what actually puts it live. You never interact with it directly.

**Harbor** -- The platform's private container registry. After your image passes security scanning, it gets stored here. All running apps pull their images from Harbor.

**HelmRelease** -- A platform resource that describes how to deploy your app. The SRE operator generates this from your bundle. You'll see it in examples as a reference, but you don't need to write one.

**Ingress** -- The mechanism that makes your app reachable from outside the cluster via a URL. When you set `ingress: myapp.apps.sre.example.com` in your bundle, you're configuring this.

**ISSM (Information System Security Manager)** -- The person who reviews security exceptions in the pipeline. If your app needs elevated permissions (like root access), the ISSM approves or denies that request.

**Istio** -- The service mesh that handles encrypted communication between all apps on the platform. It automatically adds a small helper process (sidecar) to your app that handles encryption, traffic routing, and access control.

**Kyverno** -- The policy engine that enforces security rules on the platform. If your app is blocked from deploying, Kyverno is usually the reason -- and the error message will tell you exactly what to fix.

**mTLS (Mutual TLS)** -- Two-way encrypted communication where both sides verify each other's identity. Istio sets this up automatically between all apps. You don't configure it.

**Namespace** -- An isolated area on the platform where your team's apps run. Your team gets its own namespace (e.g., `team-alpha`) with dedicated resource limits and network rules.

**NetworkPolicy** -- A rule that controls which apps can talk to each other over the network. By default, all traffic is blocked and only explicitly allowed connections work. Your bundle's `externalApis` field creates these rules for outbound traffic.

**NIST 800-53** -- A catalog of security controls published by the National Institute of Standards and Technology. The platform maps every feature to specific controls in this catalog, which is how we prove compliance.

**OpenBao** -- The platform's secrets manager. It securely stores passwords, API keys, and certificates. When your app needs a secret (like a database password), OpenBao delivers it without you ever putting it in a config file.

**OSCAL (Open Security Controls Assessment Language)** -- A machine-readable format for compliance documentation. The platform generates these automatically for auditors.

**Pod** -- The smallest unit that runs on the platform. Usually one pod = one instance of your app. If you set `replicas: 3`, you get 3 pods. You don't manage pods directly.

**PolicyException** -- A formal request to relax a security rule for your app. If your app needs root access or special Linux capabilities, the platform creates one of these after ISSM approval.

**Probe (Liveness/Readiness)** -- Health checks the platform runs against your app. A **liveness** probe checks if your app is alive (restart if not). A **readiness** probe checks if your app is ready to receive traffic (stop sending requests if not). Set these to HTTP paths your app responds to with a 200 status.

**PVC (Persistent Volume Claim)** -- Storage that survives app restarts. When you enable `storage` in your bundle, the platform creates one of these. Your data persists even if your app's container is replaced.

**ResourceQuota** -- A limit on how much CPU and memory your team's namespace can use in total. This prevents any single team from consuming all the platform's resources.

**SAST (Static Application Security Testing)** -- A security scan that analyzes your source code (if included in the bundle) for vulnerabilities without running it. Catches issues like SQL injection and hardcoded secrets.

**SBOM (Software Bill of Materials)** -- An inventory of every library and dependency inside your container image. Generated automatically during the pipeline. Used to quickly check if your app is affected when a new vulnerability is announced.

**Sidecar** -- A helper container that runs alongside your main app in the same pod, sharing its network and storage. The Istio sidecar is added automatically -- you only define sidecars in your bundle if your app needs custom ones (like a log shipper).

**STIG (Security Technical Implementation Guide)** -- A configuration checklist published by DISA (Defense Information Systems Agency) for hardening specific software. The platform's operating system and cluster follow these guides.
