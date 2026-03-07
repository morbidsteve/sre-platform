const express = require("express");
const k8s = require("@kubernetes/client-node");
const path = require("path");
const fs = require("fs");
const rateLimit = require("express-rate-limit");

const app = express();

// ── Security Headers ─────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ── Rate Limiting ────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({ windowMs: 60000, max: 200, standardHeaders: true, legacyHeaders: false });
const mutateLimiter = rateLimit({ windowMs: 60000, max: 10, message: { error: 'Too many requests' } });
const credentialLimiter = rateLimit({ windowMs: 60000, max: 5, message: { error: 'Too many requests' } });
app.use(globalLimiter);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── RBAC Middleware ──────────────────────────────────────────────────────────

function requireGroups(...requiredGroups) {
  return (req, res, next) => {
    const groupsHeader = req.headers["x-auth-request-groups"] || "";
    const userGroups = groupsHeader
      .split(/[,\s]+/)
      .map((g) => g.trim())
      .filter(Boolean)
      .map((g) => g.replace(/^\//, ""));
    const authorized = requiredGroups.some((rg) => userGroups.includes(rg));
    if (!authorized) {
      return res.status(403).json({ error: "Forbidden: admin access required" });
    }
    next();
  };
}

// Kubernetes client setup
const kc = new k8s.KubeConfig();
try {
  kc.loadFromCluster();
} catch {
  kc.loadFromDefault();
}

const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
const appsApi = kc.makeApiClient(k8s.AppsV1Api);

// ── Sample Apps (known-good non-root images) ────────────────────────────────

const SAMPLE_APPS = [
  {
    name: "nginx-demo",
    description: "Static web server (Nginx)",
    image: "nginxinc/nginx-unprivileged",
    tag: "1.27-alpine",
    port: 8080,
  },
  {
    name: "httpbin",
    description: "HTTP testing service -- echoes requests back",
    image: "mccutchen/go-httpbin",
    tag: "v2.15.0",
    port: 8080,
  },
  {
    name: "podinfo",
    description: "Go microservice demo with health checks & metrics",
    image: "ghcr.io/stefanprodan/podinfo",
    tag: "6.7.1",
    port: 9898,
  },
  {
    name: "whoami",
    description: "Shows container hostname, IP, and request headers",
    image: "traefik/whoami",
    tag: "v1.10",
    port: 80,
  },
];

// ── Platform Services Definition ────────────────────────────────────────────

const PLATFORM_SERVICES = [
  { name: "grafana", namespace: "monitoring", serviceName: "kube-prometheus-stack-grafana", icon: "chart", description: "Dashboards & observability", url: "https://grafana.apps.sre.example.com" },
  { name: "prometheus", namespace: "monitoring", serviceName: "kube-prometheus-stack-prometheus", icon: "search", description: "Metrics collection & alerting rules", url: "https://prometheus.apps.sre.example.com" },
  { name: "alertmanager", namespace: "monitoring", serviceName: "kube-prometheus-stack-alertmanager", icon: "bell", description: "Alert routing & notifications", url: "https://alertmanager.apps.sre.example.com" },
  { name: "harbor", namespace: "harbor", serviceName: "harbor-core", icon: "container", description: "Container image registry", url: "https://harbor.apps.sre.example.com" },
  { name: "keycloak", namespace: "keycloak", serviceName: "keycloak", icon: "key", description: "Identity & access management", url: "https://keycloak.apps.sre.example.com" },
  { name: "neuvector", namespace: "neuvector", serviceName: "neuvector-service-webui", icon: "shield", description: "Container security platform", url: "https://neuvector.apps.sre.example.com" },
  { name: "openbao", namespace: "openbao", serviceName: "openbao", icon: "lock", description: "Secrets management", url: "https://openbao.apps.sre.example.com" },
  { name: "dashboard", namespace: "sre-dashboard", serviceName: "sre-dashboard", icon: "layout", description: "This SRE Platform Dashboard", url: "https://dashboard.apps.sre.example.com" },
];

// ── Utility: HTML-escape to prevent XSS ─────────────────────────────────────

function escapeHtml(str) {
  if (typeof str !== "string") return str;
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── API Routes ───────────────────────────────────────────────────────────────

// Sample apps catalog
app.get("/api/samples", (req, res) => {
  res.json({ samples: SAMPLE_APPS });
});

// Platform health: HelmReleases, nodes, pods
app.get("/api/health", async (req, res) => {
  try {
    const [helmReleases, nodes, pods] = await Promise.all([
      getHelmReleases(),
      getNodes(),
      getProblemPods(),
    ]);

    const healthy = helmReleases.filter((h) => h.ready).length;
    res.json({
      helmReleases,
      nodes,
      problemPods: pods,
      summary: {
        helmReleasesReady: healthy,
        helmReleasesTotal: helmReleases.length,
        nodesReady: nodes.filter((n) => n.ready).length,
        nodesTotal: nodes.length,
        problemPodCount: pods.length,
      },
    });
  } catch (err) {
    console.error("Error fetching health:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Ingress routes
app.get("/api/ingress", async (req, res) => {
  try {
    const routes = await getIngressRoutes();
    const nodeIp = await getFirstNodeIp();
    const httpsPort = await getGatewayPort();
    res.json({ routes, nodeIp, httpsPort });
  } catch (err) {
    console.error("Error fetching ingress:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// List tenant namespaces
app.get("/api/tenants", async (req, res) => {
  try {
    const tenants = await getTenants();
    res.json({ tenants });
  } catch (err) {
    console.error("Error fetching tenants:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// List apps in a tenant namespace
app.get("/api/tenants/:namespace/apps", async (req, res) => {
  try {
    const apps = await getTenantApps(req.params.namespace);
    res.json({ apps });
  } catch (err) {
    console.error("Error fetching tenant apps:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Deploy a new app
app.post("/api/deploy", mutateLimiter, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const { name, team, image, tag, port, replicas, ingress } = req.body;

    if (!name || !team || !image || !tag) {
      return res.status(400).json({
        error: "Missing required fields: name, team, image, tag",
      });
    }

    // Sanitize deploy name
    const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').substring(0, 63);
    if (!safeName || !/^[a-z]/.test(safeName)) {
      return res.status(400).json({ error: 'Invalid app name' });
    }

    // Sanitize team name
    const teamName = team.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const nsName = teamName.startsWith("team-") ? teamName : `team-${teamName}`;

    // Auto-create namespace if it doesn't exist
    await ensureNamespace(nsName, teamName);

    const manifest = generateHelmRelease({
      name: safeName,
      team: nsName,
      image,
      tag,
      port: port || 8080,
      replicas: replicas || 2,
      ingressHost: ingress || "",
    });

    // Apply the manifest to the cluster
    await applyManifest(manifest, nsName);

    res.json({
      success: true,
      message: `App "${safeName}" deployed to namespace "${nsName}"`,
      namespace: nsName,
      manifest,
    });
  } catch (err) {
    console.error("Error deploying app:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete an app
app.delete("/api/deploy/:namespace/:name", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    await customApi.deleteNamespacedCustomObject(
      "helm.toolkit.fluxcd.io",
      "v2",
      req.params.namespace,
      "helmreleases",
      req.params.name
    );
    res.json({
      success: true,
      message: `App "${req.params.name}" deleted from "${req.params.namespace}"`,
    });
  } catch (err) {
    console.error("Error deleting app:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Credentials
app.get("/api/credentials", credentialLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    const creds = await getCredentials();
    res.json(creds);
  } catch (err) {
    console.error("Error fetching credentials:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── NEW API Endpoints ────────────────────────────────────────────────────────

// GET /api/user — Return user info from OAuth2 Proxy headers
app.get("/api/user", (req, res) => {
  const user = req.headers["x-auth-request-user"] || "anonymous";
  const email = req.headers["x-auth-request-email"] || "";
  const groupsHeader = req.headers["x-auth-request-groups"] || "";
  const groups = groupsHeader ? groupsHeader.split(",").map((g) => g.trim()).filter(Boolean) : [];
  const isAdmin = groups.includes("sre-admins");

  // Determine role for RBAC
  let role = "viewer";
  if (isAdmin) {
    role = "admin";
  } else if (groups.includes("developers")) {
    role = "developer";
  } else if (groups.includes("sre-viewers")) {
    role = "viewer";
  } else if (user === "anonymous") {
    role = "anonymous";
  }

  res.json({ user, email, groups, isAdmin, role });
});

// GET /api/alerts — Proxy Alertmanager alerts
app.get("/api/alerts", async (req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(
      "http://kube-prometheus-stack-alertmanager.monitoring.svc:9093/api/v2/alerts",
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    const alerts = await resp.json();
    const active = alerts
      .filter((a) => a.status && a.status.state !== "suppressed")
      .map((a) => ({
        name: a.labels?.alertname || "Unknown",
        severity: a.labels?.severity || "none",
        state: a.status?.state || "unknown",
        summary: a.annotations?.summary || a.annotations?.description || "",
        startsAt: a.startsAt || "",
      }));
    res.json(active);
  } catch (err) {
    // Alertmanager may not be reachable — return empty
    res.json([]);
  }
});

// GET /api/status — Service health status page
app.get("/api/status", async (req, res) => {
  try {
    const results = await Promise.all(
      PLATFORM_SERVICES.map(async (svc) => {
        let healthy = false;
        try {
          const ep = await k8sApi.readNamespacedEndpoints(svc.serviceName, svc.namespace);
          const subsets = ep.body.subsets || [];
          healthy = subsets.some((s) => (s.addresses || []).length > 0);
        } catch {
          healthy = false;
        }
        return {
          name: svc.name,
          namespace: svc.namespace,
          healthy,
          url: svc.url,
          icon: svc.icon,
          description: svc.description,
        };
      })
    );
    res.json(results);
  } catch (err) {
    console.error("Error fetching status:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/audit — Recent audit events
app.get("/api/audit", async (req, res) => {
  try {
    const resp = await k8sApi.listEventForAllNamespaces();
    const significantReasons = ["Created", "Deleted", "Scaled", "Updated", "Killing", "Started", "Pulled", "SuccessfulCreate", "SuccessfulDelete", "ScalingReplicaSet"];
    const events = resp.body.items
      .filter((e) => {
        if (e.type === "Warning") return true;
        if (e.type === "Normal" && significantReasons.includes(e.reason)) return true;
        return false;
      })
      .sort((a, b) => {
        const ta = new Date(a.lastTimestamp || a.eventTime || 0);
        const tb = new Date(b.lastTimestamp || b.eventTime || 0);
        return tb - ta;
      })
      .slice(0, 100)
      .map((e) => ({
        timestamp: e.lastTimestamp || e.eventTime || "",
        namespace: e.metadata.namespace || "",
        kind: e.involvedObject?.kind || "",
        name: e.involvedObject?.name || "",
        reason: e.reason || "",
        message: e.message || "",
        type: e.type || "Normal",
      }));
    res.json(events);
  } catch (err) {
    console.error("Error fetching audit events:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/favorites — Get user favorites
app.get("/api/favorites", async (req, res) => {
  const email = req.headers["x-auth-request-email"] || "anonymous";
  const userKey = email.replace(/[^a-zA-Z0-9.-]/g, '_');
  try {
    const cm = await k8sApi.readNamespacedConfigMap("sre-dashboard-favorites", "sre-dashboard");
    const data = cm.body.data || {};
    const userFavs = data[userKey] ? JSON.parse(data[userKey]) : [];
    res.json({ favorites: userFavs });
  } catch (err) {
    if (err.statusCode === 404) {
      res.json({ favorites: [] });
    } else {
      res.json({ favorites: [] });
    }
  }
});

// POST /api/favorites — Store user favorites
app.post("/api/favorites", async (req, res) => {
  const email = req.headers["x-auth-request-email"] || "anonymous";
  const { favorites } = req.body;
  if (!Array.isArray(favorites)) {
    return res.status(400).json({ error: "favorites must be an array" });
  }

  const key = email.replace(/[^a-zA-Z0-9.-]/g, '_');
  const value = JSON.stringify(favorites);

  try {
    // Try to read existing ConfigMap
    try {
      await k8sApi.readNamespacedConfigMap("sre-dashboard-favorites", "sre-dashboard");
      // Patch it
      await k8sApi.patchNamespacedConfigMap(
        "sre-dashboard-favorites",
        "sre-dashboard",
        { data: { [key]: value } },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { headers: { "Content-Type": "application/merge-patch+json" } }
      );
    } catch (err) {
      if (err.statusCode === 404) {
        // Create it
        await k8sApi.createNamespacedConfigMap("sre-dashboard", {
          metadata: {
            name: "sre-dashboard-favorites",
            namespace: "sre-dashboard",
            labels: { "app.kubernetes.io/name": "sre-dashboard" },
          },
          data: { [key]: value },
        });
      } else {
        throw err;
      }
    }
    res.json({ ok: true, favorites });
  } catch (err) {
    console.error("Error saving favorites:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/config — Dashboard configuration
app.get("/api/config", (req, res) => {
  res.json({
    baseUrl: "https://{service}.apps.sre.example.com",
    loginUrl: "/oauth2/start",
    logoutUrl: "/oauth2/sign_out",
    services: PLATFORM_SERVICES.map((s) => ({
      name: s.name,
      icon: s.icon,
      description: s.description,
      url: s.url,
    })),
  });
});

// ── Helper Functions ─────────────────────────────────────────────────────────

async function getHelmReleases() {
  const resp = await customApi.listClusterCustomObject(
    "helm.toolkit.fluxcd.io",
    "v2",
    "helmreleases"
  );
  return resp.body.items.map((hr) => {
    const readyCondition = (hr.status?.conditions || []).find(
      (c) => c.type === "Ready"
    );
    return {
      name: hr.metadata.name,
      namespace: hr.metadata.namespace,
      ready: readyCondition?.status === "True",
      status: readyCondition?.message || "Unknown",
      chart:
        hr.spec?.chart?.spec?.chart ||
        hr.spec?.chart?.spec?.sourceRef?.name ||
        "",
      version: hr.spec?.chart?.spec?.version || "",
    };
  });
}

async function getNodes() {
  const resp = await k8sApi.listNode();
  return resp.body.items.map((node) => {
    const readyCondition = (node.status?.conditions || []).find(
      (c) => c.type === "Ready"
    );
    const ip = (node.status?.addresses || []).find(
      (a) => a.type === "InternalIP"
    );
    return {
      name: node.metadata.name,
      ready: readyCondition?.status === "True",
      ip: ip?.address || "",
      roles: Object.keys(node.metadata.labels || {})
        .filter((l) => l.startsWith("node-role.kubernetes.io/"))
        .map((l) => l.replace("node-role.kubernetes.io/", ""))
        .join(", ") || "worker",
      version: node.status?.nodeInfo?.kubeletVersion || "",
      os: node.status?.nodeInfo?.osImage || "",
    };
  });
}

async function getProblemPods() {
  const resp = await k8sApi.listPodForAllNamespaces();
  return resp.body.items
    .filter((pod) => {
      const phase = pod.status?.phase;
      return phase !== "Running" && phase !== "Succeeded";
    })
    .map((pod) => ({
      name: pod.metadata.name,
      namespace: pod.metadata.namespace,
      phase: pod.status?.phase || "Unknown",
      reason:
        pod.status?.containerStatuses?.[0]?.state?.waiting?.reason || "",
    }))
    .slice(0, 20);
}

async function getIngressRoutes() {
  try {
    const resp = await customApi.listClusterCustomObject(
      "networking.istio.io",
      "v1",
      "virtualservices"
    );
    return resp.body.items.map((vs) => ({
      name: vs.metadata.name,
      namespace: vs.metadata.namespace,
      hosts: vs.spec?.hosts || [],
      gateways: vs.spec?.gateways || [],
    }));
  } catch {
    return [];
  }
}

async function getFirstNodeIp() {
  const resp = await k8sApi.listNode();
  const ip = resp.body.items[0]?.status?.addresses?.find(
    (a) => a.type === "InternalIP"
  );
  return ip?.address || "unknown";
}

async function getGatewayPort() {
  try {
    const resp = await k8sApi.readNamespacedService(
      "istio-gateway",
      "istio-system"
    );
    // If LoadBalancer has an external IP, use standard port 443
    const ingress = resp.body.status?.loadBalancer?.ingress;
    if (ingress && ingress.length > 0) {
      return 443;
    }
    // Fallback to NodePort if no LoadBalancer
    const httpsPort = resp.body.spec.ports.find((p) => p.name === "https");
    return httpsPort?.nodePort || 443;
  } catch {
    return 443;
  }
}

async function getTenants() {
  const resp = await k8sApi.listNamespace();
  return resp.body.items
    .filter((ns) => {
      const labels = ns.metadata?.labels || {};
      return labels["sre.io/tenant"] === "true" || ns.metadata.name.startsWith("team-");
    })
    .map((ns) => ({
      name: ns.metadata.name,
      team: ns.metadata.labels?.["sre.io/team"] || ns.metadata.name,
      created: ns.metadata.creationTimestamp,
    }));
}

async function getTenantApps(namespace) {
  try {
    const resp = await customApi.listNamespacedCustomObject(
      "helm.toolkit.fluxcd.io",
      "v2",
      namespace,
      "helmreleases"
    );
    return resp.body.items.map((hr) => {
      const readyCondition = (hr.status?.conditions || []).find(
        (c) => c.type === "Ready"
      );
      return {
        name: hr.metadata.name,
        ready: readyCondition?.status === "True",
        image:
          hr.spec?.values?.app?.image?.repository || "",
        tag: hr.spec?.values?.app?.image?.tag || "",
        port: hr.spec?.values?.app?.port || 8080,
        replicas: hr.spec?.values?.app?.replicas || 2,
      };
    });
  } catch {
    return [];
  }
}

function generateHelmRelease({ name, team, image, tag, port, replicas, ingressHost }) {
  const hr = {
    apiVersion: "helm.toolkit.fluxcd.io/v2",
    kind: "HelmRelease",
    metadata: {
      name: name,
      namespace: team,
      labels: {
        "app.kubernetes.io/part-of": "sre-platform",
        "sre.io/team": team,
      },
    },
    spec: {
      interval: "10m",
      chart: {
        spec: {
          chart: "./apps/templates/web-app",
          reconcileStrategy: "Revision",
          sourceRef: {
            kind: "GitRepository",
            name: "flux-system",
            namespace: "flux-system",
          },
        },
      },
      install: {
        createNamespace: false,
        remediation: { retries: 3 },
      },
      upgrade: {
        cleanupOnFail: true,
        remediation: { retries: 3 },
      },
      values: {
        app: {
          name: name,
          team: team,
          image: { repository: image, tag: tag, pullPolicy: "IfNotPresent" },
          port: port,
          replicas: replicas,
          resources: {
            requests: { cpu: "50m", memory: "64Mi" },
            limits: { cpu: "200m", memory: "256Mi" },
          },
          probes: {
            liveness: { path: "/", initialDelaySeconds: 10, periodSeconds: 10 },
            readiness: { path: "/", initialDelaySeconds: 5, periodSeconds: 5 },
          },
          env: [],
        },
        ingress: {
          enabled: !!ingressHost,
          host: ingressHost || "",
        },
        autoscaling: { enabled: false },
        serviceMonitor: { enabled: false },
        networkPolicy: { enabled: true },
        podDisruptionBudget: { enabled: false },
      },
    },
  };
  return hr;
}

async function ensureNamespace(nsName, teamLabel) {
  try {
    await k8sApi.readNamespace(nsName);
  } catch (err) {
    if (err.statusCode === 404) {
      await k8sApi.createNamespace({
        metadata: {
          name: nsName,
          labels: {
            "app.kubernetes.io/part-of": "sre-platform",
            "sre.io/tenant": "true",
            "sre.io/team": teamLabel,
          },
        },
      });
      // Create default-deny NetworkPolicy
      const netApi = kc.makeApiClient(k8s.NetworkingV1Api);
      await netApi.createNamespacedNetworkPolicy(nsName, {
        metadata: { name: "default-deny-all", namespace: nsName },
        spec: {
          podSelector: {},
          policyTypes: ["Ingress", "Egress"],
        },
      }).catch(() => {});
      // Create allow-base NetworkPolicy (DNS + istio + monitoring + same namespace)
      await netApi.createNamespacedNetworkPolicy(nsName, {
        metadata: { name: "allow-base", namespace: nsName },
        spec: {
          podSelector: {},
          policyTypes: ["Ingress", "Egress"],
          ingress: [
            { from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": nsName } } }] },
            { from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "istio-system" } } }] },
            { from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "monitoring" } } }] },
          ],
          egress: [
            { to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } } }], ports: [{ port: 53, protocol: "UDP" }, { port: 53, protocol: "TCP" }] },
            { to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": nsName } } }] },
            { ports: [{ port: 443, protocol: "TCP" }, { port: 6443, protocol: "TCP" }] },
          ],
        },
      }).catch(() => {});
    } else {
      throw err;
    }
  }
}

async function applyManifest(manifest, namespace) {
  try {
    await customApi.createNamespacedCustomObject(
      "helm.toolkit.fluxcd.io",
      "v2",
      namespace,
      "helmreleases",
      manifest
    );
  } catch (err) {
    if (err.statusCode === 409) {
      // Already exists — patch it
      await customApi.patchNamespacedCustomObject(
        "helm.toolkit.fluxcd.io",
        "v2",
        namespace,
        "helmreleases",
        manifest.metadata.name,
        manifest,
        undefined,
        undefined,
        undefined,
        { headers: { "Content-Type": "application/merge-patch+json" } }
      );
    } else {
      throw err;
    }
  }
}

// ── Delete App ──────────────────────────────────────────────────────────────

app.delete("/api/apps/:namespace/:name", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    const { namespace, name } = req.params;

    // Step 1: Remove finalizers so the HelmRelease can be deleted even if
    // helm uninstall fails (prevents stuck Terminating state)
    try {
      await customApi.patchNamespacedCustomObject(
        "helm.toolkit.fluxcd.io",
        "v2",
        namespace,
        "helmreleases",
        name,
        { metadata: { finalizers: null } },
        undefined,
        undefined,
        undefined,
        { headers: { "Content-Type": "application/merge-patch+json" } }
      );
    } catch (e) {
      // Ignore if already gone
    }

    // Step 2: Delete the HelmRelease
    try {
      await customApi.deleteNamespacedCustomObject(
        "helm.toolkit.fluxcd.io",
        "v2",
        namespace,
        "helmreleases",
        name
      );
    } catch (e) {
      if (e.statusCode !== 404) throw e;
    }

    // Step 3: Clean up orphaned Helm release secrets
    try {
      const secrets = await k8sApi.listNamespacedSecret(
        namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        `owner=helm,name=${name}`
      );
      for (const s of secrets.body.items) {
        if (s.metadata.name.startsWith(`sh.helm.release.v1.${name}.`)) {
          await k8sApi.deleteNamespacedSecret(s.metadata.name, namespace);
        }
      }
    } catch (e) {
      // Non-critical — just orphaned secrets
    }

    // Step 4: Clean up any pods/deployments left behind
    try {
      const deps = await appsApi.listNamespacedDeployment(namespace);
      for (const d of deps.body.items) {
        if (d.metadata.name.startsWith(`${name}-`)) {
          await appsApi.deleteNamespacedDeployment(d.metadata.name, namespace);
        }
      }
    } catch (e) {
      // Non-critical
    }

    res.json({ ok: true, message: `Deleted ${name} from ${namespace}` });
  } catch (err) {
    console.error("Error deleting app:", err);
    res.status(err.statusCode || 500).json({ error: "Internal server error" });
  }
});

async function getCredentials() {
  const creds = {};

  // Grafana
  try {
    let secret = await k8sApi.readNamespacedSecret(
      "grafana-admin-credentials",
      "monitoring"
    );
    creds.grafana = {
      username: "admin",
      password: Buffer.from(
        secret.body.data.adminPassword,
        "base64"
      ).toString(),
    };
  } catch {
    try {
      let secret = await k8sApi.readNamespacedSecret(
        "kube-prometheus-stack-grafana",
        "monitoring"
      );
      creds.grafana = {
        username: "admin",
        password: Buffer.from(
          secret.body.data["admin-password"],
          "base64"
        ).toString(),
      };
    } catch {
      creds.grafana = { username: "admin", password: "(not found)" };
    }
  }

  // NeuVector
  creds.neuvector = {
    username: "admin",
    password: "admin (change on first login)",
  };

  // OpenBao
  try {
    const secret = await k8sApi.readNamespacedSecret(
      "openbao-init",
      "openbao"
    );
    creds.openbao = {
      token: Buffer.from(secret.body.data["root-token"], "base64").toString(),
    };
  } catch {
    creds.openbao = { token: "(not initialized)" };
  }

  // Harbor
  try {
    const secret = await k8sApi.readNamespacedSecret(
      "harbor-core-envvars",
      "harbor"
    );
    creds.harbor = {
      username: "admin",
      password: Buffer.from(
        secret.body.data.HARBOR_ADMIN_PASSWORD,
        "base64"
      ).toString(),
    };
  } catch {
    creds.harbor = { username: "admin", password: "Harbor12345" };
  }

  // Keycloak
  try {
    const secret = await k8sApi.readNamespacedSecret("keycloak", "keycloak");
    creds.keycloak = {
      username: "admin",
      password: Buffer.from(
        secret.body.data["admin-password"],
        "base64"
      ).toString(),
    };
  } catch {
    creds.keycloak = { username: "admin", password: "(not found)" };
  }

  return creds;
}

// ── Start Server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`SRE Dashboard running on http://0.0.0.0:${PORT}`);
});
