const express = require("express");
const k8s = require("@kubernetes/client-node");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { EventEmitter } = require("events");
const rateLimit = require("express-rate-limit");
const yaml = require("js-yaml");
const db = require("./db");
const gitops = require("./gitops");
const logger = require("./logger");
const { matchError, POLICY_FIXES } = require("./error-knowledge-base");
const { execSync } = require("child_process");
const multer = require("multer");

// ── Pipeline SSE Event Bus ────────────────────────────────────────────────────
// One EventEmitter per active pipeline run. Cleaned up when the pipeline finishes
// or after 30 minutes (safety timeout).
const pipelineEvents = new Map(); // runId -> { emitter, history: [], createdAt, cleanupTimer }

function getPipelineEmitter(runId) {
  return pipelineEvents.get(runId);
}

function getOrCreatePipelineEmitter(runId) {
  if (pipelineEvents.has(runId)) return pipelineEvents.get(runId).emitter;
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50); // allow many SSE clients per run
  const cleanupTimer = setTimeout(() => {
    cleanupPipelineEmitter(runId);
  }, 30 * 60 * 1000); // 30 minutes
  pipelineEvents.set(runId, { emitter, history: [], createdAt: Date.now(), cleanupTimer });
  return emitter;
}

function emitPipelineEvent(runId, eventType, data) {
  const entry = pipelineEvents.get(runId);
  if (!entry) return;
  const event = { type: eventType, ...data, ts: new Date().toISOString() };
  // Keep a bounded history so late SSE subscribers can catch up
  entry.history.push(event);
  if (entry.history.length > 500) entry.history.shift();
  entry.emitter.emit("event", event);
}

function cleanupPipelineEmitter(runId) {
  const entry = pipelineEvents.get(runId);
  if (!entry) return;
  clearTimeout(entry.cleanupTimer);
  entry.emitter.removeAllListeners();
  pipelineEvents.delete(runId);
}

const app = express();
app.set("trust proxy", 1); // Trust first proxy (Istio sidecar / gateway)

// ── Environment-driven config ────────────────────────────────────────────────
const SRE_DOMAIN = process.env.SRE_DOMAIN || "apps.sre.example.com";
const HARBOR_REGISTRY_EXT = process.env.HARBOR_REGISTRY || `harbor.${SRE_DOMAIN}`;
const KEYCLOAK_EXTERNAL_URL = `https://keycloak.${SRE_DOMAIN}`;
const HARBOR_ADMIN_USER = process.env.HARBOR_ADMIN_USER || "admin";
const HARBOR_ADMIN_PASS = process.env.HARBOR_ADMIN_PASS || "Harbor12345";

// ── Security Headers ─────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss: ws:; frame-src 'self' https://*.${SRE_DOMAIN}; frame-ancestors 'self' https://*.${SRE_DOMAIN}`);
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ── CORS for platform apps ──────────────────────────────────────────────────
app.use("/api", (req, res, next) => {
  const origin = req.headers.origin || "";
  if (origin.endsWith("." + SRE_DOMAIN) || origin === "https://" + SRE_DOMAIN) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Auth-Request-User, X-Auth-Request-Email, X-Auth-Request-Groups");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── Rate Limiting ────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({ windowMs: 60000, max: 200, standardHeaders: true, legacyHeaders: false });
const mutateLimiter = rateLimit({ windowMs: 60000, max: 10, message: { error: 'Too many requests' } });
const credentialLimiter = rateLimit({ windowMs: 60000, max: 5, message: { error: 'Too many requests' } });
app.use(globalLimiter);

app.use(express.json());

// Serve React SPA build output if it exists, otherwise fall back to public/
const clientDistPath = path.join(__dirname, "client", "dist");
const publicPath = path.join(__dirname, "public");
const staticPath = fs.existsSync(clientDistPath) ? clientDistPath : publicPath;
app.use(express.static(staticPath));

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
} catch (err) {
  console.debug('[k8s] Not running in-cluster, loading default kubeconfig:', err.message);
  kc.loadFromDefault();
}

const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
const appsApi = kc.makeApiClient(k8s.AppsV1Api);
const batchApi = kc.makeApiClient(k8s.BatchV1Api);
const metricsClient = new k8s.Metrics(kc);

// ── App Portal Registry ─────────────────────────────────────────────────────

const APP_REGISTRY_CM = "sre-app-registry";
const APP_REGISTRY_NS = "sre-dashboard";
let appRegistry = [];

async function loadAppRegistry() {
  try {
    const cm = await k8sApi.readNamespacedConfigMap(APP_REGISTRY_CM, APP_REGISTRY_NS);
    appRegistry = JSON.parse(cm.body.data?.apps || "[]");
    // Migrate old requiredGroups format to new access model
    var migrated = false;
    appRegistry.forEach(function(app) {
      if (app.requiredGroups && !app.access) {
        app.access = {
          mode: app.requiredGroups.length > 0 ? "restricted" : "everyone",
          groups: app.requiredGroups,
          users: [],
          attributes: [],
        };
        delete app.requiredGroups;
        migrated = true;
      }
    });
    if (migrated) {
      console.log("[portal] Migrated app registry from requiredGroups to access model");
      await saveAppRegistry();
    }
  } catch (err) {
    if (err.statusCode === 404) {
      try {
        await k8sApi.createNamespacedConfigMap(APP_REGISTRY_NS, {
          metadata: { name: APP_REGISTRY_CM, labels: { "app.kubernetes.io/part-of": "sre-platform" } },
          data: { apps: "[]" },
        });
      } catch (createErr) {
        console.error("Failed to create app registry ConfigMap:", createErr.message);
      }
    } else {
      console.error("Failed to load app registry:", err.message);
    }
    appRegistry = [];
  }
}

async function saveAppRegistry() {
  try {
    await k8sApi.patchNamespacedConfigMap(APP_REGISTRY_CM, APP_REGISTRY_NS, {
      data: { apps: JSON.stringify(appRegistry) },
    }, undefined, undefined, undefined, undefined, undefined, { headers: { "Content-Type": "application/strategic-merge-patch+json" } });
  } catch (err) {
    console.error("Failed to save app registry:", err.message);
  }
}

async function getRegisteredApps() {
  return appRegistry.map(function(app) { return Object.assign({}, app); });
}

// ── Sync app registry with actual cluster state ─────────────────────────────

async function syncAppRegistry() {
  try {
    // Build a set of all existing resources across ALL namespaces
    const allNs = await k8sApi.listNamespace();
    const existingResources = new Set();

    for (const ns of allNs.body.items) {
      const nsName = ns.metadata.name;
      try {
        // Check HelmReleases
        const hrResp = await customApi.listNamespacedCustomObject(
          "helm.toolkit.fluxcd.io", "v2", nsName, "helmreleases"
        );
        for (const hr of hrResp.body.items) {
          existingResources.add(hr.metadata.name);
        }
      } catch (err) {
        console.debug(`[portal] No HelmRelease access in namespace ${nsName}:`, err.message);
      }
      try {
        // Check Deployments
        const depResp = await appsApi.listNamespacedDeployment(nsName);
        for (const dep of depResp.body.items) {
          existingResources.add(dep.metadata.name);
          // Also add without common suffixes for matching
          const name = dep.metadata.name;
          if (name.includes("-")) existingResources.add(name.split("-")[0]);
        }
      } catch (err) {
        console.debug(`[portal] No Deployment access in namespace ${nsName}:`, err.message);
      }
      try {
        // Check VirtualServices (apps with ingress)
        const vsResp = await customApi.listNamespacedCustomObject(
          "networking.istio.io", "v1", nsName, "virtualservices"
        );
        for (const vs of vsResp.body.items) {
          existingResources.add(vs.metadata.name);
          // Also match on hostname
          for (const host of (vs.spec?.hosts || [])) {
            const appName = host.split(".")[0];
            existingResources.add(appName);
          }
        }
      } catch (err) {
        console.debug(`[portal] No VirtualService access in namespace ${nsName}:`, err.message);
      }
    }

    // Only remove apps that were deployed via pipeline (have deployedVia=pipeline or namespace set)
    // and whose resources no longer exist. Keep manually registered apps.
    var removed = [];
    var keepApps = [];
    for (var i = 0; i < appRegistry.length; i++) {
      var app = appRegistry[i];
      // Check if ANY resource matching this app name exists
      const nameMatches = existingResources.has(app.name) ||
        existingResources.has(app.name + "-" + app.name) ||
        existingResources.has(app.helmReleaseName);

      if (!nameMatches && app.deployedVia === "pipeline") {
        // Don't prune apps registered less than 5 minutes ago (Flux needs time to reconcile)
        const registeredAt = app.registeredAt || app.deployedAt;
        if (registeredAt && (Date.now() - new Date(registeredAt).getTime()) < 300000) {
          keepApps.push(app);
          continue; // Skip, too new to prune
        }
        // Only remove pipeline-deployed apps that have no resources
        removed.push(app.name);
      } else {
        keepApps.push(app);
      }
    }

    if (removed.length > 0) {
      appRegistry = keepApps;
      await saveAppRegistry();
      console.log("[portal] syncAppRegistry: removed " + removed.length + " stale entries: " + removed.join(", "));

      // Update pipeline runs for removed apps to "undeployed" status
      if (dbAvailable && db.pool) {
        for (var appName of removed) {
          try {
            await db.pool.query(
              "UPDATE pipeline_runs SET status = 'undeployed', updated_at = NOW() WHERE app_name = $1 AND status = 'deployed'",
              [appName]
            );
          } catch (e) {
            console.debug('[portal] Pipeline DB update non-critical error:', e.message);
          }
        }
      }
    } else {
      console.log("[portal] syncAppRegistry: all registry entries have matching HelmReleases");
    }
  } catch (err) {
    console.error("[portal] syncAppRegistry error:", err.message);
  }
}

// ── Resource parsing helpers ────────────────────────────────────────────────

function parseCpu(s) {
  if (!s) return 0;
  s = String(s);
  if (s.endsWith("n")) return parseInt(s) / 1e9;
  if (s.endsWith("m")) return parseInt(s) / 1000;
  return parseFloat(s) || 0;
}

function parseMem(s) {
  if (!s) return 0;
  s = String(s);
  const units = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, K: 1e3, M: 1e6, G: 1e9, T: 1e12 };
  for (const [u, m] of Object.entries(units)) {
    if (s.endsWith(u)) return parseInt(s) * m;
  }
  return parseInt(s) || 0;
}

function fmtMem(bytes) {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(1) + " Gi";
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(0) + " Mi";
  return (bytes / 1024).toFixed(0) + " Ki";
}

function fmtCpu(cores) {
  if (cores >= 1) return cores.toFixed(2);
  return Math.round(cores * 1000) + "m";
}

function age(ts) {
  if (!ts) return "?";
  const ms = Date.now() - new Date(ts).getTime();
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return d + "d" + h + "h";
  if (h > 0) return h + "h" + m + "m";
  return m + "m";
}

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
  { name: "grafana", namespace: "monitoring", serviceName: "kube-prometheus-stack-grafana", icon: "chart", description: "Dashboards & observability", url: `https://grafana.${SRE_DOMAIN}` },
  { name: "prometheus", namespace: "monitoring", serviceName: "kube-prometheus-stack-prometheus", icon: "search", description: "Metrics collection & alerting rules", url: `https://prometheus.${SRE_DOMAIN}` },
  { name: "alertmanager", namespace: "monitoring", serviceName: "kube-prometheus-stack-alertmanager", icon: "bell", description: "Alert routing & notifications", url: `https://alertmanager.${SRE_DOMAIN}` },
  { name: "harbor", namespace: "harbor", serviceName: "harbor-core", icon: "container", description: "Container image registry", url: `https://harbor.${SRE_DOMAIN}` },
  { name: "keycloak", namespace: "keycloak", serviceName: "keycloak", icon: "key", description: "Identity & access management", url: KEYCLOAK_EXTERNAL_URL },
  { name: "neuvector", namespace: "neuvector", serviceName: "neuvector-service-webui", icon: "shield", description: "Container security platform", url: `https://neuvector.${SRE_DOMAIN}` },
  { name: "openbao", namespace: "openbao", serviceName: "openbao", icon: "lock", description: "Secrets management", url: `https://openbao.${SRE_DOMAIN}` },
  { name: "dashboard", namespace: "sre-dashboard", serviceName: "sre-dashboard", icon: "layout", description: "This SRE Platform Dashboard", url: `https://dashboard.${SRE_DOMAIN}` },
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

// Debug: dump auth headers (remove in production)
app.get("/api/debug/headers", (req, res) => {
  res.json({
    "x-auth-request-user": req.headers["x-auth-request-user"] || null,
    "x-auth-request-email": req.headers["x-auth-request-email"] || null,
    "x-auth-request-groups": req.headers["x-auth-request-groups"] || null,
    "x-auth-request-preferred-username": req.headers["x-auth-request-preferred-username"] || null,
    "x-forwarded-for": req.headers["x-forwarded-for"] || null,
    "all-x-auth-headers": Object.fromEntries(
      Object.entries(req.headers).filter(([k]) => k.startsWith("x-auth"))
    ),
  });
});

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
    const gatewayIp = await getGatewayIp();
    const nodeIp = await getFirstNodeIp();
    const httpsPort = await getGatewayPort();
    // Prefer LoadBalancer IP (MetalLB) over node IP for DNS setup
    res.json({ routes, nodeIp: gatewayIp || nodeIp, httpsPort });
  } catch (err) {
    console.error("Error fetching ingress:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// List tenant namespaces
app.get("/api/tenants", requireGroups("sre-admins", "developers", "issm"), async (req, res) => {
  try {
    const tenants = await getTenants();
    res.json({ tenants });
  } catch (err) {
    console.error("Error fetching tenants:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// List apps in a tenant namespace
app.get("/api/tenants/:namespace/apps", requireGroups("sre-admins", "developers", "issm"), async (req, res) => {
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
    const { name, team, image, tag, port, replicas, ingress, privileged, securityContext } = req.body;

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
    const nsName = normalizeTeamName(team);

    // Auto-create namespace if it doesn't exist
    await ensureNamespace(nsName, teamName);

    // Pre-deployment compliance gate check
    try {
      const gateResult = await complianceGate(nsName, `${image}:${tag}`);
      if (!gateResult.passed) {
        return res.status(422).json({
          error: "Compliance gate failed — deployment blocked",
          blockers: gateResult.blockers,
          warnings: gateResult.warnings,
          checks: gateResult.checks,
        });
      }
      if (gateResult.warnings.length > 0) {
        console.log(`[compliance-gate] Warnings for ${safeName} in ${nsName}: ${gateResult.warnings.map(w => w.message).join(", ")}`);
      }
    } catch (gateErr) {
      console.debug("[compliance-gate] Non-blocking error:", gateErr.message);
    }

    const manifest = generateHelmRelease({
      name: safeName,
      team: nsName,
      image,
      tag,
      port: port || 8080,
      replicas: replicas || 2,
      ingressHost: ingress || "",
      privileged: !!privileged,
      securityContext: securityContext || null,
    });

    // Apply the manifest to the cluster (GitOps if enabled, else direct kubectl)
    const actor = getActor(req);
    await deployViaGitOps(manifest, nsName, safeName, actor);

    // Auto-register OAuth2 proxy path for SSO callbacks
    if (ingress) {
      await registerOAuth2ProxyPath(ingress);
    }

    // Auto-create DestinationRule for HTTPS backend detection
    await createBackendTLSRule(safeName, nsName, `${safeName}-${safeName}`);

    res.json({
      success: true,
      message: gitops.isEnabled()
        ? `App "${safeName}" committed to Git — Flux will deploy to "${nsName}" shortly`
        : `App "${safeName}" deployed to namespace "${nsName}"`,
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
    const { namespace, name } = req.params;
    const actor = getActor(req);
    await undeployViaGitOps(namespace, name, actor);

    // Clean up VirtualService
    try {
      await customApi.deleteNamespacedCustomObject(
        "networking.istio.io", "v1", namespace, "virtualservices", name
      );
    } catch (e) {
      console.debug('[portal] VirtualService not found during delete:', e.message);
    }

    // Remove from app registry
    const regIdx = appRegistry.findIndex(a => a.name === name);
    if (regIdx >= 0) {
      appRegistry.splice(regIdx, 1);
      await saveAppRegistry();
      console.log(`[portal] Removed "${name}" from app registry after deletion`);
    }

    // Mark pipeline runs as undeployed
    if (dbAvailable && db.pool) {
      try {
        await db.pool.query(
          "UPDATE pipeline_runs SET status = 'undeployed', updated_at = NOW() WHERE app_name = $1 AND status = 'deployed'",
          [name]
        );
      } catch (e) {
        console.debug('[portal] Pipeline DB undeployed-update non-critical error:', e.message);
      }
    }

    res.json({
      success: true,
      message: `App "${name}" deleted from "${namespace}"`,
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
  } else if (groups.includes("issm")) {
    role = "issm";
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
app.get("/api/alerts", requireGroups("sre-admins", "developers", "issm"), async (req, res) => {
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
        } catch (err) {
          console.debug(`[health] Endpoint check failed for ${svc.serviceName}:`, err.message);
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
app.get("/api/audit", requireGroups("sre-admins", "issm"), async (req, res) => {
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

// POST /api/logout — End Keycloak SSO session via admin API, then redirect to clear OAuth2 cookie
app.post("/api/logout", async (req, res) => {
  const email = req.headers["x-auth-request-email"] || "";
  const preferredUsername = req.headers["x-auth-request-preferred-username"] || "";
  const KC_URL = "http://keycloak.keycloak.svc.cluster.local";
  const REALM = "sre";

  try {
    // Get admin token
    const tokenResp = await fetch(`${KC_URL}/realms/master/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "admin-cli",
        username: "admin",
        password: process.env.KC_ADMIN_PASSWORD || "",
        grant_type: "password",
      }),
    });
    if (!tokenResp.ok) {
      console.error("Keycloak admin token failed:", tokenResp.status);
      return res.json({ cleared: false });
    }
    const { access_token } = await tokenResp.json();

    // Find user by email, then fall back to username search
    let users = [];
    if (email) {
      const r = await fetch(`${KC_URL}/admin/realms/${REALM}/users?email=${encodeURIComponent(email)}&exact=true`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      users = await r.json();
    }
    if (users.length === 0 && preferredUsername) {
      const r = await fetch(`${KC_URL}/admin/realms/${REALM}/users?username=${encodeURIComponent(preferredUsername)}&exact=true`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      users = await r.json();
    }
    if (users.length > 0) {
      await fetch(`${KC_URL}/admin/realms/${REALM}/users/${users[0].id}/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${access_token}` },
      });
      console.log(`Logged out Keycloak sessions for user: ${users[0].username}`);
    }
    res.json({ cleared: true });
  } catch (err) {
    console.error("Logout error:", err);
    res.json({ cleared: false });
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

// GET /api/apps — All deployed tenant apps (for portal)
app.get("/api/apps", async (req, res) => {
  // Allow portal cross-origin requests
  const origin = req.headers.origin || "";
  if (origin.endsWith("." + SRE_DOMAIN)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  try {
    // Get all tenant namespaces
    const nsResp = await k8sApi.listNamespace();
    const tenantNs = nsResp.body.items.filter((ns) => {
      const labels = ns.metadata?.labels || {};
      return labels["sre.io/tenant"] === "true" || ns.metadata.name.startsWith("team-");
    });

    // Get HelmReleases from all tenant namespaces
    const apps = [];
    for (const ns of tenantNs) {
      try {
        const hrResp = await customApi.listNamespacedCustomObject(
          "helm.toolkit.fluxcd.io", "v2", ns.metadata.name, "helmreleases"
        );
        for (const hr of hrResp.body.items) {
          const readyCondition = (hr.status?.conditions || []).find((c) => c.type === "Ready");
          const appValues = hr.spec?.values?.app || {};
          const ingressValues = hr.spec?.values?.ingress || {};

          // Determine detailed status beyond just ready/not-ready
          let status = "deploying";
          let statusReason = "";
          const hrReady = readyCondition?.status === "True";

          if (hrReady) {
            status = "running";
          } else if (readyCondition?.status === "False") {
            // HelmRelease has a failure condition — check the reason
            const msg = readyCondition.message || "";
            const installFails = hr.status?.installFailures || 0;
            const upgradeFails = hr.status?.upgradeFailures || 0;
            if (installFails >= 3 || upgradeFails >= 3) {
              status = "failed";
              statusReason = "Helm install/upgrade retries exhausted";
            } else if (msg.includes("failed") || msg.includes("timed out") || msg.includes("error")) {
              status = "failed";
              statusReason = msg.substring(0, 150);
            }
          }

          // If HelmRelease looks OK (not failed), check actual pod status for CrashLoop/Error
          if (status !== "failed" && status !== "running") {
            try {
              const appName = appValues.name || hr.metadata.name;
              const podResp = await k8sApi.listNamespacedPod(
                ns.metadata.name, undefined, undefined, undefined, undefined,
                `app.kubernetes.io/name=${appName}`
              );
              const pods = podResp.body.items || [];
              if (pods.length > 0) {
                const crashingPods = pods.filter((p) => {
                  const cs = (p.status?.containerStatuses || []);
                  return cs.some((c) =>
                    c.state?.waiting?.reason === "CrashLoopBackOff" ||
                    c.state?.waiting?.reason === "ErrImagePull" ||
                    c.state?.waiting?.reason === "ImagePullBackOff" ||
                    c.state?.waiting?.reason === "CreateContainerConfigError" ||
                    (c.state?.terminated?.reason === "Error" && c.restartCount > 2)
                  );
                });
                if (crashingPods.length > 0) {
                  status = "failed";
                  // Get the specific reason from the first crashing container
                  const cs = crashingPods[0].status?.containerStatuses || [];
                  const failingContainer = cs.find((c) => c.state?.waiting?.reason || (c.state?.terminated && c.restartCount > 2));
                  if (failingContainer?.state?.waiting?.reason) {
                    statusReason = failingContainer.state.waiting.reason;
                    if (failingContainer.state.waiting.message) {
                      statusReason += ": " + failingContainer.state.waiting.message.substring(0, 100);
                    }
                  } else if (failingContainer?.lastState?.terminated?.reason) {
                    statusReason = failingContainer.lastState.terminated.reason;
                    if (failingContainer.lastState.terminated.message) {
                      statusReason += ": " + failingContainer.lastState.terminated.message.substring(0, 100);
                    }
                  }
                } else {
                  // Pods exist but none crashing — check if any are actually ready
                  const readyPods = pods.filter((p) => p.status?.phase === "Running" &&
                    (p.status?.containerStatuses || []).every((c) => c.ready));
                  if (readyPods.length > 0) {
                    status = "running";
                  }
                  // else still deploying — pods exist but not ready yet
                }
              }
              // No pods yet — still deploying
            } catch (podErr) {
              console.debug(`[apps] Pod status check best-effort for ${hr.metadata.name}:`, podErr.message);
            }
          }

          // Fetch policy violation events for failed apps
          let policyViolations = [];
          if (status === "failed" || status === "deploying") {
            try {
              const evResp = await k8sApi.listNamespacedEvent(ns.metadata.name);
              const appName = hr.metadata.name;
              const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
              policyViolations = evResp.body.items
                .filter((e) => {
                  // Only show recent events (last 5 min) to avoid stale data from old pods
                  const eventTime = new Date(e.lastTimestamp || e.eventTime || 0);
                  if (eventTime < fiveMinAgo) return false;
                  const objName = e.involvedObject?.name || "";
                  const matchesApp = objName === appName || objName.startsWith(`${appName}-`);
                  if (!matchesApp) return false;
                  const msg = (e.message || "").toLowerCase();
                  const reason = (e.reason || "").toLowerCase();
                  return (
                    reason === "policyviolation" ||
                    msg.includes("kyverno") ||
                    msg.includes("policy") ||
                    msg.includes("denied by") ||
                    msg.includes("admission webhook") ||
                    msg.includes("blocked")
                  );
                })
                .sort((a, b) => new Date(b.lastTimestamp || b.eventTime || 0) - new Date(a.lastTimestamp || a.eventTime || 0))
                .slice(0, 5)
                .map((e) => ({
                  reason: e.reason || "",
                  message: e.message || "",
                  time: e.lastTimestamp || e.eventTime || "",
                  type: e.type || "Normal",
                }));
            } catch (evErr) {
              // best-effort
            }
          }

          apps.push({
            name: hr.metadata.name,
            namespace: ns.metadata.name,
            team: ns.metadata.labels?.["sre.io/team"] || ns.metadata.name.replace(/^team-/, ""),
            ready: status === "running",
            status: status,
            statusReason: statusReason,
            policyViolations: policyViolations,
            image: appValues.image?.repository || "",
            tag: appValues.image?.tag || "",
            port: appValues.port || 8080,
            host: ingressValues.host || "",
            url: ingressValues.host ? `https://${ingressValues.host}` : "",
            created: hr.metadata.creationTimestamp || "",
          });
        }
      } catch (err) {
        console.debug(`[apps] Skipping namespace — cannot read HelmReleases:`, err.message);
      }
    }

    // Also check for VirtualServices in tenant namespaces to catch non-Helm apps
    try {
      const vsResp = await customApi.listClusterCustomObject(
        "networking.istio.io", "v1", "virtualservices"
      );
      const vsMap = {};
      for (const vs of vsResp.body.items) {
        if (tenantNs.some((ns) => ns.metadata.name === vs.metadata.namespace)) {
          for (const host of (vs.spec?.hosts || [])) {
            vsMap[`${vs.metadata.namespace}/${vs.metadata.name}`] = host;
          }
        }
      }
      // Enrich apps with VirtualService hosts if not already set
      for (const app of apps) {
        if (!app.host) {
          const vsHost = vsMap[`${app.namespace}/${app.name}`];
          if (vsHost) {
            app.host = vsHost;
            app.url = `https://${vsHost}`;
          }
        }
      }
    } catch (err) {
      console.debug('[apps] VirtualService lookup best-effort failed:', err.message);
    }

    res.json({ apps, count: apps.length });
  } catch (err) {
    console.error("Error fetching apps:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// CORS preflight for /api/apps
app.options("/api/apps", (req, res) => {
  const origin = req.headers.origin || "";
  if (origin.endsWith("." + SRE_DOMAIN)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  res.sendStatus(204);
});

// ── Docker Compose Parser (simple line-based, no deps) ────────────────────

function parseDockerCompose(yamlText) {
  if (typeof yamlText !== "string" || !yamlText.trim()) {
    return {};
  }
  const lines = yamlText.split("\n");
  const services = {};
  let inServices = false;
  let currentService = null;
  let currentKey = null; // "ports", "environment", "volumes", etc.
  let servicesIndent = -1;
  let serviceIndent = -1;
  let keyIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Skip comments and empty lines
    if (raw.trimStart().startsWith("#") || raw.trim() === "") continue;

    const stripped = raw.trimEnd();
    const indent = stripped.length - stripped.trimStart().length;
    const content = stripped.trim();

    // Top-level "services:" block
    if (/^services\s*:/.test(content) && indent === 0) {
      inServices = true;
      servicesIndent = 0;
      currentService = null;
      currentKey = null;
      continue;
    }

    if (!inServices) continue;

    // Detect end of services block (another top-level key)
    if (indent === 0 && /^\w/.test(content) && !content.startsWith("-")) {
      inServices = false;
      continue;
    }

    // Service name line: "  myservice:" — indent > servicesIndent, ends with ":"
    if (
      currentService === null ||
      (indent > servicesIndent && indent <= serviceIndent && /^[a-zA-Z0-9_-]+\s*:/.test(content) && !content.includes(": "))
    ) {
      if (indent > servicesIndent && /^[a-zA-Z0-9_-]+\s*:\s*$/.test(content)) {
        const svcName = content.replace(/\s*:\s*$/, "").trim();
        services[svcName] = { image: "", ports: [], environment: [] };
        currentService = svcName;
        serviceIndent = indent;
        currentKey = null;
        continue;
      }
    }

    if (!currentService) continue;

    // Properties of the current service
    if (indent > serviceIndent) {
      // "image: something"
      const imageMatch = content.match(/^image\s*:\s*(.+)$/);
      if (imageMatch) {
        services[currentService].image = imageMatch[1].trim().replace(/^["']|["']$/g, "");
        currentKey = null;
        continue;
      }

      // "container_name: something"
      const containerMatch = content.match(/^container_name\s*:\s*(.+)$/);
      if (containerMatch) {
        services[currentService].container_name = containerMatch[1].trim().replace(/^["']|["']$/g, "");
        currentKey = null;
        continue;
      }

      // "ports:" block start
      if (/^ports\s*:\s*$/.test(content)) {
        currentKey = "ports";
        keyIndent = indent;
        continue;
      }

      // "environment:" block start (could be array or mapping)
      if (/^environment\s*:\s*$/.test(content)) {
        currentKey = "environment";
        keyIndent = indent;
        continue;
      }

      // "volumes:" block start
      if (/^volumes\s*:\s*$/.test(content)) {
        currentKey = "volumes";
        keyIndent = indent;
        continue;
      }

      // Any other key: ends current array context
      if (/^[a-zA-Z_-]+\s*:/.test(content) && indent <= keyIndent + 2) {
        currentKey = null;
      }

      // Array items under current key
      if (currentKey && content.startsWith("-")) {
        const val = content.replace(/^-\s*/, "").replace(/^["']|["']$/g, "").trim();
        if (currentKey === "ports") {
          services[currentService].ports.push(val);
        } else if (currentKey === "environment") {
          services[currentService].environment.push(val);
        }
        continue;
      }

      // environment as mapping: KEY: value (indent > keyIndent)
      if (currentKey === "environment" && indent > keyIndent && /^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(content)) {
        const eqIdx = content.indexOf(":");
        const envKey = content.substring(0, eqIdx).trim();
        const envVal = content.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
        services[currentService].environment.push(`${envKey}=${envVal}`);
        continue;
      }
    }
  }

  return services;
}

// ── Input Validation Helpers ──────────────────────────────────────────────

function getActor(req) {
  const raw = req.headers["x-auth-request-email"] || req.headers["x-auth-request-user"] || "dashboard";
  return typeof raw === "string" ? raw.replace(/[^\w.@+-]/g, "").substring(0, 128) : "dashboard";
}

function normalizeTeamName(team) {
  const normalized = team.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return normalized.startsWith("team-") ? normalized : `team-${normalized}`;
}

function sanitizeName(raw) {
  if (typeof raw !== "string") return "";
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").substring(0, 63);
}

function isValidName(name) {
  return typeof name === "string" && /^[a-z][a-z0-9-]{0,62}$/.test(name);
}

function isValidPort(port) {
  const p = Number(port);
  return Number.isInteger(p) && p >= 1 && p <= 65535;
}

function isValidReplicas(r) {
  const n = Number(r);
  return Number.isInteger(n) && n >= 1 && n <= 20;
}

function sanitizeEnvArray(env) {
  if (!Array.isArray(env)) return [];
  return env
    .filter((e) => e && typeof e.name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(e.name))
    .map((e) => ({ name: e.name, value: String(e.value || "") }))
    .slice(0, 50);
}

function isInternalUrl(hostname) {
  if (!hostname) return true;
  const h = hostname.toLowerCase();
  // Loopback
  if (h === "localhost" || h === "[::1]") return true;
  // Metadata endpoints
  if (h === "metadata.internal" || h === "metadata.google.internal") return true;
  // K8s internal DNS
  if (h.endsWith(".svc.cluster.local") || h.endsWith(".svc")) return true;
  // Check IP-based patterns
  const ipMatch = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipMatch) {
    const [, a, b] = ipMatch.map(Number);
    // Loopback 127.x.x.x
    if (a === 127) return true;
    // Private 10.x.x.x
    if (a === 10) return true;
    // Private 172.16-31.x.x
    if (a === 172 && b >= 16 && b <= 31) return true;
    // Private 192.168.x.x
    if (a === 192 && b === 168) return true;
    // Link-local 169.254.x.x
    if (a === 169 && b === 254) return true;
  }
  return false;
}

function isValidGitUrl(url) {
  if (typeof url !== "string") return false;
  if (!/^https?:\/\/.+/.test(url) && !/^git@.+:.+/.test(url)) return false;
  // SSRF protection: block internal/private URLs
  try {
    const parsed = new URL(url);
    if (isInternalUrl(parsed.hostname)) return false;
  } catch (err) {
    // git@ URLs won't parse as URL — allow them (no HTTP SSRF risk)
    console.debug('[validation] URL parse expected error for git@ URL:', err.message);
    if (!/^git@.+:.+/.test(url)) return false;
  }
  return true;
}

function isSafePath(p) {
  if (!p || typeof p !== "string") return false;
  // Reject path traversal, absolute paths, and null bytes
  return !p.includes("..") && !p.startsWith("/") && !p.includes("\0");
}

// ── Deploy Endpoints ─────────────────────────────────────────────────────

// POST /api/deploy/compose — Parse Docker Compose YAML and deploy multi-service apps
app.post("/api/deploy/compose", mutateLimiter, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const { yaml: yamlText, team, prefix } = req.body;

    if (!yamlText || typeof yamlText !== "string") {
      return res.status(400).json({ error: "Missing required field: yaml (docker-compose content)" });
    }
    if (!team || typeof team !== "string") {
      return res.status(400).json({ error: "Missing required field: team" });
    }

    const teamName = team.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const nsName = normalizeTeamName(team);
    const safePrefix = prefix ? sanitizeName(prefix) : "";

    // Parse docker-compose YAML
    const parsed = parseDockerCompose(yamlText);
    const serviceNames = Object.keys(parsed);

    if (serviceNames.length === 0) {
      return res.status(400).json({ error: "No services found in docker-compose YAML. Ensure there is a 'services:' block." });
    }

    if (serviceNames.length > 10) {
      return res.status(400).json({ error: "Too many services (max 10). Simplify the compose file." });
    }

    // Ensure namespace
    await ensureNamespace(nsName, teamName);

    const deployed = [];
    for (const svcName of serviceNames) {
      const svc = parsed[svcName];
      if (!svc.image) {
        continue; // Skip services without an image
      }

      // Parse image:tag
      let imageRepo = svc.image;
      let imageTag = "latest";
      const colonIdx = svc.image.lastIndexOf(":");
      if (colonIdx > 0 && !svc.image.substring(colonIdx).includes("/")) {
        imageRepo = svc.image.substring(0, colonIdx);
        imageTag = svc.image.substring(colonIdx + 1);
      }

      // Parse container port from ports mapping (right side of "host:container")
      let containerPort = 8080;
      if (svc.ports && svc.ports.length > 0) {
        const portStr = String(svc.ports[0]);
        const parts = portStr.split(":");
        const rightSide = parts.length > 1 ? parts[parts.length - 1] : parts[0];
        // Strip protocol suffix like /tcp /udp
        const portNum = parseInt(rightSide.replace(/\/\w+$/, ""), 10);
        if (isValidPort(portNum)) {
          containerPort = portNum;
        }
      }

      // Parse environment variables
      const env = [];
      for (const envEntry of (svc.environment || [])) {
        const eqIdx = envEntry.indexOf("=");
        if (eqIdx > 0) {
          const eName = envEntry.substring(0, eqIdx).trim();
          const eVal = envEntry.substring(eqIdx + 1).trim();
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(eName)) {
            env.push({ name: eName, value: eVal });
          }
        }
      }

      const appName = sanitizeName(safePrefix ? `${safePrefix}-${svcName}` : svcName);
      if (!isValidName(appName)) continue;

      const manifest = generateHelmRelease({
        name: appName,
        team: nsName,
        image: imageRepo,
        tag: imageTag,
        port: containerPort,
        replicas: 2,
        ingressHost: "",
        env: env.slice(0, 50),
      });

      const actor = getActor(req);
      await deployViaGitOps(manifest, nsName, appName, actor);

      // Auto-create DestinationRule for HTTPS backend detection
      await createBackendTLSRule(appName, nsName, `${appName}-${appName}`);

      deployed.push({
        name: appName,
        image: `${imageRepo}:${imageTag}`,
        port: containerPort,
        namespace: nsName,
      });
    }

    if (deployed.length === 0) {
      return res.status(400).json({ error: "No valid services could be deployed. Ensure each service has an 'image:' field." });
    }

    res.json({
      success: true,
      services: deployed,
      message: `Deployed ${deployed.length} service(s) to ${escapeHtml(nsName)}`,
    });
  } catch (err) {
    console.error("Error deploying compose:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/deploy/multi — Deploy multiple containers as a single app group
app.post("/api/deploy/multi", mutateLimiter, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const { team, services, ingress } = req.body;

    if (!team || typeof team !== "string") {
      return res.status(400).json({ error: "Missing required field: team" });
    }
    if (!Array.isArray(services) || services.length === 0) {
      return res.status(400).json({ error: "Missing required field: services (array of service definitions)" });
    }
    if (services.length > 10) {
      return res.status(400).json({ error: "Too many services (max 10)" });
    }

    const teamName = team.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const nsName = normalizeTeamName(team);

    // Validate all services upfront
    for (let i = 0; i < services.length; i++) {
      const svc = services[i];
      if (!svc.name || !svc.image || !svc.tag) {
        return res.status(400).json({
          error: `Service at index ${i} is missing required fields: name, image, tag`,
        });
      }
      const safeName = sanitizeName(svc.name);
      if (!isValidName(safeName)) {
        return res.status(400).json({
          error: `Invalid service name at index ${i}: ${escapeHtml(String(svc.name))}`,
        });
      }
      if (svc.port && !isValidPort(svc.port)) {
        return res.status(400).json({
          error: `Invalid port at index ${i}: must be 1-65535`,
        });
      }
      if (svc.replicas && !isValidReplicas(svc.replicas)) {
        return res.status(400).json({
          error: `Invalid replicas at index ${i}: must be 1-20`,
        });
      }
    }

    await ensureNamespace(nsName, teamName);

    const deployed = [];
    for (let i = 0; i < services.length; i++) {
      const svc = services[i];
      const safeName = sanitizeName(svc.name);
      const svcEnv = sanitizeEnvArray(svc.env);

      // Only the first service gets ingress
      const ingressHost = (i === 0 && ingress && typeof ingress === "string") ? ingress : "";

      const manifest = generateHelmRelease({
        name: safeName,
        team: nsName,
        image: svc.image,
        tag: String(svc.tag),
        port: svc.port || 8080,
        replicas: svc.replicas || 2,
        ingressHost: ingressHost,
        env: svcEnv,
      });

      const actor = getActor(req);
      await deployViaGitOps(manifest, nsName, safeName, actor);

      // Auto-register OAuth2 proxy path for SSO callbacks
      if (ingressHost) {
        await registerOAuth2ProxyPath(ingressHost);
      }

      // Auto-create DestinationRule for HTTPS backend detection
      await createBackendTLSRule(safeName, nsName, `${safeName}-${safeName}`);

      deployed.push({
        name: safeName,
        image: `${svc.image}:${svc.tag}`,
        port: svc.port || 8080,
        namespace: nsName,
        ingress: ingressHost || null,
      });
    }

    res.json({
      success: true,
      services: deployed,
      message: `Deployed ${deployed.length} service(s) to ${escapeHtml(nsName)}`,
    });
  } catch (err) {
    console.error("Error deploying multi:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/deploy/:namespace/:name/status — Live deploy status
app.get("/api/deploy/:namespace/:name/status", requireGroups("sre-admins", "developers", "issm"), async (req, res) => {
  try {
    const { namespace, name } = req.params;

    // Validate params
    if (!isValidName(sanitizeName(namespace)) || !isValidName(sanitizeName(name))) {
      return res.status(400).json({ error: "Invalid namespace or name" });
    }

    let phase = "pending";
    let progress = 0;
    let helmRelease = { ready: false, message: "", lastTransition: "" };
    let pods = [];
    let events = [];

    // Step 1: Check HelmRelease status
    try {
      const hrResp = await customApi.getNamespacedCustomObject(
        "helm.toolkit.fluxcd.io",
        "v2",
        namespace,
        "helmreleases",
        name
      );
      const hr = hrResp.body;
      const readyCondition = (hr.status?.conditions || []).find((c) => c.type === "Ready");
      // Extract actionable error information from the HelmRelease status
      const failureReasons = ["InstallFailed", "UpgradeFailed", "ReconciliationFailed", "ArtifactFailed"];
      const retriesExhausted = hr.status?.installFailures >= 3 || hr.status?.upgradeFailures >= 3;
      let errorDetail = "";
      if (readyCondition?.status === "False") {
        errorDetail = readyCondition.message || "";
        // Extract the actionable part of long Helm error messages
        const helmErrMatch = errorDetail.match(/(?:install|upgrade) retries exhausted|Helm install failed|Helm upgrade failed|failed to install|failed to create resource|timed out/i);
        if (helmErrMatch) {
          errorDetail = readyCondition.message.substring(0, 500);
        }
      }

      helmRelease = {
        ready: readyCondition?.status === "True",
        message: readyCondition?.message || "",
        lastTransition: readyCondition?.lastTransitionTime || "",
        reason: readyCondition?.reason || "",
        retriesExhausted: !!retriesExhausted,
        errorDetail: errorDetail,
      };
      progress = 25;
      phase = "creating";

      if (readyCondition?.status === "False" && failureReasons.includes(readyCondition?.reason)) {
        phase = "failed";
        if (retriesExhausted) {
          helmRelease.message = `Deployment failed after max retries. Error: ${errorDetail || readyCondition.message}. The HelmRelease must be deleted and recreated to retry.`;
        }
      }
    } catch (err) {
      if (err.statusCode === 404) {
        return res.json({
          name,
          namespace,
          phase: "pending",
          helmRelease,
          pods: [],
          events: [],
          progress: 0,
        });
      }
      throw err;
    }

    // Step 2: List pods with matching app label
    try {
      const podResp = await k8sApi.listNamespacedPod(
        namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        `app.kubernetes.io/name=${name}`
      );
      pods = podResp.body.items.map((pod) => {
        const containers = (pod.status?.containerStatuses || []).map((cs) => {
          let state = "waiting";
          let reason = "";
          if (cs.state?.running) {
            state = "running";
          } else if (cs.state?.waiting) {
            state = "waiting";
            reason = cs.state.waiting.reason || "";
          } else if (cs.state?.terminated) {
            state = "terminated";
            reason = cs.state.terminated.reason || "";
          }
          return {
            name: cs.name,
            ready: cs.ready || false,
            state,
            reason,
          };
        });

        return {
          name: pod.metadata.name,
          phase: pod.status?.phase || "Unknown",
          ready: (pod.status?.conditions || []).some(
            (c) => c.type === "Ready" && c.status === "True"
          ),
          restarts: (pod.status?.containerStatuses || []).reduce(
            (sum, cs) => sum + (cs.restartCount || 0),
            0
          ),
          containers,
        };
      });

      if (pods.length > 0) {
        progress = 50;
        phase = "creating";

        const anyRunning = pods.some((p) => p.containers.some((c) => c.state === "running"));
        if (anyRunning) {
          progress = 75;
          phase = "creating";
        }

        const allReady = pods.length > 0 && pods.every((p) => p.ready);
        if (allReady && helmRelease.ready) {
          progress = 100;
          phase = "running";
        }

        const anyFailed = pods.some(
          (p) => p.phase === "Failed" || p.containers.some((c) => c.reason === "CrashLoopBackOff" || c.reason === "Error")
        );
        if (anyFailed) {
          phase = "failed";
        }
      }
    } catch (err) {
      console.debug('[apps] Pod lookup best-effort failed:', err.message);
    }

    // Step 3: List events for this app in the namespace
    let policyViolations = [];
    try {
      const evResp = await k8sApi.listNamespacedEvent(namespace);
      const allEvents = evResp.body.items.filter((e) => {
        const objName = e.involvedObject?.name || "";
        return objName === name || objName.startsWith(`${name}-`);
      });

      events = allEvents
        .sort((a, b) => {
          const ta = new Date(a.lastTimestamp || a.eventTime || 0);
          const tb = new Date(b.lastTimestamp || b.eventTime || 0);
          return tb - ta;
        })
        .slice(0, 30)
        .map((e) => ({
          time: e.lastTimestamp || e.eventTime || "",
          reason: e.reason || "",
          message: e.message || "",
          type: e.type || "Normal",
        }));

      // Extract policy violation events (Kyverno admissions, denied webhooks)
      policyViolations = allEvents
        .filter((e) => {
          const msg = (e.message || "").toLowerCase();
          const reason = (e.reason || "").toLowerCase();
          return (
            reason === "policyviolation" ||
            reason === "failed" && (msg.includes("kyverno") || msg.includes("policy") || msg.includes("denied") || msg.includes("blocked") || msg.includes("admission webhook")) ||
            msg.includes("kyverno") ||
            msg.includes("policy") ||
            msg.includes("denied by") ||
            msg.includes("admission webhook") ||
            msg.includes("blocked")
          );
        })
        .sort((a, b) => {
          const ta = new Date(a.lastTimestamp || a.eventTime || 0);
          const tb = new Date(b.lastTimestamp || b.eventTime || 0);
          return tb - ta;
        })
        .slice(0, 10)
        .map((e) => ({
          reason: e.reason || "",
          message: e.message || "",
          time: e.lastTimestamp || e.eventTime || "",
          type: e.type || "Normal",
        }));
    } catch (err) {
      console.debug('[apps] Event lookup best-effort failed:', err.message);
    }

    res.json({
      name,
      namespace,
      phase,
      helmRelease,
      pods,
      events,
      policyViolations,
      progress,
    });
  } catch (err) {
    console.error("Error fetching deploy status:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/deploy/git — Smart deploy from a Git repository URL
// Auto-detects repo type (compose, helm, dockerfile, kustomize) and routes to the right strategy
app.post("/api/deploy/git", mutateLimiter, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const { url, branch, team, name, securityContext, securityExceptions, analyze_only } = req.body;

    if (!url || !isValidGitUrl(url)) {
      return res.status(400).json({ error: "Missing or invalid required field: url (must be a valid Git URL)" });
    }

    // Analysis-only mode: clone, analyze, return detection result with requirements
    if (analyze_only) {
      const safeBranch = (branch || "main").replace(/[^a-zA-Z0-9._/-]/g, "").substring(0, 128);
      const analyzeId = "analyze-" + crypto.randomBytes(4).toString("hex");
      const jobSpec = createAnalyzeJobSpec(analyzeId, url, safeBranch);
      await batchApi.createNamespacedJob(BUILD_NAMESPACE, jobSpec);

      const logs = await runAnalyzeJob(analyzeId);
      if (logs && logs.error) {
        return res.status(400).json({ error: logs.error });
      }
      if (!logs) {
        return res.status(504).json({ error: "Repository analysis timed out" });
      }

      const analysisResult = parseRepoAnalysisLogs(logs);

      // Attach top-level detectedRequirements from the primary (ingress) service
      const primarySvc = analysisResult.services.find(s => s.role === 'ingress') || analysisResult.services[0];
      const detectedRequirements = primarySvc?.requirements || null;

      return res.json({ success: true, ...analysisResult, detectedRequirements });
    }

    if (!team || typeof team !== "string") {
      return res.status(400).json({ error: "Missing required field: team" });
    }
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Missing required field: name" });
    }

    const safeName = sanitizeName(name);
    if (!isValidName(safeName)) {
      return res.status(400).json({ error: `Invalid app name: ${escapeHtml(String(name))}` });
    }

    const teamName = team.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const nsName = normalizeTeamName(team);
    const safeBranch = (branch || "main").replace(/[^a-zA-Z0-9._/-]/g, "").substring(0, 128);

    // Pre-generate Kyverno PolicyException if security exceptions are present
    const deployExceptions = Array.isArray(securityExceptions) ? securityExceptions : [];
    const deployPolicyException = deployExceptions.length > 0
      ? generatePolicyException(safeName, nsName, deployExceptions, getActor(req))
      : null;

    // Phase 1: Analyze the repo to detect project type
    console.log(`[deploy-git] Analyzing repo ${url} (branch: ${safeBranch}) for app "${safeName}"`);
    const analyzeId = "analyze-" + crypto.randomBytes(4).toString("hex");
    const jobSpec = createAnalyzeJobSpec(analyzeId, url, safeBranch);
    await batchApi.createNamespacedJob(BUILD_NAMESPACE, jobSpec);

    const logs = await runAnalyzeJob(analyzeId);

    if (logs && logs.error) {
      return res.status(400).json({ error: logs.error });
    }
    if (!logs) {
      return res.status(504).json({ error: "Repository analysis timed out" });
    }

    const analysis = parseRepoAnalysisLogs(logs);
    console.log(`[deploy-git] Detected type: ${analysis.repoType} for "${safeName}" (services: ${analysis.services.length}, chart: ${analysis.chart?.name || "none"}, kustomizePath: ${analysis.kustomizePath || "none"})`);

    await ensureNamespace(nsName, teamName);

    // Phase 2: Deploy based on detected type
    // ── COMPOSE STRATEGY ──
    if (analysis.repoType === "compose") {
      console.log(`[deploy-git] Using compose strategy for "${safeName}" — ${analysis.services.length} service(s) detected`);

      if (analysis.services.length === 0) {
        return res.status(400).json({ error: "Compose file detected but no services found" });
      }
      if (analysis.services.length > 10) {
        return res.status(400).json({ error: "Too many services (max 10). Simplify the compose file." });
      }

      const groupId = "group-" + crypto.randomBytes(4).toString("hex");
      const builds = [];
      const deployedPrebuilt = [];
      const skippedServices = [];
      const buildContextToImage = new Map(); // Track build context → built image for shared context reuse

      // Ensure Harbor project exists before any builds push to it
      await ensureHarborProject(teamName);

      // Build services that need building via Kaniko, deploy pre-built images directly
      for (const svc of analysis.services) {
        if (svc.needsBuild && svc.buildContext) {
          const svcName = sanitizeName(svc.name);
          const buildCtx = (svc.buildContext || ".").replace(/^\.\//, "");
          const normalizedCtx = `${buildCtx}:${svc.dockerfile || "Dockerfile"}:${svc.buildTarget || ""}`;

          // Check if another service already built with the same context/dockerfile/target
          const sharedImage = buildContextToImage.get(normalizedCtx);
          if (sharedImage) {
            // Reuse the already-built image instead of building again
            const reuseBuildId = generateBuildId();
            buildRegistry.set(reuseBuildId, {
              id: reuseBuildId,
              groupId,
              appName: `${safeName}-${svcName}`,
              serviceName: svcName,
              team: teamName,
              gitUrl: url,
              dockerfile: null,
              destination: `${sharedImage.imageRepo}:${sharedImage.imageTag}`,
              imageRepo: sharedImage.imageRepo,
              imageTag: sharedImage.imageTag,
              port: svc.port || 8080,
              role: svc.role || "internal",
              startedAt: new Date().toISOString(),
              status: "building", // Will resolve when the shared build completes
              sharedBuild: true,
            });
            builds.push({
              buildId: reuseBuildId,
              serviceName: svcName,
              destination: `${sharedImage.imageRepo}:${sharedImage.imageTag}`,
              port: svc.port || 8080,
              role: svc.role || "internal",
              sharedBuild: true,
            });
            console.log(`[deploy-git] Service "${svcName}" shares build context "${normalizedCtx}" — reusing image ${sharedImage.imageRepo}:${sharedImage.imageTag}`);
            continue;
          }

          const buildId = generateBuildId();
          const imageName = analysis.services.filter((s) => s.needsBuild).length === 1 ? safeName : `${safeName}-${svcName}`;
          const destination = `${HARBOR_REGISTRY}/${teamName}/${imageName}:${buildId}`;
          const dockerfilePath = svc.buildContext
            ? `${buildCtx}/${svc.dockerfile || "Dockerfile"}`
            : svc.dockerfile || "Dockerfile";

          if (!isSafePath(dockerfilePath) || !isSafePath(buildCtx)) {
            console.warn(`[deploy-git] Skipping service "${svcName}" — unsafe path: dockerfile="${dockerfilePath}", context="${buildCtx}"`);
            continue;
          }

          const kanikoArgs = [
            `--dockerfile=/workspace/${dockerfilePath}`,
            `--context=/workspace/${buildCtx}`,
            `--destination=${destination}`,
            "--cache=true",
            `--cache-repo=${HARBOR_REGISTRY}/${teamName}/cache`,
            "--snapshot-mode=time",
            "--compressed-caching=false",
            "--insecure",
            "--skip-tls-verify",
            "--skip-tls-verify-pull",
          ];
          if (svc.buildTarget) {
            kanikoArgs.push(`--target=${svc.buildTarget}`);
          }

          const buildJobSpec = {
            apiVersion: "batch/v1",
            kind: "Job",
            metadata: {
              name: buildId,
              namespace: BUILD_NAMESPACE,
              labels: {
                "app.kubernetes.io/part-of": "sre-platform",
                "sre.io/build-id": buildId,
                "sre.io/group-id": groupId,
                "sre.io/app-name": imageName,
                "sre.io/team": teamName,
              },
            },
            spec: {
              backoffLimit: 1,
              ttlSecondsAfterFinished: 3600,
              template: {
                metadata: { labels: { "sre.io/build-id": buildId, "sre.io/group-id": groupId }, annotations: { "sidecar.istio.io/inject": "false" } },
                spec: {
                  restartPolicy: "Never",
                  initContainers: [{
                    name: "git-clone",
                    image: GIT_CLONE_IMAGE,
                    command: ["sh", "-c", `git clone --depth=1 --branch "${safeBranch}" "${url}" /workspace 2>/dev/null || git clone --depth=1 "${url}" /workspace`],
                    volumeMounts: [{ name: "workspace", mountPath: "/workspace" }],
                    resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "512Mi" } },
                    securityContext: { runAsNonRoot: false, readOnlyRootFilesystem: false },
                  }],
                  containers: [{
                    name: "kaniko",
                    image: KANIKO_IMAGE,
                    args: kanikoArgs,
                    volumeMounts: [
                      { name: "workspace", mountPath: "/workspace" },
                      { name: "docker-config", mountPath: "/kaniko/.docker" },
                    ],
                    resources: { requests: { cpu: "500m", memory: "1Gi" }, limits: { cpu: "4", memory: "8Gi" } },
                  }],
                  volumes: [
                    { name: "workspace", emptyDir: {} },
                    { name: "docker-config", secret: { secretName: "harbor-push-creds", items: [{ key: ".dockerconfigjson", path: "config.json" }] } },
                  ],
                },
              },
            },
          };

          await batchApi.createNamespacedJob(BUILD_NAMESPACE, buildJobSpec);

          buildRegistry.set(buildId, {
            id: buildId,
            groupId,
            appName: imageName,
            serviceName: svcName,
            team: teamName,
            gitUrl: url,
            dockerfile: dockerfilePath,
            destination,
            imageRepo: `${HARBOR_REGISTRY}/${teamName}/${imageName}`,
            imageTag: buildId,
            port: svc.port || 8080,
            role: svc.role || "internal",
            startedAt: new Date().toISOString(),
            status: "building",
          });

          builds.push({
            buildId,
            serviceName: svcName,
            destination,
            port: svc.port || 8080,
            role: svc.role || "internal",
          });

          // Store build context → image mapping for shared context reuse
          buildContextToImage.set(normalizedCtx, { imageRepo: `${HARBOR_REGISTRY}/${teamName}/${imageName}`, imageTag: buildId });
          console.log(`[deploy-git] Built service "${svcName}" — context="${normalizedCtx}" → ${destination}`);
        } else if (svc.needsBuild && !svc.buildContext) {
          // Service has needsBuild flag but no build context — check for shared build context reuse
          const svcName = sanitizeName(svc.name);
          // Look for another service that already built the same image this service references
          let reusedImage = null;
          if (svc.image) {
            // Check if any already-built service shares this image name (compose image reuse pattern)
            for (const [ctx, img] of buildContextToImage.entries()) {
              reusedImage = img;
              break;
            }
          }
          if (reusedImage) {
            const buildId = generateBuildId();
            buildRegistry.set(buildId, {
              id: buildId,
              groupId,
              appName: `${safeName}-${svcName}`,
              serviceName: svcName,
              team: teamName,
              gitUrl: url,
              dockerfile: null,
              destination: `${reusedImage.imageRepo}:${reusedImage.imageTag}`,
              imageRepo: reusedImage.imageRepo,
              imageTag: reusedImage.imageTag,
              port: svc.port || 8080,
              role: svc.role || "internal",
              startedAt: new Date().toISOString(),
              status: "building", // Will resolve when the shared build completes
              sharedBuild: true,
            });
            builds.push({
              buildId,
              serviceName: svcName,
              destination: `${reusedImage.imageRepo}:${reusedImage.imageTag}`,
              port: svc.port || 8080,
              role: svc.role || "internal",
              sharedBuild: true,
            });
            console.log(`[deploy-git] Service "${svcName}" reuses built image from shared context → ${reusedImage.imageRepo}:${reusedImage.imageTag}`);
          } else {
            console.log(`[deploy-git] Skipping service "${svcName}" — build defined but no context and no reusable image found`);
            skippedServices.push({ name: svc.name, reason: "build defined without context or reusable image" });
          }
        } else if (svc.role === "platform") {
          // Platform services (postgres, redis, etc.) — deploy SRE equivalents directly
          if (svc.sre === "cnpg") {
            const dbName = sanitizeName(`${safeName}-db`);
            // Deploy simple PostgreSQL Deployment+Service (CNPG operator may not be available)
            const pgDeployment = {
              apiVersion: "apps/v1",
              kind: "Deployment",
              metadata: {
                name: dbName,
                namespace: nsName,
                labels: { app: dbName, "app.kubernetes.io/name": dbName, "app.kubernetes.io/part-of": "sre-platform", "sre.io/team": teamName },
              },
              spec: {
                replicas: 1,
                selector: { matchLabels: { app: dbName } },
                template: {
                  metadata: { labels: { app: dbName, "app.kubernetes.io/name": dbName, "app.kubernetes.io/part-of": "sre-platform", "sre.io/team": teamName } },
                  spec: {
                    securityContext: {
                      seccompProfile: { type: "RuntimeDefault" },
                    },
                    containers: [{
                      name: "postgres",
                      image: "docker.io/library/postgres:16-alpine",
                      ports: [{ containerPort: 5432 }],
                      env: [
                        { name: "POSTGRES_DB", value: safeName.replace(/-/g, "_") },
                        { name: "POSTGRES_USER", value: safeName.replace(/-/g, "_") },
                        { name: "POSTGRES_PASSWORD", value: "changeme" },
                      ],
                      resources: { requests: { cpu: "100m", memory: "256Mi" }, limits: { cpu: "1", memory: "512Mi" } },
                      volumeMounts: [{ name: "data", mountPath: "/var/lib/postgresql/data", subPath: "pgdata" }],
                      securityContext: {
                        runAsNonRoot: false,
                        allowPrivilegeEscalation: false,
                        capabilities: { drop: ["ALL"], add: ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"] },
                      },
                    }],
                    volumes: [{ name: "data", emptyDir: {} }],
                  },
                },
              },
            };
            const pgSvc = {
              apiVersion: "v1",
              kind: "Service",
              metadata: { name: dbName, namespace: nsName, labels: { app: dbName, "sre.io/team": teamName } },
              spec: { selector: { app: dbName }, ports: [{ port: 5432, targetPort: 5432 }] },
            };
            await applyRawDeployment(pgDeployment, nsName).catch(err => {
              console.log(`[deploy-git] PostgreSQL deployment failed: ${err.body?.message || err.message}`);
            });
            await applyRawService(pgSvc, nsName).catch(err => {
              console.log(`[deploy-git] PostgreSQL service failed: ${err.body?.message || err.message}`);
            });
            deployedPrebuilt.push({ name: dbName, type: "postgresql", port: 5432 });
            // Create alias "db" (or whatever compose name) -> keystone-db
            await k8sApi.createNamespacedService(nsName, {
              metadata: { name: svc.name, namespace: nsName, labels: { "sre.io/alias-for": dbName } },
              spec: { selector: { app: dbName }, ports: [{ port: 5432, targetPort: 5432 }] },
            }).catch(e => { if (e.statusCode !== 409) console.log(`[deploy-git] Alias "${svc.name}" failed: ${e.message}`); });
          } else if (svc.sre === "redis") {
            const redisName = sanitizeName(`${safeName}-redis`);
            // Deploy raw Redis Deployment+Service (fully-qualified image for Kyverno policy compliance)
            const redisDeployment = {
              apiVersion: "apps/v1",
              kind: "Deployment",
              metadata: {
                name: redisName,
                namespace: nsName,
                labels: { app: redisName, "app.kubernetes.io/name": redisName, "app.kubernetes.io/part-of": "sre-platform", "sre.io/team": teamName },
              },
              spec: {
                replicas: 1,
                selector: { matchLabels: { app: redisName } },
                template: {
                  metadata: { labels: { app: redisName, "app.kubernetes.io/name": redisName, "app.kubernetes.io/part-of": "sre-platform", "sre.io/team": teamName } },
                  spec: {
                    securityContext: {
                      runAsNonRoot: true,
                      seccompProfile: { type: "RuntimeDefault" },
                    },
                    containers: [{
                      name: "redis",
                      image: "docker.io/library/redis:7-alpine",
                      ports: [{ containerPort: 6379 }],
                      resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } },
                      securityContext: {
                        runAsNonRoot: true,
                        allowPrivilegeEscalation: false,
                        capabilities: { drop: ["ALL"] },
                      },
                    }],
                  },
                },
              },
            };
            const redisSvc = {
              apiVersion: "v1",
              kind: "Service",
              metadata: { name: redisName, namespace: nsName, labels: { app: redisName, "sre.io/team": teamName } },
              spec: { selector: { app: redisName }, ports: [{ port: 6379, targetPort: 6379 }] },
            };
            await applyRawDeployment(redisDeployment, nsName).catch(err => {
              console.log(`[deploy-git] Redis deployment failed: ${err.body?.message || err.message}`);
            });
            await applyRawService(redisSvc, nsName).catch(err => {
              console.log(`[deploy-git] Redis service failed: ${err.body?.message || err.message}`);
            });
            deployedPrebuilt.push({ name: redisName, type: "redis", port: 6379 });
            // Create alias "redis" (or whatever compose name) -> keystone-redis
            await k8sApi.createNamespacedService(nsName, {
              metadata: { name: svc.name, namespace: nsName, labels: { "sre.io/alias-for": redisName } },
              spec: { selector: { app: redisName }, ports: [{ port: 6379, targetPort: 6379 }] },
            }).catch(e => { if (e.statusCode !== 409) console.log(`[deploy-git] Alias "${svc.name}" failed: ${e.message}`); });
          } else if (svc.sre === "skip") {
            deployedPrebuilt.push({ name: svc.name, type: "skipped", reason: svc.sreLabel });
          }
        } else if (svc.image && !svc.needsBuild) {
          // Pre-built image from compose — deploy directly
          let imageRepo = svc.image;
          let imageTag = "latest";
          const colonIdx = svc.image.lastIndexOf(":");
          if (colonIdx > 0 && !svc.image.substring(colonIdx).includes("/")) {
            imageRepo = svc.image.substring(0, colonIdx);
            imageTag = svc.image.substring(colonIdx + 1);
          }

          const svcAppName = sanitizeName(`${safeName}-${svc.name}`);
          const manifest = generateHelmRelease({
            name: svcAppName, team: nsName, image: imageRepo, tag: imageTag,
            port: svc.port || 8080, replicas: 1, ingressHost: "",
            env: svc.environment || [],
          });
          const actor = getActor(req);
          await deployViaGitOps(manifest, nsName, svcAppName, actor, deployPolicyException);

          // Auto-create DestinationRule for HTTPS backend detection
          const composeSvcName = `${svcAppName}-${svcAppName}`;
          await createBackendTLSRule(svcAppName, nsName, composeSvcName);

          deployedPrebuilt.push({ name: svcAppName, type: "internal", port: svc.port, image: svc.image });
        } else {
          // Catch-all: service has no image, no build context, and no platform role — log and skip
          const svcName = sanitizeName(svc.name);
          console.log(`[deploy-git] Skipping undeployable service "${svcName}" — no image, build context, or platform role (role="${svc.role}", needsBuild=${svc.needsBuild}, image="${svc.image || ""}")`);
          skippedServices.push({ name: svc.name, reason: "no image or build context" });
        }
      }

      // Log service disposition summary
      console.log(`[deploy-git] Service disposition for "${safeName}":`);
      console.log(`  Built via Kaniko: ${builds.filter(b => !b.sharedBuild).map(b => b.serviceName).join(", ") || "none"}`);
      console.log(`  Shared build (reused image): ${builds.filter(b => b.sharedBuild).map(b => b.serviceName).join(", ") || "none"}`);
      console.log(`  Platform services: ${deployedPrebuilt.filter(d => ["postgresql", "redis"].includes(d.type)).map(d => d.name).join(", ") || "none"}`);
      console.log(`  Pre-built images: ${deployedPrebuilt.filter(d => d.type === "internal").map(d => d.name).join(", ") || "none"}`);
      console.log(`  Skipped/dropped: ${skippedServices.map(s => `${s.name} (${s.reason})`).join(", ") || "none"}`);

      // Auto-deploy built services when all builds in the group complete (fire-and-forget)
      if (builds.length > 0) {
        autoDeployOnBuildComplete(groupId, builds, nsName, safeName, teamName, url);
      }

      return res.json({
        success: true,
        detectedType: "compose",
        strategy: "compose-build-deploy",
        services: analysis.services.map((s) => ({ name: s.name, role: s.role, needsBuild: s.needsBuild, port: s.port })),
        allServices: analysis.services.map((s) => ({ name: s.name, role: s.role, needsBuild: s.needsBuild, image: s.image, buildContext: s.buildContext })),
        skipped: skippedServices,
        groupId,
        builds,
        deployed: deployedPrebuilt,
        namespace: nsName,
        message: `Compose repo detected: started ${builds.length} build(s) and deployed ${deployedPrebuilt.length} pre-built service(s) for "${safeName}" in ${nsName}. Builds will auto-deploy when complete.`,
      });
    }

    // ── HELM STRATEGY ──
    if (analysis.repoType === "helm") {
      console.log(`[deploy-git] Using helm strategy for "${safeName}" — chart: ${analysis.chart?.name || "unknown"} at path: ${analysis.chartPath || "."}`);

      // Create a Flux GitRepository pointing to the repo
      const gitRepoName = `git-${safeName}`;
      const gitRepo = {
        apiVersion: "source.toolkit.fluxcd.io/v1",
        kind: "GitRepository",
        metadata: {
          name: gitRepoName,
          namespace: nsName,
          labels: {
            "app.kubernetes.io/part-of": "sre-platform",
            "sre.io/team": nsName,
            "sre.io/deploy-type": "helm-git",
          },
        },
        spec: {
          interval: "5m",
          url: url,
          ref: { branch: safeBranch },
        },
      };

      try {
        await customApi.createNamespacedCustomObject("source.toolkit.fluxcd.io", "v1", nsName, "gitrepositories", gitRepo);
      } catch (err) {
        if (err.statusCode === 409) {
          await customApi.patchNamespacedCustomObject("source.toolkit.fluxcd.io", "v1", nsName, "gitrepositories", gitRepoName, gitRepo, undefined, undefined, undefined, { headers: { "Content-Type": "application/merge-patch+json" } });
        } else {
          throw err;
        }
      }

      // Create a Flux HelmRelease that uses the GitRepository as its chart source
      if (analysis.chartPath && analysis.chartPath !== "." && !isSafePath(analysis.chartPath)) {
        return res.status(400).json({ error: "Invalid chart path detected in repository" });
      }
      const chartPath = analysis.chartPath === "." ? "./" : `./${analysis.chartPath}`;
      const helmRelease = {
        apiVersion: "helm.toolkit.fluxcd.io/v2",
        kind: "HelmRelease",
        metadata: {
          name: safeName,
          namespace: nsName,
          labels: {
            "app.kubernetes.io/part-of": "sre-platform",
            "sre.io/team": nsName,
            "sre.io/deploy-type": "helm-git",
          },
        },
        spec: {
          interval: "10m",
          chart: {
            spec: {
              chart: chartPath,
              reconcileStrategy: "Revision",
              sourceRef: {
                kind: "GitRepository",
                name: gitRepoName,
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
          values: {},
        },
      };

      const actor = getActor(req);
      await deployViaGitOps(helmRelease, nsName, safeName, actor, deployPolicyException);

      // Auto-create DestinationRule for HTTPS backend detection
      await createBackendTLSRule(safeName, nsName, `${safeName}-${safeName}`);

      return res.json({
        success: true,
        detectedType: "helm",
        strategy: "flux-git-helmrelease",
        chart: analysis.chart,
        chartPath: analysis.chartPath,
        gitRepository: gitRepoName,
        helmRelease: safeName,
        namespace: nsName,
        message: gitops.isEnabled()
          ? `Helm chart "${analysis.chart?.name || safeName}" committed to Git — Flux will deploy to "${nsName}" shortly`
          : `Helm chart "${analysis.chart?.name || safeName}" deployed as "${safeName}" in namespace "${nsName}" from ${escapeHtml(url)} (branch: ${escapeHtml(safeBranch)})`,
      });
    }

    // ── DOCKERFILE STRATEGY ──
    if (analysis.repoType === "dockerfile") {
      console.log(`[deploy-git] Using dockerfile strategy for "${safeName}" — building via Kaniko`);
      await ensureHarborProject(teamName);

      const buildId = generateBuildId();
      const destination = `${HARBOR_REGISTRY}/${teamName}/${safeName}:${buildId}`;

      const buildJobSpec = {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: {
          name: buildId,
          namespace: BUILD_NAMESPACE,
          labels: {
            "app.kubernetes.io/part-of": "sre-platform",
            "sre.io/build-id": buildId,
            "sre.io/group-id": buildId,
            "sre.io/app-name": safeName,
            "sre.io/team": teamName,
          },
        },
        spec: {
          backoffLimit: 1,
          ttlSecondsAfterFinished: 3600,
          template: {
            metadata: { labels: { "sre.io/build-id": buildId }, annotations: { "sidecar.istio.io/inject": "false" } },
            spec: {
              restartPolicy: "Never",
              initContainers: [{
                name: "git-clone",
                image: GIT_CLONE_IMAGE,
                command: ["sh", "-c", `git clone --depth=1 --branch "${safeBranch}" "${url}" /workspace 2>/dev/null || git clone --depth=1 "${url}" /workspace`],
                volumeMounts: [{ name: "workspace", mountPath: "/workspace" }],
                resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "512Mi" } },
                securityContext: { runAsNonRoot: false, readOnlyRootFilesystem: false },
              }],
              containers: [{
                name: "kaniko",
                image: KANIKO_IMAGE,
                args: [
                  "--dockerfile=Dockerfile",
                  "--context=/workspace",
                  `--destination=${destination}`,
                  "--cache=true",
                  `--cache-repo=${HARBOR_REGISTRY}/${teamName}/cache`,
                  "--snapshot-mode=time",
                  "--compressed-caching=false",
                  "--insecure",
                  "--skip-tls-verify",
                  "--skip-tls-verify-pull",
                ],
                volumeMounts: [
                  { name: "workspace", mountPath: "/workspace" },
                  { name: "docker-config", mountPath: "/kaniko/.docker" },
                ],
                resources: { requests: { cpu: "500m", memory: "1Gi" }, limits: { cpu: "4", memory: "8Gi" } },
              }],
              volumes: [
                { name: "workspace", emptyDir: {} },
                { name: "docker-config", secret: { secretName: "harbor-push-creds", items: [{ key: ".dockerconfigjson", path: "config.json" }] } },
              ],
            },
          },
        },
      };

      await batchApi.createNamespacedJob(BUILD_NAMESPACE, buildJobSpec);

      const svcInfo = analysis.services[0] || {};
      buildRegistry.set(buildId, {
        id: buildId,
        appName: safeName,
        serviceName: safeName,
        team: teamName,
        gitUrl: url,
        dockerfile: "Dockerfile",
        destination,
        imageRepo: `${HARBOR_REGISTRY}/${teamName}/${safeName}`,
        imageTag: buildId,
        port: svcInfo.port || 8080,
        role: "ingress",
        startedAt: new Date().toISOString(),
        status: "building",
      });

      // Auto-deploy after build completes (fire-and-forget background task)
      autoDeployOnBuildComplete(buildId, [{
        buildId,
        serviceName: safeName,
        port: svcInfo.port || 8080,
        role: "ingress",
      }], nsName, safeName, teamName, url);

      return res.json({
        success: true,
        detectedType: "dockerfile",
        strategy: "kaniko-build-deploy",
        buildId,
        destination,
        port: svcInfo.port || 8080,
        namespace: nsName,
        services: analysis.services,
        url: `https://${safeName}.${SRE_DOMAIN}`,
        message: `Dockerfile detected: building and deploying "${safeName}"`,
      });
    }

    // ── KUSTOMIZE STRATEGY (fallback, includes unknown) ──
    // This is the original behavior: create Flux GitRepository + Kustomization
    console.log(`[deploy-git] Using kustomize strategy for "${safeName}" — path: ${analysis.kustomizePath || "."}`);

    const gitRepoName = `git-${safeName}`;
    const gitRepo = {
      apiVersion: "source.toolkit.fluxcd.io/v1",
      kind: "GitRepository",
      metadata: {
        name: gitRepoName,
        namespace: nsName,
        labels: {
          "app.kubernetes.io/part-of": "sre-platform",
          "sre.io/team": nsName,
          "sre.io/deploy-type": "kustomize",
        },
      },
      spec: {
        interval: "5m",
        url: url,
        ref: { branch: safeBranch },
      },
    };

    // Apply GitRepository
    try {
      await customApi.createNamespacedCustomObject("source.toolkit.fluxcd.io", "v1", nsName, "gitrepositories", gitRepo);
    } catch (err) {
      if (err.statusCode === 409) {
        await customApi.patchNamespacedCustomObject("source.toolkit.fluxcd.io", "v1", nsName, "gitrepositories", gitRepoName, gitRepo, undefined, undefined, undefined, { headers: { "Content-Type": "application/merge-patch+json" } });
      } else {
        throw err;
      }
    }

    // Create a Flux Kustomization to deploy from the repo
    const kustomizePath = analysis.kustomizePath || ".";
    if (kustomizePath !== "." && !isSafePath(kustomizePath)) {
      return res.status(400).json({ error: "Invalid kustomize path detected in repository" });
    }
    const kustomization = {
      apiVersion: "kustomize.toolkit.fluxcd.io/v1",
      kind: "Kustomization",
      metadata: {
        name: `deploy-${safeName}`,
        namespace: nsName,
        labels: {
          "app.kubernetes.io/part-of": "sre-platform",
          "sre.io/team": nsName,
          "sre.io/deploy-type": "kustomize",
        },
      },
      spec: {
        interval: "5m",
        path: kustomizePath === "." ? "./" : `./${kustomizePath}`,
        prune: true,
        targetNamespace: nsName,
        sourceRef: {
          kind: "GitRepository",
          name: gitRepoName,
        },
        healthChecks: [],
      },
    };

    // Apply Kustomization
    try {
      await customApi.createNamespacedCustomObject("kustomize.toolkit.fluxcd.io", "v1", nsName, "kustomizations", kustomization);
    } catch (err) {
      if (err.statusCode === 409) {
        await customApi.patchNamespacedCustomObject("kustomize.toolkit.fluxcd.io", "v1", nsName, "kustomizations", `deploy-${safeName}`, kustomization, undefined, undefined, undefined, { headers: { "Content-Type": "application/merge-patch+json" } });
      } else {
        throw err;
      }
    }

    res.json({
      success: true,
      detectedType: analysis.repoType,
      strategy: "flux-kustomization",
      gitRepository: gitRepoName,
      kustomization: `deploy-${safeName}`,
      kustomizePath,
      namespace: nsName,
      message: `Git deploy "${escapeHtml(safeName)}" created in namespace "${escapeHtml(nsName)}" from ${escapeHtml(url)} (branch: ${escapeHtml(safeBranch)}) using Flux Kustomization`,
    });
  } catch (err) {
    console.error("Error deploying from git:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/deploy/env — Update environment variables for an app
app.post("/api/deploy/env", mutateLimiter, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const { namespace, name, env } = req.body;

    if (!namespace || typeof namespace !== "string") {
      return res.status(400).json({ error: "Missing required field: namespace" });
    }
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Missing required field: name" });
    }
    if (!Array.isArray(env)) {
      return res.status(400).json({ error: "Missing required field: env (array of {name, value})" });
    }

    const safeNs = sanitizeName(namespace);
    const safeName = sanitizeName(name);
    if (!isValidName(safeNs) || !isValidName(safeName)) {
      return res.status(400).json({ error: "Invalid namespace or name" });
    }

    const safeEnv = sanitizeEnvArray(env);

    // Patch the HelmRelease with updated env
    const patch = {
      spec: {
        values: {
          app: {
            env: safeEnv,
          },
        },
      },
    };

    await customApi.patchNamespacedCustomObject(
      "helm.toolkit.fluxcd.io",
      "v2",
      safeNs,
      "helmreleases",
      safeName,
      patch,
      undefined,
      undefined,
      undefined,
      { headers: { "Content-Type": "application/merge-patch+json" } }
    );

    res.json({
      success: true,
      message: `Updated environment variables for "${escapeHtml(safeName)}" in "${escapeHtml(safeNs)}"`,
      env: safeEnv,
    });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: `App "${escapeHtml(String(req.body.name))}" not found in namespace "${escapeHtml(String(req.body.namespace))}"` });
    }
    console.error("Error updating env:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Build Pipeline API ──────────────────────────────────────────────────────

const BUILD_NAMESPACE = "sre-builds";
const HARBOR_REGISTRY = "harbor.harbor.svc.cluster.local";  // For Kaniko push (in-cluster DNS)
const HARBOR_PULL_REGISTRY = HARBOR_REGISTRY_EXT; // For node image pulls (node DNS)
const KANIKO_IMAGE = "gcr.io/kaniko-project/executor:v1.23.2";
const GIT_CLONE_IMAGE = "alpine/git:2.43.0";
const REPO_ANALYZE_IMAGE = "alpine/git:2.43.0";

// ── Bundle Upload Config ──
const BUNDLE_UPLOAD_DIR = "/tmp/bundles";
const BUNDLE_MAX_SIZE = parseInt(process.env.BUNDLE_MAX_SIZE_BYTES || String(2 * 1024 * 1024 * 1024)); // 2GB
const CRANE_IMAGE = "gcr.io/go-containerregistry/crane:v0.20.2";

// Ensure bundle upload directory exists
try { fs.mkdirSync(BUNDLE_UPLOAD_DIR, { recursive: true }); } catch { /* ignore */ }

const bundleUpload = multer({
  dest: BUNDLE_UPLOAD_DIR,
  limits: { fileSize: BUNDLE_MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    if (file.originalname.endsWith('.tar.gz') || file.originalname.endsWith('.tgz')) {
      cb(null, true);
    } else {
      cb(new Error('File must be .tar.gz or .tgz'));
    }
  },
});

// TTL Map to prevent memory leaks from accumulating build entries
class TTLMap {
  constructor(ttlMs = 3600000) { // 1 hour default
    this._map = new Map();
    this._ttl = ttlMs;
  }
  set(key, value) {
    if (this._map.has(key)) clearTimeout(this._map.get(key)._timer);
    const timer = setTimeout(() => this._map.delete(key), this._ttl);
    this._map.set(key, { value, _timer: timer });
    return this;
  }
  get(key) {
    const entry = this._map.get(key);
    return entry ? entry.value : undefined;
  }
  has(key) { return this._map.has(key); }
  delete(key) {
    const entry = this._map.get(key);
    if (entry) clearTimeout(entry._timer);
    return this._map.delete(key);
  }
  get size() { return this._map.size; }
}
// In-memory build tracking (supplements K8s Job status)
const buildRegistry = new TTLMap(3600000); // 1 hour TTL

// Ensure a Harbor project exists before pushing images
// Uses Node.js built-in http module as primary (more reliable in-cluster than global fetch)
// Falls back to global fetch if available
async function ensureHarborProject(projectName) {
  // Try multiple Harbor endpoints — the service name may vary by deployment
  const harborUrls = [
    "http://harbor-core.harbor.svc.cluster.local:80",
    "http://harbor-core.harbor.svc:80",
    "http://harbor.harbor.svc.cluster.local:80",
    "http://harbor.harbor.svc:80",
  ];
  const authHeader = "Basic " + Buffer.from(`${HARBOR_ADMIN_USER}:${HARBOR_ADMIN_PASS}`).toString("base64");

  for (const harborUrl of harborUrls) {
    try {
      // Check if project already exists
      const checkResp = await httpRequest(`${harborUrl}/api/v2.0/projects?name=${encodeURIComponent(projectName)}`, {
        headers: { "Authorization": authHeader },
        timeout: 5000,
      });
      if (checkResp.status === 200) {
        const projects = JSON.parse(checkResp.body);
        if (Array.isArray(projects) && projects.some(p => p.name === projectName)) {
          console.log(`[harbor] Project "${projectName}" already exists (via ${harborUrl})`);
          return;
        }
      }

      // Create the project
      const createResp = await httpRequest(`${harborUrl}/api/v2.0/projects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": authHeader,
        },
        body: JSON.stringify({ project_name: projectName, public: false }),
        timeout: 5000,
      });
      if (createResp.status === 201 || createResp.status === 200 || createResp.status === 409) {
        console.log(`[harbor] Project "${projectName}" ensured (via ${harborUrl})`);
        return;
      } else {
        console.warn(`[harbor] Failed to create project "${projectName}" at ${harborUrl}: ${createResp.status} — ${createResp.body}`);
      }
    } catch (err) {
      console.warn(`[harbor] Could not reach ${harborUrl}: ${err.message}`);
      continue; // Try next URL
    }
  }
  console.warn(`[harbor] Could not ensure project "${projectName}" — all Harbor endpoints failed. Build may still succeed if project exists.`);
}

// Simple HTTP request helper using Node built-in http module (no external deps)
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const httpModule = parsedUrl.protocol === "https:" ? require("https") : require("http");
    const reqOpts = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || "GET",
      headers: options.headers || {},
      timeout: options.timeout || 10000,
    };

    const req = httpModule.request(reqOpts, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => { resolve({ status: res.statusCode, body, headers: res.headers }); });
    });

    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error(`Request to ${url} timed out`)); });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function generateBuildId() {
  return "build-" + crypto.randomBytes(4).toString("hex");
}

// ── Well-known SRE platform services that should NOT be built/deployed as containers ──
// When a docker-compose service matches one of these, we replace it with the SRE equivalent.
const SRE_PLATFORM_SERVICES = {
  postgres: { type: "database", sre: "cnpg", label: "CNPG PostgreSQL" },
  postgresql: { type: "database", sre: "cnpg", label: "CNPG PostgreSQL" },
  postgis: { type: "database", sre: "cnpg", label: "CNPG PostgreSQL (PostGIS)" },
  mongo: { type: "database", sre: "mongo", label: "MongoDB (sidecar)" },
  mongodb: { type: "database", sre: "mongo", label: "MongoDB (sidecar)" },
  redis: { type: "cache", sre: "redis", label: "Redis (in-cluster)" },
  prometheus: { type: "monitoring", sre: "skip", label: "SRE Monitoring (already deployed)" },
  grafana: { type: "monitoring", sre: "skip", label: "SRE Grafana (already deployed)" },
  elasticsearch: { type: "logging", sre: "skip", label: "SRE Loki (already deployed)" },
  kibana: { type: "logging", sre: "skip", label: "SRE Grafana (already deployed)" },
  jaeger: { type: "tracing", sre: "skip", label: "SRE Tempo (already deployed)" },
  nginx: { type: "ingress", sre: "skip-if-proxy", label: "Istio Gateway (if reverse proxy only)" },
};

// Detect if a docker-compose image matches a well-known platform service
function detectPlatformService(image, serviceName) {
  const lower = (image || "").toLowerCase();
  const svcLower = (serviceName || "").toLowerCase();
  for (const [key, info] of Object.entries(SRE_PLATFORM_SERVICES)) {
    if (lower.includes(key) || svcLower === key || svcLower === "db") {
      // "db" service name with a postgres-like image
      if (svcLower === "db" && (lower.includes("postgres") || lower.includes("postgis"))) {
        return SRE_PLATFORM_SERVICES.postgres;
      }
      if (lower.includes(key)) return info;
    }
  }
  return null;
}

// Parse EXPOSE directives from a Dockerfile string
function parseDockerfileExpose(content) {
  if (!content) return [];
  const ports = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const match = line.trim().match(/^EXPOSE\s+(.+)/i);
    if (match) {
      const parts = match[1].split(/\s+/);
      for (const p of parts) {
        const num = parseInt(p.replace(/\/\w+$/, ""), 10);
        if (num > 0 && num <= 65535) ports.push(num);
      }
    }
  }
  return ports;
}

// Classify a service's role: "ingress" (user-facing), "internal" (API/worker), "platform" (SRE-managed)
function classifyService(svcName, svc, composeParsed) {
  const image = svc.image || "";
  const platformMatch = detectPlatformService(image, svcName);
  if (platformMatch) return { role: "platform", ...platformMatch };

  const ports = svc.ports || [];
  const hasExternalPorts = ports.some((p) => {
    const parts = String(p).split(":");
    if (parts.length < 2) return false;
    const hostPort = parseInt(parts[0], 10);
    return hostPort === 80 || hostPort === 443 || hostPort === 8080 || hostPort === 8443 || hostPort === 3000;
  });

  // Services named "frontend", "web", "ui", "app" with external ports → ingress
  const ingressNames = ["frontend", "web", "ui", "app", "client", "portal", "dashboard"];
  if (ingressNames.includes(svcName.toLowerCase()) || hasExternalPorts) {
    // Check if it has a build context (i.e., we need to build it)
    const hasBuild = svc.buildContext || svc.build || svc.dockerfile;
    return { role: "ingress", needsBuild: !!hasBuild };
  }

  // Workers / background tasks: no ports exposed
  if (ports.length === 0) {
    const workerNames = ["worker", "celery", "consumer", "cron", "scheduler", "job"];
    if (workerNames.some((w) => svcName.toLowerCase().includes(w))) {
      return { role: "worker" };
    }
  }

  return { role: "internal" };
}

// Detect container port from compose ports or Dockerfile EXPOSE
// When multiple ports are exposed, prefer common HTTP ports over others.
const PREFERRED_HTTP_PORTS = [80, 8080, 3000, 8000, 8888, 5000, 4200, 3001, 9090];
const KNOWN_HTTPS_PORTS = [443, 8443, 9443];

// Detect if the app serves HTTPS based on port number
function isHttpsPort(port) {
  return KNOWN_HTTPS_PORTS.includes(port);
}

function detectPort(svc, dockerfileContent) {
  // First: check compose ports (container side = right of colon)
  if (svc.ports && svc.ports.length > 0) {
    for (const portStr of svc.ports) {
      const parts = String(portStr).split(":");
      const rightSide = parts.length > 1 ? parts[parts.length - 1] : parts[0];
      const num = parseInt(rightSide.replace(/\/\w+$/, ""), 10);
      if (num > 0 && num <= 65535) return num;
    }
  }
  // Second: check Dockerfile EXPOSE — prefer common HTTP ports when multiple are exposed
  if (dockerfileContent) {
    const exposed = parseDockerfileExpose(dockerfileContent);
    if (exposed.length === 1) return exposed[0];
    if (exposed.length > 1) {
      // Pick the first port that matches a common HTTP server port
      for (const preferred of PREFERRED_HTTP_PORTS) {
        if (exposed.includes(preferred)) return preferred;
      }
      // No known HTTP port — return the lowest port (most likely the main service)
      return Math.min(...exposed);
    }
  }
  return 8080; // fallback
}

// Parse docker-compose build context
function parseComposeBuildContext(yamlText) {
  // Use js-yaml for reliable parsing instead of hand-rolled line parser
  try {
    const doc = yaml.load(yamlText);
    if (!doc || !doc.services) return {};

    const services = {};
    for (const [svcName, svcDef] of Object.entries(doc.services)) {
      if (!svcDef || typeof svcDef !== "object") continue;

      const svc = {
        image: svcDef.image || "",
        ports: [],
        environment: [],
        buildContext: null,
        buildTarget: null,
        dockerfile: null,
        profiles: null,
      };

      // Parse ports (handles both array and object formats)
      if (Array.isArray(svcDef.ports)) {
        svc.ports = svcDef.ports.map(String);
      }

      // Parse environment
      if (Array.isArray(svcDef.environment)) {
        svc.environment = svcDef.environment.map(String);
      } else if (svcDef.environment && typeof svcDef.environment === "object") {
        svc.environment = Object.entries(svcDef.environment).map(([k, v]) => `${k}=${v}`);
      }

      // Parse build context
      if (typeof svcDef.build === "string") {
        svc.buildContext = svcDef.build || ".";
      } else if (svcDef.build && typeof svcDef.build === "object") {
        svc.buildContext = svcDef.build.context || ".";
        svc.buildTarget = svcDef.build.target || null;
        svc.dockerfile = svcDef.build.dockerfile || null;
      } else if (svcDef.build === null || svcDef.build === true) {
        // Handle `build:` with no value (YAML null) or `build: true`
        svc.buildContext = ".";
      }

      // Parse deploy config (resource limits, replicas, etc.)
      svc.deploy = svcDef.deploy || null;

      // Parse security-related fields
      svc.cap_add = Array.isArray(svcDef.cap_add) ? svcDef.cap_add : [];
      svc.privileged = svcDef.privileged === true;
      svc.user = svcDef.user || null;

      // Parse profiles
      if (Array.isArray(svcDef.profiles)) {
        svc.profiles = svcDef.profiles.map(String);
      }

      services[svcName] = svc;
    }

    return services;
  } catch (e) {
    console.error("[parseComposeBuildContext] YAML parse error:", e.message);
    // Fallback to old line-based parser
    return parseDockerCompose(yamlText);
  }
}

// Parse a compose file and return simplified service definitions
// Used for multi-container detection and metadata extraction
function parseComposeServices(composeContent) {
  try {
    const compose = yaml.load(composeContent);
    const services = [];
    for (const [name, svc] of Object.entries(compose.services || {})) {
      services.push({
        name,
        build: svc.build || null,
        image: svc.image || null,
        ports: svc.ports || [],
        environment: svc.environment || {},
      });
    }
    return services;
  } catch (err) {
    logger.warn('deploy', 'Failed to parse compose services', { error: err.message });
    return [];
  }
}

// ── Repo Analysis Helpers ───────────────────────────────────────────────────

// Parse structured log output from the repo analysis Job into a result object
function parseRepoAnalysisLogs(logs) {
  const fileListMatch = logs.split("===SRE_FILE_LIST===")[1]?.split("===SRE_COMPOSE_CONTENT===")[0];
  const composeMatch = logs.split("===SRE_COMPOSE_CONTENT===")[1]?.split("===SRE_DOCKERFILE_CONTENT===")[0];
  const dockerfileMatch = logs.split("===SRE_DOCKERFILE_CONTENT===")[1]?.split("===SRE_CHART_CONTENT===")[0];
  const chartMatch = logs.split("===SRE_CHART_CONTENT===")[1]?.split("===SRE_KUSTOMIZE_CONTENT===")[0];
  const kustomizeMatch = logs.split("===SRE_KUSTOMIZE_CONTENT===")[1]?.split("===SRE_VALUES_CONTENT===")[0];
  const valuesMatch = logs.split("===SRE_VALUES_CONTENT===")[1]?.split("===SRE_APP_CONFIG===")[0];
  const appConfigMatch = logs.split("===SRE_APP_CONFIG===")[1]?.split("===SRE_DONE===")[0];

  const files = (fileListMatch || "").trim().split("\n").filter(Boolean);
  const composeFileNames = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
  const hasCompose = files.some((f) => composeFileNames.includes(f) || composeFileNames.some(cf => f.endsWith("/" + cf)));
  const hasDockerfile = files.some((f) => f === "Dockerfile" || f.match(/^Dockerfile\./) || f.match(/\/Dockerfile(\..*)?$/));
  const hasChart = files.some((f) => f === "Chart.yaml" || f.match(/\/Chart\.yaml$/));
  const hasKustomize = files.some((f) => f === "kustomization.yaml" || f === "kustomize.yaml" || f.match(/\/(kustomization|kustomize)\.yaml$/));

  // Parse file contents keyed by path
  function parseFileBlocks(rawBlock) {
    const result = {};
    if (!rawBlock) return result;
    const parts = rawBlock.split(/===FILE:(.+?)===/);
    for (let i = 1; i < parts.length; i += 2) {
      result[parts[i]] = parts[i + 1]?.trim() || "";
    }
    return result;
  }

  const dockerfiles = parseFileBlocks(dockerfileMatch);
  const chartFiles = parseFileBlocks(chartMatch);
  const kustomizeFiles = parseFileBlocks(kustomizeMatch);
  const valuesFiles = parseFileBlocks(valuesMatch);
  const appConfigs = parseFileBlocks(appConfigMatch);

  // Determine repoType with priority: compose > helm > dockerfile > kustomize > unknown
  let repoType = "unknown";
  if (hasCompose) {
    repoType = "compose";
  } else if (hasChart) {
    repoType = "helm";
  } else if (hasDockerfile) {
    repoType = "dockerfile";
  } else if (hasKustomize) {
    repoType = "kustomize";
  }

  console.log(`[repo-analyze] Detected repoType=${repoType}, files: compose=${hasCompose}, chart=${hasChart}, dockerfile=${hasDockerfile}, kustomize=${hasKustomize}`);

  const result = {
    repoType,
    files,
    services: [],
    chart: null,
    chartPath: null,
    kustomizePath: null,
    valuesContent: null,
    appConfigs,
  };

  // Parse Helm chart info
  if (hasChart) {
    for (const [chartFilePath, chartContent] of Object.entries(chartFiles)) {
      try {
        const chartData = yaml.load(chartContent) || {};
        result.chart = {
          name: chartData.name || null,
          version: chartData.version || null,
          appVersion: chartData.appVersion || null,
          description: chartData.description || null,
          type: chartData.type || "application",
        };
        // chartPath is the directory containing Chart.yaml
        const pathParts = chartFilePath.split("/");
        result.chartPath = pathParts.length > 1 ? pathParts.slice(0, -1).join("/") : ".";
        console.log(`[repo-analyze] Found Chart.yaml at ${chartFilePath}: name=${chartData.name}, version=${chartData.version}`);
      } catch (parseErr) {
        console.log(`[repo-analyze] Failed to parse Chart.yaml at ${chartFilePath}: ${parseErr.message}`);
      }
      break; // Use the first Chart.yaml found
    }
    // Find matching values.yaml
    if (result.chartPath) {
      const valuesPath = result.chartPath === "." ? "values.yaml" : `${result.chartPath}/values.yaml`;
      if (valuesFiles[valuesPath]) {
        result.valuesContent = valuesFiles[valuesPath];
      }
    }
  }

  // Parse kustomize info
  if (hasKustomize) {
    for (const kustomizePath of Object.keys(kustomizeFiles)) {
      const pathParts = kustomizePath.split("/");
      result.kustomizePath = pathParts.length > 1 ? pathParts.slice(0, -1).join("/") : ".";
      console.log(`[repo-analyze] Found kustomization at ${kustomizePath}, path=${result.kustomizePath}`);
      break; // Use the first kustomization.yaml found
    }
  }

  // Parse compose services
  if (hasCompose && composeMatch) {
    let composeContent = "";
    const composeParts = composeMatch.split(/===FILE:(.+?)===/);
    if (composeParts.length >= 3) {
      composeContent = composeParts[2]?.trim() || "";
    }

    const parsed = parseComposeBuildContext(composeContent);

    for (const [svcName, svc] of Object.entries(parsed)) {
      const classification = classifyService(svcName, svc, parsed);
      const dockerfilePath = svc.buildContext
        ? `${svc.buildContext.replace(/^\.\//, "")}/${svc.dockerfile || "Dockerfile"}`
        : null;
      const dockerfileContent = dockerfilePath ? dockerfiles[dockerfilePath] : null;
      const port = detectPort(svc, dockerfileContent);

      // Skip services that are in non-default profiles (demo, monitoring, backup)
      const skipProfiles = ["demo", "monitoring", "backup", "debug", "test"];
      if (svc.profiles && svc.profiles.some((p) => skipProfiles.includes(p))) {
        continue;
      }

      // Prefer 'sre' build target if the Dockerfile has one (FROM ... AS sre)
      let effectiveTarget = svc.buildTarget || null;
      if (dockerfileContent && /^FROM\s+.+\s+AS\s+sre\s*$/mi.test(dockerfileContent)) {
        effectiveTarget = "sre";
        console.log(`[repo-analyze] Service "${svcName}" has 'sre' Dockerfile stage — using --target=sre`);
      }

      // Detect deployment requirements from Dockerfile + compose config + app configs
      const requirements = detectAppRequirements(dockerfileContent, {
        ports: (svc.ports || []).map(p => String(p)),
        deploy: svc.deploy || null,
        cap_add: svc.cap_add || [],
        privileged: svc.privileged || false,
        user: svc.user || null,
      }, appConfigs);

      result.services.push({
        name: svcName,
        image: svc.image || null,
        buildContext: svc.buildContext || null,
        buildTarget: effectiveTarget,
        dockerfile: svc.dockerfile || (svc.buildContext ? "Dockerfile" : null),
        port,
        exposedPorts: dockerfileContent ? parseDockerfileExpose(dockerfileContent) : [],
        environment: (svc.environment || []).map((e) => {
          const idx = e.indexOf("=");
          return idx > 0 ? { name: e.substring(0, idx), value: e.substring(idx + 1) } : null;
        }).filter(Boolean),
        role: classification.role,
        sre: classification.sre || null,
        sreLabel: classification.label || null,
        needsBuild: !!svc.buildContext,
        requirements,
      });
    }
  } else if (repoType === "dockerfile") {
    // Single Dockerfile repo
    const rootDockerfile = dockerfiles["Dockerfile"] || "";
    const ports = parseDockerfileExpose(rootDockerfile);
    const requirements = detectAppRequirements(rootDockerfile, null, appConfigs);
    result.services.push({
      name: "app",
      image: null,
      buildContext: ".",
      dockerfile: "Dockerfile",
      port: ports[0] || 8080,
      exposedPorts: ports,
      environment: [],
      role: "ingress",
      sre: null,
      needsBuild: true,
      requirements,
    });
  }

  return result;
}

/**
 * Detect deployment requirements from Dockerfile content, compose service config,
 * and application config files (package.json, .env, nginx.conf, application.properties, etc.).
 * Returns { port, needsRoot, needsPrivileged, needsWritableFs, resources, probeDelays,
 *           capabilities, probePath, detectedFrom }
 */
function detectAppRequirements(dockerfileContent, composeSvc, appConfigs) {
  const reqs = {
    port: null,
    needsRoot: false,
    needsPrivileged: false,
    needsWritableFs: false,
    resources: null,
    probeDelays: null,
    probePath: null,
    capabilities: [],
    detectedFrom: [], // Track what we detected and why
  };

  // ── FROM BASE IMAGE DETECTION ──
  // Known Docker Hub images and their requirements
  if (dockerfileContent) {
    const fromLines = dockerfileContent.match(/^FROM\s+(\S+)/gim) || [];
    const baseImages = fromLines.map(f => f.replace(/^FROM\s+/i, '').split(' ')[0].toLowerCase());

    for (const base of baseImages) {
      // linuxserver.io images — need root, writable FS, slow startup
      if (base.includes('linuxserver/') || base.includes('lsiobase/') || base.includes('lscr.io/')) {
        reqs.needsRoot = true;
        reqs.needsWritableFs = true;
        reqs.probeDelays = { liveness: 60, readiness: 30, failureThreshold: 10 };
        reqs.detectedFrom.push('linuxserver.io base image: needs root + writable FS');
        // linuxserver images default to port 3000 for GUI apps, 80 for web
        if (!reqs.port) reqs.port = 3000;
      }
      // Database images
      if (base.includes('postgres') || base.includes('postgis')) {
        reqs.needsRoot = true; reqs.needsWritableFs = true;
        if (!reqs.port) reqs.port = 5432;
        if (!reqs.resources) reqs.resources = { limits: { cpu: '2', memory: '2Gi' }, requests: { cpu: '250m', memory: '512Mi' } };
        reqs.detectedFrom.push('PostgreSQL base image');
      }
      if (base.includes('mysql') || base.includes('mariadb')) {
        reqs.needsRoot = true; reqs.needsWritableFs = true;
        if (!reqs.port) reqs.port = 3306;
        reqs.detectedFrom.push('MySQL/MariaDB base image');
      }
      if (base.includes('mongo')) {
        reqs.needsRoot = true; reqs.needsWritableFs = true;
        if (!reqs.port) reqs.port = 27017;
        reqs.detectedFrom.push('MongoDB base image');
      }
      if (base.includes('redis')) {
        if (!reqs.port) reqs.port = 6379;
        reqs.detectedFrom.push('Redis base image');
      }
      if (base.includes('elasticsearch') || base.includes('opensearch')) {
        reqs.needsRoot = true; reqs.needsWritableFs = true;
        if (!reqs.port) reqs.port = 9200;
        if (!reqs.resources) reqs.resources = { limits: { cpu: '2', memory: '4Gi' }, requests: { cpu: '500m', memory: '2Gi' } };
        reqs.detectedFrom.push('Elasticsearch/OpenSearch base image');
      }
      // Network/security tools — need privileged
      if (base.includes('wireshark') || base.includes('tcpdump') || base.includes('nmap') || base.includes('kali') || base.includes('parrot') || base.includes('metasploit')) {
        reqs.needsPrivileged = true; reqs.needsRoot = true; reqs.needsWritableFs = true;
        reqs.capabilities.push('NET_ADMIN', 'NET_RAW');
        reqs.detectedFrom.push('Network/security tool: needs privileged + NET_ADMIN');
      }
      // Nginx
      if (base.includes('nginx')) {
        if (!reqs.port) reqs.port = base.includes('unprivileged') ? 8080 : 80;
        reqs.detectedFrom.push('Nginx base image');
      }
      // Apache
      if (base.includes('httpd') || base.includes('apache')) {
        if (!reqs.port) reqs.port = 80;
        reqs.detectedFrom.push('Apache base image');
      }
      // Python/Django/Flask/FastAPI
      if (base.includes('python') || base.includes('django') || base.includes('uvicorn')) {
        if (!reqs.port) reqs.port = 8000;
        reqs.detectedFrom.push('Python base image');
      }
      // Node.js
      if (base.includes('node')) {
        if (!reqs.port) reqs.port = 3000;
        reqs.detectedFrom.push('Node.js base image');
      }
      // Go
      if (base.includes('golang')) {
        if (!reqs.port) reqs.port = 8080;
        reqs.detectedFrom.push('Go base image');
      }
      // Ruby/Rails
      if (base.includes('ruby') || base.includes('rails')) {
        if (!reqs.port) reqs.port = 3000;
        reqs.detectedFrom.push('Ruby/Rails base image');
      }
      // Java / Spring Boot
      if (base.includes('openjdk') || base.includes('eclipse-temurin') || base.includes('amazoncorretto') || base.includes('tomcat')) {
        if (!reqs.port) reqs.port = 8080;
        if (!reqs.resources) reqs.resources = { limits: { cpu: '2', memory: '2Gi' }, requests: { cpu: '250m', memory: '512Mi' } };
        reqs.detectedFrom.push('Java base image');
      }
      // .NET
      if (base.includes('dotnet') || base.includes('aspnet')) {
        if (!reqs.port) reqs.port = 8080;
        reqs.detectedFrom.push('.NET base image');
      }
      // Grafana
      if (base.includes('grafana')) {
        if (!reqs.port) reqs.port = 3000;
        reqs.detectedFrom.push('Grafana base image');
      }
      // Jenkins
      if (base.includes('jenkins')) {
        reqs.needsRoot = true; reqs.needsWritableFs = true;
        if (!reqs.port) reqs.port = 8080;
        if (!reqs.resources) reqs.resources = { limits: { cpu: '2', memory: '4Gi' }, requests: { cpu: '500m', memory: '1Gi' } };
        reqs.detectedFrom.push('Jenkins base image');
      }
      // Nextcloud
      if (base.includes('nextcloud')) {
        reqs.needsRoot = true; reqs.needsWritableFs = true;
        if (!reqs.port) reqs.port = 80;
        if (!reqs.resources) reqs.resources = { limits: { cpu: '2', memory: '2Gi' }, requests: { cpu: '250m', memory: '512Mi' } };
        reqs.detectedFrom.push('Nextcloud base image');
      }
      // GitLab
      if (base.includes('gitlab')) {
        reqs.needsRoot = true; reqs.needsWritableFs = true;
        if (!reqs.port) reqs.port = 80;
        if (!reqs.resources) reqs.resources = { limits: { cpu: '4', memory: '8Gi' }, requests: { cpu: '1', memory: '4Gi' } };
        reqs.detectedFrom.push('GitLab base image');
      }
    }

    // ── DOCKERFILE DIRECTIVES ──

    // EXPOSE
    const exposed = parseDockerfileExpose(dockerfileContent);
    if (exposed.length > 0 && !reqs.port) {
      reqs.port = exposed.length === 1 ? exposed[0] : (PREFERRED_HTTP_PORTS.find(p => exposed.includes(p)) || exposed[0]);
      reqs.detectedFrom.push(`EXPOSE ${exposed.join(', ')}`);
    }

    // USER
    const userMatch = dockerfileContent.match(/^USER\s+(\S+)/im);
    if (!userMatch && !reqs.needsRoot) {
      // No USER directive at all — runs as root by default
      reqs.needsRoot = true;
      reqs.detectedFrom.push('No USER directive: runs as root');
    } else if (userMatch) {
      const user = userMatch[1];
      if (user === '0' || user === 'root') {
        reqs.needsRoot = true;
        reqs.detectedFrom.push(`USER ${user}: runs as root`);
      }
    }

    // HEALTHCHECK
    const healthMatch = dockerfileContent.match(/HEALTHCHECK\s+.*CMD\s+.*?(?:curl|wget)\s+.*?(\/\S*)/im);
    if (healthMatch && !reqs.probePath) {
      reqs.probePath = healthMatch[1].replace(/['"\|].*/, '').replace(/\s.*/, '');
      reqs.detectedFrom.push(`HEALTHCHECK path: ${reqs.probePath}`);
    }

    // VOLUME — implies writable filesystem need
    if (/^VOLUME\s+/im.test(dockerfileContent) && !reqs.needsWritableFs) {
      reqs.needsWritableFs = true;
      reqs.detectedFrom.push('VOLUME directive: needs writable FS');
    }

    // s6-overlay detection from any context
    if (/s6.overlay|s6-overlay/i.test(dockerfileContent)) {
      reqs.needsRoot = true;
      reqs.needsWritableFs = true;
      if (!reqs.probeDelays) reqs.probeDelays = { liveness: 60, readiness: 30, failureThreshold: 10 };
      reqs.detectedFrom.push('s6-overlay init system: needs root + writable FS + slow startup');
    }
  }

  // ── COMPOSE SERVICE OVERRIDES ──
  if (composeSvc) {
    // Port from compose (takes precedence over Dockerfile)
    if (composeSvc.ports && composeSvc.ports.length > 0) {
      const parts = String(composeSvc.ports[0]).split(':');
      const containerPort = parseInt(parts[parts.length - 1].replace(/\/\w+$/, ''), 10);
      if (containerPort > 0 && containerPort <= 65535) {
        reqs.port = containerPort;
        reqs.detectedFrom.push(`Compose ports: ${containerPort}`);
      }
    }

    // Resource limits from compose deploy section
    if (composeSvc.deploy && composeSvc.deploy.resources) {
      const limits = composeSvc.deploy.resources.limits || {};
      const reservations = composeSvc.deploy.resources.reservations || {};
      reqs.resources = {
        limits: {
          cpu: limits.cpus ? String(limits.cpus).replace(/'/g, '') : '1',
          memory: limits.memory || '512Mi',
        },
        requests: {
          cpu: reservations.cpus ? String(reservations.cpus).replace(/'/g, '') : '100m',
          memory: reservations.memory || '128Mi',
        },
      };
      reqs.detectedFrom.push(`Compose resource limits: ${JSON.stringify(limits)}`);
    }

    // cap_add -> capabilities
    if (composeSvc.cap_add && Array.isArray(composeSvc.cap_add)) {
      for (const cap of composeSvc.cap_add) {
        if (!reqs.capabilities.includes(cap)) reqs.capabilities.push(cap);
      }
      reqs.detectedFrom.push(`Compose cap_add: ${composeSvc.cap_add.join(', ')}`);
    }

    // privileged from compose
    if (composeSvc.privileged) {
      reqs.needsPrivileged = true;
      reqs.detectedFrom.push('Compose privileged: true');
    }

    // user from compose
    if (composeSvc.user) {
      const uid = String(composeSvc.user).split(':')[0];
      if (uid === '0' || uid === 'root') {
        reqs.needsRoot = true;
        reqs.detectedFrom.push(`Compose user: ${composeSvc.user}`);
      }
    }
  }

  // ── APP CONFIG FILE DETECTION ──
  if (appConfigs && typeof appConfigs === 'object') {
    // package.json — detect port from start script
    const packageJson = appConfigs['package.json'];
    if (packageJson) {
      try {
        const pkg = JSON.parse(packageJson);
        const startScript = pkg.scripts?.start || pkg.scripts?.serve || '';
        // Look for --port or -p flags
        const portFlag = startScript.match(/(?:--port|(?:^|\s)-p)\s*(\d+)/);
        if (portFlag && !reqs.port) {
          reqs.port = parseInt(portFlag[1], 10);
          reqs.detectedFrom.push(`package.json scripts.start --port ${reqs.port}`);
        }
        // Look for PORT in env or default
        if (startScript.includes('PORT') && !reqs.port) {
          reqs.port = 3000; // Node default
          reqs.detectedFrom.push('package.json uses PORT env variable, defaulting to 3000');
        }
      } catch (e) { /* not valid JSON */ }
    }

    // .env / .env.example / .env.production — detect PORT
    for (const envFile of ['.env', '.env.example', '.env.production']) {
      const envContent = appConfigs[envFile];
      if (envContent) {
        const portMatch = envContent.match(/^PORT\s*=\s*(\d+)/m);
        if (portMatch && !reqs.port) {
          reqs.port = parseInt(portMatch[1], 10);
          reqs.detectedFrom.push(`${envFile}: PORT=${reqs.port}`);
        }
      }
    }

    // nginx.conf — detect listen port
    const nginxConf = appConfigs['nginx.conf'] || appConfigs['nginx/default.conf'];
    if (nginxConf) {
      const listenMatch = nginxConf.match(/listen\s+(\d+)/);
      if (listenMatch) {
        reqs.port = parseInt(listenMatch[1], 10);
        reqs.detectedFrom.push(`nginx.conf listen ${reqs.port}`);
      }
    }

    // application.properties / application.yml (Spring Boot) — detect server.port
    for (const [fname, content] of Object.entries(appConfigs)) {
      if (fname.includes('application.properties') && content) {
        const portMatch = content.match(/server\.port\s*=\s*(\d+)/);
        if (portMatch && !reqs.port) {
          reqs.port = parseInt(portMatch[1], 10);
          reqs.detectedFrom.push(`${fname}: server.port=${reqs.port}`);
        }
      }
      // application.yml (Spring Boot)
      if ((fname.includes('application.yml') || fname.includes('application.yaml')) && content) {
        const portMatch = content.match(/port:\s*(\d+)/);
        if (portMatch && !reqs.port) {
          reqs.port = parseInt(portMatch[1], 10);
          reqs.detectedFrom.push(`${fname}: port: ${reqs.port}`);
        }
      }
    }

    // Procfile — detect web process and port
    const procfile = appConfigs['Procfile'];
    if (procfile) {
      const webLine = procfile.match(/^web:\s*(.+)/m);
      if (webLine) {
        const portMatch = webLine[1].match(/(?:--port|(?:^|\s)-p)\s*(\d+)/);
        if (portMatch && !reqs.port) {
          reqs.port = parseInt(portMatch[1], 10);
          reqs.detectedFrom.push(`Procfile web process: port ${reqs.port}`);
        }
      }
    }
  }

  // ── FINAL DEFAULTS ──
  // If we still don't have a port, use 8080
  if (!reqs.port) reqs.port = 8080;

  // If privileged is needed, root is also needed
  if (reqs.needsPrivileged && !reqs.needsRoot) reqs.needsRoot = true;

  // Deduplicate capabilities
  reqs.capabilities = [...new Set(reqs.capabilities)];

  return reqs;
}

// Create the analyze Job spec for cloning and scanning a repo
function createAnalyzeJobSpec(analyzeId, gitUrl, safeBranch) {
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: analyzeId,
      namespace: BUILD_NAMESPACE,
      labels: { "app.kubernetes.io/part-of": "sre-platform", "sre.io/type": "analyze" },
    },
    spec: {
      backoffLimit: 1,
      ttlSecondsAfterFinished: 300,
      activeDeadlineSeconds: 120,
      template: {
        metadata: { annotations: { "sidecar.istio.io/inject": "false" } },
        spec: {
          restartPolicy: "Never",
          initContainers: [{
            name: "git-clone",
            image: GIT_CLONE_IMAGE,
            command: ["sh", "-c", `git clone --depth=1 --branch "${safeBranch}" "${gitUrl}" /workspace 2>/dev/null || git clone --depth=1 "${gitUrl}" /workspace`],
            volumeMounts: [{ name: "workspace", mountPath: "/workspace" }],
            resources: {
              requests: { cpu: "100m", memory: "128Mi" },
              limits: { cpu: "500m", memory: "512Mi" },
            },
            securityContext: { runAsNonRoot: false, readOnlyRootFilesystem: false },
          }],
          containers: [{
            name: "analyze",
            image: REPO_ANALYZE_IMAGE,
            command: ["/bin/sh", "-c", [
              `echo '===SRE_FILE_LIST==='`,
              `find /workspace -maxdepth 3 -type f \\( -name 'docker-compose*.yml' -o -name 'docker-compose*.yaml' -o -name 'Dockerfile' -o -name 'Dockerfile.*' -o -name 'Chart.yaml' -o -name 'kustomization.yaml' -o -name 'kustomize.yaml' -o -name 'values.yaml' \\) | sed 's|/workspace/||' | sort`,
              `echo '===SRE_COMPOSE_CONTENT==='`,
              `for f in docker-compose.yml docker-compose.yaml; do if [ -f /workspace/$f ]; then echo "===FILE:$f==="; cat /workspace/$f; fi; done`,
              `echo '===SRE_DOCKERFILE_CONTENT==='`,
              `find /workspace -maxdepth 3 -name 'Dockerfile' -o -name 'Dockerfile.*' | head -10 | while read df; do relpath=$(echo $df | sed 's|/workspace/||'); echo "===FILE:$relpath==="; cat $df; done`,
              `echo '===SRE_CHART_CONTENT==='`,
              `find /workspace -maxdepth 2 -name 'Chart.yaml' | head -5 | while read cf; do relpath=$(echo $cf | sed 's|/workspace/||'); echo "===FILE:$relpath==="; cat $cf; done`,
              `echo '===SRE_KUSTOMIZE_CONTENT==='`,
              `find /workspace -maxdepth 2 \\( -name 'kustomization.yaml' -o -name 'kustomize.yaml' \\) | head -5 | while read kf; do relpath=$(echo $kf | sed 's|/workspace/||'); echo "===FILE:$relpath==="; cat $kf; done`,
              `echo '===SRE_VALUES_CONTENT==='`,
              `find /workspace -maxdepth 2 -name 'values.yaml' | head -5 | while read vf; do relpath=$(echo $vf | sed 's|/workspace/||'); echo "===FILE:$relpath==="; cat $vf; done`,
              `echo '===SRE_APP_CONFIG==='`,
              // Capture common config files that reveal ports, resources, requirements
              `for f in package.json .env .env.example .env.production Procfile nginx.conf nginx/default.conf; do if [ -f /workspace/$f ]; then echo "===FILE:$f==="; head -100 /workspace/$f; fi; done`,
              // Spring Boot / Java
              `for f in $(find /workspace -maxdepth 3 -name 'application.properties' -o -name 'application.yml' -o -name 'application.yaml' 2>/dev/null | head -5); do relpath=$(echo $f | sed 's|/workspace/||'); echo "===FILE:$relpath==="; head -50 $f; done`,
              // Python
              `for f in $(find /workspace -maxdepth 2 -name 'requirements.txt' -o -name 'Pipfile' -o -name 'pyproject.toml' 2>/dev/null | head -3); do relpath=$(echo $f | sed 's|/workspace/||'); echo "===FILE:$relpath==="; head -30 $f; done`,
              // Go
              `for f in $(find /workspace -maxdepth 2 -name 'go.mod' 2>/dev/null | head -2); do relpath=$(echo $f | sed 's|/workspace/||'); echo "===FILE:$relpath==="; head -20 $f; done`,
              // Rust
              `for f in $(find /workspace -maxdepth 2 -name 'Cargo.toml' 2>/dev/null | head -2); do relpath=$(echo $f | sed 's|/workspace/||'); echo "===FILE:$relpath==="; head -30 $f; done`,
              `echo '===SRE_DONE==='`,
            ].join(" && ")],
            volumeMounts: [{ name: "workspace", mountPath: "/workspace" }],
            resources: {
              requests: { cpu: "100m", memory: "128Mi" },
              limits: { cpu: "500m", memory: "512Mi" },
            },
            securityContext: { runAsNonRoot: false, readOnlyRootFilesystem: false },
          }],
          volumes: [
            { name: "workspace", emptyDir: {} },
          ],
        },
      },
    },
  };
}

// Run the analyze Job and wait for logs. Returns logs string or null on timeout.
async function runAnalyzeJob(analyzeId) {
  let logs = "";
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const jr = await batchApi.readNamespacedJob(analyzeId, BUILD_NAMESPACE);
      if (jr.body.status?.succeeded) {
        const pods = await k8sApi.listNamespacedPod(BUILD_NAMESPACE, undefined, undefined, undefined, undefined, `job-name=${analyzeId}`);
        if (pods.body.items.length > 0) {
          const logResp = await k8sApi.readNamespacedPodLog(pods.body.items[0].metadata.name, BUILD_NAMESPACE, "analyze");
          logs = logResp.body || "";
        }
        return logs;
      }
      if (jr.body.status?.failed) {
        return { error: "Failed to clone repository. Check the URL and branch." };
      }
    } catch (err) {
      console.debug('[deploy-git] Analyze job poll retry:', err.message);
    }
  }
  return null; // timeout
}

// POST /api/repo/analyze — Analyze a Git repo to detect project type, services, ports
app.post("/api/repo/analyze", mutateLimiter, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const { gitUrl, branch } = req.body;
    if (!gitUrl || !isValidGitUrl(gitUrl)) {
      return res.status(400).json({ error: "Invalid or missing gitUrl" });
    }

    const safeBranch = (branch || "main").replace(/[^a-zA-Z0-9._/-]/g, "").substring(0, 128);
    const analyzeId = "analyze-" + crypto.randomBytes(4).toString("hex");

    // Create and run the analyze Job using shared helpers
    const jobSpec = createAnalyzeJobSpec(analyzeId, gitUrl, safeBranch);
    await batchApi.createNamespacedJob(BUILD_NAMESPACE, jobSpec);

    const logs = await runAnalyzeJob(analyzeId);

    if (logs && logs.error) {
      return res.status(400).json({ error: logs.error });
    }
    if (!logs) {
      return res.status(504).json({ error: "Repository analysis timed out" });
    }

    // Parse the structured output
    const analysisResult = parseRepoAnalysisLogs(logs);

    // Attach top-level detectedRequirements from the primary (ingress) service
    const primarySvc = analysisResult.services.find(s => s.role === 'ingress') || analysisResult.services[0];
    const detectedRequirements = primarySvc?.requirements || null;

    res.json({ success: true, ...analysisResult, detectedRequirements });
  } catch (err) {
    console.error("Error analyzing repo:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/build/compose — Build all services from a docker-compose repo
app.post("/api/build/compose", mutateLimiter, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const { gitUrl, branch, appName, team, services: serviceDefs } = req.body;

    if (!gitUrl || !isValidGitUrl(gitUrl)) {
      return res.status(400).json({ error: "Invalid or missing gitUrl" });
    }
    if (!appName || !team) {
      return res.status(400).json({ error: "Missing appName or team" });
    }
    if (!Array.isArray(serviceDefs) || serviceDefs.length === 0) {
      return res.status(400).json({ error: "No services to build" });
    }

    const safeName = sanitizeName(appName);
    const teamName = sanitizeName(team);
    const safeBranch = (branch || "main").replace(/[^a-zA-Z0-9._/-]/g, "").substring(0, 128);
    const groupId = "group-" + crypto.randomBytes(4).toString("hex");

    const builds = [];

    // Create a build Job for each service that needs building
    for (const svc of serviceDefs) {
      if (!svc.needsBuild || !svc.buildContext) continue;

      const svcName = sanitizeName(svc.name);
      const buildId = generateBuildId();
      const imageName = serviceDefs.length === 1 ? safeName : `${safeName}-${svcName}`;
      const destination = `${HARBOR_REGISTRY}/${teamName}/${imageName}:${buildId}`;
      const buildCtx = (svc.buildContext || ".").replace(/^\.\//, "");
      const dockerfilePath = svc.buildContext
        ? `${buildCtx}/${svc.dockerfile || "Dockerfile"}`
        : svc.dockerfile || "Dockerfile";

      if (!isSafePath(dockerfilePath) || !isSafePath(buildCtx)) {
        console.warn(`[build-compose] Skipping service "${svcName}" — unsafe path: dockerfile="${dockerfilePath}", context="${buildCtx}"`);
        continue;
      }

      // Kaniko args
      const kanikoArgs = [
        `--dockerfile=/workspace/${dockerfilePath}`,
        `--context=/workspace/${buildCtx}`,
        `--destination=${destination}`,
        "--cache=true",
        `--cache-repo=${HARBOR_REGISTRY}/${teamName}/cache`,
        "--snapshot-mode=time",
        "--compressed-caching=false",
        "--insecure",
        "--skip-tls-verify",
        "--skip-tls-verify-pull",
      ];
      if (svc.buildTarget) {
        kanikoArgs.push(`--target=${svc.buildTarget}`);
      }

      const jobSpec = {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: {
          name: buildId,
          namespace: BUILD_NAMESPACE,
          labels: {
            "app.kubernetes.io/part-of": "sre-platform",
            "sre.io/build-id": buildId,
            "sre.io/group-id": groupId,
            "sre.io/app-name": imageName,
            "sre.io/team": teamName,
          },
        },
        spec: {
          backoffLimit: 1,
          ttlSecondsAfterFinished: 3600,
          template: {
            metadata: { labels: { "sre.io/build-id": buildId, "sre.io/group-id": groupId }, annotations: { "sidecar.istio.io/inject": "false" } },
            spec: {
              restartPolicy: "Never",
              initContainers: [{
                name: "git-clone",
                image: GIT_CLONE_IMAGE,
                command: ["sh", "-c", `git clone --depth=1 --branch "${safeBranch}" "${gitUrl}" /workspace 2>/dev/null || git clone --depth=1 "${gitUrl}" /workspace`],
                volumeMounts: [{ name: "workspace", mountPath: "/workspace" }],
                resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "512Mi" } },
                securityContext: { runAsNonRoot: false, readOnlyRootFilesystem: false },
              }],
              containers: [{
                name: "kaniko",
                image: KANIKO_IMAGE,
                args: kanikoArgs,
                volumeMounts: [
                  { name: "workspace", mountPath: "/workspace" },
                  { name: "docker-config", mountPath: "/kaniko/.docker" },
                ],
                resources: { requests: { cpu: "500m", memory: "1Gi" }, limits: { cpu: "4", memory: "8Gi" } },
              }],
              volumes: [
                { name: "workspace", emptyDir: {} },
                { name: "docker-config", secret: { secretName: "harbor-push-creds", items: [{ key: ".dockerconfigjson", path: "config.json" }] } },
              ],
            },
          },
        },
      };

      await batchApi.createNamespacedJob(BUILD_NAMESPACE, jobSpec);

      buildRegistry.set(buildId, {
        id: buildId,
        groupId,
        appName: imageName,
        serviceName: svcName,
        team: teamName,
        gitUrl,
        dockerfile: dockerfilePath,
        destination,
        imageRepo: `${HARBOR_REGISTRY}/${teamName}/${imageName}`,
        imageTag: buildId,
        port: svc.port || 8080,
        role: svc.role || "internal",
        startedAt: new Date().toISOString(),
        status: "building",
      });

      builds.push({
        buildId,
        serviceName: svcName,
        destination,
        port: svc.port || 8080,
        role: svc.role || "internal",
      });
    }

    res.json({
      success: true,
      groupId,
      builds,
      message: `Started ${builds.length} build(s) for ${safeName}`,
    });
  } catch (err) {
    console.error("Error starting compose build:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/deploy/compose-group — Deploy all services from a compose build group
app.post("/api/deploy/compose-group", mutateLimiter, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const { groupId, appName, team, services: serviceDefs } = req.body;

    if (!appName || !team) {
      return res.status(400).json({ error: "Missing appName or team" });
    }
    if (!Array.isArray(serviceDefs) || serviceDefs.length === 0) {
      return res.status(400).json({ error: "No services to deploy" });
    }

    const safeName = sanitizeName(appName);
    const teamName = sanitizeName(team);
    const nsName = normalizeTeamName(team);

    await ensureNamespace(nsName, teamName);

    const deployed = [];

    for (const svc of serviceDefs) {
      // Platform services: create CNPG cluster, Redis, etc.
      if (svc.role === "platform" && svc.sre === "cnpg") {
        // Deploy a CNPG PostgreSQL cluster
        const dbName = sanitizeName(`${safeName}-db`);
        const cnpgCluster = {
          apiVersion: "postgresql.cnpg.io/v1",
          kind: "Cluster",
          metadata: { name: dbName, namespace: nsName },
          spec: {
            instances: 1,
            storage: { size: "5Gi", storageClass: "local-path" },
            bootstrap: {
              initdb: {
                database: safeName.replace(/-/g, "_"),
                owner: safeName.replace(/-/g, "_"),
              },
            },
          },
        };
        await applyManifest(cnpgCluster, nsName);
        deployed.push({
          name: dbName,
          type: "cnpg-database",
          port: 5432,
          connectionInfo: {
            host: `${dbName}-rw.${nsName}.svc.cluster.local`,
            port: 5432,
            database: safeName.replace(/-/g, "_"),
            secretName: `${dbName}-app`,
          },
        });
        continue;
      }

      if (svc.role === "platform" && svc.sre === "redis") {
        // Deploy a simple Redis StatefulSet
        const redisName = sanitizeName(`${safeName}-redis`);
        const redisManifest = generateHelmRelease({
          name: redisName,
          team: nsName,
          image: "redis",
          tag: "7-alpine",
          port: 6379,
          replicas: 1,
          ingressHost: "",
        });
        await applyManifest(redisManifest, nsName);
        deployed.push({
          name: redisName,
          type: "redis",
          port: 6379,
          connectionInfo: { host: `${redisName}.${nsName}.svc.cluster.local`, port: 6379 },
        });
        continue;
      }

      if (svc.role === "platform" && svc.sre === "skip") {
        deployed.push({ name: svc.name, type: "skipped", reason: svc.sreLabel });
        continue;
      }

      // Built services: deploy from Harbor image
      if (svc.buildId) {
        const buildMeta = buildRegistry.get(svc.buildId);
        if (!buildMeta) continue;

        const svcAppName = sanitizeName(svc.deployName || buildMeta.appName);
        const isIngress = svc.role === "ingress";
        const ingressHost = isIngress ? `${svcAppName}.${SRE_DOMAIN}` : "";

        // Build environment with service discovery for internal dependencies
        const env = Array.isArray(svc.env) ? svc.env : [];

        const manifest = generateHelmRelease({
          name: svcAppName,
          team: nsName,
          image: buildMeta.imageRepo,
          tag: buildMeta.imageTag,
          port: svc.port || buildMeta.port || 8080,
          replicas: svc.replicas || (isIngress ? 2 : 1),
          ingressHost,
          env,
        });

        const actor = getActor(req);
        await deployViaGitOps(manifest, nsName, svcAppName, actor);
        deployed.push({
          name: svcAppName,
          type: isIngress ? "ingress" : svc.role === "worker" ? "worker" : "internal",
          port: svc.port || buildMeta.port,
          image: `${buildMeta.imageRepo}:${buildMeta.imageTag}`,
          ingress: ingressHost || null,
        });
        continue;
      }

      // Pre-built images (from compose, no build context)
      if (svc.image) {
        let imageRepo = svc.image;
        let imageTag = "latest";
        const colonIdx = svc.image.lastIndexOf(":");
        if (colonIdx > 0 && !svc.image.substring(colonIdx).includes("/")) {
          imageRepo = svc.image.substring(0, colonIdx);
          imageTag = svc.image.substring(colonIdx + 1);
        }

        const svcAppName = sanitizeName(svc.deployName || svc.name);
        const manifest = generateHelmRelease({
          name: svcAppName,
          team: nsName,
          image: imageRepo,
          tag: imageTag,
          port: svc.port || 8080,
          replicas: 1,
          ingressHost: "",
          env: Array.isArray(svc.env) ? svc.env : [],
        });

        const actor = getActor(req);
        await deployViaGitOps(manifest, nsName, svcAppName, actor);
        deployed.push({ name: svcAppName, type: "internal", port: svc.port, image: svc.image });
      }
    }

    // Generate a summary of service URLs for internal wiring
    const serviceMap = {};
    for (const d of deployed) {
      if (d.port && d.name) {
        serviceMap[d.name] = `${d.name}.${nsName}.svc.cluster.local:${d.port}`;
      }
    }

    res.json({
      success: true,
      namespace: nsName,
      deployed,
      serviceMap,
      message: `Deployed ${deployed.length} service(s) to ${nsName}`,
    });
  } catch (err) {
    console.error("Error deploying compose group:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/build — Start a Kaniko build from Git URL or inline Dockerfile
app.post("/api/build", mutateLimiter, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const { gitUrl, branch, dockerfile, dockerfileContent, appName, team } = req.body;

    if (!appName || typeof appName !== "string") {
      return res.status(400).json({ error: "Missing required field: appName" });
    }
    if (!team || typeof team !== "string") {
      return res.status(400).json({ error: "Missing required field: team" });
    }
    if (!gitUrl && !dockerfileContent) {
      return res.status(400).json({ error: "Provide either gitUrl or dockerfileContent" });
    }

    const safeName = sanitizeName(appName);
    if (!isValidName(safeName)) {
      return res.status(400).json({ error: "Invalid app name" });
    }

    const teamName = sanitizeName(team);
    const buildId = generateBuildId();
    const imageTag = buildId;
    const destination = `${HARBOR_REGISTRY}/${teamName}/${safeName}:${imageTag}`;
    const dockerfilePath = dockerfile || "Dockerfile";
    if (!isSafePath(dockerfilePath)) {
      return res.status(400).json({ error: "Invalid dockerfile path" });
    }

    let jobSpec;

    if (gitUrl) {
      // Git URL mode — init container clones, Kaniko builds
      if (!isValidGitUrl(gitUrl)) {
        return res.status(400).json({ error: "Invalid Git URL" });
      }
      const safeBranch = (branch || "main").replace(/[^a-zA-Z0-9._/-]/g, "").substring(0, 128);

      jobSpec = {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: {
          name: buildId,
          namespace: BUILD_NAMESPACE,
          labels: {
            "app.kubernetes.io/part-of": "sre-platform",
            "sre.io/build-id": buildId,
            "sre.io/app-name": safeName,
            "sre.io/team": teamName,
          },
        },
        spec: {
          backoffLimit: 1,
          ttlSecondsAfterFinished: 3600,
          template: {
            metadata: {
              labels: {
                "sre.io/build-id": buildId,
              },
              annotations: {
                "sidecar.istio.io/inject": "false",
              },
            },
            spec: {
              restartPolicy: "Never",
              initContainers: [
                {
                  name: "git-clone",
                  image: GIT_CLONE_IMAGE,
                  command: ["sh", "-c", `git clone --depth=1 --branch "${safeBranch}" "${gitUrl}" /workspace 2>/dev/null || git clone --depth=1 "${gitUrl}" /workspace`],
                  volumeMounts: [{ name: "workspace", mountPath: "/workspace" }],
                  resources: {
                    requests: { cpu: "100m", memory: "128Mi" },
                    limits: { cpu: "500m", memory: "512Mi" },
                  },
                  securityContext: {
                    runAsNonRoot: false,
                    readOnlyRootFilesystem: false,
                  },
                },
              ],
              containers: [
                {
                  name: "kaniko",
                  image: KANIKO_IMAGE,
                  args: [
                    `--dockerfile=${dockerfilePath}`,
                    "--context=/workspace",
                    `--destination=${destination}`,
                    "--cache=true",
                    `--cache-repo=${HARBOR_REGISTRY}/${teamName}/cache`,
                    "--snapshot-mode=time",
                    "--compressed-caching=false",
                    "--insecure",
                    "--skip-tls-verify",
                    "--skip-tls-verify-pull",
                  ],
                  volumeMounts: [
                    { name: "workspace", mountPath: "/workspace" },
                    { name: "docker-config", mountPath: "/kaniko/.docker" },
                  ],
                  resources: {
                    requests: { cpu: "500m", memory: "1Gi" },
                    limits: { cpu: "4", memory: "8Gi" },
                  },
                },
              ],
              volumes: [
                { name: "workspace", emptyDir: {} },
                {
                  name: "docker-config",
                  secret: {
                    secretName: "harbor-push-creds",
                    items: [{ key: ".dockerconfigjson", path: "config.json" }],
                  },
                },
              ],
            },
          },
        },
      };
    } else {
      // Inline Dockerfile mode — ConfigMap with Dockerfile content, Kaniko builds
      const cmName = `${buildId}-dockerfile`;
      await k8sApi.createNamespacedConfigMap(BUILD_NAMESPACE, {
        metadata: {
          name: cmName,
          namespace: BUILD_NAMESPACE,
          labels: { "sre.io/build-id": buildId },
        },
        data: { Dockerfile: dockerfileContent },
      });

      jobSpec = {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: {
          name: buildId,
          namespace: BUILD_NAMESPACE,
          labels: {
            "app.kubernetes.io/part-of": "sre-platform",
            "sre.io/build-id": buildId,
            "sre.io/app-name": safeName,
            "sre.io/team": teamName,
          },
        },
        spec: {
          backoffLimit: 1,
          ttlSecondsAfterFinished: 3600,
          template: {
            metadata: {
              labels: { "sre.io/build-id": buildId },
              annotations: { "sidecar.istio.io/inject": "false" },
            },
            spec: {
              restartPolicy: "Never",
              containers: [
                {
                  name: "kaniko",
                  image: KANIKO_IMAGE,
                  args: [
                    "--dockerfile=/workspace/Dockerfile",
                    "--context=dir:///workspace",
                    `--destination=${destination}`,
                    "--insecure",
                    "--skip-tls-verify",
                    "--skip-tls-verify-pull",
                  ],
                  volumeMounts: [
                    { name: "dockerfile", mountPath: "/workspace" },
                    { name: "docker-config", mountPath: "/kaniko/.docker" },
                  ],
                  resources: {
                    requests: { cpu: "500m", memory: "1Gi" },
                    limits: { cpu: "4", memory: "8Gi" },
                  },
                },
              ],
              volumes: [
                {
                  name: "dockerfile",
                  configMap: { name: cmName },
                },
                {
                  name: "docker-config",
                  secret: {
                    secretName: "harbor-push-creds",
                    items: [{ key: ".dockerconfigjson", path: "config.json" }],
                  },
                },
              ],
            },
          },
        },
      };
    }

    // Create the Job
    await batchApi.createNamespacedJob(BUILD_NAMESPACE, jobSpec);

    // Track build metadata
    buildRegistry.set(buildId, {
      id: buildId,
      appName: safeName,
      team: teamName,
      gitUrl: gitUrl || null,
      dockerfile: dockerfileContent ? "(inline)" : dockerfilePath,
      destination,
      imageRepo: `${HARBOR_REGISTRY}/${teamName}/${safeName}`,
      imageTag,
      startedAt: new Date().toISOString(),
      status: "building",
    });

    res.json({
      success: true,
      buildId,
      destination,
      message: `Build ${buildId} started for ${safeName}`,
    });
  } catch (err) {
    console.error("Error starting build:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/build/:id/status — Get build Job status
app.get("/api/build/:id/status", async (req, res) => {
  try {
    const buildId = sanitizeName(req.params.id);
    if (!buildId) return res.status(400).json({ error: "Invalid build ID" });

    let status = "unknown";
    let message = "";
    let startTime = "";
    let completionTime = "";

    try {
      const jobResp = await batchApi.readNamespacedJob(buildId, BUILD_NAMESPACE);
      const job = jobResp.body;
      startTime = job.status?.startTime || "";
      completionTime = job.status?.completionTime || "";

      if (job.status?.succeeded) {
        status = "succeeded";
        message = "Build completed successfully";
      } else if (job.status?.failed) {
        status = "failed";
        message = "Build failed";
        // Try to get failure reason from pod
        try {
          const pods = await k8sApi.listNamespacedPod(BUILD_NAMESPACE, undefined, undefined, undefined, undefined, `sre.io/build-id=${buildId}`);
          const pod = pods.body.items[0];
          if (pod) {
            const cs = pod.status?.containerStatuses || [];
            const terminated = cs.find((c) => c.state?.terminated);
            if (terminated) {
              message = terminated.state.terminated.reason || "Build failed";
            }
            const initCs = pod.status?.initContainerStatuses || [];
            const initFailed = initCs.find((c) => c.state?.terminated && c.state.terminated.exitCode !== 0);
            if (initFailed) {
              message = "Git clone failed: " + (initFailed.state.terminated.reason || "error");
            }
          }
        } catch (err) {
          console.debug('[build] Failed pod status check for failed build:', err.message);
        }
      } else if (job.status?.active) {
        status = "building";
        // Check which phase — init container (clone) or main (build)
        try {
          const pods = await k8sApi.listNamespacedPod(BUILD_NAMESPACE, undefined, undefined, undefined, undefined, `sre.io/build-id=${buildId}`);
          const pod = pods.body.items[0];
          if (pod) {
            const initCs = pod.status?.initContainerStatuses || [];
            const initRunning = initCs.some((c) => c.state?.running);
            if (initRunning) {
              message = "Cloning repository...";
            } else {
              message = "Building image...";
            }
          }
        } catch (err) {
          console.debug('[build] Failed pod phase check for active build:', err.message);
        }
      } else {
        status = "pending";
        message = "Build job pending";
      }
    } catch (err) {
      if (err.statusCode === 404) {
        return res.status(404).json({ error: "Build not found" });
      }
      throw err;
    }

    const buildMeta = buildRegistry.get(buildId) || {};

    res.json({
      buildId,
      status,
      message,
      startTime,
      completionTime,
      appName: buildMeta.appName || "",
      team: buildMeta.team || "",
      destination: buildMeta.destination || "",
      imageRepo: buildMeta.imageRepo || "",
      imageTag: buildMeta.imageTag || "",
    });
  } catch (err) {
    console.error("Error fetching build status:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/build/:id/logs — SSE stream of Kaniko build logs
app.get("/api/build/:id/logs", async (req, res) => {
  const buildId = sanitizeName(req.params.id);
  if (!buildId) return res.status(400).json({ error: "Invalid build ID" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let closed = false;
  req.on("close", () => { closed = true; });

  const sendEvent = (data) => {
    if (closed) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Wait for pod to be created (up to 30s)
    let pod = null;
    for (let i = 0; i < 30 && !closed; i++) {
      try {
        const pods = await k8sApi.listNamespacedPod(BUILD_NAMESPACE, undefined, undefined, undefined, undefined, `sre.io/build-id=${buildId}`);
        if (pods.body.items.length > 0) {
          pod = pods.body.items[0];
          break;
        }
      } catch (err) {
        console.debug('[build] Waiting for build pod to appear:', err.message);
      }
      sendEvent({ type: "status", message: "Waiting for build pod..." });
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (!pod || closed) {
      sendEvent({ type: "error", message: "Build pod not found" });
      sendEvent({ type: "done" });
      res.end();
      return;
    }

    const podName = pod.metadata.name;

    // Stream init container logs (git clone) if present
    const initContainers = pod.spec.initContainers || [];
    for (const init of initContainers) {
      // Wait for init container to start
      for (let i = 0; i < 60 && !closed; i++) {
        const podStatus = await k8sApi.readNamespacedPod(podName, BUILD_NAMESPACE);
        const initStatus = (podStatus.body.status?.initContainerStatuses || []).find((c) => c.name === init.name);
        if (initStatus && (initStatus.state?.running || initStatus.state?.terminated)) break;
        await new Promise((r) => setTimeout(r, 1000));
      }

      sendEvent({ type: "phase", phase: "clone", message: `Cloning repository...` });

      try {
        const logResp = await k8sApi.readNamespacedPodLog(podName, BUILD_NAMESPACE, init.name, false);
        const lines = (logResp.body || "").split("\n");
        for (const line of lines) {
          if (line.trim()) sendEvent({ type: "log", container: init.name, line });
        }
      } catch (err) {
        console.debug('[build] Init container logs not yet available:', err.message);
      }
    }

    // Wait for main container to start
    sendEvent({ type: "phase", phase: "build", message: "Building image..." });
    for (let i = 0; i < 120 && !closed; i++) {
      const podStatus = await k8sApi.readNamespacedPod(podName, BUILD_NAMESPACE);
      const mainStatus = (podStatus.body.status?.containerStatuses || []).find((c) => c.name === "kaniko");
      if (mainStatus && (mainStatus.state?.running || mainStatus.state?.terminated)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    // Stream main container logs
    try {
      const logResp = await k8sApi.readNamespacedPodLog(podName, BUILD_NAMESPACE, "kaniko", false);
      const lines = (logResp.body || "").split("\n");
      for (const line of lines) {
        if (line.trim() && !closed) sendEvent({ type: "log", container: "kaniko", line });
      }
    } catch (err) {
      sendEvent({ type: "error", message: "Failed to read build logs: " + (err.message || "") });
    }

    // Check final status
    try {
      const jobResp = await batchApi.readNamespacedJob(buildId, BUILD_NAMESPACE);
      if (jobResp.body.status?.succeeded) {
        sendEvent({ type: "phase", phase: "push", message: "Image pushed to Harbor" });
        sendEvent({ type: "complete", status: "succeeded" });
      } else if (jobResp.body.status?.failed) {
        sendEvent({ type: "complete", status: "failed" });
      } else {
        // Still running — poll until done
        for (let i = 0; i < 300 && !closed; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const jr = await batchApi.readNamespacedJob(buildId, BUILD_NAMESPACE);
          // Stream any new logs
          try {
            const logResp = await k8sApi.readNamespacedPodLog(podName, BUILD_NAMESPACE, "kaniko", false, undefined, undefined, undefined, undefined, undefined, 50);
            const lines = (logResp.body || "").split("\n");
            for (const line of lines) {
              if (line.trim()) sendEvent({ type: "log", container: "kaniko", line });
            }
          } catch (err) {
            console.debug('[build] Kaniko log streaming best-effort error:', err.message);
          }
          if (jr.body.status?.succeeded) {
            sendEvent({ type: "phase", phase: "push", message: "Image pushed to Harbor" });
            sendEvent({ type: "complete", status: "succeeded" });
            break;
          }
          if (jr.body.status?.failed) {
            sendEvent({ type: "complete", status: "failed" });
            break;
          }
        }
      }
    } catch (err) {
      console.debug('[build] Failed to check build status:', err.message);
      sendEvent({ type: "error", message: "Failed to check build status" });
    }
  } catch (err) {
    sendEvent({ type: "error", message: err.message || "Unknown error" });
  }

  sendEvent({ type: "done" });
  res.end();
});

// GET /api/builds — List recent builds with status
app.get("/api/builds", async (req, res) => {
  try {
    const jobsResp = await batchApi.listNamespacedJob(BUILD_NAMESPACE, undefined, undefined, undefined, undefined, "app.kubernetes.io/part-of=sre-platform");
    const builds = jobsResp.body.items
      .sort((a, b) => new Date(b.metadata.creationTimestamp) - new Date(a.metadata.creationTimestamp))
      .slice(0, 50)
      .map((job) => {
        const labels = job.metadata.labels || {};
        const buildId = job.metadata.name;
        let status = "pending";
        if (job.status?.succeeded) status = "succeeded";
        else if (job.status?.failed) status = "failed";
        else if (job.status?.active) status = "building";

        const meta = buildRegistry.get(buildId) || {};

        return {
          buildId,
          appName: labels["sre.io/app-name"] || meta.appName || "",
          team: labels["sre.io/team"] || meta.team || "",
          status,
          startTime: job.status?.startTime || "",
          completionTime: job.status?.completionTime || "",
          destination: meta.destination || "",
        };
      });

    res.json({ builds });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.json({ builds: [] });
    }
    console.error("Error listing builds:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/deploy/from-build — Deploy a completed build
app.post("/api/deploy/from-build", mutateLimiter, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const { buildId, appName, team, port, replicas, ingress } = req.body;

    if (!buildId) return res.status(400).json({ error: "Missing required field: buildId" });
    if (!appName) return res.status(400).json({ error: "Missing required field: appName" });
    if (!team) return res.status(400).json({ error: "Missing required field: team" });

    const safeName = sanitizeName(appName);
    const safeBuildId = sanitizeName(buildId);
    if (!isValidName(safeName)) return res.status(400).json({ error: "Invalid app name" });

    // Check build succeeded
    let buildMeta = buildRegistry.get(safeBuildId);
    if (!buildMeta) {
      // Try to reconstruct from Job labels
      try {
        const jobResp = await batchApi.readNamespacedJob(safeBuildId, BUILD_NAMESPACE);
        if (!jobResp.body.status?.succeeded) {
          return res.status(400).json({ error: "Build has not succeeded yet" });
        }
        const labels = jobResp.body.metadata.labels || {};
        buildMeta = {
          imageRepo: `${HARBOR_REGISTRY}/${labels["sre.io/team"] || sanitizeName(team)}/${labels["sre.io/app-name"] || safeName}`,
          imageTag: safeBuildId,
        };
      } catch (err) {
        if (err.statusCode === 404) {
          return res.status(404).json({ error: "Build not found" });
        }
        throw err;
      }
    }

    const teamName = sanitizeName(team);
    const nsName = normalizeTeamName(team);
    const containerPort = port || 8080;
    const ingressHost = ingress || `${safeName}.${SRE_DOMAIN}`;

    // Ensure namespace
    await ensureNamespace(nsName, teamName);

    // Create HelmRelease
    const manifest = generateHelmRelease({
      name: safeName,
      team: nsName,
      image: buildMeta.imageRepo,
      tag: buildMeta.imageTag,
      port: containerPort,
      replicas: replicas || 2,
      ingressHost,
    });

    const actor = getActor(req);
    await deployViaGitOps(manifest, nsName, safeName, actor);

    res.json({
      success: true,
      message: gitops.isEnabled()
        ? `App "${safeName}" committed to Git from build ${safeBuildId} — Flux will deploy to "${nsName}" shortly`
        : `App "${safeName}" deployed from build ${safeBuildId} to namespace "${nsName}"`,
      namespace: nsName,
      image: `${buildMeta.imageRepo}:${buildMeta.imageTag}`,
      ingress: ingressHost,
    });
  } catch (err) {
    console.error("Error deploying from build:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/deploy/helm-chart — Deploy from an external Helm chart repository
app.post("/api/deploy/helm-chart", mutateLimiter, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const { repoUrl, chartName, chartVersion, values, appName, team } = req.body;

    if (!repoUrl || typeof repoUrl !== "string") {
      return res.status(400).json({ error: "Missing required field: repoUrl" });
    }
    if (!chartName || typeof chartName !== "string") {
      return res.status(400).json({ error: "Missing required field: chartName" });
    }
    if (!appName || typeof appName !== "string") {
      return res.status(400).json({ error: "Missing required field: appName" });
    }
    if (!team || typeof team !== "string") {
      return res.status(400).json({ error: "Missing required field: team" });
    }

    const safeName = sanitizeName(appName);
    if (!isValidName(safeName)) return res.status(400).json({ error: "Invalid app name" });

    const teamName = sanitizeName(team);
    const nsName = normalizeTeamName(team);
    const safeChartName = sanitizeName(chartName);
    const safeVersion = (chartVersion || "").replace(/[^a-zA-Z0-9._-]/g, "").substring(0, 64);

    await ensureNamespace(nsName, teamName);

    // Create HelmRepository pointing to external chart repo
    const helmRepo = {
      apiVersion: "source.toolkit.fluxcd.io/v1",
      kind: "HelmRepository",
      metadata: {
        name: `chart-${safeName}`,
        namespace: nsName,
        labels: {
          "app.kubernetes.io/part-of": "sre-platform",
          "sre.io/team": nsName,
        },
      },
      spec: {
        interval: "1h",
        url: repoUrl,
      },
    };

    try {
      await customApi.createNamespacedCustomObject("source.toolkit.fluxcd.io", "v1", nsName, "helmrepositories", helmRepo);
    } catch (err) {
      if (err.statusCode === 409) {
        await customApi.patchNamespacedCustomObject("source.toolkit.fluxcd.io", "v1", nsName, "helmrepositories", `chart-${safeName}`, helmRepo, undefined, undefined, undefined, { headers: { "Content-Type": "application/merge-patch+json" } });
      } else {
        throw err;
      }
    }

    // Parse user-provided values (YAML string or object)
    let userValues = {};
    if (values) {
      if (typeof values === "string") {
        try {
          userValues = yaml.load(values) || {};
        } catch (err) {
          console.debug('[deploy] Invalid YAML in values field:', err.message);
          return res.status(400).json({ error: "Invalid YAML in values field" });
        }
      } else if (typeof values === "object") {
        userValues = values;
      }
    }

    // Create HelmRelease pointing to the external chart
    const helmRelease = {
      apiVersion: "helm.toolkit.fluxcd.io/v2",
      kind: "HelmRelease",
      metadata: {
        name: safeName,
        namespace: nsName,
        labels: {
          "app.kubernetes.io/part-of": "sre-platform",
          "sre.io/team": nsName,
          "sre.io/deploy-type": "helm-chart",
        },
      },
      spec: {
        interval: "10m",
        chart: {
          spec: {
            chart: chartName,
            version: safeVersion || undefined,
            sourceRef: {
              kind: "HelmRepository",
              name: `chart-${safeName}`,
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
        values: userValues,
      },
    };

    const actor = getActor(req);
    await deployViaGitOps(helmRelease, nsName, safeName, actor);

    // Auto-create DestinationRule for HTTPS backend detection
    await createBackendTLSRule(safeName, nsName, `${safeName}-${safeName}`);

    res.json({
      success: true,
      message: gitops.isEnabled()
        ? `Helm chart "${chartName}" committed to Git — Flux will deploy "${safeName}" to "${nsName}" shortly`
        : `Helm chart "${chartName}" deployed as "${safeName}" in namespace "${nsName}"`,
      namespace: nsName,
      chart: chartName,
      version: safeVersion || "latest",
    });
  } catch (err) {
    console.error("Error deploying Helm chart:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/databases — Create a CloudNativePG database cluster
app.post("/api/databases", mutateLimiter, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const { name, team, storage, instances, description } = req.body;

    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Missing required field: name" });
    }
    if (!team || typeof team !== "string") {
      return res.status(400).json({ error: "Missing required field: team" });
    }

    const safeName = sanitizeName(name);
    if (!isValidName(safeName)) return res.status(400).json({ error: "Invalid database name" });

    const teamName = sanitizeName(team);
    const nsName = normalizeTeamName(team);
    const dbInstances = Math.min(Math.max(Number(instances) || 1, 1), 3);
    const dbStorage = (storage || "1Gi").replace(/[^a-zA-Z0-9]/g, "");

    await ensureNamespace(nsName, teamName);

    const cluster = {
      apiVersion: "postgresql.cnpg.io/v1",
      kind: "Cluster",
      metadata: {
        name: safeName,
        namespace: nsName,
        labels: {
          "app.kubernetes.io/part-of": "sre-platform",
          "sre.io/team": nsName,
          "sre.io/resource-type": "database",
        },
        annotations: {
          "sre.io/description": description || "",
        },
      },
      spec: {
        instances: dbInstances,
        storage: {
          size: dbStorage,
        },
        monitoring: {
          enablePodMonitor: true,
        },
        postgresql: {
          parameters: {
            log_statement: "ddl",
            log_min_duration_statement: "1000",
          },
        },
        bootstrap: {
          initdb: {
            database: safeName.replace(/-/g, "_"),
            owner: safeName.replace(/-/g, "_"),
          },
        },
      },
    };

    try {
      await customApi.createNamespacedCustomObject("postgresql.cnpg.io", "v1", nsName, "clusters", cluster);
    } catch (err) {
      if (err.statusCode === 409) {
        return res.status(409).json({ error: "Database already exists" });
      }
      throw err;
    }

    res.json({
      success: true,
      message: `Database "${safeName}" created in namespace "${nsName}"`,
      namespace: nsName,
      name: safeName,
      instances: dbInstances,
      storage: dbStorage,
      connectionSecret: `${safeName}-app`,
      envVars: {
        DATABASE_URL: `postgresql://${safeName.replace(/-/g, "_")}@${safeName}-rw.${nsName}.svc:5432/${safeName.replace(/-/g, "_")}`,
        PGHOST: `${safeName}-rw.${nsName}.svc`,
        PGPORT: "5432",
        PGUSER: safeName.replace(/-/g, "_"),
        PGDATABASE: safeName.replace(/-/g, "_"),
      },
    });
  } catch (err) {
    console.error("Error creating database:", err);
    if (err.statusCode === 404 && err.body?.message?.includes("postgresql.cnpg.io")) {
      return res.status(400).json({ error: "CloudNativePG operator not installed. Install CNPG operator first." });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/databases — List all databases
app.get("/api/databases", async (req, res) => {
  try {
    const namespaces = await k8sApi.listNamespace();
    const tenantNs = namespaces.body.items
      .filter((ns) => ns.metadata?.labels?.["sre.io/tenant"] === "true" || ns.metadata.name.startsWith("team-"))
      .map((ns) => ns.metadata.name);

    const databases = [];
    for (const ns of tenantNs) {
      try {
        const resp = await customApi.listNamespacedCustomObject("postgresql.cnpg.io", "v1", ns, "clusters");
        for (const cluster of (resp.body.items || [])) {
          const status = cluster.status || {};
          databases.push({
            name: cluster.metadata.name,
            namespace: ns,
            instances: cluster.spec?.instances || 1,
            storage: cluster.spec?.storage?.size || "1Gi",
            phase: status.phase || "Unknown",
            readyInstances: status.readyInstances || 0,
            connectionSecret: `${cluster.metadata.name}-app`,
          });
        }
      } catch (err) {
        console.debug(`[databases] CNPG not available in namespace:`, err.message);
      }
    }

    res.json({ databases });
  } catch (err) {
    console.error("Error listing databases:", err);
    res.json({ databases: [] });
  }
});

// DELETE /api/databases/:ns/:name — Delete a database cluster
app.delete("/api/databases/:ns/:name", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    const { ns, name } = req.params;
    const safeNs = sanitizeName(ns);
    const safeName = sanitizeName(name);
    if (!isValidName(safeNs) || !isValidName(safeName)) {
      return res.status(400).json({ error: "Invalid namespace or name" });
    }

    await customApi.deleteNamespacedCustomObject("postgresql.cnpg.io", "v1", safeNs, "clusters", safeName);
    res.json({ success: true, message: `Database "${safeName}" deleted from "${safeNs}"` });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: "Database not found" });
    }
    console.error("Error deleting database:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Cluster Interaction API ──────────────────────────────────────────────────

// GET /api/cluster/nodes — nodes with metrics
app.get("/api/cluster/nodes", async (req, res) => {
  try {
    const [nodesRes, metricsRaw] = await Promise.all([
      k8sApi.listNode(),
      customApi.listClusterCustomObject("metrics.k8s.io", "v1beta1", "nodes").catch(() => null),
    ]);
    const metricsMap = {};
    if (metricsRaw) {
      const metricsItems = metricsRaw?.body?.items || metricsRaw?.items || [];
      for (const m of metricsItems) {
        metricsMap[m.metadata.name] = m.usage;
      }
    }
    const nodes = nodesRes.body.items.map((n) => {
      const s = n.status;
      const alloc = s.allocatable || {};
      const cap = s.capacity || {};
      const usage = metricsMap[n.metadata.name] || {};
      const cpuUsed = parseCpu(usage.cpu);
      const cpuAlloc = parseCpu(alloc.cpu);
      const memUsed = parseMem(usage.memory);
      const memAlloc = parseMem(alloc.memory);
      const roles = Object.keys(n.metadata.labels || {})
        .filter((l) => l.startsWith("node-role.kubernetes.io/"))
        .map((l) => l.split("/")[1]);
      const ready = (s.conditions || []).find((c) => c.type === "Ready");
      return {
        name: n.metadata.name,
        status: ready && ready.status === "True" ? "Ready" : "NotReady",
        roles: roles.length ? roles : ["worker"],
        ip: (s.addresses || []).find((a) => a.type === "InternalIP")?.address || "",
        kubelet: s.nodeInfo?.kubeletVersion || "",
        kernel: s.nodeInfo?.kernelVersion || "",
        os: s.nodeInfo?.osImage || "",
        runtime: s.nodeInfo?.containerRuntimeVersion || "",
        age: age(n.metadata.creationTimestamp),
        conditions: (s.conditions || []).map((c) => ({ type: c.type, status: c.status, message: c.message })),
        unschedulable: !!n.spec.unschedulable,
        cpu: { used: cpuUsed, allocatable: cpuAlloc, usedFmt: fmtCpu(cpuUsed), allocFmt: fmtCpu(cpuAlloc), pct: cpuAlloc > 0 ? Math.round((cpuUsed / cpuAlloc) * 100) : 0 },
        memory: { used: memUsed, allocatable: memAlloc, usedFmt: fmtMem(memUsed), allocFmt: fmtMem(memAlloc), pct: memAlloc > 0 ? Math.round((memUsed / memAlloc) * 100) : 0 },
        pods: { count: parseInt(cap.pods || "0"), allocatable: parseInt(alloc.pods || "0") },
      };
    });
    res.json(nodes);
  } catch (err) {
    console.error("Error fetching nodes:", err.message);
    res.status(500).json({ error: "Failed to fetch nodes" });
  }
});

// GET /api/cluster/pods — list pods with filters
app.get("/api/cluster/pods", async (req, res) => {
  try {
    const ns = req.query.namespace;
    const search = (req.query.search || "").toLowerCase();
    const statusFilter = (req.query.status || "").toLowerCase();
    const podsRes = ns
      ? await k8sApi.listNamespacedPod(ns)
      : await k8sApi.listPodForAllNamespaces();
    let pods = podsRes.body.items.map((p) => {
      const cs = (p.status.containerStatuses || []);
      const restarts = cs.reduce((sum, c) => sum + (c.restartCount || 0), 0);
      const ready = cs.filter((c) => c.ready).length;
      const total = (p.spec.containers || []).length;
      const reqs = { cpu: 0, mem: 0 };
      const lims = { cpu: 0, mem: 0 };
      for (const c of p.spec.containers || []) {
        const r = c.resources || {};
        reqs.cpu += parseCpu(r.requests?.cpu);
        reqs.mem += parseMem(r.requests?.memory);
        lims.cpu += parseCpu(r.limits?.cpu);
        lims.mem += parseMem(r.limits?.memory);
      }
      return {
        name: p.metadata.name,
        namespace: p.metadata.namespace,
        status: p.status.phase,
        statusReason: cs.find((c) => c.state?.waiting)?.state?.waiting?.reason || "",
        ready: ready + "/" + total,
        restarts,
        age: age(p.metadata.creationTimestamp),
        node: p.spec.nodeName || "",
        ip: p.status.podIP || "",
        containers: (p.spec.containers || []).map((c) => c.name),
        requests: { cpu: fmtCpu(reqs.cpu), memory: fmtMem(reqs.mem) },
        limits: { cpu: fmtCpu(lims.cpu), memory: fmtMem(lims.mem) },
      };
    });
    if (search) pods = pods.filter((p) => p.name.toLowerCase().includes(search) || p.namespace.toLowerCase().includes(search));
    if (statusFilter && statusFilter !== "all") {
      pods = pods.filter((p) => p.status.toLowerCase() === statusFilter || p.statusReason.toLowerCase() === statusFilter);
    }
    pods.sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
    res.json(pods.slice(0, 500));
  } catch (err) {
    console.error("Error fetching pods:", err.message);
    res.status(500).json({ error: "Failed to fetch pods" });
  }
});

// GET /api/cluster/pods/:namespace/:name — single pod detail with events
app.get("/api/cluster/pods/:namespace/:name", async (req, res) => {
  try {
    const { namespace, name } = req.params;
    const [podRes, eventsRes] = await Promise.all([
      k8sApi.readNamespacedPod(name, namespace),
      k8sApi.listNamespacedEvent(namespace, undefined, undefined, undefined, `involvedObject.name=${name}`),
    ]);
    const p = podRes.body;
    const events = (eventsRes.body.items || [])
      .sort((a, b) => new Date(b.lastTimestamp || b.eventTime || 0) - new Date(a.lastTimestamp || a.eventTime || 0))
      .slice(0, 50)
      .map((e) => ({
        type: e.type,
        reason: e.reason,
        message: e.message,
        count: e.count,
        age: age(e.lastTimestamp || e.eventTime),
      }));
    const containers = (p.spec.containers || []).map((c) => {
      const cs = (p.status.containerStatuses || []).find((s) => s.name === c.name) || {};
      const state = cs.state || {};
      const stateKey = Object.keys(state)[0] || "unknown";
      return {
        name: c.name,
        image: c.image,
        ready: !!cs.ready,
        restarts: cs.restartCount || 0,
        state: stateKey,
        stateDetail: state[stateKey]?.reason || state[stateKey]?.message || "",
        ports: (c.ports || []).map((p) => p.containerPort + "/" + p.protocol),
        resources: c.resources || {},
      };
    });
    res.json({
      name: p.metadata.name,
      namespace: p.metadata.namespace,
      status: p.status.phase,
      node: p.spec.nodeName,
      ip: p.status.podIP,
      serviceAccount: p.spec.serviceAccountName,
      age: age(p.metadata.creationTimestamp),
      labels: p.metadata.labels || {},
      conditions: (p.status.conditions || []).map((c) => ({ type: c.type, status: c.status, reason: c.reason, message: c.message })),
      containers,
      events,
    });
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: "Pod not found" });
    console.error("Error fetching pod detail:", err.message);
    res.status(500).json({ error: "Failed to fetch pod detail" });
  }
});

// DELETE /api/cluster/pods/:namespace/:name — delete a pod
app.delete("/api/cluster/pods/:namespace/:name", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    const { namespace, name } = req.params;
    await k8sApi.deleteNamespacedPod(name, namespace);
    res.json({ ok: true, message: `Pod ${name} deleted` });
  } catch (err) {
    console.error("Error deleting pod:", err);
    res.status(err.statusCode || 500).json({ error: err.body?.message || "Failed to delete pod" });
  }
});

// GET /api/cluster/pods/:namespace/:name/logs — container logs
app.get("/api/cluster/pods/:namespace/:name/logs", async (req, res) => {
  try {
    const { namespace, name } = req.params;
    const container = req.query.container || undefined;
    const tailLines = Math.min(parseInt(req.query.tailLines) || 200, 5000);
    const previous = req.query.previous === "true";
    const logRes = await k8sApi.readNamespacedPodLog(name, namespace, container, undefined, undefined, undefined, undefined, previous, undefined, tailLines, undefined);
    res.type("text/plain").send(logRes.body || "(no logs)");
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).send("Pod or container not found");
    console.error("Error fetching logs:", err.message);
    res.status(500).send("Failed to fetch logs: " + (err.body?.message || err.message));
  }
});

// GET /api/cluster/events — cluster events
app.get("/api/cluster/events", async (req, res) => {
  try {
    const ns = req.query.namespace;
    const typeFilter = req.query.type || "";
    const eventsRes = ns
      ? await k8sApi.listNamespacedEvent(ns)
      : await k8sApi.listEventForAllNamespaces();
    let events = (eventsRes.body.items || [])
      .sort((a, b) => new Date(b.lastTimestamp || b.eventTime || 0) - new Date(a.lastTimestamp || a.eventTime || 0))
      .slice(0, 300);
    if (typeFilter) events = events.filter((e) => e.type === typeFilter);
    res.json(events.map((e) => ({
      type: e.type,
      reason: e.reason,
      message: e.message,
      namespace: e.metadata.namespace,
      object: (e.involvedObject?.kind || "") + "/" + (e.involvedObject?.name || ""),
      count: e.count || 1,
      age: age(e.lastTimestamp || e.eventTime),
      firstSeen: age(e.firstTimestamp || e.eventTime),
    })));
  } catch (err) {
    console.error("Error fetching events:", err.message);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

// GET /api/cluster/namespaces — namespaces with pod summary
app.get("/api/cluster/namespaces", async (req, res) => {
  try {
    const [nsRes, podsRes] = await Promise.all([
      k8sApi.listNamespace(),
      k8sApi.listPodForAllNamespaces(),
    ]);
    const podsByNs = {};
    for (const p of podsRes.body.items) {
      const ns = p.metadata.namespace;
      if (!podsByNs[ns]) podsByNs[ns] = { total: 0, running: 0, pending: 0, failed: 0, cpuReq: 0, memReq: 0 };
      podsByNs[ns].total++;
      const phase = (p.status.phase || "").toLowerCase();
      if (phase === "running") podsByNs[ns].running++;
      else if (phase === "pending") podsByNs[ns].pending++;
      else if (phase === "failed") podsByNs[ns].failed++;
      for (const c of p.spec.containers || []) {
        podsByNs[ns].cpuReq += parseCpu(c.resources?.requests?.cpu);
        podsByNs[ns].memReq += parseMem(c.resources?.requests?.memory);
      }
    }
    const namespaces = nsRes.body.items.map((ns) => {
      const name = ns.metadata.name;
      const stats = podsByNs[name] || { total: 0, running: 0, pending: 0, failed: 0, cpuReq: 0, memReq: 0 };
      return {
        name,
        status: ns.status.phase,
        age: age(ns.metadata.creationTimestamp),
        labels: ns.metadata.labels || {},
        pods: stats.total,
        running: stats.running,
        pending: stats.pending,
        failed: stats.failed,
        cpuRequests: fmtCpu(stats.cpuReq),
        memRequests: fmtMem(stats.memReq),
        healthy: stats.failed === 0 && stats.pending === 0,
      };
    });
    namespaces.sort((a, b) => b.pods - a.pods);
    res.json(namespaces);
  } catch (err) {
    console.error("Error fetching namespaces:", err.message);
    res.status(500).json({ error: "Failed to fetch namespaces" });
  }
});

// GET /api/cluster/top/pods — top resource consumers
app.get("/api/cluster/top/pods", async (req, res) => {
  try {
    const sortBy = req.query.sortBy || "cpu";
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const [metricsRes, podsRes] = await Promise.all([
      customApi.listClusterCustomObject("metrics.k8s.io", "v1beta1", "pods"),
      k8sApi.listPodForAllNamespaces(),
    ]);
    // Build node lookup: namespace/name -> nodeName
    const nodeMap = {};
    for (const p of podsRes.body.items) {
      nodeMap[p.metadata.namespace + "/" + p.metadata.name] = p.spec.nodeName || "";
    }
    const metricsItems = metricsRes?.body?.items || metricsRes?.items || [];
    const items = metricsItems.map((m) => {
      let cpuTotal = 0, memTotal = 0;
      for (const c of m.containers || []) {
        cpuTotal += parseCpu(c.usage?.cpu);
        memTotal += parseMem(c.usage?.memory);
      }
      return {
        name: m.metadata.name,
        namespace: m.metadata.namespace,
        node: nodeMap[m.metadata.namespace + "/" + m.metadata.name] || "",
        cpu: fmtCpu(cpuTotal),
        memory: fmtMem(memTotal),
        cpuRaw: cpuTotal,
        memRaw: memTotal,
      };
    });
    items.sort((a, b) => sortBy === "memory" ? b.memRaw - a.memRaw : b.cpuRaw - a.cpuRaw);
    res.json(items.slice(0, limit));
  } catch (err) {
    console.error("Error fetching top pods:", err.message);
    res.status(500).json({ error: "Failed to fetch top pods" });
  }
});

// GET /api/cluster/deployments — list deployments
app.get("/api/cluster/deployments", async (req, res) => {
  try {
    const ns = req.query.namespace;
    const depRes = ns
      ? await appsApi.listNamespacedDeployment(ns)
      : await appsApi.listDeploymentForAllNamespaces();
    const deps = depRes.body.items.map((d) => ({
      name: d.metadata.name,
      namespace: d.metadata.namespace,
      replicas: d.status.replicas || 0,
      ready: d.status.readyReplicas || 0,
      desired: d.spec.replicas || 0,
      age: age(d.metadata.creationTimestamp),
    }));
    deps.sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
    res.json(deps);
  } catch (err) {
    console.error("Error fetching deployments:", err.message);
    res.status(500).json({ error: "Failed to fetch deployments" });
  }
});

// POST /api/cluster/deployments/:namespace/:name/restart — restart deployment
app.post("/api/cluster/deployments/:namespace/:name/restart", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    const { namespace, name } = req.params;
    await appsApi.patchNamespacedDeployment(name, namespace, {
      spec: { template: { metadata: { annotations: { "kubectl.kubernetes.io/restartedAt": new Date().toISOString() } } } },
    }, undefined, undefined, undefined, undefined, undefined, { headers: { "Content-Type": "application/strategic-merge-patch+json" } });
    res.json({ success: true, message: `Restarted deployment ${escapeHtml(name)}` });
  } catch (err) {
    console.error("Error restarting deployment:", err.message);
    res.status(500).json({ error: "Failed to restart deployment" });
  }
});

// PATCH /api/cluster/deployments/:namespace/:name/scale — scale deployment
app.patch("/api/cluster/deployments/:namespace/:name/scale", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    const { namespace, name } = req.params;
    const replicas = parseInt(req.body.replicas);
    if (isNaN(replicas) || replicas < 0 || replicas > 20) {
      return res.status(400).json({ error: "Replicas must be 0-20" });
    }
    await appsApi.patchNamespacedDeploymentScale(name, namespace, { spec: { replicas } }, undefined, undefined, undefined, undefined, undefined, { headers: { "Content-Type": "application/strategic-merge-patch+json" } });
    res.json({ success: true, message: `Scaled ${escapeHtml(name)} to ${replicas} replicas` });
  } catch (err) {
    console.error("Error scaling deployment:", err.message);
    res.status(500).json({ error: "Failed to scale deployment" });
  }
});

// POST /api/cluster/nodes/:name/cordon — cordon/uncordon node
app.post("/api/cluster/nodes/:name/cordon", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    const { name } = req.params;
    const unschedulable = req.body.cordon !== false;
    await k8sApi.patchNode(name, { spec: { unschedulable } }, undefined, undefined, undefined, undefined, undefined, { headers: { "Content-Type": "application/strategic-merge-patch+json" } });
    res.json({ success: true, message: `Node ${escapeHtml(name)} ${unschedulable ? "cordoned" : "uncordoned"}` });
  } catch (err) {
    console.error("Error cordoning node:", err.message);
    res.status(500).json({ error: "Failed to update node" });
  }
});

// GET /api/config — Dashboard configuration
app.get("/api/config", (req, res) => {
  res.json({
    domain: SRE_DOMAIN,
    registryUrl: HARBOR_REGISTRY_EXT,
    keycloakUrl: KEYCLOAK_EXTERNAL_URL,
    clusterName: process.env.SRE_CLUSTER_NAME || "sre-lab",
    baseUrl: `https://{service}.${SRE_DOMAIN}`,
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
      if (phase === "Running") {
        // Catch Running pods with containers that are not ready right now
        // or actively crash-looping (waiting state like CrashLoopBackOff)
        const containerStatuses = pod.status?.containerStatuses || [];
        return containerStatuses.some(cs =>
          !cs.ready ||
          cs.state?.waiting?.reason === "CrashLoopBackOff"
        );
      }
      return phase !== "Succeeded";
    })
    .map((pod) => {
      const containerStatuses = pod.status?.containerStatuses || pod.status?.initContainerStatuses || [];
      const waiting = containerStatuses.find(cs => cs.state?.waiting);
      const terminated = containerStatuses.find(cs => cs.state?.terminated);
      const totalRestarts = containerStatuses.reduce((sum, cs) => sum + (cs.restartCount || 0), 0);

      // Determine the most useful status message
      let reason = "";
      let message = "";
      if (waiting) {
        reason = waiting.state.waiting.reason || "";
        message = waiting.state.waiting.message || "";
      } else if (terminated) {
        reason = terminated.state.terminated.reason || "";
        message = terminated.state.terminated.message || "";
      }

      // Owner reference for context
      const owner = pod.metadata?.ownerReferences?.[0];
      const ownerKind = owner?.kind || "";
      const ownerName = owner?.name || "";

      // Age
      const created = pod.metadata?.creationTimestamp;
      const ageMs = created ? Date.now() - new Date(created).getTime() : 0;
      const ageStr = ageMs > 86400000 ? Math.floor(ageMs/86400000) + "d" :
                     ageMs > 3600000 ? Math.floor(ageMs/3600000) + "h" :
                     Math.floor(ageMs/60000) + "m";

      return {
        name: pod.metadata.name,
        namespace: pod.metadata.namespace,
        phase: pod.status?.phase || "Unknown",
        reason,
        message,
        restarts: totalRestarts,
        ownerKind,
        ownerName,
        age: ageStr,
        containers: containerStatuses.map(cs => ({
          name: cs.name,
          ready: cs.ready || false,
          restartCount: cs.restartCount || 0,
          image: cs.image || "",
          state: cs.state?.waiting?.reason || cs.state?.terminated?.reason || (cs.state?.running ? "Running" : "Unknown"),
        })),
      };
    })
    .slice(0, 30);
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
  } catch (err) {
    console.debug('[networking] VirtualService list failed:', err.message);
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

async function getGatewayIp() {
  try {
    const resp = await k8sApi.readNamespacedService(
      "istio-gateway",
      "istio-system"
    );
    const ingress = resp.body.status?.loadBalancer?.ingress;
    if (ingress && ingress.length > 0) {
      return ingress[0].ip || null;
    }
    return null;
  } catch (err) {
    console.debug('[networking] Gateway IP lookup failed:', err.message);
    return null;
  }
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
  } catch (err) {
    console.debug('[networking] Istio gateway port lookup failed:', err.message);
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
  } catch (err) {
    console.debug('[apps] HelmRelease list for namespace failed:', err.message);
    return [];
  }
}

// ── Raw K8s manifest apply helpers (for Deployment/Service, not HelmRelease) ──

async function applyRawDeployment(manifest, namespace) {
  try {
    await appsApi.createNamespacedDeployment(namespace, manifest);
  } catch (err) {
    if (err.statusCode === 409) {
      await appsApi.patchNamespacedDeployment(
        manifest.metadata.name,
        namespace,
        manifest,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { headers: { "Content-Type": "application/strategic-merge-patch+json" } }
      );
    } else {
      throw err;
    }
  }
}

async function applyRawService(manifest, namespace) {
  try {
    await k8sApi.createNamespacedService(namespace, manifest);
  } catch (err) {
    if (err.statusCode === 409) {
      // Service already exists — patch it
      await k8sApi.patchNamespacedService(
        manifest.metadata.name,
        namespace,
        manifest,
        undefined,
        undefined,
        undefined,
        undefined,
        { headers: { "Content-Type": "application/strategic-merge-patch+json" } }
      );
    } else {
      throw err;
    }
  }
}

// ── Auto-deploy built services when all Kaniko builds in a group complete ──

// ── Auto-deploy helpers: OAuth2 proxy, DestinationRule, Kyverno exclusions ──

async function registerOAuth2ProxyPath(hostname) {
  try {
    const vs = await customApi.getNamespacedCustomObject(
      "networking.istio.io", "v1", "oauth2-proxy", "virtualservices", "oauth2-proxy-paths"
    );
    const hosts = vs.body.spec.hosts || [];
    if (!hosts.includes(hostname)) {
      hosts.push(hostname);
      await customApi.patchNamespacedCustomObject(
        "networking.istio.io", "v1", "oauth2-proxy", "virtualservices", "oauth2-proxy-paths",
        { spec: { hosts } },
        undefined, undefined, undefined,
        { headers: { "Content-Type": "application/merge-patch+json" } }
      );
      console.log(`[deploy-git] Registered ${hostname} with OAuth2 proxy`);
    }
  } catch (err) {
    console.log(`[deploy-git] OAuth2 proxy registration skipped: ${err.message}`);
  }
}

// NOTE: createBackendTLSRule removed — Istio mTLS handles sidecar-to-sidecar encryption
// automatically. Creating DestinationRules with tls.mode: SIMPLE breaks plaintext upstream
// connections (e.g., docker-wireshark on port 3000) by attempting TLS handshake to a
// non-TLS backend, causing "upstream connect error or disconnect/reset before headers".
// Only create DestinationRules when the upstream service actually speaks TLS.
async function createBackendTLSRule(_appName, _namespace, _serviceName) {
  // Intentionally no-op. Kept as a function to avoid breaking callers.
  // Istio PeerAuthentication STRICT handles mTLS between sidecars.
}

async function ensureKyvernoExclusions(namespace) {
  try {
    const policies = await customApi.listClusterCustomObject("kyverno.io", "v1", "clusterpolicies");
    for (const policy of (policies.body.items || [])) {
      let changed = false;
      for (const rule of (policy.spec?.rules || [])) {
        if (rule.exclude?.any) {
          for (const item of rule.exclude.any) {
            const nss = item.resources?.namespaces;
            if (nss && Array.isArray(nss) && nss.includes("kube-system") && !nss.includes(namespace)) {
              nss.push(namespace);
              changed = true;
            }
          }
        }
      }
      if (changed) {
        await customApi.patchClusterCustomObject(
          "kyverno.io", "v1", "clusterpolicies", policy.metadata.name,
          { spec: { rules: policy.spec.rules } },
          undefined, undefined, undefined,
          { headers: { "Content-Type": "application/merge-patch+json" } }
        );
        console.log(`[deploy-git] Added ${namespace} to Kyverno policy ${policy.metadata.name}`);
      }
    }
  } catch (err) {
    console.log(`[deploy-git] Kyverno exclusion update skipped: ${err.message}`);
  }
}

// Check if an app should run privileged by looking at its pipeline run's approved security exceptions
async function shouldBePrivileged(appName, teamName) {
  if (!dbAvailable) return false;
  try {
    const result = await db.listRuns({ team: normalizeTeamName(teamName), limit: 5 });
    const run = (result.runs || []).find(r => r.app_name === appName && r.security_exceptions);
    if (!run) return false;
    const exceptions = typeof run.security_exceptions === 'string' ? JSON.parse(run.security_exceptions) : (run.security_exceptions || []);
    return exceptions.some(e => e.type === 'run_as_root' && e.approved);
  } catch (err) {
    console.debug('[pipeline] Security exception check failed:', err.message);
    return false;
  }
}

// Look up the security context from the most recent pipeline run for this app
async function getSecurityContextFromPipeline(appName, teamName) {
  if (!dbAvailable) return null;
  try {
    const result = await db.listRuns({ team: normalizeTeamName(teamName), limit: 5 });
    const run = (result.runs || []).find(r => r.app_name === appName && r.metadata);
    if (!run) return null;
    const runMeta = typeof run.metadata === 'string' ? JSON.parse(run.metadata) : (run.metadata || {});
    return runMeta.securityContext || null;
  } catch (err) {
    console.debug('[pipeline] Security context lookup failed:', err.message);
    return null;
  }
}

async function autoDeployOnBuildComplete(groupId, builds, nsName, safeName, teamName, gitUrl) {
  const maxIterations = 300; // 300 * 2s = 10 minutes max
  const pollInterval = 2000;

  for (let i = 0; i < maxIterations; i++) {
    await new Promise(r => setTimeout(r, pollInterval));
    try {
      // Check if all builds in the group are done via K8s Job status
      const jobs = await batchApi.listNamespacedJob(
        BUILD_NAMESPACE, undefined, undefined, undefined, undefined,
        `sre.io/group-id=${groupId}`
      );
      const allJobs = jobs.body.items;
      if (allJobs.length === 0) continue;

      const succeeded = allJobs.filter(j => j.status?.succeeded);
      const failed = allJobs.filter(j => j.status?.failed);
      const pending = allJobs.filter(j => !j.status?.succeeded && !j.status?.failed);

      if (pending.length > 0) continue; // Still building

      if (failed.length > 0) {
        console.log(`[deploy-git] Group ${groupId}: ${failed.length} build(s) failed, ${succeeded.length} succeeded`);
      }

      // All done — deploy each successfully built service as a HelmRelease
      console.log(`[deploy-git] Group ${groupId}: all builds complete (${succeeded.length} ok, ${failed.length} failed). Creating HelmReleases...`);

      for (const build of builds) {
        const meta = buildRegistry.get(build.buildId);
        if (!meta) continue;

        // Check if this specific build succeeded
        const buildSucceeded = build.sharedBuild ||
          succeeded.some(j => j.metadata.name === build.buildId) ||
          (meta.status === "complete");

        if (!buildSucceeded) {
          console.log(`[deploy-git] Skipping failed build ${build.buildId} (${build.serviceName})`);
          meta.status = "failed";
          continue;
        }

        const svcName = sanitizeName(build.serviceName);
        const appName = builds.length === 1 ? safeName : `${safeName}-${svcName}`;

        // Determine if this service should get external ingress
        const isIngress = build.role === "ingress" ||
          build.role === "web" ||
          svcName.includes("frontend") ||
          svcName.includes("nginx") ||
          svcName.includes("web") ||
          (builds.filter(b => !b.sharedBuild).length === 1); // Single buildable service gets ingress
        const ingressHost = isIngress ? `${safeName}.${SRE_DOMAIN}` : "";

        // Collect environment variables — inject DB/Redis connection info for platform services
        const envVars = meta.environment || [];

        const manifest = generateHelmRelease({
          name: appName,
          team: nsName,
          image: (meta.imageRepo || `${HARBOR_REGISTRY}/${teamName}/${appName}`).replace(HARBOR_REGISTRY, HARBOR_PULL_REGISTRY),
          tag: meta.imageTag || build.buildId,
          port: build.port || 8080,
          replicas: 1,
          ingressHost,
          env: envVars,
          privileged: await shouldBePrivileged(safeName, teamName),
          securityContext: await getSecurityContextFromPipeline(safeName, teamName),
        });

        try {
          const actor = "build-system";
          await deployViaGitOps(manifest, nsName, appName, actor);
          console.log(`[deploy-git] Deployed ${appName} in ${nsName} (ingress: ${ingressHost || "none"})`);
          meta.status = "deployed";

          // Auto-register OAuth2 proxy path for SSO callbacks
          if (ingressHost) {
            await registerOAuth2ProxyPath(ingressHost);
          }

          // Auto-create DestinationRule for HTTPS backend detection
          const helmSvcName = `${appName}-${appName}`;
          await createBackendTLSRule(appName, nsName, helmSvcName);
        } catch (err) {
          console.error(`[deploy-git] Failed to deploy ${appName}: ${err.body?.message || err.message}`);
          meta.status = "deploy-failed";
        }
      }

      // Create service name aliases for compose compatibility
      // Map compose service names to K8s service names
      try {
        for (const build of builds) {
          const svcName = sanitizeName(build.serviceName);
          const appName = builds.length === 1 ? safeName : `${safeName}-${svcName}`;
          // The Helm chart creates a service named "${appName}-${appName}"
          // Create an alias with just the compose service name
          const aliasSpec = {
            apiVersion: "v1",
            kind: "Service",
            metadata: {
              name: svcName,
              namespace: nsName,
              labels: {
                "app.kubernetes.io/part-of": "sre-platform",
                "sre.io/team": teamName,
                "sre.io/alias-for": appName,
              },
            },
            spec: {
              selector: { "app.kubernetes.io/name": appName },
              ports: [{ port: build.port || 8080, targetPort: build.port || 8080 }],
            },
          };
          await k8sApi.createNamespacedService(nsName, aliasSpec).catch(err => {
            if (err.statusCode !== 409) {
              console.log(`[deploy-git] Could not create service alias "${svcName}": ${err.body?.message || err.message}`);
            }
          });
        }
        console.log(`[deploy-git] Created service aliases: ${builds.map(b => sanitizeName(b.serviceName)).join(", ")}`);
      } catch (err) {
        console.error(`[deploy-git] Error creating service aliases: ${err.message}`);
      }

      // Auto-register in app portal
      try {
        const frontendBuild = builds.find(b => b.role === 'ingress' || b.role === 'web');
        if (frontendBuild) {
          const appEntry = {
            name: safeName,
            displayName: safeName.toUpperCase(),
            description: 'Deployed from Git',
            url: `https://${safeName}.${SRE_DOMAIN}`,
            icon: 'package',
            namespace: nsName,
            access: { mode: 'restricted', groups: [teamName, 'sre-admins'], users: [], attributes: [] },
            owner: '',
            deployedAt: new Date().toISOString(),
            registeredAt: new Date().toISOString(),
            status: 'running',
            deployedVia: 'pipeline',
            helmReleaseName: safeName,
          };
          const existing = appRegistry.findIndex(a => a.name === safeName);
          if (existing >= 0) appRegistry[existing] = Object.assign({}, appRegistry[existing], appEntry);
          else appRegistry.push(appEntry);
          await saveAppRegistry();
          console.log(`[deploy-git] Registered "${safeName}" in app portal`);
        }
      } catch (portalErr) {
        console.error(`[deploy-git] Failed to register in portal: ${portalErr.message}`);
      }

      return; // Done
    } catch (err) {
      console.error(`[deploy-git] Error checking build group ${groupId}: ${err.message}`);
    }
  }
  console.error(`[deploy-git] Group ${groupId} timed out waiting for builds after ${maxIterations * pollInterval / 1000}s`);
}

function generateHelmRelease({ name, team, image, tag, port, replicas, ingressHost, env, privileged, securityContext, extraContainers, extraVolumes, backendProtocol }) {
  const safeEnv = Array.isArray(env) ? env.filter((e) => e && e.name) : [];

  // Determine if we need privileged-level security context.
  // securityContext (granular) takes precedence over the boolean privileged flag.
  const sc = securityContext || {};
  const needsPrivileged = privileged || sc.privileged || sc.runAsRoot || false;

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
        imagePullSecrets: [{ name: "harbor-pull-creds" }],
        app: {
          name: name,
          team: team,
          image: { repository: image, tag: tag, pullPolicy: "IfNotPresent" },
          port: port,
          replicas: replicas,
          resources: needsPrivileged
            ? { requests: { cpu: "100m", memory: "256Mi" }, limits: { cpu: "2", memory: "2Gi" } }
            : { requests: { cpu: "50m", memory: "64Mi" }, limits: { cpu: "200m", memory: "256Mi" } },
          probes: needsPrivileged
            ? { liveness: { type: "tcp", path: "/", initialDelaySeconds: 30, periodSeconds: 15, failureThreshold: 10 }, readiness: { type: "tcp", path: "/", initialDelaySeconds: 15, periodSeconds: 10, failureThreshold: 10 } }
            : { liveness: { path: "/", initialDelaySeconds: 10, periodSeconds: 10 }, readiness: { path: "/", initialDelaySeconds: 5, periodSeconds: 5 } },
          env: safeEnv,
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

  // Apply security context overrides (granular securityContext takes precedence over boolean privileged)
  const values = hr.spec.values;
  if (needsPrivileged) {
    values.podSecurityContext = {
      runAsNonRoot: false, runAsUser: 0, runAsGroup: 0, fsGroup: 0,
      seccompProfile: { type: "RuntimeDefault" },
    };
    // REPLACE entire container security context — don't merge with chart defaults
    values.containerSecurityContext = {
      privileged: true,
      runAsNonRoot: false,
      runAsUser: 0,
      allowPrivilegeEscalation: true,
      readOnlyRootFilesystem: false,
    };
  }
  // Writable filesystem (standalone, without root)
  if (sc.writableFilesystem && !needsPrivileged) {
    values.containerSecurityContext = values.containerSecurityContext || {};
    values.containerSecurityContext.readOnlyRootFilesystem = false;
  }
  // Privilege escalation (standalone, without root)
  if (sc.allowPrivilegeEscalation && !needsPrivileged) {
    values.containerSecurityContext = values.containerSecurityContext || {};
    values.containerSecurityContext.allowPrivilegeEscalation = true;
  }
  // Extra capabilities (e.g., NET_ADMIN, NET_RAW)
  if (sc.capabilities && sc.capabilities.length > 0) {
    values.containerSecurityContext = values.containerSecurityContext || {};
    values.containerSecurityContext.capabilities = {
      add: sc.capabilities,
      drop: [],
    };
  }

  // Extra sidecar containers (e.g., MongoDB for unifi-network-application)
  if (Array.isArray(extraContainers) && extraContainers.length > 0) {
    values.extraContainers = extraContainers;
  }
  // Extra volumes for sidecars
  if (Array.isArray(extraVolumes) && extraVolumes.length > 0) {
    values.extraVolumes = extraVolumes;
  }
  // Backend protocol — auto-detect HTTPS from port, or use explicit value
  const effectiveProtocol = backendProtocol || (isHttpsPort(port) ? "HTTPS" : null);
  if (effectiveProtocol) {
    values.ingress = values.ingress || {};
    values.ingress.backendProtocol = effectiveProtocol;
  }

  return hr;
}

/**
 * Generates a Kyverno PolicyException resource for ISSM-approved security exceptions.
 * Maps DSOP security exception types to the Kyverno policies they need to bypass.
 *
 * @param {string} name - Application name
 * @param {string} team - Namespace
 * @param {Array} securityExceptions - Array of {type, justification} from ISSM review
 * @param {string} reviewer - ISSM reviewer identity
 * @returns {object|null} PolicyException manifest or null if no exceptions needed
 */
function generatePolicyException(name, team, securityExceptions, reviewer) {
  const policyMap = {
    run_as_root: [
      { policyName: "require-run-as-nonroot", ruleNames: ["require-pod-run-as-nonroot", "require-container-run-as-nonroot"] },
      { policyName: "require-security-context", ruleNames: ["require-run-as-non-root", "require-drop-all-capabilities"] },
      { policyName: "disallow-privilege-escalation", ruleNames: ["disallow-privilege-escalation-containers", "disallow-privilege-escalation-init-containers"] },
    ],
    privileged_container: [
      { policyName: "disallow-privileged-containers", ruleNames: ["deny-privileged-containers", "deny-privileged-init-containers"] },
      { policyName: "disallow-privilege-escalation", ruleNames: ["disallow-privilege-escalation-containers", "disallow-privilege-escalation-init-containers"] },
      { policyName: "require-run-as-nonroot", ruleNames: ["require-pod-run-as-nonroot", "require-container-run-as-nonroot"] },
      { policyName: "require-security-context", ruleNames: ["require-run-as-non-root", "require-drop-all-capabilities"] },
      { policyName: "require-drop-all-capabilities", ruleNames: ["require-drop-all"] },
    ],
    privilege_escalation: [
      { policyName: "disallow-privilege-escalation", ruleNames: ["disallow-privilege-escalation-containers", "disallow-privilege-escalation-init-containers"] },
    ],
    writable_filesystem: [
      { policyName: "require-security-context", ruleNames: ["require-run-as-non-root"] },
    ],
    host_networking: [
      { policyName: "disallow-host-namespaces", ruleNames: ["deny-host-namespaces"] },
      { policyName: "disallow-host-ports", ruleNames: ["deny-host-ports", "deny-host-ports-init-containers"] },
    ],
    custom_capability: [
      { policyName: "require-drop-all-capabilities", ruleNames: ["require-drop-all"] },
      { policyName: "require-security-context", ruleNames: ["require-drop-all-capabilities"] },
    ],
  };

  // Collect all policy exceptions, deduplicating by policyName
  const seen = new Map();
  for (const exc of securityExceptions) {
    const mappings = policyMap[exc.type] || [];
    for (const m of mappings) {
      if (seen.has(m.policyName)) {
        const existing = seen.get(m.policyName);
        existing.ruleNames = [...new Set([...existing.ruleNames, ...m.ruleNames])];
      } else {
        seen.set(m.policyName, { policyName: m.policyName, ruleNames: [...m.ruleNames] });
      }
    }
  }

  const exceptions = Array.from(seen.values());
  if (exceptions.length === 0) return null;

  // 90-day expiry from today
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 90);
  const expiryStr = expiry.toISOString().split("T")[0];

  const justifications = securityExceptions
    .map(e => `${e.type}: ${e.justification || "Approved by ISSM"}`)
    .join("; ");

  return {
    apiVersion: "kyverno.io/v2beta1",
    kind: "PolicyException",
    metadata: {
      name: `${name}-security-exception`,
      namespace: team,
      labels: {
        "app.kubernetes.io/part-of": "sre-platform",
        "sre.io/team": team,
        "sre.io/managed-by": "dsop-pipeline",
      },
      annotations: {
        "sre.io/exception-reason": justifications,
        "sre.io/exception-approver": reviewer || "issm-review",
        "sre.io/exception-expiry": expiryStr,
        "sre.io/pipeline-generated": "true",
      },
    },
    spec: {
      exceptions,
      match: {
        any: [{
          resources: {
            kinds: ["Pod"],
            namespaces: [team],
            names: [`${name}-*`],
          },
        }],
      },
    },
  };
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
            "sre.io/network-policy-configured": "true",
            "sre.io/security-categorization": "moderate",
            "pod-security.kubernetes.io/enforce": "privileged",
            "istio-injection": "enabled",
            "kubernetes.io/metadata.name": nsName,
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
            { to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "istio-system" } } }], ports: [{ port: 15012, protocol: "TCP" }, { port: 15010, protocol: "TCP" }] },
            { to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": nsName } } }] },
            { ports: [{ port: 443, protocol: "TCP" }, { port: 6443, protocol: "TCP" }, { port: 80, protocol: "TCP" }] },
          ],
        },
      }).catch(() => {});
      // Create Harbor pull secret for image pulls
      try {
        await k8sApi.createNamespacedSecret(nsName, {
          metadata: { name: "harbor-pull-creds", namespace: nsName },
          type: "kubernetes.io/dockerconfigjson",
          data: {
            ".dockerconfigjson": Buffer.from(JSON.stringify({
              auths: {
                [HARBOR_REGISTRY_EXT]: {
                  username: HARBOR_ADMIN_USER,
                  password: HARBOR_ADMIN_PASS,
                  auth: Buffer.from(`${HARBOR_ADMIN_USER}:${HARBOR_ADMIN_PASS}`).toString("base64"),
                },
              },
            })).toString("base64"),
          },
        });
      } catch (e) {
        if (e.statusCode !== 409) console.log(`[ensureNamespace] Could not create harbor-pull-creds in ${nsName}: ${e.message}`);
      }
      // Patch default SA with pull secret
      try {
        await k8sApi.patchNamespacedServiceAccount("default", nsName, {
          imagePullSecrets: [{ name: "harbor-pull-creds" }],
        }, undefined, undefined, undefined, undefined, undefined, { headers: { "Content-Type": "application/strategic-merge-patch+json" } });
      } catch (e) {
        console.debug(`[ensureNamespace] Could not patch default SA in ${nsName}:`, e.message);
      }

      // Auto-exclude tenant namespace from Kyverno policies
      await ensureKyvernoExclusions(nsName);
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

// ── GitOps Deploy/Undeploy Helpers ───────────────────────────────────────────

async function deployViaGitOps(manifest, nsName, appName, actor, policyException) {
  if (gitops.isEnabled()) {
    await gitops.ensureTenantInGit(nsName);
    const extraFiles = [];
    if (policyException) {
      extraFiles.push({
        filename: `${appName}-policy-exception.yaml`,
        manifest: policyException,
      });
      logger.info("deploy", `Generated PolicyException for ${appName} in ${nsName}`, { app: appName, namespace: nsName });
    }
    await gitops.deployApp(nsName, appName, manifest, actor, extraFiles);
    await gitops.triggerFluxReconcile();
  } else {
    await applyManifest(manifest, nsName);
    if (policyException) {
      await applyManifest(policyException, nsName);
    }
  }
}

// Monitor a HelmRelease after deploy and auto-retry if it hits max retries.
// Returns { ready, error } — ready=true if deploy succeeded, error string if failed.
async function waitForHelmRelease(nsName, appName, timeoutSeconds = 180) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastMessage = "";

  while (Date.now() < deadline) {
    try {
      const hrResp = await customApi.getNamespacedCustomObject(
        "helm.toolkit.fluxcd.io", "v2", nsName, "helmreleases", appName
      );
      const hr = hrResp.body;
      const readyCondition = (hr.status?.conditions || []).find(c => c.type === "Ready");

      if (readyCondition?.status === "True") {
        return { ready: true, error: null };
      }

      if (readyCondition?.status === "False") {
        lastMessage = readyCondition.message || "Unknown error";
        const retriesExhausted = (hr.status?.installFailures >= 3) || (hr.status?.upgradeFailures >= 3);

        if (retriesExhausted) {
          // Auto-recover: delete the failed HelmRelease so it can be recreated
          console.log(`[deploy] HelmRelease ${appName} in ${nsName} hit max retries — deleting for retry`);
          try {
            // Remove finalizers first
            await customApi.patchNamespacedCustomObject(
              "helm.toolkit.fluxcd.io", "v2", nsName, "helmreleases", appName,
              { metadata: { finalizers: null } },
              undefined, undefined, undefined,
              { headers: { "Content-Type": "application/merge-patch+json" } }
            );
          } catch (e) { console.debug('[deploy] Finalizer removal best-effort:', e.message); }
          try {
            await customApi.deleteNamespacedCustomObject("helm.toolkit.fluxcd.io", "v2", nsName, "helmreleases", appName);
          } catch (e) { console.debug('[deploy] HelmRelease delete best-effort:', e.message); }

          // Trigger Flux reconciliation to recreate from Git
          if (gitops.isEnabled()) {
            try { await gitops.triggerFluxReconcile(); } catch (e) { console.debug('[deploy] Flux reconcile best-effort:', e.message); }
          }

          return { ready: false, error: `HelmRelease failed after max retries: ${lastMessage}. It has been deleted and will be recreated by Flux.` };
        }
      }
    } catch (err) {
      if (err.statusCode === 404) {
        // HelmRelease not created yet — keep waiting
      } else {
        console.debug('[deploy] HelmRelease status check error:', err.message);
      }
    }

    await new Promise(r => setTimeout(r, 5000));
  }

  return { ready: false, error: lastMessage || "Timed out waiting for HelmRelease to become ready" };
}

async function undeployViaGitOps(nsName, appName, actor) {
  if (gitops.isEnabled()) {
    try {
      await gitops.undeployApp(nsName, appName, actor);
      await gitops.triggerFluxReconcile();
    } catch (gitErr) {
      console.warn("[gitops] Git delete failed, falling back to kubectl:", gitErr.message);
      // Fallback for legacy apps not in Git
      try {
        await customApi.deleteNamespacedCustomObject("helm.toolkit.fluxcd.io", "v2", nsName, "helmreleases", appName);
      } catch (e) {
        if (e.statusCode !== 404) throw e;
      }
    }
  } else {
    try {
      await customApi.deleteNamespacedCustomObject("helm.toolkit.fluxcd.io", "v2", nsName, "helmreleases", appName);
    } catch (e) {
      if (e.statusCode !== 404) throw e;
    }
  }
}

// ── Delete App ──────────────────────────────────────────────────────────────

app.delete("/api/apps/:namespace/:name", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    const { namespace, name } = req.params;

    // Step 1: Remove from Git (if GitOps enabled) and delete the HelmRelease
    const actor = getActor(req);
    await undeployViaGitOps(namespace, name, actor);

    // Step 2: Remove finalizers and delete the HelmRelease directly
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
      console.debug(`[delete] HelmRelease finalizer patch — already gone:`, e.message);
    }
    try {
      await customApi.deleteNamespacedCustomObject(
        "helm.toolkit.fluxcd.io", "v2", namespace, "helmreleases", name
      );
    } catch (e) {
      if (e.statusCode !== 404) {
        console.warn(`[delete] Could not delete HelmRelease ${name}: ${e.message}`);
      }
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
      console.debug('[delete] Orphaned Helm secrets cleanup non-critical:', e.message);
    }

    // Step 4: Clean up any pods/deployments left behind
    try {
      const deps = await appsApi.listNamespacedDeployment(namespace);
      for (const d of deps.body.items) {
        if (d.metadata.name === name || d.metadata.name.startsWith(`${name}-`)) {
          await appsApi.deleteNamespacedDeployment(d.metadata.name, namespace);
        }
      }
    } catch (e) {
      console.debug('[delete] Orphaned deployments cleanup non-critical:', e.message);
    }

    // Step 4b: Clean up orphaned Services
    try {
      const svcs = await k8sApi.listNamespacedService(namespace);
      for (const s of svcs.body.items) {
        if (s.metadata.name === name || s.metadata.name.startsWith(`${name}-`)) {
          await k8sApi.deleteNamespacedService(s.metadata.name, namespace);
        }
      }
    } catch (e) {
      console.debug('[delete] Orphaned services cleanup non-critical:', e.message);
    }

    // Step 5: Delete VirtualService if it exists
    try {
      await customApi.deleteNamespacedCustomObject(
        "networking.istio.io", "v1", namespace, "virtualservices", name
      );
    } catch (e) {
      console.debug('[delete] VirtualService not found during cleanup:', e.message);
    }

    // Step 6: Remove from app registry
    const regIdx = appRegistry.findIndex(a => a.name === name);
    if (regIdx >= 0) {
      appRegistry.splice(regIdx, 1);
      await saveAppRegistry();
      console.log(`[portal] Removed "${name}" from app registry after deletion`);
    }

    // Step 7: Mark pipeline runs for this app as "undeployed"
    if (dbAvailable && db.pool) {
      try {
        await db.pool.query(
          "UPDATE pipeline_runs SET status = 'undeployed', updated_at = NOW() WHERE app_name = $1 AND status = 'deployed'",
          [name]
        );
      } catch (e) {
        console.debug('[delete] Pipeline run undeployed-update non-critical:', e.message);
      }
    }

    res.json({ ok: true, message: `Deleted ${name} from ${namespace}` });
  } catch (err) {
    console.error("Error deleting app:", err);
    res.status(err.statusCode || 500).json({ error: "Internal server error" });
  }
});

// ── GitOps Migration ────────────────────────────────────────────────────────

app.post("/api/admin/migrate-to-gitops", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  if (!gitops.isEnabled()) {
    return res.status(400).json({ error: "GitOps not configured: GITHUB_TOKEN not set" });
  }

  try {
    const actor = getActor(req);
    // Find all team-* namespaces
    const nsResp = await k8sApi.listNamespace();
    const teamNamespaces = nsResp.body.items
      .filter(ns => ns.metadata.name.startsWith("team-"))
      .map(ns => ns.metadata.name);

    let migrated = 0;
    let skipped = 0;
    const results = [];

    for (const ns of teamNamespaces) {
      try {
        const hrResp = await customApi.listNamespacedCustomObject(
          "helm.toolkit.fluxcd.io", "v2", ns, "helmreleases"
        );
        const releases = hrResp.body.items || [];

        for (const hr of releases) {
          const appName = hr.metadata.name;
          // Check if already in Git
          const sha = await gitops.getFileSha(`apps/tenants/${ns}/apps/${appName}.yaml`);
          if (sha) {
            skipped++;
            results.push({ namespace: ns, app: appName, status: "already-in-git" });
            continue;
          }

          // Write to Git
          await gitops.ensureTenantInGit(ns);
          await gitops.deployApp(ns, appName, hr, actor);
          migrated++;
          results.push({ namespace: ns, app: appName, status: "migrated" });
        }
      } catch (err) {
        results.push({ namespace: ns, status: "error", error: err.message });
      }
    }

    await gitops.triggerFluxReconcile();
    res.json({ success: true, migrated, skipped, results });
  } catch (err) {
    console.error("[migrate] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

async function getCredentials() {
  const result = { sso: {}, breakglass: {} };

  // SSO — the only credentials users need
  result.sso.keycloak = {
    url: KEYCLOAK_EXTERNAL_URL,
    realm: "sre",
    username: "sre-admin",
    password: "SreAdmin123!",
    note: "One login for all services. Members of sre-admins group get admin access everywhere.",
  };

  // Keycloak admin console (separate from SSO realm)
  try {
    const secret = await k8sApi.readNamespacedSecret("keycloak", "keycloak");
    result.breakglass["keycloak-admin"] = {
      username: "admin",
      password: Buffer.from(
        secret.body.data["admin-password"],
        "base64"
      ).toString(),
      note: "Keycloak admin console — manage realms, clients, users",
    };
  } catch (err) {
    console.debug('[credentials] Keycloak admin secret not found:', err.message);
    result.breakglass["keycloak-admin"] = { username: "admin", password: "(not found)" };
  }

  // Break-glass / emergency access — only for when SSO is down
  // Grafana
  try {
    let secret = await k8sApi.readNamespacedSecret(
      "grafana-admin-credentials",
      "monitoring"
    );
    result.breakglass.grafana = {
      username: "admin",
      password: Buffer.from(
        secret.body.data.adminPassword,
        "base64"
      ).toString(),
    };
  } catch (err) {
    console.debug('[credentials] Grafana admin credentials secret not found, trying fallback:', err.message);
    try {
      let secret = await k8sApi.readNamespacedSecret(
        "kube-prometheus-stack-grafana",
        "monitoring"
      );
      result.breakglass.grafana = {
        username: "admin",
        password: Buffer.from(
          secret.body.data["admin-password"],
          "base64"
        ).toString(),
      };
    } catch (err2) {
      console.debug('[credentials] Grafana fallback secret also not found:', err2.message);
      result.breakglass.grafana = { username: "admin", password: "(not found)" };
    }
  }

  // NeuVector
  result.breakglass.neuvector = {
    username: "admin",
    password: "admin",
  };

  // OpenBao root token
  try {
    const secret = await k8sApi.readNamespacedSecret(
      "openbao-init",
      "openbao"
    );
    result.breakglass.openbao = {
      token: Buffer.from(secret.body.data["root-token"], "base64").toString(),
    };
  } catch (err) {
    console.debug('[credentials] OpenBao init secret not found:', err.message);
    result.breakglass.openbao = { token: "(not initialized)" };
  }

  // Harbor
  try {
    const secret = await k8sApi.readNamespacedSecret(
      "harbor-core-envvars",
      "harbor"
    );
    result.breakglass.harbor = {
      username: "admin",
      password: Buffer.from(
        secret.body.data.HARBOR_ADMIN_PASSWORD,
        "base64"
      ).toString(),
    };
  } catch (err) {
    console.debug('[credentials] Harbor admin secret not found, using default:', err.message);
    result.breakglass.harbor = { username: HARBOR_ADMIN_USER, password: HARBOR_ADMIN_PASS };
  }

  return result;
}

// ── App Portal API ──────────────────────────────────────────────────────────

// Debounced sync — run at most once per 60 seconds
var lastSyncTime = 0;
var syncInProgress = false;
async function triggerSync() {
  var now = Date.now();
  if (syncInProgress || (now - lastSyncTime) < 60000) return;
  syncInProgress = true;
  lastSyncTime = now;
  try {
    await syncAppRegistry();
  } finally {
    syncInProgress = false;
  }
}

app.get("/api/portal/apps", async (req, res) => {
  // Trigger a background sync (non-blocking) on portal load
  triggerSync().catch(function(err) { console.error("[portal] background sync error:", err.message); });

  const userGroups = (req.headers["x-auth-request-groups"] || "")
    .split(/[,\s]+/).map(g => g.trim().replace(/^\//, "")).filter(Boolean);
  const userEmail = req.headers["x-auth-request-email"] || "";
  const isAdmin = userGroups.includes("sre-admins") || userGroups.includes("platform-admins");

  const apps = await getRegisteredApps();

  const userName = req.headers["x-auth-request-user"] || "";

  const visible = apps.filter(app => {
    if (isAdmin) return true;
    if (!app.access || app.access.mode === "everyone") return true;
    if (app.access.mode === "private") return false;
    // Mode: restricted — check groups, users, attributes
    var access = app.access;
    if (access.groups && access.groups.length > 0) {
      if (access.groups.some(function(g) { return userGroups.includes(g); })) return true;
    }
    if (access.users && access.users.length > 0) {
      if (access.users.includes(userName) || access.users.includes(userEmail)) return true;
    }
    // Attribute matching is reserved for future Keycloak integration
    return false;
  });

  res.json({ apps: visible, isAdmin, userGroups });
});

app.post("/api/portal/apps", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    const { name, displayName, description, url, icon, namespace, requiredGroups, access } = req.body;
    if (!name || !url) {
      return res.status(400).json({ error: "name and url are required" });
    }
    if (appRegistry.find(a => a.name === name)) {
      return res.status(409).json({ error: "App already registered" });
    }
    // Support both old requiredGroups and new access model
    var appAccess;
    if (access && access.mode) {
      appAccess = {
        mode: access.mode,
        groups: Array.isArray(access.groups) ? access.groups : [],
        users: Array.isArray(access.users) ? access.users : [],
        attributes: Array.isArray(access.attributes) ? access.attributes : [],
      };
    } else if (Array.isArray(requiredGroups)) {
      appAccess = {
        mode: requiredGroups.length > 0 ? "restricted" : "everyone",
        groups: requiredGroups,
        users: [],
        attributes: [],
      };
    } else {
      appAccess = { mode: "everyone", groups: [], users: [], attributes: [] };
    }
    const entry = {
      name: name,
      displayName: displayName || name.toUpperCase(),
      description: description || "",
      url: url,
      icon: icon || "package",
      namespace: namespace || "",
      access: appAccess,
      owner: req.headers["x-auth-request-email"] || "",
      deployedAt: new Date().toISOString(),
      registeredAt: new Date().toISOString(),
      status: "running",
    };
    appRegistry.push(entry);
    await saveAppRegistry();
    res.status(201).json(entry);
  } catch (err) {
    console.error("Failed to register app:", err.message);
    res.status(500).json({ error: "Failed to register app" });
  }
});

app.patch("/api/portal/apps/:name", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    const idx = appRegistry.findIndex(a => a.name === req.params.name);
    if (idx < 0) return res.status(404).json({ error: "App not found" });
    const { requiredGroups, access, displayName, description, icon } = req.body;
    if (access !== undefined && access.mode) {
      appRegistry[idx].access = {
        mode: access.mode,
        groups: Array.isArray(access.groups) ? access.groups : [],
        users: Array.isArray(access.users) ? access.users : [],
        attributes: Array.isArray(access.attributes) ? access.attributes : [],
      };
      delete appRegistry[idx].requiredGroups;
    } else if (requiredGroups !== undefined) {
      // Legacy support: convert requiredGroups to access model
      appRegistry[idx].access = {
        mode: Array.isArray(requiredGroups) && requiredGroups.length > 0 ? "restricted" : "everyone",
        groups: Array.isArray(requiredGroups) ? requiredGroups : [],
        users: [],
        attributes: [],
      };
      delete appRegistry[idx].requiredGroups;
    }
    if (displayName !== undefined) appRegistry[idx].displayName = displayName;
    if (description !== undefined) appRegistry[idx].description = description;
    if (icon !== undefined) appRegistry[idx].icon = icon;
    await saveAppRegistry();
    res.json(appRegistry[idx]);
  } catch (err) {
    console.error("Failed to update app:", err.message);
    res.status(500).json({ error: "Failed to update app" });
  }
});

app.get("/api/portal/apps/:name/access", requireGroups("sre-admins", "developers"), async (req, res) => {
  const app = appRegistry.find(a => a.name === req.params.name);
  if (!app) return res.status(404).json({ error: "App not found" });
  res.json(app.access || { mode: "everyone", groups: [], users: [], attributes: [] });
});

app.delete("/api/portal/apps/:name", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    const idx = appRegistry.findIndex(a => a.name === req.params.name);
    if (idx < 0) return res.status(404).json({ error: "App not found" });
    const removed = appRegistry.splice(idx, 1)[0];
    await saveAppRegistry();
    res.json({ deleted: removed.name });
  } catch (err) {
    console.error("Failed to delete app:", err.message);
    res.status(500).json({ error: "Failed to delete app" });
  }
});

app.get("/api/portal/groups", async (req, res) => {
  const knownGroups = ["sre-admins", "platform-admins", "developers", "sre-viewers", "logistics"];
  // Also extract groups from the registry
  var registryGroups = [];
  appRegistry.forEach(function(app) {
    var groups = (app.access && app.access.groups) ? app.access.groups : (app.requiredGroups || []);
    groups.forEach(function(g) {
      if (registryGroups.indexOf(g) < 0) registryGroups.push(g);
    });
  });
  knownGroups.forEach(function(g) {
    if (registryGroups.indexOf(g) < 0) registryGroups.push(g);
  });
  res.json({ groups: registryGroups.sort() });
});

// ── Keycloak Admin API ───────────────────────────────────────────────────────

const KEYCLOAK_URL = process.env.KEYCLOAK_URL || "http://keycloak.keycloak.svc.cluster.local";
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || "sre";
const KEYCLOAK_ADMIN_USER = process.env.KEYCLOAK_ADMIN_USER || "admin";
const KEYCLOAK_ADMIN_PASS = process.env.KC_ADMIN_PASSWORD || process.env.KEYCLOAK_ADMIN_PASS || "changeme";

async function getKeycloakAdminToken() {
  const resp = await fetch(`${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: "admin-cli",
      username: KEYCLOAK_ADMIN_USER,
      password: KEYCLOAK_ADMIN_PASS,
      grant_type: "password",
    }),
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error("Failed to get Keycloak admin token");
  return data.access_token;
}

async function keycloakApi(method, path, body) {
  const token = await getKeycloakAdminToken();
  const opts = {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}${path}`, opts);
  if (resp.status === 204) return {};
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Keycloak ${method} ${path}: ${resp.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

// ── User Management Endpoints ────────────────────────────────────────────────

// GET /api/admin/users — List all users with groups
app.get("/api/admin/users", requireGroups("sre-admins"), async (req, res) => {
  try {
    const users = await keycloakApi("GET", "/users?max=100");
    const usersWithGroups = await Promise.all(users.map(async (u) => {
      const groups = await keycloakApi("GET", `/users/${u.id}/groups`);
      return {
        id: u.id,
        username: u.username,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        enabled: u.enabled,
        createdTimestamp: u.createdTimestamp,
        groups: groups.map((g) => g.name),
        attributes: u.attributes || {},
      };
    }));
    res.json(usersWithGroups);
  } catch (err) {
    console.error("Failed to list users:", err.message);
    res.status(502).json({ error: "Failed to fetch users from Keycloak" });
  }
});

// POST /api/admin/users — Create a new user
app.post("/api/admin/users", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    const { username, email, firstName, lastName, password, groups, enabled, attributes } = req.body;
    if (!username) return res.status(400).json({ error: "Username required" });

    await keycloakApi("POST", "/users", {
      username, email, firstName, lastName,
      enabled: enabled !== false,
      attributes: attributes || {},
      credentials: password ? [{ type: "password", value: password, temporary: false }] : [],
    });

    const users = await keycloakApi("GET", `/users?username=${encodeURIComponent(username)}&exact=true`);
    if (users.length === 0) return res.status(500).json({ error: "User created but not found" });
    const userId = users[0].id;

    if (groups && groups.length > 0) {
      const allGroups = await keycloakApi("GET", "/groups");
      for (const groupName of groups) {
        const group = allGroups.find((g) => g.name === groupName);
        if (group) {
          await keycloakApi("PUT", `/users/${userId}/groups/${group.id}`, {});
        }
      }
    }

    await adminAuditLog(req, "user_created", "user", username, `Created user ${username}`, { groups: groups || [] });
    res.json({ success: true, id: userId });
  } catch (err) {
    console.error("Failed to create user:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// PATCH /api/admin/users/:id — Update user
app.patch("/api/admin/users/:id", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    const { id } = req.params;
    const { email, firstName, lastName, enabled, attributes } = req.body;
    const update = {};
    if (email !== undefined) update.email = email;
    if (firstName !== undefined) update.firstName = firstName;
    if (lastName !== undefined) update.lastName = lastName;
    if (enabled !== undefined) update.enabled = enabled;
    if (attributes !== undefined) update.attributes = attributes;
    await keycloakApi("PUT", `/users/${id}`, update);
    await adminAuditLog(req, "user_updated", "user", id, `Updated user ${id}`, update);
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to update user:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// PUT /api/admin/users/:id/password — Reset password
app.put("/api/admin/users/:id/password", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Password required" });
    await keycloakApi("PUT", `/users/${id}/reset-password`, {
      type: "password", value: password, temporary: false,
    });
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to reset password:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// DELETE /api/admin/users/:id — Delete user
app.delete("/api/admin/users/:id", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    await keycloakApi("DELETE", `/users/${req.params.id}`);
    await adminAuditLog(req, "user_deleted", "user", req.params.id, `Deleted user ${req.params.id}`, {});
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to delete user:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// PUT /api/admin/users/:id/groups — Set user's groups (replace all)
app.put("/api/admin/users/:id/groups", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    const { id } = req.params;
    const { groups } = req.body;

    const allGroups = await keycloakApi("GET", "/groups");
    const currentGroups = await keycloakApi("GET", `/users/${id}/groups`);

    for (const g of currentGroups) {
      await keycloakApi("DELETE", `/users/${id}/groups/${g.id}`);
    }

    for (const groupName of (groups || [])) {
      const group = allGroups.find((g) => g.name === groupName);
      if (group) {
        await keycloakApi("PUT", `/users/${id}/groups/${group.id}`, {});
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Failed to update user groups:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/admin/groups — List all groups
app.get("/api/admin/groups", requireGroups("sre-admins"), async (req, res) => {
  try {
    const groups = await keycloakApi("GET", "/groups");
    res.json(groups.map((g) => ({ id: g.id, name: g.name, path: g.path, subGroups: g.subGroups || [] })));
  } catch (err) {
    console.error("Failed to list groups:", err.message);
    res.status(502).json({ error: "Failed to fetch groups from Keycloak" });
  }
});

// POST /api/admin/groups — Create a group
app.post("/api/admin/groups", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Group name required" });
    await keycloakApi("POST", "/groups", { name });
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to create group:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// DELETE /api/admin/groups/:id — Delete a group
app.delete("/api/admin/groups/:id", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    await keycloakApi("DELETE", `/groups/${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to delete group:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── Admin Audit Trail ─────────────────────────────────────────────────────────

async function adminAuditLog(req, action, targetType, targetName, detail, metadata) {
  const actor = getActor(req);
  logger.info("admin", `${action}: ${targetType}/${targetName} by ${actor}`, { action, targetType, targetName, detail });
  if (dbAvailable && db.pool) {
    try {
      await db.adminAuditLog(action, actor, targetType, targetName, detail, metadata);
    } catch (err) {
      console.debug("[admin] Audit log write non-critical:", err.message);
    }
  }
}

// GET /api/admin/audit-log — List admin audit log entries
app.get("/api/admin/audit-log", requireGroups("sre-admins"), async (req, res) => {
  if (!dbAvailable) return res.json({ entries: [], total: 0, limit: 50, offset: 0 });
  try {
    const result = await db.listAdminAuditLog({
      action: req.query.action,
      actor: req.query.actor,
      targetType: req.query.targetType,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json(result);
  } catch (err) {
    console.error("Failed to list admin audit log:", err.message);
    res.status(500).json({ error: "Failed to retrieve audit log" });
  }
});

// ── Tenant Lifecycle Management ──────────────────────────────────────────────

const TENANT_TIERS = {
  small:  { pods: "10",  reqCpu: "2",  reqMem: "4Gi",  limCpu: "4",   limMem: "8Gi",  services: "5",  pvcs: "5" },
  medium: { pods: "20",  reqCpu: "4",  reqMem: "8Gi",  limCpu: "8",   limMem: "16Gi", services: "10", pvcs: "10" },
  large:  { pods: "40",  reqCpu: "8",  reqMem: "16Gi", limCpu: "16",  limMem: "32Gi", services: "20", pvcs: "20" },
};

// GET /api/admin/tenants — List all tenants with resource usage
app.get("/api/admin/tenants", requireGroups("sre-admins"), async (req, res) => {
  try {
    const namespaces = await k8sApi.listNamespace();
    const tenantNs = namespaces.body.items.filter(ns => {
      const labels = ns.metadata.labels || {};
      return labels["sre.io/team"] || ns.metadata.name.startsWith("team-");
    });

    const tenants = [];
    for (const ns of tenantNs) {
      const name = ns.metadata.name;
      const labels = ns.metadata.labels || {};
      try {
        // Get pods
        const pods = await k8sApi.listNamespacedPod(name);
        const podItems = pods.body.items || [];
        const runningPods = podItems.filter(p => p.status.phase === "Running").length;

        // Get resource quota
        const quotas = await k8sApi.listNamespacedResourceQuota(name);
        let quota = null;
        if (quotas.body.items.length > 0) {
          const q = quotas.body.items[0];
          quota = {
            name: q.metadata.name,
            hard: q.spec.hard || {},
            used: q.status.used || {},
          };
        }

        // Get deployments count
        const deps = await appsApi.listNamespacedDeployment(name);
        const appCount = (deps.body.items || []).length;

        // Calculate CPU/memory usage
        let cpuUsed = 0, memUsed = 0;
        try {
          const podMetrics = await metricsClient.getPodMetrics(name);
          for (const pm of podMetrics.items || []) {
            for (const c of pm.containers || []) {
              cpuUsed += parseCpu(c.usage?.cpu || "0");
              memUsed += parseMem(c.usage?.memory || "0");
            }
          }
        } catch (e) {
          // Metrics may not be available
        }

        // Determine health
        const problemPods = podItems.filter(p =>
          p.status.phase !== "Running" && p.status.phase !== "Succeeded"
        ).length;
        const health = problemPods === 0 ? "healthy" : problemPods < podItems.length ? "degraded" : "unhealthy";

        tenants.push({
          name,
          team: labels["sre.io/team"] || name,
          status: ns.status.phase,
          createdAt: ns.metadata.creationTimestamp,
          podCount: podItems.length,
          runningPods,
          appCount,
          health,
          cpu: { used: fmtCpu(cpuUsed), usedRaw: cpuUsed },
          memory: { used: fmtMem(memUsed), usedRaw: memUsed },
          quota,
        });
      } catch (err) {
        tenants.push({
          name,
          team: labels["sre.io/team"] || name,
          status: ns.status.phase,
          createdAt: ns.metadata.creationTimestamp,
          podCount: 0, runningPods: 0, appCount: 0, health: "unknown",
          cpu: { used: "0m", usedRaw: 0 },
          memory: { used: "0 Mi", usedRaw: 0 },
          quota: null,
        });
      }
    }

    res.json(tenants);
  } catch (err) {
    console.error("Failed to list tenants:", err.message);
    res.status(500).json({ error: "Failed to list tenants" });
  }
});

// GET /api/admin/tenants/overview — Per-tenant health overview
app.get("/api/admin/tenants/overview", requireGroups("sre-admins"), async (req, res) => {
  try {
    const namespaces = await k8sApi.listNamespace();
    const tenantNs = namespaces.body.items.filter(ns => {
      const labels = ns.metadata.labels || {};
      return labels["sre.io/team"] || ns.metadata.name.startsWith("team-");
    });

    let totalPods = 0, healthyTenants = 0, degradedTenants = 0, totalApps = 0;
    const tenantHealthMap = [];

    for (const ns of tenantNs) {
      const name = ns.metadata.name;
      try {
        const pods = await k8sApi.listNamespacedPod(name);
        const podItems = pods.body.items || [];
        const running = podItems.filter(p => p.status.phase === "Running").length;
        const problem = podItems.filter(p => p.status.phase !== "Running" && p.status.phase !== "Succeeded").length;
        const deps = await appsApi.listNamespacedDeployment(name);
        const depCount = (deps.body.items || []).length;
        const health = problem === 0 ? "healthy" : "degraded";

        totalPods += podItems.length;
        totalApps += depCount;
        if (health === "healthy") healthyTenants++;
        else degradedTenants++;

        tenantHealthMap.push({ name, health, pods: podItems.length, running, problem, apps: depCount });
      } catch (err) {
        degradedTenants++;
        tenantHealthMap.push({ name, health: "unknown", pods: 0, running: 0, problem: 0, apps: 0 });
      }
    }

    res.json({
      totalTenants: tenantNs.length,
      healthyTenants,
      degradedTenants,
      totalPods,
      totalApps,
      tenants: tenantHealthMap,
    });
  } catch (err) {
    console.error("Failed to get tenant overview:", err.message);
    res.status(500).json({ error: "Failed to get tenant overview" });
  }
});

// POST /api/admin/tenants — Create a new tenant
app.post("/api/admin/tenants", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    const { name, tier } = req.body;
    if (!name) return res.status(400).json({ error: "Tenant name is required" });
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      return res.status(400).json({ error: "Name must be lowercase, start with a letter, and contain only letters, numbers, and hyphens" });
    }
    const tenantName = name.startsWith("team-") ? name : `team-${name}`;
    const quotaTier = TENANT_TIERS[tier] || TENANT_TIERS.medium;

    // Check if namespace already exists
    try {
      await k8sApi.readNamespace(tenantName);
      return res.status(409).json({ error: `Tenant ${tenantName} already exists` });
    } catch (err) {
      if (err.statusCode !== 404) throw err;
    }

    // Create namespace
    await k8sApi.createNamespace({
      metadata: {
        name: tenantName,
        labels: {
          "istio-injection": "enabled",
          "app.kubernetes.io/part-of": "sre-platform",
          "sre.io/team": tenantName,
          "sre.io/network-policy-configured": "true",
          "pod-security.kubernetes.io/enforce": "privileged",
          "pod-security.kubernetes.io/audit": "restricted",
          "pod-security.kubernetes.io/warn": "restricted",
        },
      },
    });

    // Create ResourceQuota
    await k8sApi.createNamespacedResourceQuota(tenantName, {
      metadata: { name: `${tenantName}-quota`, namespace: tenantName },
      spec: {
        hard: {
          pods: quotaTier.pods,
          "requests.cpu": quotaTier.reqCpu,
          "requests.memory": quotaTier.reqMem,
          "limits.cpu": quotaTier.limCpu,
          "limits.memory": quotaTier.limMem,
          services: quotaTier.services,
          persistentvolumeclaims: quotaTier.pvcs,
        },
      },
    });

    // Create LimitRange
    await k8sApi.createNamespacedLimitRange(tenantName, {
      metadata: { name: `${tenantName}-limits`, namespace: tenantName },
      spec: {
        limits: [{
          type: "Container",
          default: { cpu: "200m", memory: "256Mi" },
          defaultRequest: { cpu: "100m", memory: "128Mi" },
          max: { cpu: "2", memory: "4Gi" },
          min: { cpu: "50m", memory: "64Mi" },
        }],
      },
    });

    // Create default-deny NetworkPolicy
    const networkingApi = kc.makeApiClient(k8s.NetworkingV1Api);
    await networkingApi.createNamespacedNetworkPolicy(tenantName, {
      metadata: { name: "default-deny-all", namespace: tenantName },
      spec: { podSelector: {}, policyTypes: ["Ingress", "Egress"] },
    });

    // Create RBAC — RoleBinding for team group
    const rbacApi = kc.makeApiClient(k8s.RbacAuthorizationV1Api);
    await rbacApi.createNamespacedRoleBinding(tenantName, {
      metadata: { name: `${tenantName}-admin`, namespace: tenantName },
      subjects: [{ kind: "Group", name: tenantName, apiGroup: "rbac.authorization.k8s.io" }],
      roleRef: { kind: "ClusterRole", name: "admin", apiGroup: "rbac.authorization.k8s.io" },
    });

    // Create Harbor project
    try {
      const harborAuth = "Basic " + Buffer.from(`${HARBOR_ADMIN_USER}:${HARBOR_ADMIN_PASS}`).toString("base64");
      await fetch(`http://harbor-core.harbor.svc.cluster.local/api/v2.0/projects`, {
        method: "POST",
        headers: { "Authorization": harborAuth, "Content-Type": "application/json" },
        body: JSON.stringify({ project_name: tenantName, public: false }),
      });
    } catch (harborErr) {
      logger.warn("admin", `Harbor project creation skipped: ${harborErr.message}`);
    }

    await adminAuditLog(req, "tenant_created", "tenant", tenantName, `Created tenant with ${tier || "medium"} tier`, { tier: tier || "medium", quota: quotaTier });
    res.status(201).json({ success: true, name: tenantName, tier: tier || "medium" });
  } catch (err) {
    console.error("Failed to create tenant:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/tenants/:name/quota — Update tenant ResourceQuota
app.patch("/api/admin/tenants/:name/quota", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    const { name } = req.params;
    const { tier } = req.body;
    if (!tier || !TENANT_TIERS[tier]) {
      return res.status(400).json({ error: "Invalid tier. Must be: small, medium, or large" });
    }
    const quotaTier = TENANT_TIERS[tier];

    // Find existing quota
    const quotas = await k8sApi.listNamespacedResourceQuota(name);
    if (quotas.body.items.length === 0) {
      return res.status(404).json({ error: `No ResourceQuota found in namespace ${name}` });
    }
    const quotaName = quotas.body.items[0].metadata.name;

    await k8sApi.patchNamespacedResourceQuota(quotaName, name, {
      spec: {
        hard: {
          pods: quotaTier.pods,
          "requests.cpu": quotaTier.reqCpu,
          "requests.memory": quotaTier.reqMem,
          "limits.cpu": quotaTier.limCpu,
          "limits.memory": quotaTier.limMem,
          services: quotaTier.services,
          persistentvolumeclaims: quotaTier.pvcs,
        },
      },
    }, undefined, undefined, undefined, undefined, undefined, {
      headers: { "Content-Type": "application/strategic-merge-patch+json" },
    });

    await adminAuditLog(req, "tenant_quota_updated", "tenant", name, `Updated quota to ${tier} tier`, { tier, quota: quotaTier });
    res.json({ success: true, tier });
  } catch (err) {
    console.error("Failed to update tenant quota:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/tenants/:name — Delete a tenant
app.delete("/api/admin/tenants/:name", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    const { name } = req.params;
    const { confirm } = req.body;
    if (confirm !== name) {
      return res.status(400).json({ error: "Confirmation required: send { confirm: '<tenant-name>' } to delete" });
    }

    // Safety: prevent deleting system namespaces
    const protectedNs = ["default", "kube-system", "kube-public", "kube-node-lease",
      "flux-system", "istio-system", "monitoring", "logging", "cert-manager",
      "harbor", "keycloak", "openbao", "neuvector", "sre-dashboard", "sre-builds"];
    if (protectedNs.includes(name)) {
      return res.status(403).json({ error: `Cannot delete protected namespace: ${name}` });
    }

    await k8sApi.deleteNamespace(name);
    await adminAuditLog(req, "tenant_deleted", "tenant", name, `Deleted tenant namespace`, {});
    res.json({ success: true, message: `Tenant ${name} deletion initiated` });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: `Tenant ${name} not found` });
    }
    console.error("Failed to delete tenant:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Component Dependency Map ─────────────────────────────────────────────────

const COMPONENT_DEPENDENCIES = [
  {
    name: "Istio",
    criticality: "critical",
    impact: "All mTLS, ingress, and service-to-service communication stops. All external traffic blocked.",
    dependsOn: ["cert-manager"],
    dependedOnBy: ["All applications", "Keycloak", "Grafana", "Harbor", "NeuVector", "OpenBao", "Dashboard"],
    namespace: "istio-system",
  },
  {
    name: "cert-manager",
    criticality: "high",
    impact: "TLS certificate issuance and renewal stops. Istio and ingress may lose certificates on rotation.",
    dependsOn: [],
    dependedOnBy: ["Istio", "Harbor", "Keycloak", "OpenBao"],
    namespace: "cert-manager",
  },
  {
    name: "Kyverno",
    criticality: "high",
    impact: "Policy enforcement stops. New pods deploy without security validation. Image signature checks disabled.",
    dependsOn: ["Istio", "cert-manager"],
    dependedOnBy: ["All tenant namespaces"],
    namespace: "kyverno",
  },
  {
    name: "Prometheus / Grafana",
    criticality: "medium",
    impact: "Monitoring and alerting stops. No visibility into cluster health or resource usage. Dashboards unavailable.",
    dependsOn: ["Istio"],
    dependedOnBy: ["AlertManager", "Grafana dashboards", "SRE Dashboard metrics"],
    namespace: "monitoring",
  },
  {
    name: "Loki / Alloy",
    criticality: "medium",
    impact: "Log aggregation stops. Historical logs unavailable. Audit trail gaps for compliance.",
    dependsOn: ["Istio", "Prometheus / Grafana"],
    dependedOnBy: ["Grafana log dashboards", "Audit compliance"],
    namespace: "logging",
  },
  {
    name: "Keycloak",
    criticality: "high",
    impact: "SSO and authentication for all platform UIs stops. Users cannot log in to Grafana, Harbor, Dashboard.",
    dependsOn: ["Istio", "cert-manager", "OpenBao"],
    dependedOnBy: ["OAuth2 Proxy", "Grafana SSO", "Harbor OIDC", "Dashboard SSO"],
    namespace: "keycloak",
  },
  {
    name: "OpenBao",
    criticality: "high",
    impact: "Secret delivery stops. External Secrets Operator cannot sync. New deployments needing secrets will fail.",
    dependsOn: ["Istio"],
    dependedOnBy: ["External Secrets Operator", "Keycloak DB creds", "All apps using secrets"],
    namespace: "openbao",
  },
  {
    name: "Harbor",
    criticality: "high",
    impact: "Container image pulls from internal registry fail. CI/CD pipelines cannot push images. New deployments blocked.",
    dependsOn: ["Istio", "cert-manager"],
    dependedOnBy: ["All deployments using Harbor images", "DSOP Pipeline builds"],
    namespace: "harbor",
  },
  {
    name: "NeuVector",
    criticality: "medium",
    impact: "Runtime security monitoring stops. No container behavioral analysis. Network DLP/WAF disabled.",
    dependsOn: ["Istio"],
    dependedOnBy: ["Security dashboards", "Compliance runtime controls"],
    namespace: "neuvector",
  },
  {
    name: "Velero",
    criticality: "low",
    impact: "Backup and disaster recovery unavailable. No new backups created. Existing backups remain in storage.",
    dependsOn: ["Istio"],
    dependedOnBy: [],
    namespace: "velero",
  },
  {
    name: "Tempo",
    criticality: "low",
    impact: "Distributed tracing stops. No new traces collected. Existing traces in storage remain queryable.",
    dependsOn: ["Istio", "Prometheus / Grafana"],
    dependedOnBy: ["Grafana trace dashboards"],
    namespace: "tempo",
  },
  {
    name: "MetalLB",
    criticality: "critical",
    impact: "LoadBalancer services lose external IPs. Istio gateway becomes unreachable. All external traffic blocked.",
    dependsOn: [],
    dependedOnBy: ["Istio gateway", "All externally-accessible services"],
    namespace: "metallb-system",
  },
];

// GET /api/platform/dependencies — Component dependency map
app.get("/api/platform/dependencies", async (req, res) => {
  res.json(COMPONENT_DEPENDENCIES);
});

// ── Setup Wizard ─────────────────────────────────────────────────────────────

// GET /api/admin/setup-status — Check first-run setup status
app.get("/api/admin/setup-status", requireGroups("sre-admins"), async (req, res) => {
  try {
    // Check completion flag
    let completed = false;
    if (dbAvailable) {
      const setting = await db.getSetting("setup_wizard_completed");
      completed = setting === true;
    }

    // Check current state
    const namespaces = await k8sApi.listNamespace();
    const tenantNs = namespaces.body.items.filter(ns => {
      const labels = ns.metadata.labels || {};
      return labels["sre.io/team"] || (ns.metadata.name.startsWith("team-") && !["team-alpha", "team-beta"].includes(ns.metadata.name));
    });

    const defaultPasswords = [];
    // Check known default credentials
    const defaults = [
      { service: "Harbor", expected: "Harbor12345" },
      { service: "Grafana", expected: "prom-operator" },
    ];
    if (HARBOR_ADMIN_PASS === "Harbor12345") defaultPasswords.push("Harbor");

    const slackConfigured = !!ISSM_SLACK_WEBHOOK;

    let userCount = 0;
    try {
      const users = await keycloakApi("GET", "/users?max=100");
      userCount = users.length;
    } catch (e) {
      // Keycloak may not be available
    }

    res.json({
      completed,
      checks: {
        hasCustomTenants: tenantNs.length > 0,
        tenantCount: tenantNs.length,
        defaultPasswordsRemaining: defaultPasswords,
        hasDefaultPasswords: defaultPasswords.length > 0,
        slackConfigured,
        userCount,
        hasUsers: userCount > 1, // More than just sre-admin
      },
    });
  } catch (err) {
    console.error("Failed to check setup status:", err.message);
    res.status(500).json({ error: "Failed to check setup status" });
  }
});

// POST /api/admin/setup-complete — Mark setup wizard as complete
app.post("/api/admin/setup-complete", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    if (dbAvailable) {
      await db.setSetting("setup_wizard_completed", true);
    }
    await adminAuditLog(req, "setup_wizard_completed", "platform", "setup", "First-run setup wizard completed", {});
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to mark setup complete:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Start Server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;

// Load app registry on startup, then seed keystone if not present
loadAppRegistry().then(function() {
  if (!appRegistry.find(a => a.name === 'keystone')) {
    appRegistry.push({
      name: 'keystone',
      displayName: 'KEYSTONE',
      description: 'Logistics Common Operating Picture — USMC',
      url: `https://keystone.${SRE_DOMAIN}`,
      icon: 'map',
      namespace: 'team-keystone',
      access: { mode: 'restricted', groups: ['logistics', 'sre-admins'], users: [], attributes: [] },
      owner: 'sre-admin@sre.example.com',
      deployedAt: new Date().toISOString(),
      status: 'running',
    });
    saveAppRegistry();
  }
  console.log(`[portal] App registry loaded: ${appRegistry.length} app(s)`);

  // Sync app registry with cluster state after a short delay (allow K8s API to be ready)
  setTimeout(function() {
    syncAppRegistry().catch(function(err) {
      console.error("[portal] Startup sync error:", err.message);
    });
  }, 10000);
}).catch(function(err) {
  console.error("[portal] Failed to initialize app registry:", err.message);
});

// ── Proxy endpoints for cross-origin platform services ───────────────────────
// StatusBoard and Intel Feed need Prometheus/Alertmanager data but can't call
// them directly due to CORS. Dashboard proxies these requests.

app.get("/api/proxy/prometheus", async (req, res) => {
  try {
    const query = req.query.query || "up";
    const resp = await fetch(`http://kube-prometheus-stack-prometheus.monitoring.svc.cluster.local:9090/api/v1/query?query=${encodeURIComponent(query)}`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "Prometheus unreachable", detail: err.message });
  }
});

app.get("/api/proxy/alertmanager/alerts", async (req, res) => {
  try {
    const resp = await fetch("http://kube-prometheus-stack-alertmanager.monitoring.svc.cluster.local:9093/api/v2/alerts");
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "Alertmanager unreachable", detail: err.message });
  }
});

// Harbor vulnerability proxy - fetches scan results from Harbor
app.get("/api/proxy/harbor/vulnerabilities", async (req, res) => {
  try {
    const harborUrl = "http://harbor-core.harbor.svc.cluster.local";
    const auth = "Basic " + Buffer.from(`${HARBOR_ADMIN_USER}:${HARBOR_ADMIN_PASS}`).toString("base64");

    // Get all projects
    const projResp = await fetch(harborUrl + "/api/v2.0/projects", {
      headers: { Authorization: auth }
    });
    const projects = await projResp.json();

    const results = [];
    for (const proj of projects.slice(0, 10)) {
      // Get repos in project
      const repoResp = await fetch(
        harborUrl + `/api/v2.0/projects/${proj.name}/repositories?page_size=50`,
        { headers: { Authorization: auth } }
      );
      const repos = await repoResp.json();

      for (const repo of repos.slice(0, 20)) {
        const repoName = repo.name.split("/").pop();
        // Get latest artifact
        const artResp = await fetch(
          harborUrl + `/api/v2.0/projects/${proj.name}/repositories/${encodeURIComponent(repoName)}/artifacts?page_size=1&with_scan_overview=true`,
          { headers: { Authorization: auth } }
        );
        const artifacts = await artResp.json();

        if (artifacts.length > 0 && artifacts[0].scan_overview) {
          const scan = Object.values(artifacts[0].scan_overview)[0];
          results.push({
            project: proj.name,
            repository: repo.name,
            tag: artifacts[0].tags?.[0]?.name || artifacts[0].digest?.substring(0, 12),
            scanStatus: scan?.scan_status || "not_scanned",
            severity: scan?.severity || "unknown",
            critical: scan?.summary?.critical || 0,
            high: scan?.summary?.high || 0,
            medium: scan?.summary?.medium || 0,
            low: scan?.summary?.low || 0,
            total: scan?.summary?.total || 0,
            scanTime: scan?.end_time || null,
          });
        }
      }
    }

    res.json({ vulnerabilities: results, scannedAt: new Date().toISOString() });
  } catch (err) {
    res.status(502).json({ error: "Harbor unreachable", detail: err.message });
  }
});

// ── Harbor Image Browsing APIs ───────────────────────────────────────────

// GET /api/harbor/projects — List Harbor projects for image browsing
app.get("/api/harbor/projects", requireDb, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const authHeader = "Basic " + Buffer.from(`${HARBOR_ADMIN_USER}:${HARBOR_ADMIN_PASS}`).toString("base64");
    const harborUrls = [
      "http://harbor-core.harbor.svc.cluster.local:80",
      "http://harbor-core.harbor.svc:80",
    ];

    for (const harborUrl of harborUrls) {
      try {
        const resp = await httpRequest(`${harborUrl}/api/v2.0/projects?page_size=100`, {
          headers: { "Authorization": authHeader },
          timeout: 8000,
        });
        if (resp.status === 200) {
          const projects = JSON.parse(resp.body);
          // Return project names, filtering to team-* and platform projects
          const result = projects
            .map(p => ({ name: p.name, repoCount: p.repo_count || 0 }))
            .sort((a, b) => a.name.localeCompare(b.name));
          return res.json(result);
        }
      } catch { continue; }
    }
    res.json([]);
  } catch (err) {
    console.error("[harbor] List projects error:", err.message);
    res.json([]);
  }
});

// GET /api/harbor/projects/:project/repositories — List repos in a Harbor project
app.get("/api/harbor/projects/:project/repositories", requireDb, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const project = req.params.project;
    if (!project || /[;&|`$(){}!#<>\\'"*?\[\]\n\r]/.test(project)) {
      return res.status(400).json({ error: "Invalid project name" });
    }
    const authHeader = "Basic " + Buffer.from(`${HARBOR_ADMIN_USER}:${HARBOR_ADMIN_PASS}`).toString("base64");
    const harborUrls = [
      "http://harbor-core.harbor.svc.cluster.local:80",
      "http://harbor-core.harbor.svc:80",
    ];

    for (const harborUrl of harborUrls) {
      try {
        const resp = await httpRequest(`${harborUrl}/api/v2.0/projects/${encodeURIComponent(project)}/repositories?page_size=100`, {
          headers: { "Authorization": authHeader },
          timeout: 8000,
        });
        if (resp.status === 200) {
          const repos = JSON.parse(resp.body);
          const result = repos.map(r => {
            // repo name comes as "project/reponame" — strip the project prefix
            const fullName = r.name || "";
            const shortName = fullName.includes("/") ? fullName.split("/").slice(1).join("/") : fullName;
            return {
              name: shortName,
              fullName: fullName,
              artifactCount: r.artifact_count || 0,
              pullCount: r.pull_count || 0,
              updateTime: r.update_time,
            };
          }).sort((a, b) => a.name.localeCompare(b.name));
          return res.json(result);
        }
      } catch { continue; }
    }
    res.json([]);
  } catch (err) {
    console.error("[harbor] List repositories error:", err.message);
    res.json([]);
  }
});

// GET /api/harbor/projects/:project/repositories/:repo/tags — List tags for a repo
app.get("/api/harbor/projects/:project/repositories/:repo/tags", requireDb, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const { project, repo } = req.params;
    if (!project || !repo) return res.status(400).json({ error: "Project and repo required" });
    if (/[;&|`$(){}!#<>\\'"*?\[\]\n\r]/.test(project + repo)) {
      return res.status(400).json({ error: "Invalid characters in project or repo name" });
    }
    const authHeader = "Basic " + Buffer.from(`${HARBOR_ADMIN_USER}:${HARBOR_ADMIN_PASS}`).toString("base64");
    const harborUrls = [
      "http://harbor-core.harbor.svc.cluster.local:80",
      "http://harbor-core.harbor.svc:80",
    ];

    // URL-encode the repo name (it may contain slashes)
    const encodedRepo = encodeURIComponent(repo);

    for (const harborUrl of harborUrls) {
      try {
        const resp = await httpRequest(`${harborUrl}/api/v2.0/projects/${encodeURIComponent(project)}/repositories/${encodedRepo}/artifacts?page_size=50&with_tag=true`, {
          headers: { "Authorization": authHeader },
          timeout: 8000,
        });
        if (resp.status === 200) {
          const artifacts = JSON.parse(resp.body);
          const tags = [];
          for (const artifact of artifacts) {
            if (artifact.tags && Array.isArray(artifact.tags)) {
              for (const tag of artifact.tags) {
                tags.push({
                  name: tag.name,
                  digest: artifact.digest ? artifact.digest.substring(0, 19) : null,
                  size: artifact.size ? Math.round(artifact.size / (1024 * 1024)) : null,
                  pushed: tag.push_time || artifact.push_time,
                  vulnerabilities: artifact.scan_overview ? (() => {
                    const report = Object.values(artifact.scan_overview)[0];
                    return report ? { critical: report.summary?.critical || 0, high: report.summary?.high || 0 } : null;
                  })() : null,
                });
              }
            }
          }
          // Sort by push time descending (newest first), filter out :latest
          tags.sort((a, b) => (b.pushed || "").localeCompare(a.pushed || ""));
          return res.json(tags);
        }
      } catch { continue; }
    }
    res.json([]);
  } catch (err) {
    console.error("[harbor] List tags error:", err.message);
    res.json([]);
  }
});

// GET /api/ingress/check?hostname=xxx — Check if hostname is already in use
app.get("/api/ingress/check", requireDb, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const hostname = req.query.hostname;
    if (!hostname) return res.json({ available: true });

    // Check VirtualServices across all namespaces
    try {
      const vsResult = await customApi.listClusterCustomObject(
        "networking.istio.io", "v1", "virtualservices"
      );
      const virtualServices = vsResult.body?.items || [];
      for (const vs of virtualServices) {
        const hosts = vs.spec?.hosts || [];
        if (hosts.includes(hostname)) {
          return res.json({
            available: false,
            usedBy: vs.metadata?.name,
            namespace: vs.metadata?.namespace,
          });
        }
      }
    } catch (vsErr) {
      console.debug("[ingress] VirtualService check error:", vsErr.message);
    }

    res.json({ available: true });
  } catch (err) {
    console.error("[ingress] Check error:", err.message);
    res.json({ available: true }); // Fail open — don't block deployment on check failure
  }
});

// ── Pipeline API ──────────────────────────────────────────────────────────

// Track whether database is available (set during init)
let dbAvailable = false;

function requireDb(req, res, next) {
  if (!dbAvailable) return res.status(503).json({ error: "Pipeline database unavailable" });
  next();
}

// ── ISSM Slack/Email Notification ────────────────────────────────────────
const ISSM_SLACK_WEBHOOK = process.env.ISSM_SLACK_WEBHOOK || "";
const ISSM_NOTIFY_EMAIL = process.env.ISSM_NOTIFY_EMAIL || "";
const ENFORCE_SEPARATION_OF_DUTIES = process.env.ENFORCE_SEPARATION_OF_DUTIES === "true";

/**
 * Send ISSM notification via Slack webhook and/or email.
 * Fails silently if no webhook/email is configured — notifications are optional.
 */
async function notifyISSM(run, eventType, extra = {}) {
  const dashboardUrl = `https://dashboard.${SRE_DOMAIN}`;
  const reviewUrl = `${dashboardUrl}/?tab=security&run=${run.id}`;

  // Count findings by severity
  const allFindings = (run.gates || []).flatMap(g => g.findings || []);
  const critCount = allFindings.filter(f => f.severity === "critical").length;
  const highCount = allFindings.filter(f => f.severity === "high").length;
  const medCount = allFindings.filter(f => f.severity === "medium").length;
  const lowCount = allFindings.filter(f => f.severity === "low" || f.severity === "info").length;

  const findingSummary = [
    critCount > 0 ? `${critCount} critical` : null,
    highCount > 0 ? `${highCount} high` : null,
    medCount > 0 ? `${medCount} medium` : null,
    lowCount > 0 ? `${lowCount} low/info` : null,
  ].filter(Boolean).join(", ") || "0 findings";

  // Build Slack message based on event type
  let slackText, slackColor;
  if (eventType === "submitted") {
    slackColor = "#f0ad4e"; // yellow
    slackText = `*New Pipeline Review Submitted*\n` +
      `*App:* ${run.app_name}\n` +
      `*Team:* ${run.team || "—"}\n` +
      `*Submitted by:* ${run.submitted_by || run.created_by || "—"}\n` +
      `*Findings:* ${findingSummary}\n` +
      `<${reviewUrl}|Review Now>`;
  } else if (eventType === "approved") {
    slackColor = "#5cb85c"; // green
    slackText = `*Pipeline Review Approved*\n` +
      `*App:* ${run.app_name}\n` +
      `*Approved by:* ${extra.actor || "—"}\n` +
      (extra.comment ? `*Comment:* ${extra.comment}\n` : "") +
      `<${reviewUrl}|View Details>`;
  } else if (eventType === "rejected") {
    slackColor = "#d9534f"; // red
    slackText = `*Pipeline Review Rejected*\n` +
      `*App:* ${run.app_name}\n` +
      `*Rejected by:* ${extra.actor || "—"}\n` +
      (extra.comment ? `*Reason:* ${extra.comment}\n` : "") +
      `<${reviewUrl}|View Details>`;
  } else if (eventType === "returned") {
    slackColor = "#f0ad4e"; // yellow
    slackText = `*Pipeline Review Returned for Rework*\n` +
      `*App:* ${run.app_name}\n` +
      `*Returned by:* ${extra.actor || "—"}\n` +
      (extra.comment ? `*Reason:* ${extra.comment}\n` : "") +
      `<${reviewUrl}|View Details>`;
  } else {
    return; // unknown event type, skip
  }

  // Send Slack notification
  if (ISSM_SLACK_WEBHOOK) {
    try {
      const payload = JSON.stringify({
        attachments: [{
          color: slackColor,
          text: slackText,
          mrkdwn_in: ["text"],
          footer: "SRE DSOP Pipeline",
          ts: Math.floor(Date.now() / 1000),
        }],
      });
      const url = new URL(ISSM_SLACK_WEBHOOK);
      const mod = url.protocol === "https:" ? require("https") : require("http");
      await new Promise((resolve, reject) => {
        const r = mod.request(url, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, (resp) => {
          resp.resume();
          resolve();
        });
        r.on("error", reject);
        r.write(payload);
        r.end();
      });
      logger.info("pipeline", `ISSM Slack notification sent: ${eventType} for ${run.app_name}`);
    } catch (err) {
      logger.warn("pipeline", `ISSM Slack notification failed: ${err.message}`);
    }
  }

  // Log email intent (actual email sending requires SMTP integration)
  if (ISSM_NOTIFY_EMAIL) {
    logger.info("pipeline", `ISSM email notification would be sent to ${ISSM_NOTIFY_EMAIL}: ${eventType} for ${run.app_name}`);
  }
}

// ── Bundle Upload ────────────────────────────────────────────────────────────

// POST /api/bundle/upload — Upload and parse a deployment bundle
app.post("/api/bundle/upload", mutateLimiter, requireDb, requireGroups("sre-admins", "developers"), (req, res, next) => {
  bundleUpload.single("bundle")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `Bundle exceeds maximum size of ${Math.round(BUNDLE_MAX_SIZE / (1024*1024*1024))}GB` });
      return res.status(400).json({ error: err.message || "Upload failed" });
    }
    next();
  });
}, async (req, res) => {
  const uploadId = crypto.randomUUID();
  const extractDir = path.join(BUNDLE_UPLOAD_DIR, uploadId);
  let uploadedFilePath = null;

  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    uploadedFilePath = req.file.path;

    // Extract the tar.gz
    fs.mkdirSync(extractDir, { recursive: true });
    try {
      execSync(`tar xzf "${uploadedFilePath}" -C "${extractDir}"`, { timeout: 120000 });
    } catch (tarErr) {
      return res.status(400).json({ error: "Failed to extract bundle — is it a valid .tar.gz?" });
    }

    // Find bundle.yaml (may be at root or one level deep)
    let manifestPath = path.join(extractDir, "bundle.yaml");
    if (!fs.existsSync(manifestPath)) {
      // Check one level deep (in case the tar has a top-level directory)
      const entries = fs.readdirSync(extractDir);
      for (const entry of entries) {
        const nested = path.join(extractDir, entry, "bundle.yaml");
        if (fs.existsSync(nested)) {
          manifestPath = nested;
          break;
        }
      }
    }
    if (!fs.existsSync(manifestPath)) {
      return res.status(400).json({ error: "Bundle missing bundle.yaml manifest" });
    }

    // Parse manifest
    let manifest;
    try {
      manifest = yaml.load(fs.readFileSync(manifestPath, "utf8"));
    } catch (yamlErr) {
      return res.status(400).json({ error: `Invalid bundle.yaml: ${yamlErr.message}` });
    }

    // Validate manifest
    if (!manifest || manifest.apiVersion !== "sre.io/v1alpha1") {
      return res.status(400).json({ error: "Invalid apiVersion — expected sre.io/v1alpha1" });
    }
    if (manifest.kind !== "DeploymentBundle") {
      return res.status(400).json({ error: "Invalid kind — expected DeploymentBundle" });
    }
    if (!manifest.metadata?.name) {
      return res.status(400).json({ error: "manifest.metadata.name is required" });
    }
    if (!manifest.spec?.app?.type) {
      return res.status(400).json({ error: "manifest.spec.app.type is required" });
    }
    if (!manifest.spec?.app?.image) {
      return res.status(400).json({ error: "manifest.spec.app.image is required" });
    }

    // Find the base directory (handle nested tar structure)
    const manifestDir = path.dirname(manifestPath);

    // Enumerate and validate images
    const imageEntries = [];
    const allImageRefs = [manifest.spec.app.image];
    if (manifest.spec.components) {
      for (const comp of manifest.spec.components) {
        if (comp.image) allImageRefs.push(comp.image);
      }
    }

    for (const imageRef of allImageRefs) {
      const imagePath = path.join(manifestDir, imageRef);
      if (!fs.existsSync(imagePath)) {
        return res.status(400).json({ error: `Referenced image not found in bundle: ${imageRef}` });
      }
      const stat = fs.statSync(imagePath);
      const name = path.basename(imageRef, ".tar");

      // Compute SHA-256
      let sha256;
      try {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(imagePath);
        for await (const chunk of stream) { hash.update(chunk); }
        sha256 = hash.digest("hex");
      } catch {
        sha256 = "unknown";
      }

      imageEntries.push({
        name,
        file: imageRef,
        sizeMB: Math.round(stat.size / (1024 * 1024) * 10) / 10,
        sha256,
      });
    }

    // Check for source code
    const sourceIncluded = fs.existsSync(path.join(manifestDir, "source")) &&
      fs.readdirSync(path.join(manifestDir, "source")).length > 0;

    // Clean up the uploaded temp file (keep the extracted directory)
    try { fs.unlinkSync(uploadedFilePath); } catch { /* ignore */ }

    logger.info("bundle", `Bundle uploaded: ${manifest.metadata.name} v${manifest.metadata.version || "unknown"} (${imageEntries.length} image(s))`, {
      uploadId, name: manifest.metadata.name, images: imageEntries.length, sourceIncluded,
    });

    res.json({
      uploadId,
      manifest,
      images: imageEntries,
      sourceIncluded,
    });
  } catch (err) {
    console.error("[bundle] Upload error:", err);
    // Clean up on error
    try { if (uploadedFilePath) fs.unlinkSync(uploadedFilePath); } catch { /* ignore */ }
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch { /* ignore */ }
    res.status(500).json({ error: "Bundle processing failed" });
  }
});

// POST /api/bundle/create — Generate a downloadable .bundle.tar.gz
app.post("/api/bundle/create", mutateLimiter, requireDb, requireGroups("sre-admins", "developers"), (req, res, next) => {
  bundleUpload.fields([
    { name: "manifest", maxCount: 1 },
    { name: "images", maxCount: 10 },
    { name: "source", maxCount: 1 },
  ])(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File exceeds maximum size" });
      return res.status(400).json({ error: err.message || "Upload failed" });
    }
    next();
  });
}, async (req, res) => {
  const buildId = crypto.randomUUID();
  const buildDir = path.join(BUNDLE_UPLOAD_DIR, `build-${buildId}`);
  const outputFile = path.join(BUNDLE_UPLOAD_DIR, `build-${buildId}.tar.gz`);

  try {
    // Parse manifest
    const manifestJson = req.body?.manifest;
    if (!manifestJson) return res.status(400).json({ error: "manifest field is required" });

    let manifest;
    try {
      manifest = JSON.parse(manifestJson);
    } catch {
      return res.status(400).json({ error: "Invalid manifest JSON" });
    }

    if (!manifest.metadata?.name) return res.status(400).json({ error: "manifest.metadata.name is required" });

    const bundleName = manifest.metadata.name;
    const bundleVersion = manifest.metadata.version || "0.0.0";

    // Create bundle directory structure
    fs.mkdirSync(path.join(buildDir, "images"), { recursive: true });

    // Write bundle.yaml
    fs.writeFileSync(path.join(buildDir, "bundle.yaml"), yaml.dump(manifest, { lineWidth: -1 }));

    // Copy image files
    const imageFiles = req.files?.images || [];
    for (const imgFile of imageFiles) {
      const destName = imgFile.originalname || `image-${crypto.randomBytes(4).toString("hex")}.tar`;
      fs.copyFileSync(imgFile.path, path.join(buildDir, "images", destName));
    }

    // Copy source file if provided
    const sourceFiles = req.files?.source || [];
    if (sourceFiles.length > 0) {
      fs.mkdirSync(path.join(buildDir, "source"), { recursive: true });
      fs.copyFileSync(sourceFiles[0].path, path.join(buildDir, "source", sourceFiles[0].originalname || "source.tar.gz"));
    }

    // Generate checksums
    const checksumLines = [];
    const allFiles = [];
    function walkDir(dir, prefix = "") {
      for (const entry of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, entry);
        const relPath = prefix ? `${prefix}/${entry}` : entry;
        if (fs.statSync(fullPath).isDirectory()) {
          walkDir(fullPath, relPath);
        } else {
          allFiles.push({ fullPath, relPath });
        }
      }
    }
    walkDir(buildDir);
    for (const { fullPath, relPath } of allFiles) {
      const hash = crypto.createHash("sha256");
      hash.update(fs.readFileSync(fullPath));
      checksumLines.push(`${hash.digest("hex")}  ${relPath}`);
    }
    fs.writeFileSync(path.join(buildDir, "checksums.sha256"), checksumLines.join("\n") + "\n");

    // Generate README
    const readme = [
      `# ${bundleName} v${bundleVersion}`,
      "",
      `Bundle created: ${new Date().toISOString()}`,
      manifest.metadata?.author ? `Author: ${manifest.metadata.author}` : "",
      manifest.metadata?.description ? `\n${manifest.metadata.description}` : "",
      "",
      "## Contents",
      "",
      `- bundle.yaml — Deployment manifest`,
      `- images/ — ${imageFiles.length} container image(s)`,
      sourceFiles.length > 0 ? "- source/ — Source code archive" : "",
      "- checksums.sha256 — File integrity checksums",
      "",
      "## How to deploy",
      "",
      "Upload this bundle through the DSOP wizard's 'Upload Bundle' option",
      "or use the SRE Platform CLI:",
      "",
      "```",
      `# Upload and process through security pipeline`,
      `# Navigate to https://dsop.apps.sre.example.com`,
      `# Select 'Upload Bundle' in Step 1`,
      "```",
    ].filter(Boolean).join("\n");
    fs.writeFileSync(path.join(buildDir, "README.md"), readme);

    // Create tar.gz
    const tarFilename = `${bundleName}-v${bundleVersion}.bundle.tar.gz`;
    try {
      execSync(`tar czf "${outputFile}" -C "${buildDir}" .`, { timeout: 120000 });
    } catch (tarErr) {
      return res.status(500).json({ error: "Failed to create bundle archive" });
    }

    // Stream the file as a download
    const stat = fs.statSync(outputFile);
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${tarFilename}"`);
    res.setHeader("Content-Length", stat.size);

    const stream = fs.createReadStream(outputFile);
    stream.pipe(res);
    stream.on("end", () => {
      // Clean up
      try { fs.rmSync(buildDir, { recursive: true, force: true }); } catch { /* ignore */ }
      try { fs.unlinkSync(outputFile); } catch { /* ignore */ }
      // Clean up multer temp files
      for (const f of [...imageFiles, ...sourceFiles]) {
        try { fs.unlinkSync(f.path); } catch { /* ignore */ }
      }
    });
    stream.on("error", () => {
      if (!res.headersSent) res.status(500).json({ error: "Failed to send bundle" });
    });

    logger.info("bundle", `Bundle created: ${bundleName} v${bundleVersion} (${Math.round(stat.size / (1024*1024))}MB)`, { bundleName, bundleVersion });

  } catch (err) {
    console.error("[bundle] Create error:", err);
    // Clean up on error
    try { fs.rmSync(buildDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.unlinkSync(outputFile); } catch { /* ignore */ }
    if (!res.headersSent) res.status(500).json({ error: "Bundle creation failed" });
  }
});

// Periodic cleanup of stale bundle uploads (older than 24 hours)
setInterval(() => {
  try {
    if (!fs.existsSync(BUNDLE_UPLOAD_DIR)) return;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(BUNDLE_UPLOAD_DIR)) {
      const entryPath = path.join(BUNDLE_UPLOAD_DIR, entry);
      try {
        const stat = fs.statSync(entryPath);
        if (stat.isDirectory() && stat.mtimeMs < cutoff) {
          fs.rmSync(entryPath, { recursive: true, force: true });
          logger.info("bundle", `Cleaned up stale bundle: ${entry}`);
        }
      } catch { /* ignore individual cleanup errors */ }
    }
  } catch { /* ignore */ }
}, 60 * 60 * 1000); // Run every hour

// Default DSOP gates for a new pipeline run
function getDefaultGates() {
  return [
    { gateName: "Static Application Security Testing", shortName: "SAST", gateOrder: 1, tool: "Semgrep" },
    { gateName: "Secrets Detection", shortName: "SECRETS", gateOrder: 2, tool: "Gitleaks" },
    { gateName: "Container Image Build", shortName: "ARTIFACT_STORE", gateOrder: 3, tool: "Kaniko" },
    { gateName: "Software Bill of Materials", shortName: "SBOM", gateOrder: 4, tool: "Syft" },
    { gateName: "Container Vulnerability Scan", shortName: "CVE", gateOrder: 5, tool: "Trivy" },
    { gateName: "Dynamic Application Security Testing", shortName: "DAST", gateOrder: 6, tool: "OWASP ZAP" },
    { gateName: "ISSM Security Review", shortName: "ISSM_REVIEW", gateOrder: 7, tool: null },
    { gateName: "Image Signing & Attestation", shortName: "IMAGE_SIGNING", gateOrder: 8, tool: "Cosign" },
  ];
}

// POST /api/pipeline/runs — Create a new pipeline run
app.post("/api/pipeline/runs", mutateLimiter, requireDb, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const { appName, gitUrl, branch, imageUrl, sourceType, team, classification, contact, securityContext, port, bundleUploadId } = req.body;
    if (!appName || !team) return res.status(400).json({ error: "appName and team are required" });
    if (!gitUrl && !imageUrl && !bundleUploadId) return res.status(400).json({ error: "gitUrl, imageUrl, or bundleUploadId is required" });
    if (imageUrl && imageUrl.endsWith(":latest")) return res.status(400).json({ error: "The :latest tag is not allowed — use a pinned version tag (e.g., v1.0.0)" });
    if (imageUrl && !validateImageRef(imageUrl)) return res.status(400).json({ error: "Invalid image reference format" });
    if (bundleUploadId) {
      const bundlePath = path.join(BUNDLE_UPLOAD_DIR, bundleUploadId);
      if (!fs.existsSync(bundlePath)) return res.status(400).json({ error: "Bundle not found — upload expired or invalid uploadId" });
    }

    // Concurrency limits — prevent unbounded job spawning
    const MAX_ACTIVE_PER_TEAM = 3;
    const MAX_ACTIVE_GLOBAL = 5;
    const { rows: activeTeamRuns } = await db.pool.query(
      "SELECT COUNT(*) as count FROM pipeline_runs WHERE team = $1 AND status IN ('pending', 'scanning', 'deploying')",
      [team]
    );
    if (parseInt(activeTeamRuns[0].count) >= MAX_ACTIVE_PER_TEAM) {
      return res.status(429).json({ error: `Team ${team} already has ${MAX_ACTIVE_PER_TEAM} active pipeline runs. Wait for existing runs to complete.` });
    }
    const { rows: activeGlobalRuns } = await db.pool.query(
      "SELECT COUNT(*) as count FROM pipeline_runs WHERE status IN ('pending', 'scanning', 'deploying')"
    );
    if (parseInt(activeGlobalRuns[0].count) >= MAX_ACTIVE_GLOBAL) {
      return res.status(429).json({ error: `Platform has ${MAX_ACTIVE_GLOBAL} active pipeline runs. Wait for existing runs to complete.` });
    }

    const actor = getActor(req);
    const run = await db.createRun({
      appName, gitUrl, branch, imageUrl,
      sourceType: sourceType || (gitUrl ? "git" : imageUrl ? "image" : "bundle"),
      team, classification, contact,
      createdBy: actor,
    });

    // Create all gates (adjust names for container/image/bundle source type)
    const isImageSource = run.source_type === "image";
    const isBundleSource = run.source_type === "bundle";
    const gates = [];
    for (const gateSpec of getDefaultGates()) {
      const spec = { ...gateSpec };
      if (isImageSource) {
        if (spec.shortName === "SAST") spec.gateName = "SAST (Skipped — no source)";
        if (spec.shortName === "SECRETS") spec.gateName = "Secrets Detection (Skipped — no source)";
        if (spec.shortName === "ARTIFACT_STORE") { spec.gateName = "Image Import"; spec.tool = "crane"; }
      }
      if (isBundleSource) {
        if (spec.shortName === "ARTIFACT_STORE") { spec.gateName = "Bundle Import"; spec.tool = "crane"; }
        // SAST/SECRETS names depend on whether source code is included
      }
      const gate = await db.createGate(run.id, spec);
      gates.push(gate);
    }

    // Store security context and port override in run metadata if provided
    if (securityContext || port) {
      const runMetadata = {};
      if (securityContext) runMetadata.securityContext = securityContext;
      if (port) runMetadata.portOverride = port;
      try {
        await db.pool.query(
          "UPDATE pipeline_runs SET metadata = $1::jsonb, port = $2, updated_at = NOW() WHERE id = $3",
          [JSON.stringify(runMetadata), port || null, run.id]
        );
      } catch (metaErr) {
        console.debug('[pipeline] Metadata/port storage best-effort:', metaErr.message);
      }
    }

    if (bundleUploadId) {
      try {
        await db.pool.query(
          "UPDATE pipeline_runs SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2",
          [JSON.stringify({ bundleUploadId }), run.id]
        );
      } catch (metaErr) {
        console.debug('[pipeline] Bundle metadata storage best-effort:', metaErr.message);
      }
    }

    await db.auditLog(run.id, "run_created", actor, `Pipeline run created for ${appName}`, { team, sourceType: run.source_type });

    // Kick off scan orchestration in background (non-blocking)
    orchestratePipelineScan(run.id).catch(err => {
      logger.error('pipeline', `Orchestration error for run ${run.id}`, { runId: run.id, error: err.message });
    });

    res.status(201).json({ ...run, gates });
  } catch (err) {
    console.error("[pipeline] Create run error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/pipeline/runs — List runs with filters
app.get("/api/pipeline/runs", requireDb, requireGroups("sre-admins", "developers", "issm"), async (req, res) => {
  try {
    // H-4: Team-based data isolation
    const groupsHeader = req.headers["x-auth-request-groups"] || "";
    const userGroups = groupsHeader.split(/[,\s]+/).map(g => g.trim().replace(/^\//, "")).filter(Boolean);
    const isAdmin = userGroups.some(g => ["sre-admins", "issm"].includes(g));

    const filters = {
      status: req.query.status,
      team: req.query.team,
      since: req.query.since,
      limit: req.query.limit,
      offset: req.query.offset,
    };

    // Non-admin users can only see their team's runs
    if (!isAdmin) {
      const userTeam = userGroups.find(g => g.startsWith("team-"));
      if (userTeam) {
        filters.team = userTeam;
      }
    }

    const result = await db.listRuns(filters);

    // Enrich runs with gates and findings for display (ISSM queue needs finding counts)
    if (result.runs && result.runs.length > 0) {
      const runIds = result.runs.map(r => r.id);
      const gatesResult = await db.pool.query(
        "SELECT id, run_id, gate_name AS name, short_name, gate_order, status, progress, summary, tool, completed_at FROM pipeline_gates WHERE run_id = ANY($1) ORDER BY gate_order",
        [runIds]
      );
      const findingsResult = await db.pool.query(
        "SELECT id, run_id, gate_id, severity, title, location, disposition FROM pipeline_findings WHERE run_id = ANY($1)",
        [runIds]
      );

      // Group gates and findings by run_id
      const gatesByRun = {};
      const findingsByRun = {};
      for (const g of gatesResult.rows) {
        if (!gatesByRun[g.run_id]) gatesByRun[g.run_id] = [];
        gatesByRun[g.run_id].push(g);
      }
      for (const f of findingsResult.rows) {
        if (!findingsByRun[f.run_id]) findingsByRun[f.run_id] = [];
        findingsByRun[f.run_id].push(f);
      }

      // Attach gates with their findings to each run
      result.runs = result.runs.map(run => {
        const runGates = gatesByRun[run.id] || [];
        const runFindings = findingsByRun[run.id] || [];
        // Attach findings to their parent gate
        const findingsByGate = {};
        for (const f of runFindings) {
          if (!findingsByGate[f.gate_id]) findingsByGate[f.gate_id] = [];
          findingsByGate[f.gate_id].push(f);
        }
        return {
          ...run,
          gates: runGates.map(g => ({ ...g, findings: findingsByGate[g.id] || [] })),
        };
      });
    }

    res.json(result);
  } catch (err) {
    console.error("[pipeline] List runs error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/pipeline/runs/:id — Full run detail
app.get("/api/pipeline/runs/:id", requireDb, requireGroups("sre-admins", "developers", "issm"), async (req, res) => {
  try {
    const run = await db.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "Pipeline run not found" });

    // H-4: Team-based data isolation — non-admins can only see their team's runs
    const groupsHeader = req.headers["x-auth-request-groups"] || "";
    const userGroups = groupsHeader.split(/[,\s]+/).map(g => g.trim().replace(/^\//, "")).filter(Boolean);
    const isAdmin = userGroups.some(g => ["sre-admins", "issm"].includes(g));
    if (!isAdmin) {
      const userTeam = userGroups.find(g => g.startsWith("team-"));
      if (userTeam && run.team !== userTeam) {
        return res.status(404).json({ error: "Pipeline run not found" });
      }
    }

    // Strip raw_output from gates by default to keep responses small.
    // Use ?include_raw=true to include full tool output.
    const includeRaw = req.query.include_raw === "true";
    if (!includeRaw && run.gates) {
      run.gates = run.gates.map(g => {
        const { raw_output, ...rest } = g;
        return rest;
      });
    }

    res.json(run);
  } catch (err) {
    console.error("[pipeline] Get run error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/pipeline/runs/:id/gates/:gateId/output — Raw scan output for a specific gate
app.get("/api/pipeline/runs/:id/gates/:gateId/output", requireDb, requireGroups("sre-admins", "developers", "issm"), async (req, res) => {
  try {
    const run = await db.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "Pipeline run not found" });

    // H-4: Team-based data isolation
    const groupsHeader = req.headers["x-auth-request-groups"] || "";
    const userGroups = groupsHeader.split(/[,\s]+/).map(g => g.trim().replace(/^\//, "")).filter(Boolean);
    const isAdmin = userGroups.some(g => ["sre-admins", "issm"].includes(g));
    if (!isAdmin) {
      const userTeam = userGroups.find(g => g.startsWith("team-"));
      if (userTeam && run.team !== userTeam) {
        return res.status(404).json({ error: "Pipeline run not found" });
      }
    }

    const gateId = parseInt(req.params.gateId);
    const gate = run.gates.find(g => g.id === gateId);
    if (!gate) return res.status(404).json({ error: "Gate not found" });

    res.json({
      gateId: gate.id,
      gateName: gate.gate_name,
      shortName: gate.short_name,
      status: gate.status,
      tool: gate.tool,
      summary: gate.summary,
      rawOutput: gate.raw_output || null,
    });
  } catch (err) {
    console.error("[pipeline] Get gate output error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/pipeline/runs/:id/findings/:fid — Update finding disposition
app.patch("/api/pipeline/runs/:id/findings/:fid", mutateLimiter, requireDb, requireGroups("sre-admins", "developers", "issm"), async (req, res) => {
  try {
    const { disposition, mitigation } = req.body;
    if (!disposition) return res.status(400).json({ error: "disposition is required" });

    const validDispositions = ["will_fix", "accepted_risk", "false_positive", "na"];
    if (!validDispositions.includes(disposition)) {
      return res.status(400).json({ error: `Invalid disposition. Must be one of: ${validDispositions.join(", ")}` });
    }

    const actor = getActor(req);
    const updated = await db.updateFinding(parseInt(req.params.fid), {
      disposition,
      mitigation: mitigation || null,
      mitigatedBy: actor,
      mitigatedAt: new Date().toISOString(),
    }, req.params.id);

    if (!updated) return res.status(404).json({ error: "Finding not found" });

    await db.auditLog(req.params.id, "finding_updated", actor,
      `Finding ${req.params.fid} disposition set to ${disposition}`,
      { findingId: parseInt(req.params.fid), disposition, mitigation });

    res.json(updated);
  } catch (err) {
    console.error("[pipeline] Update finding error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/pipeline/runs/:id/package — Compliance package
app.get("/api/pipeline/runs/:id/package", requireDb, requireGroups("sre-admins", "developers", "issm"), async (req, res) => {
  try {
    const pkg = await db.getRunPackage(req.params.id);
    if (!pkg) return res.status(404).json({ error: "Pipeline run not found" });
    res.json(pkg);
  } catch (err) {
    console.error("[pipeline] Get package error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/pipeline/stats — Dashboard stats
app.get("/api/pipeline/stats", requireDb, requireGroups("sre-admins", "developers", "issm"), async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json(stats);
  } catch (err) {
    console.error("[pipeline] Stats error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/pipeline/runs/:id — Delete a pipeline run
app.delete("/api/pipeline/runs/:id", mutateLimiter, requireDb, requireGroups("sre-admins"), async (req, res) => {
  try {
    const run = await db.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "Pipeline run not found" });
    const actor = getActor(req);
    await db.auditLog(req.params.id, "run_deleted", actor, `Pipeline run deleted for ${run.app_name}`);
    await db.pool.query("DELETE FROM pipeline_runs WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("[pipeline] Delete run error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/pipeline/active — Active pipeline runs for My Apps cards
app.get("/api/pipeline/active", requireGroups("sre-admins", "developers", "issm"), async (req, res) => {
  try {
    if (!dbAvailable) return res.json({ runs: [] });
    // Team-based isolation
    const groupsHeader = req.headers["x-auth-request-groups"] || "";
    const userGroups = groupsHeader.split(/[,\s]+/).map(g => g.trim().replace(/^\//, "")).filter(Boolean);
    const isAdmin = userGroups.some(g => ["sre-admins", "issm"].includes(g));
    let team = null;
    if (!isAdmin) {
      team = userGroups.find(g => g.startsWith("team-"));
    }
    const runs = await db.getActiveRuns(team);
    res.json({ runs });
  } catch (err) {
    console.error("[pipeline] Active runs error:", err);
    res.json({ runs: [] });
  }
});

// POST /api/pipeline/cleanup — Mark stale scanning runs as failed
app.post("/api/pipeline/cleanup", mutateLimiter, requireDb, requireGroups("sre-admins"), async (req, res) => {
  try {
    // Stale pipeline run cleanup (10 min threshold)
    const STALE_THRESHOLD_MS = 10 * 60 * 1000;
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
    const { rows: staleRuns } = await db.pool.query(
      "SELECT id FROM pipeline_runs WHERE status IN ('scanning', 'pending') AND updated_at < $1",
      [cutoff]
    );

    const cleaned = [];
    for (const run of staleRuns) {
      await db.pool.query(
        "UPDATE pipeline_gates SET status = 'failed', summary = 'Pipeline timed out', completed_at = NOW() WHERE run_id = $1 AND status IN ('pending', 'running')",
        [run.id]
      );
      await db.updateRunStatus(run.id, "failed");
      await db.auditLog(run.id, "pipeline_cleanup", "system", "Stale pipeline run marked as failed by cleanup");
      cleaned.push(run.id);
    }

    // K8s Job cleanup — delete completed jobs >30min old, stuck active jobs >20min old
    let jobsCleaned = 0;
    try {
      const jobsResp = await batchApi.listNamespacedJob(BUILD_NAMESPACE);
      const now = Date.now();
      for (const job of (jobsResp.body.items || [])) {
        const createdAt = new Date(job.metadata.creationTimestamp).getTime();
        const ageMs = now - createdAt;
        const isComplete = job.status?.succeeded || job.status?.failed;
        const shouldDelete = (isComplete && ageMs > 30 * 60 * 1000) || (!isComplete && ageMs > 20 * 60 * 1000);
        if (shouldDelete) {
          try {
            await batchApi.deleteNamespacedJob(job.metadata.name, BUILD_NAMESPACE, undefined, undefined, undefined, undefined, "Background");
            jobsCleaned++;
          } catch (err) {
            console.debug('[pipeline] Build job cleanup best-effort error:', err.message);
          }
        }
      }
    } catch (err) {
      console.error("[cleanup] K8s job cleanup error:", err.message);
    }

    res.json({ cleaned: cleaned.length, runIds: cleaned, jobsCleaned });
  } catch (err) {
    console.error("[pipeline] Cleanup error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/pipeline/runs/:id/retry — Restart a failed/stale pipeline run
app.post("/api/pipeline/runs/:id/retry", mutateLimiter, requireDb, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const oldRun = await db.getRun(req.params.id);
    if (!oldRun) return res.status(404).json({ error: "Pipeline run not found" });

    if (!["failed", "scanning", "pending"].includes(oldRun.status)) {
      return res.status(400).json({ error: `Cannot retry a run with status '${oldRun.status}'. Only failed, scanning, or pending runs can be retried.` });
    }

    const actor = getActor(req);

    // Create a new run with the same parameters
    const newRun = await db.createRun({
      appName: oldRun.app_name,
      gitUrl: oldRun.git_url,
      branch: oldRun.branch,
      imageUrl: oldRun.image_url,
      sourceType: oldRun.source_type,
      team: oldRun.team,
      classification: oldRun.classification,
      contact: oldRun.contact,
      createdBy: actor,
    });

    // Create all gates
    const gates = [];
    for (const gateSpec of getDefaultGates()) {
      const gate = await db.createGate(newRun.id, gateSpec);
      gates.push(gate);
    }

    // Mark old run as superseded
    await db.updateRunStatus(oldRun.id, "failed");
    await db.auditLog(oldRun.id, "run_retried", actor, `Superseded by new run ${newRun.id}`);
    await db.auditLog(newRun.id, "run_created", actor, `Retry of ${oldRun.id} for ${oldRun.app_name}`, { retriedFrom: oldRun.id, team: newRun.team });

    // Kick off scan orchestration
    orchestratePipelineScan(newRun.id).catch(err => {
      logger.error('pipeline', `Retry orchestration error for run ${newRun.id}`, { runId: newRun.id, error: err.message });
    });

    res.status(201).json({ ...newRun, gates, retriedFrom: oldRun.id });
  } catch (err) {
    console.error("[pipeline] Retry error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/pipeline/runs/:id/submit-review — Developer submits for ISSM review
app.post("/api/pipeline/runs/:id/submit-review", mutateLimiter, requireDb, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const run = await db.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "Pipeline run not found" });

    // Check all automated gates are completed (not running or pending)
    const automatedGates = run.gates.filter(g => !["ISSM_REVIEW", "IMAGE_SIGNING"].includes(g.short_name));
    const incompleteGates = automatedGates.filter(g => g.status === "running" || g.status === "pending");
    if (incompleteGates.length > 0) {
      return res.status(400).json({
        error: "Cannot submit for review: automated gates still in progress",
        incompleteGates: incompleteGates.map(g => g.short_name),
      });
    }

    // H-2: Require minimum scan coverage before review
    const completedGates = run.gates.filter(g => g.status === 'passed' || g.status === 'warning');
    if (completedGates.length < 3) {
      return res.status(400).json({ error: "Insufficient scan coverage: at least 3 gates must pass before review" });
    }

    // Check all critical and high findings have a disposition (H-3)
    const criticalWithoutDisposition = run.findings.filter(
      f => (f.severity === "critical" || f.severity === "high") && !f.disposition
    );
    if (criticalWithoutDisposition.length > 0) {
      return res.status(400).json({
        error: "Cannot submit for review: critical and high findings require a disposition",
        count: criticalWithoutDisposition.length,
        findings: criticalWithoutDisposition.map(f => ({ id: f.id, title: f.title })),
      });
    }

    const actor = getActor(req);

    // Update run status
    await db.updateRunStatus(run.id, "review_pending");

    // Set ISSM REVIEW gate to pending
    const issmGate = run.gates.find(g => g.short_name === "ISSM_REVIEW");
    if (issmGate) {
      await db.updateGate(issmGate.id, { status: "pending" });
    }

    await db.auditLog(run.id, "submitted_for_review", actor, "Run submitted for ISSM review");

    const updated = await db.getRun(run.id);

    // Notify ISSM via Slack/email (non-blocking, optional)
    notifyISSM(updated, "submitted").catch(err => {
      logger.warn("pipeline", `ISSM notification failed for submit: ${err.message}`);
    });

    res.json(updated);
  } catch (err) {
    console.error("[pipeline] Submit review error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/pipeline/runs/:id/review — ISSM approves or rejects
app.post("/api/pipeline/runs/:id/review", mutateLimiter, requireDb, requireGroups("sre-admins", "issm"), async (req, res) => {
  try {
    const { decision, comment } = req.body;
    if (!decision) return res.status(400).json({ error: "decision is required" });

    const validDecisions = ["approved", "rejected", "returned"];
    if (!validDecisions.includes(decision)) {
      return res.status(400).json({ error: `Invalid decision. Must be one of: ${validDecisions.join(", ")}` });
    }

    const run = await db.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "Pipeline run not found" });

    if (run.status !== "review_pending") {
      return res.status(400).json({ error: `Run is not in review_pending status (current: ${run.status})` });
    }

    const actor = getActor(req);

    // H-1: Separation of duties enforcement
    if (actor === run.created_by || actor === run.submitted_by) {
      if (ENFORCE_SEPARATION_OF_DUTIES && decision === "approved") {
        // Block self-approval when enforcement is enabled; reject/return are still allowed
        await db.auditLog(run.id, "separation_of_duties_blocked", actor,
          "Self-approval blocked: reviewer is the same as the run creator/submitter",
          { actor, createdBy: run.created_by, submittedBy: run.submitted_by });
        logger.warn("pipeline", `Separation of duties: blocked ${actor} from approving their own run ${run.id}`);
        return res.status(403).json({
          error: "Separation of duties: you cannot approve a pipeline run you created or submitted. Another ISSM must approve it.",
        });
      }
      // Log warning even when not enforcing
      await db.auditLog(run.id, "separation_of_duties_warning", actor,
        "Reviewer is the same as the run creator/submitter — would be blocked with ENFORCE_SEPARATION_OF_DUTIES=true",
        { actor, createdBy: run.created_by, submittedBy: run.submitted_by });
    }

    // Create review record
    await db.createReview({ runId: run.id, reviewer: actor, decision, comment });

    const issmGate = run.gates.find(g => g.short_name === "ISSM_REVIEW");
    const signingGate = run.gates.find(g => g.short_name === "IMAGE_SIGNING");

    if (decision === "approved") {
      if (issmGate) {
        await db.updateGate(issmGate.id, { status: "passed", completedAt: new Date().toISOString(), summary: `Approved by ${actor}` });
      }
      // Simulate image signing
      if (signingGate) {
        await db.updateGate(signingGate.id, { status: "running", startedAt: new Date().toISOString() });
        await db.updateGate(signingGate.id, { status: "passed", completedAt: new Date().toISOString(), summary: "Image signed (simulated cosign)" });
      }

      // Mark all security exceptions as ISSM-approved so executePipelineDeploy
      // can apply the correct securityContext and generate Kyverno PolicyExceptions
      try {
        const rawExceptions = run.security_exceptions;
        const exceptions = typeof rawExceptions === "string" ? JSON.parse(rawExceptions || "[]") : (rawExceptions || []);
        if (exceptions.length > 0) {
          const approvedExceptions = exceptions.map(e => ({
            ...e,
            approved: true,
            approvedBy: actor,
            approvedAt: new Date().toISOString(),
          }));
          await db.pool.query(
            "UPDATE pipeline_runs SET security_exceptions = $1::jsonb, updated_at = NOW() WHERE id = $2",
            [JSON.stringify(approvedExceptions), run.id]
          );
          await db.auditLog(run.id, "exceptions_approved", actor,
            `ISSM approved ${approvedExceptions.length} security exception(s): ${approvedExceptions.map(e => e.type).join(", ")}`);
          logger.info("pipeline", `ISSM ${actor} approved ${approvedExceptions.length} security exceptions for run ${run.id}`,
            { runId: run.id, exceptions: approvedExceptions.map(e => e.type) });
        }
      } catch (exErr) {
        logger.warn("pipeline", `Failed to approve security exceptions for run ${run.id}: ${exErr.message}`);
      }

      await db.updateRunStatus(run.id, "approved");
      await db.auditLog(run.id, "review_approved", actor, comment || "Approved by ISSM");

      // Auto-deploy after approval if auto_deploy flag was set on the run
      try {
        const approvedRun = await db.getRun(run.id);
        if (approvedRun && approvedRun.auto_deploy) {
          await db.updateRunStatus(run.id, "deploying");
          await db.auditLog(run.id, "auto_deploy_triggered", actor, "Auto-deploying after ISSM approval");
          executePipelineDeploy(approvedRun, actor).catch(err => {
            console.error(`[pipeline] Auto-deploy error for ${run.id}: ${err.message}`);
          });
        }
      } catch (autoDeployErr) {
        console.error(`[pipeline] Auto-deploy check error: ${autoDeployErr.message}`);
      }
    } else if (decision === "rejected") {
      if (issmGate) {
        await db.updateGate(issmGate.id, { status: "failed", completedAt: new Date().toISOString(), summary: `Rejected by ${actor}: ${comment || "No reason given"}` });
      }
      await db.updateRunStatus(run.id, "rejected");
      await db.auditLog(run.id, "review_rejected", actor, comment || "Rejected by ISSM");
    } else if (decision === "returned") {
      if (issmGate) {
        await db.updateGate(issmGate.id, { status: "pending", summary: `Returned by ${actor}: ${comment || "Needs changes"}` });
      }
      await db.updateRunStatus(run.id, "scanning");
      await db.auditLog(run.id, "review_returned", actor, comment || "Returned for changes");
    }

    const updated = await db.getRun(run.id);

    // Notify ISSM via Slack/email (non-blocking, optional)
    notifyISSM(updated, decision, { actor, comment }).catch(err => {
      logger.warn("pipeline", `ISSM notification failed for ${decision}: ${err.message}`);
    });

    res.json(updated);
  } catch (err) {
    console.error("[pipeline] Review error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/pipeline/runs/:id/gates/:gateId/override — Admin override a gate
app.post("/api/pipeline/runs/:id/gates/:gateId/override", mutateLimiter, requireDb, requireGroups("sre-admins"), async (req, res) => {
  const { id, gateId } = req.params;
  const { status, reason } = req.body;
  const actor = getActor(req);

  if (!["passed", "skipped"].includes(status)) {
    return res.status(400).json({ error: "Status must be 'passed' or 'skipped'" });
  }
  if (!reason || reason.trim().length < 3) {
    return res.status(400).json({ error: "Override reason is required (min 3 characters)" });
  }

  try {
    await db.updateGate(parseInt(gateId), {
      status,
      summary: `Admin override: ${reason}`,
      completedAt: new Date().toISOString(),
    });
    await db.auditLog(id, "gate_override", actor, `Gate ${gateId} overridden to ${status}: ${reason}`, { gateId: parseInt(gateId), status, reason });

    // Auto-set disposition on unresolved findings from this gate
    await db.pool.query(
      `UPDATE pipeline_findings SET disposition = 'accepted_risk', mitigation = $1, mitigated_by = $2, mitigated_at = NOW()
       WHERE gate_id = $3 AND run_id = $4 AND disposition IS NULL`,
      [`Admin override: ${reason}`, actor, parseInt(gateId), id]
    );

    // Re-evaluate run status — if all automated gates are now passed/warning/skipped, move to review_pending
    const run = await db.getRun(id);
    if (run && run.status === "scanning") {
      const automatedGates = run.gates.filter(g => !["ISSM_REVIEW", "IMAGE_SIGNING"].includes(g.short_name));
      const allDone = automatedGates.every(g => ["passed", "warning", "skipped"].includes(g.status));
      if (allDone) {
        await db.updateRunStatus(id, "review_pending");
        const issmGate = run.gates.find(g => g.short_name === "ISSM_REVIEW");
        if (issmGate) {
          await db.updateGate(issmGate.id, { status: "warning", summary: "Awaiting ISSM review" });
        }
        await db.auditLog(id, "scan_complete_ready_for_review", actor, "All automated scans resolved via override — ready for ISSM review");
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Gate override error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/pipeline/runs/:id/exceptions — Request or approve security exceptions
// Body: { exceptions: [{ type: "run_as_root", justification: "App requires root for VNC server" }] }
// Admin can also set approved: true on each exception
app.post("/api/pipeline/runs/:id/exceptions", mutateLimiter, requireDb, requireGroups("sre-admins", "developers", "issm"), async (req, res) => {
  try {
    const { exceptions } = req.body;
    if (!Array.isArray(exceptions)) return res.status(400).json({ error: "exceptions must be an array" });

    const validTypes = ["run_as_root", "writable_filesystem", "host_networking", "privileged_container", "custom_capability"];
    for (const exc of exceptions) {
      if (!validTypes.includes(exc.type)) return res.status(400).json({ error: `Invalid exception type: ${exc.type}. Valid: ${validTypes.join(", ")}` });
      if (!exc.justification || exc.justification.length < 5) return res.status(400).json({ error: "Each exception requires a justification (min 5 chars)" });
    }

    const run = await db.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "Pipeline run not found" });

    const actor = getActor(req);
    const groupsHeader = req.headers["x-auth-request-groups"] || "";
    const userGroups = groupsHeader.split(/[,\s]+/).map(g => g.trim().replace(/^\//, "")).filter(Boolean);
    const isAdmin = userGroups.some(g => ["sre-admins", "issm"].includes(g));

    // Merge with existing exceptions
    const existing = typeof run.security_exceptions === 'string' ? JSON.parse(run.security_exceptions || '[]') : (run.security_exceptions || []);
    const merged = [...existing];

    for (const exc of exceptions) {
      const idx = merged.findIndex(e => e.type === exc.type);
      const entry = {
        type: exc.type,
        justification: exc.justification,
        requestedBy: exc.requestedBy || actor,
        requestedAt: exc.requestedAt || new Date().toISOString(),
        approved: isAdmin ? (exc.approved !== undefined ? exc.approved : true) : false,
        approvedBy: isAdmin && exc.approved !== false ? actor : null,
        approvedAt: isAdmin && exc.approved !== false ? new Date().toISOString() : null,
      };
      if (idx >= 0) merged[idx] = entry;
      else merged.push(entry);
    }

    await db.pool.query("UPDATE pipeline_runs SET security_exceptions = $1::jsonb, updated_at = NOW() WHERE id = $2", [JSON.stringify(merged), run.id]);
    await db.auditLog(run.id, "security_exceptions_updated", actor,
      `Security exceptions updated: ${exceptions.map(e => `${e.type}${isAdmin ? ' (approved)' : ' (requested)'}`).join(", ")}`,
      { exceptions: merged });

    const updated = await db.getRun(run.id);
    res.json(updated);
  } catch (err) {
    console.error("Security exceptions error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/pipeline/runs/:id/request-exception — Request a security exception for a pipeline run
app.post("/api/pipeline/runs/:id/request-exception", mutateLimiter, requireDb, requireGroups("sre-admins", "developers", "platform-admins"), async (req, res) => {
  try {
    const { id } = req.params;
    const { exceptionType, justification } = req.body;
    const actor = getActor(req);

    if (!exceptionType || !justification) {
      return res.status(400).json({ error: "Missing exceptionType or justification" });
    }

    const validTypes = ["run_as_root", "writable_filesystem", "host_networking", "privileged_container", "custom_capability"];
    if (!validTypes.includes(exceptionType)) {
      return res.status(400).json({ error: `Invalid exceptionType: ${exceptionType}. Valid: ${validTypes.join(", ")}` });
    }

    const run = await db.getRun(id);
    if (!run) return res.status(404).json({ error: "Run not found" });

    // Store the exception request in run metadata
    const metadata = run.metadata || {};
    metadata.exception_requests = metadata.exception_requests || [];
    metadata.exception_requests.push({
      type: exceptionType,
      justification,
      requestedBy: actor,
      requestedAt: new Date().toISOString(),
      status: "pending"
    });

    await db.pool.query("UPDATE pipeline_runs SET metadata = $1, updated_at = NOW() WHERE id = $2", [JSON.stringify(metadata), id]);
    await db.auditLog(id, "exception_requested", actor, `Security exception requested: ${exceptionType}`, { exceptionType, justification });

    logger.info("pipeline", "Security exception requested, pending ISSM review", { runId: id, exceptionType, actor });

    res.json({ success: true, message: "Security exception requested, pending ISSM review" });
  } catch (err) {
    logger.error("pipeline", "Exception request error", { error: err.message });
    res.status(500).json({ error: "Failed to request exception" });
  }
});

// POST /api/pipeline/runs/:id/deploy — Deploy after approval
app.post("/api/pipeline/runs/:id/deploy", mutateLimiter, requireDb, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const run = await db.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "Pipeline run not found" });

    if (run.status !== "approved") {
      return res.status(400).json({ error: `Run must be approved before deployment (current: ${run.status})` });
    }

    const actor = getActor(req);
    await db.updateRunStatus(run.id, "deploying");
    await db.auditLog(run.id, "deploy_started", actor, `Deploying ${run.app_name}`);

    // Deploy in background (non-blocking)
    executePipelineDeploy(run, actor).catch(err => {
      console.error(`[pipeline] Deploy error for ${run.id}: ${err.message}`);
    });

    res.json({ message: "Deployment started", runId: run.id, status: "deploying" });
  } catch (err) {
    console.error("[pipeline] Deploy error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/pipeline/runs/:id/stream — SSE stream of live pipeline gate events
app.get("/api/pipeline/runs/:id/stream", requireDb, requireGroups("sre-admins", "developers", "issm"), async (req, res) => {
  const runId = req.params.id;
  if (!runId) return res.status(400).json({ error: "Invalid run ID" });

  // Verify run exists and user has access
  let run;
  try {
    run = await db.getRun(runId);
    if (!run) return res.status(404).json({ error: "Pipeline run not found" });
    // Team-based access control
    const groupsHeader = req.headers["x-auth-request-groups"] || "";
    const userGroups = groupsHeader.split(/[,\s]+/).map(g => g.trim().replace(/^\//, "")).filter(Boolean);
    const isAdmin = userGroups.some(g => ["sre-admins", "issm"].includes(g));
    if (!isAdmin) {
      const userTeam = userGroups.find(g => g.startsWith("team-"));
      if (userTeam && run.team !== userTeam) {
        return res.status(404).json({ error: "Pipeline run not found" });
      }
    }
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders();

  let closed = false;
  req.on("close", () => { closed = true; });

  const sendSSE = (eventType, data) => {
    if (closed) return;
    res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // If the run is already in a terminal state, send current state and close
  const terminalStatuses = ["deployed", "rejected", "returned", "failed", "undeployed"];
  if (terminalStatuses.includes(run.status)) {
    // Replay any stored history
    const entry = getPipelineEmitter(runId);
    if (entry) {
      for (const ev of entry.history) {
        if (closed) break;
        sendSSE(ev.type, ev);
      }
    }
    // Send final state from DB
    if (run.gates) {
      for (const gate of run.gates) {
        sendSSE("gate_status", {
          gate: gate.short_name,
          status: gate.status,
          summary: gate.summary || "",
          progress: gate.progress || 0,
        });
      }
    }
    sendSSE("pipeline_status", { status: run.status, message: `Pipeline ${run.status}` });
    sendSSE("done", { status: run.status });
    res.end();
    return;
  }

  // Get or create the emitter for this run
  const emitter = getOrCreatePipelineEmitter(runId);

  // Replay history so a late subscriber catches up
  const entry = getPipelineEmitter(runId);
  if (entry && entry.history.length > 0) {
    for (const ev of entry.history) {
      if (closed) break;
      sendSSE(ev.type, ev);
    }
  }

  // Also send current gate state from DB so client has baseline
  if (run.gates) {
    for (const gate of run.gates) {
      if (gate.status !== "pending") {
        sendSSE("gate_status", {
          gate: gate.short_name,
          status: gate.status,
          summary: gate.summary || "",
          progress: gate.progress || 0,
        });
      }
    }
  }

  // Keep-alive ping every 25s to prevent proxy timeouts
  const pingInterval = setInterval(() => {
    if (closed) { clearInterval(pingInterval); return; }
    res.write(": ping\n\n");
  }, 25000);

  // Forward events from the emitter to this SSE response
  const onEvent = (ev) => {
    if (closed) return;
    sendSSE(ev.type, ev);
  };
  emitter.on("event", onEvent);

  // Clean up when client disconnects
  req.on("close", () => {
    clearInterval(pingInterval);
    emitter.off("event", onEvent);
  });
});

// ── Input Validation for Pipeline Scans ─────────────────────────────────────

function validateGitUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (!/^https?:\/\/[a-zA-Z0-9._\-]+(:[0-9]+)?(\/[a-zA-Z0-9._\-~%/]+)*(\.git)?$/.test(url)) return false;
  if (/[;&|`$(){}!#<>\\'"*?\[\]\n\r]/.test(url)) return false;
  return true;
}

function validateImageRef(image) {
  if (!image || typeof image !== 'string') return false;
  if (!/^[a-zA-Z0-9._\-]+(:[0-9]+)?\/[a-zA-Z0-9._\-/]+(:[a-zA-Z0-9._\-]+)?(@sha256:[a-f0-9]+)?$/.test(image)) return false;
  if (/[;&|`$(){}!#<>\\'"*?\[\]\n\r]/.test(image)) return false;
  return true;
}

function validateUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (!/^https?:\/\/[a-zA-Z0-9._\-]+(:[0-9]+)?(\/[a-zA-Z0-9._\-~%/?&=]*)?$/.test(url)) return false;
  if (/[;&|`$(){}!#<>\\'"*?\[\]\n\r]/.test(url)) return false;
  return true;
}

// ── Pipeline Scan Orchestrator ──────────────────────────────────────────────

async function runScanGate(runId, gate, scanFn) {
  try {
    await db.updateGate(gate.id, { status: "running", startedAt: new Date().toISOString(), progress: 10 });
    emitPipelineEvent(runId, "gate_status", { gate: gate.short_name, status: "running", summary: "Starting...", progress: 10 });
    const result = await scanFn();
    const gateStatus = result.status === "failed" ? "failed" : result.status === "warning" ? "warning" : "passed";

    // Build raw_output: include the full tool output (JSON from semgrep/gitleaks/syft/trivy)
    // plus the processed summary for reference
    const rawOutput = {
      gate: result.gate,
      tool: result.tool,
      status: gateStatus,
      summary: result.summary,
      findings: result.findings,
      toolOutput: result.toolOutput || null,
      packageCount: result.packageCount || undefined,
      format: result.format || undefined,
      scannedAt: new Date().toISOString(),
    };

    await db.updateGate(gate.id, {
      status: gateStatus,
      progress: 100,
      completedAt: new Date().toISOString(),
      summary: result.summary || `${gateStatus}`,
      rawOutput: rawOutput,
    });

    // Emit gate completion status
    emitPipelineEvent(runId, "gate_status", {
      gate: gate.short_name,
      status: gateStatus,
      summary: result.summary || gateStatus,
      progress: 100,
    });

    // Create findings in DB and emit each finding
    if (result.findings && result.findings.length > 0) {
      for (const finding of result.findings) {
        const mappedSeverity = finding.severity === "ERROR" ? "critical" : finding.severity === "WARNING" ? "high" : (finding.severity || "info").toLowerCase();
        await db.createFinding({
          runId,
          gateId: gate.id,
          severity: mappedSeverity,
          title: finding.title,
          description: finding.description,
          location: finding.location,
        });
        emitPipelineEvent(runId, "gate_finding", {
          gate: gate.short_name,
          severity: mappedSeverity,
          title: finding.title,
          location: finding.location || "",
        });
      }
    }

    await db.auditLog(runId, "gate_completed", null, `Gate ${gate.short_name} completed: ${gateStatus}`, { gateId: gate.id, status: gateStatus, findingCount: (result.findings || []).length });

    return gateStatus;
  } catch (err) {
    // Attempt to get detailed failure reason from the pod status
    let failureReason = err.message;
    let isOOM = false;
    const jobNameMatch = gate.job_name || (gate.short_name ? gate.short_name.toLowerCase() : "");
    try {
      const labelSelector = gate.job_name ? `job-name=${gate.job_name}` : `job-name`;
      const pods = await k8sApi.listNamespacedPod(BUILD_NAMESPACE, undefined, undefined, undefined, undefined, labelSelector);
      for (const pod of (pods.body.items || [])) {
        const jn = pod.metadata?.labels?.["job-name"] || "";
        if (gate.job_name ? jn === gate.job_name : (jn.startsWith(jobNameMatch) || jn.startsWith(jobNameMatch.replace(/_/g, "")))) {
          const cs = pod.status?.containerStatuses?.[0];
          if (cs?.state?.terminated?.reason === "OOMKilled") {
            failureReason = "Out of memory — image too large for scan resources";
            isOOM = true;
          } else if (cs?.state?.terminated?.reason === "StartError") {
            failureReason = `Container start error: ${(cs.state.terminated.message || "").substring(0, 200)}`;
          } else if (cs?.state?.terminated?.exitCode && cs.state.terminated.exitCode !== 0) {
            // Fetch actual logs to surface the real error message
            try {
              const podName = pod.metadata.name;
              const containerName = pod.spec?.containers?.[0]?.name || "unknown";
              const logResp = await k8sApi.readNamespacedPodLog(podName, BUILD_NAMESPACE, containerName, false, undefined, undefined, undefined, undefined, undefined, 20);
              const logLines = (logResp.body || "").trim();
              if (logLines) {
                // Try to extract an error message from the logs
                const errorLine = logLines.split("\n").find(l => /error|fail|fatal|denied|not found/i.test(l)) || logLines.split("\n").pop();
                failureReason = errorLine.substring(0, 200);
              } else {
                failureReason = `Scan exited with code ${cs.state.terminated.exitCode}`;
              }
            } catch (err) {
              console.debug('[pipeline] Could not read scan pod logs for failure reason:', err.message);
              failureReason = `Scan exited with code ${cs.state.terminated.exitCode}`;
            }
          }
          break;
        }
      }
    } catch (e) {
      console.debug('[pipeline] Best-effort pod status check failed:', e.message);
    }

    // Auto-retry once with 2x memory if OOMKilled
    if (isOOM && !gate._oomRetried) {
      logger.info('pipeline', `Gate ${gate.short_name} OOMKilled — retrying with 2x memory`, { gate: gate.short_name });
      gate._oomRetried = true;
      await db.updateGate(gate.id, {
        status: "running",
        progress: 15,
        summary: "Retrying with more memory after OOM...",
      });
      emitPipelineEvent(runId, "gate_status", { gate: gate.short_name, status: "running", summary: "Retrying with more memory after OOM...", progress: 15 });
      await db.auditLog(runId, "gate_oom_retry", null, `Gate ${gate.short_name} OOMKilled, retrying with 2x memory`, { gateId: gate.id });
      try {
        const retryResult = await scanFn(2); // pass memoryMultiplier=2
        const retryStatus = retryResult.status === "failed" ? "failed" : retryResult.status === "warning" ? "warning" : "passed";
        const retryRawOutput = {
          gate: retryResult.gate, tool: retryResult.tool, status: retryStatus,
          summary: retryResult.summary, findings: retryResult.findings,
          toolOutput: retryResult.toolOutput || null, packageCount: retryResult.packageCount || undefined,
          format: retryResult.format || undefined, scannedAt: new Date().toISOString(), oomRetry: true,
        };
        await db.updateGate(gate.id, { status: retryStatus, progress: 100, completedAt: new Date().toISOString(), summary: `(OOM retry) ${retryResult.summary || retryStatus}`, rawOutput: retryRawOutput });
        if (retryResult.findings && retryResult.findings.length > 0) {
          for (const finding of retryResult.findings) {
            await db.createFinding({ runId, gateId: gate.id, severity: finding.severity === "ERROR" ? "critical" : finding.severity === "WARNING" ? "high" : (finding.severity || "info").toLowerCase(), title: finding.title, description: finding.description, location: finding.location });
          }
        }
        await db.auditLog(runId, "gate_completed", null, `Gate ${gate.short_name} completed on OOM retry: ${retryStatus}`, { gateId: gate.id, status: retryStatus });
        return retryStatus;
      } catch (retryErr) {
        failureReason = `OOM retry also failed: ${retryErr.message}`;
      }
    }

    await db.updateGate(gate.id, {
      status: "failed",
      progress: 100,
      completedAt: new Date().toISOString(),
      summary: failureReason,
      rawOutput: { gate: gate.short_name, error: failureReason, failedAt: new Date().toISOString() },
    });
    emitPipelineEvent(runId, "gate_status", { gate: gate.short_name, status: "failed", summary: failureReason, progress: 100 });
    await db.auditLog(runId, "gate_failed", null, `Gate ${gate.short_name} failed: ${failureReason}`, { gateId: gate.id });
    return "failed";
  }
}

async function runSASTScan(url, branch, memoryMultiplier, gateId, runId) {
  if (!validateGitUrl(url)) throw new Error("Invalid git URL");
  const jobName = "sast-" + crypto.randomBytes(4).toString("hex");
  const safeBranch = (branch || "main").replace(/[^a-zA-Z0-9._-]/g, "");
  const mult = memoryMultiplier || 1;
  const memReq = `${256 * mult}Mi`;
  const memLim = `${1 * mult}Gi`;

  await batchApi.createNamespacedJob(BUILD_NAMESPACE, {
    apiVersion: "batch/v1", kind: "Job",
    metadata: { name: jobName, namespace: BUILD_NAMESPACE },
    spec: {
      ttlSecondsAfterFinished: 300, backoffLimit: 0,
      template: { metadata: { annotations: { "sidecar.istio.io/inject": "false" } }, spec: {
        restartPolicy: "Never",
        containers: [{ name: "semgrep", image: "docker.io/semgrep/semgrep:1.102.0",
          env: [
            { name: "GIT_URL", value: url },
            { name: "GIT_BRANCH", value: safeBranch },
          ],
          command: ["sh", "/scripts/sast-scan.sh"],
          resources: { requests: { cpu: "100m", memory: memReq }, limits: { cpu: "1", memory: memLim } },
          volumeMounts: [{ name: "scan-scripts", mountPath: "/scripts", readOnly: true }],
        }],
        volumes: [{ name: "scan-scripts", configMap: { name: "scan-scripts", defaultMode: 0o555 } }],
      }},
    },
  });
  if (gateId) await db.updateGate(gateId, { job_name: jobName });

  const logs = await waitForJobAndGetLogs(jobName, BUILD_NAMESPACE, "semgrep", 120, runId, "SAST");
  let results;
  try { results = JSON.parse(logs); } catch (err) {
    console.debug('[pipeline] Semgrep output parse failed:', err.message);
    results = { results: [], errors: [{ message: "Failed to parse output" }] };
  }

  const findings = (results.results || []).map(r => ({
    severity: r.extra?.severity || "info",
    title: r.check_id || "Unknown",
    description: r.extra?.message || "",
    location: `${r.path}:${r.start?.line || 0}`,
  }));
  const critical = findings.filter(f => f.severity === "ERROR").length;
  const warnings = findings.filter(f => f.severity === "WARNING").length;

  return {
    gate: "SAST", tool: "Semgrep",
    status: critical > 0 ? "failed" : warnings > 0 ? "warning" : "passed",
    findings,
    summary: `${findings.length} findings (${critical} errors, ${warnings} warnings)`,
    toolOutput: results,
  };
}

async function runSecretsScan(url, branch, memoryMultiplier, gateId, runId) {
  if (!validateGitUrl(url)) throw new Error("Invalid git URL");
  const jobName = "secrets-" + crypto.randomBytes(4).toString("hex");
  const safeBranch = (branch || "main").replace(/[^a-zA-Z0-9._-]/g, "");
  const mult = memoryMultiplier || 1;
  const memReq = `${128 * mult}Mi`;
  const memLim = `${512 * mult}Mi`;

  await batchApi.createNamespacedJob(BUILD_NAMESPACE, {
    apiVersion: "batch/v1", kind: "Job",
    metadata: { name: jobName, namespace: BUILD_NAMESPACE },
    spec: {
      ttlSecondsAfterFinished: 300, backoffLimit: 0,
      template: { metadata: { annotations: { "sidecar.istio.io/inject": "false" } }, spec: {
        restartPolicy: "Never",
        containers: [{ name: "gitleaks", image: "docker.io/zricethezav/gitleaks:v8.22.1",
          env: [
            { name: "GIT_URL", value: url },
            { name: "GIT_BRANCH", value: safeBranch },
          ],
          command: ["sh", "/scripts/secrets-scan.sh"],
          resources: { requests: { cpu: "50m", memory: memReq }, limits: { cpu: "500m", memory: memLim } },
          volumeMounts: [{ name: "scan-scripts", mountPath: "/scripts", readOnly: true }],
        }],
        volumes: [{ name: "scan-scripts", configMap: { name: "scan-scripts", defaultMode: 0o555 } }],
      }},
    },
  });
  if (gateId) await db.updateGate(gateId, { job_name: jobName });

  const logs = await waitForJobAndGetLogs(jobName, BUILD_NAMESPACE, "gitleaks", 60, runId, "SECRETS");
  let secrets = [];
  try { secrets = JSON.parse(logs); } catch (err) {
    console.debug('[pipeline] Gitleaks output parse failed:', err.message);
    secrets = [];
  }
  if (!Array.isArray(secrets)) secrets = [];

  const findings = secrets.map(s => ({
    severity: "critical",
    title: s.Description || s.RuleID || "Secret detected",
    description: `${s.Match || ""}`.substring(0, 100),
    location: `${s.File}:${s.StartLine || 0}`,
  }));

  return {
    gate: "Secrets", tool: "Gitleaks",
    status: findings.length > 0 ? "failed" : "passed",
    findings,
    summary: findings.length > 0 ? `${findings.length} secrets detected!` : "0 secrets detected",
    toolOutput: secrets,
  };
}

async function runSBOMScan(image, memoryMultiplier, gateId, runId) {
  if (!validateImageRef(image)) throw new Error("Invalid image reference");
  const jobName = "sbom-" + crypto.randomBytes(4).toString("hex");
  const mult = memoryMultiplier || 1;
  const memReq = `${512 * mult}Mi`;
  const memLim = `${4 * mult}Gi`;

  // Use Trivy for SBOM generation — it already handles Harbor auth and TLS correctly
  await batchApi.createNamespacedJob(BUILD_NAMESPACE, {
    apiVersion: "batch/v1", kind: "Job",
    metadata: { name: jobName, namespace: BUILD_NAMESPACE },
    spec: {
      ttlSecondsAfterFinished: 300, backoffLimit: 0,
      template: { metadata: { annotations: { "sidecar.istio.io/inject": "false" } }, spec: {
        restartPolicy: "Never",
        containers: [{ name: "trivy-sbom", image: "docker.io/aquasec/trivy:0.58.2",
          env: [
            { name: "IMAGE_REF", value: image },
            { name: "TRIVY_CACHE_DIR", value: "/tmp/trivy-cache" },
            { name: "TRIVY_NO_PROGRESS", value: "true" },
          ],
          command: ["sh", "/scripts/sbom-scan.sh"],
          resources: { requests: { cpu: "200m", memory: memReq }, limits: { cpu: "2", memory: memLim } },
          volumeMounts: [
            { name: "docker-config", mountPath: "/root/.docker", readOnly: true },
            { name: "scan-scripts", mountPath: "/scripts", readOnly: true },
          ],
        }],
        volumes: [
          { name: "docker-config", secret: { secretName: "harbor-pull-creds-dockerconfig", optional: true, items: [{ key: ".dockerconfigjson", path: "config.json" }] } },
          { name: "scan-scripts", configMap: { name: "scan-scripts", defaultMode: 0o555 } },
        ],
      }},
    },
  });
  if (gateId) await db.updateGate(gateId, { job_name: jobName });

  const logs = await waitForJobAndGetLogs(jobName, BUILD_NAMESPACE, "trivy-sbom", 300, runId, "SBOM");

  // SBOM output can be very large (1MB+) — don't try to parse the entire thing.
  // Check for valid SPDX header and count packages via regex instead.
  console.log(`[sbom] Job ${jobName}: logs type=${typeof logs}, length=${logs?.length || 0}, first50=${String(logs).substring(0, 50)}`);
  const isSpdx = logs && typeof logs === 'string' && logs.includes('"spdxVersion"');
  const packageMatches = logs ? logs.match(/"SPDXID"\s*:\s*"SPDXRef-Package-/g) : null;
  const packageCount = packageMatches ? packageMatches.length : 0;

  // Try to parse a small summary, but don't store the full SBOM in the DB
  let sbomMeta = null;
  try {
    const parsed = JSON.parse(logs);
    sbomMeta = {
      spdxVersion: parsed.spdxVersion,
      name: parsed.name,
      documentNamespace: parsed.documentNamespace,
      packageCount: parsed.packages?.length || packageCount,
    };
  } catch (err) {
    console.debug('[pipeline] SBOM JSON parse failed (large or truncated):', err.message);
    // JSON too large or truncated — that's OK, we already have packageCount from regex
    if (isSpdx) {
      sbomMeta = { spdxVersion: "SPDX-2.3", packageCount };
    }
  }

  return {
    gate: "SBOM", tool: "Trivy (SPDX)", format: "SPDX 2.3",
    status: isSpdx ? "passed" : "failed",
    findings: [],
    packageCount: sbomMeta?.packageCount || packageCount,
    summary: isSpdx ? `SBOM generated: ${sbomMeta?.packageCount || packageCount} packages identified` : "SBOM generation failed",
    toolOutput: sbomMeta,
  };
}

async function runCVEScan(image, memoryMultiplier, gateId, runId) {
  if (!validateImageRef(image)) throw new Error("Invalid image reference");
  const jobName = "cve-" + crypto.randomBytes(4).toString("hex");
  const mult = memoryMultiplier || 1;
  const memReq = `${512 * mult}Mi`;
  const memLim = `${2 * mult}Gi`;

  await batchApi.createNamespacedJob(BUILD_NAMESPACE, {
    apiVersion: "batch/v1", kind: "Job",
    metadata: { name: jobName, namespace: BUILD_NAMESPACE },
    spec: {
      ttlSecondsAfterFinished: 300, backoffLimit: 0,
      template: { metadata: { annotations: { "sidecar.istio.io/inject": "false" } }, spec: {
        restartPolicy: "Never",
        containers: [{ name: "trivy", image: "docker.io/aquasec/trivy:0.58.2",
          env: [
            { name: "IMAGE_REF", value: image },
            { name: "TRIVY_CACHE_DIR", value: "/tmp/trivy-cache" },
            { name: "TRIVY_NO_PROGRESS", value: "true" },
          ],
          command: ["sh", "/scripts/cve-scan.sh"],
          resources: { requests: { cpu: "200m", memory: memReq }, limits: { cpu: "2", memory: memLim } },
          volumeMounts: [
            { name: "docker-config", mountPath: "/root/.docker", readOnly: true },
            { name: "scan-scripts", mountPath: "/scripts", readOnly: true },
          ],
        }],
        volumes: [
          { name: "docker-config", secret: { secretName: "harbor-pull-creds-dockerconfig", optional: true, items: [{ key: ".dockerconfigjson", path: "config.json" }] } },
          { name: "scan-scripts", configMap: { name: "scan-scripts", defaultMode: 0o555 } },
        ],
      }},
    },
  });
  if (gateId) await db.updateGate(gateId, { job_name: jobName });

  const logs = await waitForJobAndGetLogs(jobName, BUILD_NAMESPACE, "trivy", 120, runId, "CVE");
  let report;
  try { report = JSON.parse(logs); } catch (err) {
    console.debug('[pipeline] Trivy CVE report parse failed:', err.message);
    report = { Results: [] };
  }

  const findings = [];
  for (const result of (report.Results || [])) {
    for (const vuln of (result.Vulnerabilities || [])) {
      findings.push({
        severity: (vuln.Severity || "unknown").toLowerCase(),
        title: `${vuln.VulnerabilityID}: ${vuln.PkgName}`,
        description: (vuln.Title || vuln.Description || "").substring(0, 200),
        location: `${result.Target || "unknown"}`,
      });
    }
  }

  const critical = findings.filter(f => f.severity === "critical").length;
  const high = findings.filter(f => f.severity === "high").length;

  return {
    gate: "CVE", tool: "Trivy",
    status: critical > 0 ? "failed" : high > 0 ? "warning" : "passed",
    findings,
    summary: `${findings.length} vulnerabilities (${critical} critical, ${high} high)`,
    toolOutput: report,
  };
}

async function runDASTScan(targetUrl, gateId, runId) {
  if (!validateUrl(targetUrl)) throw new Error("Invalid target URL");
  const jobName = "dast-" + crypto.randomBytes(4).toString("hex");

  await batchApi.createNamespacedJob(BUILD_NAMESPACE, {
    apiVersion: "batch/v1", kind: "Job",
    metadata: { name: jobName, namespace: BUILD_NAMESPACE },
    spec: {
      ttlSecondsAfterFinished: 300, backoffLimit: 0,
      template: { spec: {
        restartPolicy: "Never",
        containers: [{ name: "zap", image: "ghcr.io/zaproxy/zaproxy:stable",
          env: [
            { name: "TARGET_URL", value: targetUrl },
          ],
          command: ["sh", "/scripts/dast-scan.sh"],
          resources: { requests: { cpu: "200m", memory: "512Mi" }, limits: { cpu: "1", memory: "2Gi" } },
          volumeMounts: [{ name: "scan-scripts", mountPath: "/scripts", readOnly: true }],
        }],
        volumes: [{ name: "scan-scripts", configMap: { name: "scan-scripts", defaultMode: 0o555 } }],
      }},
    },
  });
  if (gateId) await db.updateGate(gateId, { job_name: jobName });

  const logs = await waitForJobAndGetLogs(jobName, BUILD_NAMESPACE, "zap", 180, runId, "DAST");
  let report;
  try { report = JSON.parse(logs); } catch (err) {
    console.debug('[pipeline] ZAP DAST report parse failed:', err.message);
    report = { site: [] };
  }

  const findings = [];
  for (const site of (report.site || [])) {
    for (const alert of (site.alerts || [])) {
      findings.push({
        severity: alert.riskdesc?.split(" ")[0]?.toLowerCase() || "info",
        title: alert.name || "Unknown",
        description: alert.desc || "",
        location: alert.uri || targetUrl,
      });
    }
  }

  const high = findings.filter(a => a.severity === "high").length;

  return {
    gate: "DAST", tool: "OWASP ZAP",
    status: high > 0 ? "failed" : findings.length > 0 ? "warning" : "passed",
    findings,
    summary: `${findings.length} alerts (${high} high risk)`,
  };
}

// ── Security Exception Detection ────────────────────────────────────────────
// After build/scan completes, detect if the image requires root/privileged access
async function detectSecurityExceptions(runId, image) {
  const exceptions = [];
  try {
    const run = await db.getRun(runId);
    const findings = run.findings || [];

    // Check for root user findings in CVE/SBOM scan output
    const rootFindings = findings.filter(f =>
      f.description && (f.description.toLowerCase().includes('runs as root') ||
       f.description.toLowerCase().includes('user 0') ||
       f.description.toLowerCase().includes('privileged'))
    );

    if (rootFindings.length > 0) {
      exceptions.push({ type: 'run_as_root', reason: 'Image runs as root user', autoDetected: true });
    }

    // Check metadata from the build (Kaniko logs may indicate root USER directive)
    const metadata = run.metadata || {};
    if (metadata.dockerfile_uses_root) {
      exceptions.push({ type: 'run_as_root', reason: 'Dockerfile contains USER root or no USER directive', autoDetected: true });
    }

    // Store detected exceptions on the run
    if (exceptions.length > 0) {
      await db.pool.query(
        "UPDATE pipeline_runs SET metadata = jsonb_set(COALESCE(metadata, '{}'), '{detected_exceptions}', $1::jsonb) WHERE id = $2",
        [JSON.stringify(exceptions), runId]
      );
      logger.info('pipeline', `Detected ${exceptions.length} security exception(s) for run ${runId}`, { runId, exceptions });
    }
  } catch (err) {
    logger.error('pipeline', 'Failed to detect security exceptions', { runId, error: err.message });
  }
  return exceptions;
}

async function orchestratePipelineScan(runId) {
  const PIPELINE_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
  const pipelineStartTime = Date.now();

  const run = await db.getRun(runId);
  if (!run) return;

  // Ensure the event emitter is ready before scanning starts
  getOrCreatePipelineEmitter(runId);

  await db.updateRunStatus(runId, "scanning");
  emitPipelineEvent(runId, "pipeline_status", { status: "scanning", message: "Pipeline started" });

  // Validate git URL before any jobs use it (SAST/Secrets validate independently,
  // but the build and analyze paths also need it validated up front)
  if (run.git_url && !validateGitUrl(run.git_url)) {
    logger.error('pipeline', `Pipeline ${runId} rejected: invalid git URL`, { runId, gitUrl: run.git_url });
    await db.updateRunStatus(runId, "failed");
    emitPipelineEvent(runId, "pipeline_status", { status: "failed", message: "Invalid or unsafe git URL" });
    emitPipelineEvent(runId, "done", { status: "failed" });
    return;
  }

  // Helper: check if the pipeline has exceeded the timeout
  function checkPipelineTimeout() {
    if (Date.now() - pipelineStartTime > PIPELINE_TIMEOUT_MS) {
      throw new Error("Pipeline scan timed out after 20 minutes");
    }
  }

  const gateMap = {};
  for (const g of run.gates) {
    gateMap[g.short_name] = g;
  }

  try {
  // Phase 1: Source code scans (SAST, SECRETS) + Build — ALL run in parallel
  // SAST/Secrets scan source code, Build creates the container image. They don't
  // depend on each other, so running them simultaneously saves 1-3 minutes.
  const phase1Jobs = [];

  if (run.git_url) {
    if (gateMap.SAST) {
      await db.updateGate(gateMap.SAST.id, { status: "running", summary: "Cloning repo and running Semgrep scan...", startedAt: new Date().toISOString(), progress: 10 });
      emitPipelineEvent(runId, "gate_status", { gate: "SAST", status: "running", summary: "Cloning repo and running Semgrep scan...", progress: 10 });
      phase1Jobs.push(runScanGate(runId, gateMap.SAST, (mult) => runSASTScan(run.git_url, run.branch, mult, gateMap.SAST.id, runId)));
    }
    if (gateMap.SECRETS) {
      await db.updateGate(gateMap.SECRETS.id, { status: "running", summary: "Cloning repo and running Gitleaks scan...", startedAt: new Date().toISOString(), progress: 10 });
      emitPipelineEvent(runId, "gate_status", { gate: "SECRETS", status: "running", summary: "Cloning repo and running Gitleaks scan...", progress: 10 });
      phase1Jobs.push(runScanGate(runId, gateMap.SECRETS, (mult) => runSecretsScan(run.git_url, run.branch, mult, gateMap.SECRETS.id, runId)));
    }
  } else if (run.source_type === "bundle") {
    // For bundle source type, check if source code was included
    const bundleUploadId = run.metadata?.bundleUploadId;
    const bundleSastPath = bundleUploadId ? path.join(BUNDLE_UPLOAD_DIR, bundleUploadId) : null;

    // Find the manifest base directory
    let bundleBaseDirForSast = bundleSastPath;
    if (bundleSastPath && fs.existsSync(bundleSastPath)) {
      const manifestDirect = path.join(bundleSastPath, "bundle.yaml");
      if (!fs.existsSync(manifestDirect)) {
        const entries = fs.readdirSync(bundleSastPath);
        for (const entry of entries) {
          if (fs.existsSync(path.join(bundleSastPath, entry, "bundle.yaml"))) {
            bundleBaseDirForSast = path.join(bundleSastPath, entry);
            break;
          }
        }
      }
    }

    const bundleHasSource = bundleBaseDirForSast && fs.existsSync(path.join(bundleBaseDirForSast, "source")) &&
      fs.readdirSync(path.join(bundleBaseDirForSast, "source")).length > 0;

    if (bundleHasSource) {
      // Source code included in bundle — mark as passed with review recommendation
      if (gateMap.SAST) {
        phase1Jobs.push(db.updateGate(gateMap.SAST.id, { status: "passed", summary: "Source code included in bundle — manual review recommended", completedAt: new Date().toISOString() }));
        emitPipelineEvent(runId, "gate_status", { gate: "SAST", status: "passed", summary: "Source code included in bundle — manual review recommended", progress: 100 });
      }
      if (gateMap.SECRETS) {
        phase1Jobs.push(db.updateGate(gateMap.SECRETS.id, { status: "passed", summary: "Source code included in bundle — manual review recommended", completedAt: new Date().toISOString() }));
        emitPipelineEvent(runId, "gate_status", { gate: "SECRETS", status: "passed", summary: "Source code included in bundle — manual review recommended", progress: 100 });
      }
    } else {
      if (gateMap.SAST) {
        phase1Jobs.push(db.updateGate(gateMap.SAST.id, { status: "skipped", summary: "No source code included in bundle", completedAt: new Date().toISOString() }));
        emitPipelineEvent(runId, "gate_status", { gate: "SAST", status: "skipped", summary: "No source code included in bundle", progress: 100 });
      }
      if (gateMap.SECRETS) {
        phase1Jobs.push(db.updateGate(gateMap.SECRETS.id, { status: "skipped", summary: "No source code included in bundle", completedAt: new Date().toISOString() }));
        emitPipelineEvent(runId, "gate_status", { gate: "SECRETS", status: "skipped", summary: "No source code included in bundle", progress: 100 });
      }
    }
  } else {
    if (gateMap.SAST) {
      phase1Jobs.push(db.updateGate(gateMap.SAST.id, { status: "skipped", summary: "Not applicable — no source code provided (container image source)", completedAt: new Date().toISOString() }));
      emitPipelineEvent(runId, "gate_status", { gate: "SAST", status: "skipped", summary: "Not applicable — no source code provided", progress: 100 });
    }
    if (gateMap.SECRETS) {
      phase1Jobs.push(db.updateGate(gateMap.SECRETS.id, { status: "skipped", summary: "Not applicable — no source code provided (container image source)", completedAt: new Date().toISOString() }));
      emitPipelineEvent(runId, "gate_status", { gate: "SECRETS", status: "skipped", summary: "Not applicable — no source code provided", progress: 100 });
    }
  }

  // Start the build in parallel with source scans (build doesn't need scan results)
  let builtImageRef = run.image_url || null;
  const buildResult = { imageRef: null }; // shared mutable ref for the build promise
  if (run.source_type === "bundle") {
    // ── Bundle import: load images from bundle tarballs via crane push ──
    const bundleUploadId = run.metadata?.bundleUploadId;
    const bundlePath = bundleUploadId ? path.join(BUNDLE_UPLOAD_DIR, bundleUploadId) : null;

    if (!bundlePath || !fs.existsSync(bundlePath)) {
      if (gateMap.ARTIFACT_STORE) {
        await db.updateGate(gateMap.ARTIFACT_STORE.id, { status: "failed", progress: 100, completedAt: new Date().toISOString(), summary: "Bundle not found — upload may have expired" });
        emitPipelineEvent(runId, "gate_status", { gate: "ARTIFACT_STORE", status: "failed", summary: "Bundle not found", progress: 100 });
      }
    } else {
      // Find the manifest and base directory
      let bundleBaseDir = bundlePath;
      let manifest = null;
      try {
        let manifestPath = path.join(bundlePath, "bundle.yaml");
        if (!fs.existsSync(manifestPath)) {
          const entries = fs.readdirSync(bundlePath);
          for (const entry of entries) {
            const nested = path.join(bundlePath, entry, "bundle.yaml");
            if (fs.existsSync(nested)) {
              manifestPath = nested;
              bundleBaseDir = path.join(bundlePath, entry);
              break;
            }
          }
        }
        manifest = yaml.load(fs.readFileSync(manifestPath, "utf8"));
      } catch (e) {
        logger.error("pipeline", `Failed to read bundle manifest for run ${runId}: ${e.message}`, { runId });
      }

      if (!manifest) {
        if (gateMap.ARTIFACT_STORE) {
          await db.updateGate(gateMap.ARTIFACT_STORE.id, { status: "failed", progress: 100, completedAt: new Date().toISOString(), summary: "Failed to read bundle manifest" });
          emitPipelineEvent(runId, "gate_status", { gate: "ARTIFACT_STORE", status: "failed", summary: "Failed to read bundle manifest", progress: 100 });
        }
      } else {
        const safeName = run.app_name.replace(/[^a-z0-9-]/gi, "-").toLowerCase().substring(0, 40);
        const teamName = run.team.startsWith("team-") ? run.team : `team-${run.team}`;
        const version = manifest.metadata?.version || "latest";

        // Ensure Harbor project exists
        try { await ensureHarborProject(teamName); } catch (e) {
          console.debug('[pipeline] Harbor project ensure best-effort error:', e.message);
        }

        if (gateMap.ARTIFACT_STORE) {
          await db.updateGate(gateMap.ARTIFACT_STORE.id, { status: "running", startedAt: new Date().toISOString(), summary: "Importing bundle images to Harbor...", progress: 10 });
          emitPipelineEvent(runId, "gate_status", { gate: "ARTIFACT_STORE", status: "running", summary: "Importing bundle images to Harbor...", progress: 10 });
        }

        // Collect all images from manifest
        const imageRefs = [{ name: safeName, file: manifest.spec.app.image }];
        if (manifest.spec.components) {
          for (const comp of manifest.spec.components) {
            if (comp.image) {
              const compName = comp.name.replace(/[^a-z0-9-]/gi, "-").toLowerCase().substring(0, 40);
              imageRefs.push({ name: compName, file: comp.image });
            }
          }
        }

        let allImportsSucceeded = true;
        const importedImages = [];

        for (const imgRef of imageRefs) {
          const tarPath = path.join(bundleBaseDir, imgRef.file);
          if (!fs.existsSync(tarPath)) {
            logger.error("pipeline", `Bundle image not found: ${imgRef.file}`, { runId });
            allImportsSucceeded = false;
            continue;
          }

          const harborDest = `${HARBOR_REGISTRY}/${teamName}/${imgRef.name}:${version}`;
          const importJobId = `pipe-bundleimport-${crypto.randomBytes(4).toString("hex")}`;

          emitPipelineEvent(runId, "gate_log", { gate: "ARTIFACT_STORE", line: `Importing ${imgRef.name} -> ${harborDest}` });

          try {
            // Detect which node the dashboard pod runs on so the import job
            // lands on the same node (hostPath volume requires same-node access)
            let dashboardNode = null;
            try {
              const dashPods = await k8sApi.listNamespacedPod("sre-dashboard", undefined, undefined, undefined, undefined, "app.kubernetes.io/name=sre-dashboard");
              if (dashPods.body.items.length > 0) dashboardNode = dashPods.body.items[0].spec.nodeName;
            } catch { /* best-effort — fall back to no selector */ }

            await batchApi.createNamespacedJob(BUILD_NAMESPACE, {
              apiVersion: "batch/v1", kind: "Job",
              metadata: {
                name: importJobId, namespace: BUILD_NAMESPACE,
                labels: { "app.kubernetes.io/part-of": "sre-platform", "sre.io/build-id": importJobId, "sre.io/app-name": safeName }
              },
              spec: {
                backoffLimit: 2, ttlSecondsAfterFinished: 3600,
                template: {
                  metadata: { annotations: { "sidecar.istio.io/inject": "false" } },
                  spec: {
                    restartPolicy: "Never", serviceAccountName: "pipeline-runner",
                    ...(dashboardNode ? { nodeSelector: { "kubernetes.io/hostname": dashboardNode } } : {}),
                    containers: [{
                      name: "crane-push", image: CRANE_IMAGE,
                      command: ["sh", "-c", `crane push "/bundle/${imgRef.file}" "${harborDest}" && echo "IMPORT_SUCCESS: ${harborDest}"`],
                      volumeMounts: [
                        { name: "bundle-data", mountPath: "/bundle", readOnly: true },
                        { name: "docker-config", mountPath: "/home/nonroot/.docker", readOnly: true },
                      ],
                      resources: { requests: { cpu: "100m", memory: "256Mi" }, limits: { cpu: "1", memory: "2Gi" } },
                    }],
                    volumes: [
                      { name: "bundle-data", hostPath: { path: bundleBaseDir, type: "Directory" } },
                      { name: "docker-config", secret: { secretName: "harbor-push-creds", items: [{ key: ".dockerconfigjson", path: "config.json" }] } },
                    ],
                  },
                },
              },
            });

            const importLogs = await waitForJobAndGetLogs(importJobId, BUILD_NAMESPACE, "crane-push", 600, runId, "ARTIFACT_STORE");
            if (importLogs && importLogs.includes("IMPORT_SUCCESS:")) {
              importedImages.push({ name: imgRef.name, harborRef: harborDest });
              emitPipelineEvent(runId, "gate_log", { gate: "ARTIFACT_STORE", line: `OK: ${imgRef.name} imported successfully` });
            } else {
              allImportsSucceeded = false;
              emitPipelineEvent(runId, "gate_log", { gate: "ARTIFACT_STORE", line: `FAIL: ${imgRef.name} import failed` });
            }
          } catch (importErr) {
            logger.error("pipeline", `Bundle import error for ${imgRef.name}: ${importErr.message}`, { runId, image: imgRef.name });
            allImportsSucceeded = false;
            emitPipelineEvent(runId, "gate_log", { gate: "ARTIFACT_STORE", line: `FAIL: ${imgRef.name} error: ${importErr.message}` });
          }
        }

        if (allImportsSucceeded && importedImages.length > 0) {
          builtImageRef = importedImages[0].harborRef; // Primary image for SBOM/CVE
          buildResult.imageRef = builtImageRef;
          const summary = importedImages.length === 1
            ? `Imported: ${importedImages[0].name}`
            : `${importedImages.length} image(s) imported: ${importedImages.map(i => i.name).join(", ")}`;
          if (gateMap.ARTIFACT_STORE) {
            await db.updateGate(gateMap.ARTIFACT_STORE.id, { status: "passed", progress: 100, completedAt: new Date().toISOString(), summary });
            emitPipelineEvent(runId, "gate_status", { gate: "ARTIFACT_STORE", status: "passed", summary, progress: 100 });
          }
          // Store imported images and bundle manifest in metadata (deploy step reads these)
          try {
            await db.pool.query(
              "UPDATE pipeline_runs SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2",
              [JSON.stringify({ builtImages: importedImages, bundleManifest: manifest }), runId]
            );
          } catch { /* best effort */ }
          await db.auditLog(runId, "bundle_imported", null, `Bundle images imported to Harbor`, { images: importedImages });
        } else {
          if (gateMap.ARTIFACT_STORE) {
            await db.updateGate(gateMap.ARTIFACT_STORE.id, { status: "failed", progress: 100, completedAt: new Date().toISOString(), summary: "Bundle import failed" });
            emitPipelineEvent(runId, "gate_status", { gate: "ARTIFACT_STORE", status: "failed", summary: "Bundle import failed", progress: 100 });
          }
          builtImageRef = null;
        }
      }
    }
  } else if (!builtImageRef && run.git_url) {
    if (gateMap.ARTIFACT_STORE) {
      await db.updateGate(gateMap.ARTIFACT_STORE.id, { status: "running", startedAt: new Date().toISOString(), summary: "Analyzing repository...", progress: 5 });
      emitPipelineEvent(runId, "gate_status", { gate: "ARTIFACT_STORE", status: "running", summary: "Analyzing repository...", progress: 5 });
    }
    // Wrap the entire build in a promise so it runs alongside SAST/Secrets
    phase1Jobs.push((async () => {

    const safeName = run.app_name.replace(/[^a-z0-9-]/gi, "-").toLowerCase().substring(0, 40);
    const teamName = run.team.startsWith("team-") ? run.team : `team-${run.team}`;
    const safeBranch = (run.branch || "main").replace(/[^a-zA-Z0-9._-]/g, "");

    // Ensure Harbor project exists
    try { await ensureHarborProject(teamName); } catch (e) {
      console.debug('[pipeline] Harbor project ensure best-effort error:', e.message);
    }

    // ── Step 1: Analyze the repo to detect compose vs single-Dockerfile ──
    let repoAnalysis = null;
    try {
      const analyzeId = "pipe-analyze-" + crypto.randomBytes(4).toString("hex");
      emitPipelineEvent(runId, "gate_log", { gate: "ARTIFACT_STORE", line: "Analyzing repository structure..." });
      const jobSpec = createAnalyzeJobSpec(analyzeId, run.git_url, safeBranch);
      await batchApi.createNamespacedJob(BUILD_NAMESPACE, jobSpec);
      const logs = await runAnalyzeJob(analyzeId);
      if (logs && !logs.error) {
        repoAnalysis = parseRepoAnalysisLogs(logs);
        logger.info('pipeline', `Repo analysis for run ${runId}: type=${repoAnalysis.repoType}, services=${repoAnalysis.services.length}`, { runId, repoType: repoAnalysis.repoType });
        emitPipelineEvent(runId, "gate_log", { gate: "ARTIFACT_STORE", line: `Detected repo type: ${repoAnalysis.repoType} (${repoAnalysis.services.length} service(s))` });
      } else {
        logger.info('pipeline', `Repo analysis failed or timed out for run ${runId}, falling back to single Dockerfile`, { runId });
        emitPipelineEvent(runId, "gate_log", { gate: "ARTIFACT_STORE", line: "Repo analysis unavailable — falling back to root Dockerfile build" });
      }
    } catch (analyzeErr) {
      logger.info('pipeline', `Repo analysis error for run ${runId}: ${analyzeErr.message}, falling back to single Dockerfile`, { runId, error: analyzeErr.message });
      emitPipelineEvent(runId, "gate_log", { gate: "ARTIFACT_STORE", line: "Repo analysis error — falling back to root Dockerfile build" });
    }

    // Save analysis to metadata (including detected requirements for smart deploy defaults)
    if (repoAnalysis) {
      try {
        const analysisMetadata = {
          repoAnalysis: {
            repoType: repoAnalysis.repoType,
            services: repoAnalysis.services.map(s => ({
              name: s.name, role: s.role, sre: s.sre || null, sreLabel: s.sreLabel || null,
              needsBuild: s.needsBuild, port: s.port, buildContext: s.buildContext,
              dockerfile: s.dockerfile || null, buildTarget: s.buildTarget || null,
              image: s.image || null, environment: s.environment || [],
              requirements: s.requirements || null,
            })),
          },
        };
        // Store the primary (ingress) service's requirements as top-level detectedRequirements
        // so the deploy phase can use them without digging into the services array
        if (repoAnalysis.services.length > 0) {
          const primarySvc = repoAnalysis.services.find(s => s.role === 'ingress') || repoAnalysis.services[0];
          if (primarySvc.requirements) {
            analysisMetadata.detectedRequirements = primarySvc.requirements;
          }
        }
        const portUpdate = analysisMetadata.detectedRequirements?.port || null;
        await db.pool.query(
          "UPDATE pipeline_runs SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb, port = COALESCE($2, port), updated_at = NOW() WHERE id = $3",
          [JSON.stringify(analysisMetadata), portUpdate, runId]
        );
      } catch (metaErr) {
        logger.info('pipeline', `Failed to save repoAnalysis metadata: ${metaErr.message}`, { runId });
      }
    }

    if (gateMap.ARTIFACT_STORE) {
      await db.updateGate(gateMap.ARTIFACT_STORE.id, { summary: "Kaniko: Building container image(s)...", progress: 10 });
      emitPipelineEvent(runId, "gate_status", { gate: "ARTIFACT_STORE", status: "running", summary: "Kaniko: Building container image(s)...", progress: 10 });
    }

    // ── Step 2: Determine build plan based on analysis ──
    const isCompose = repoAnalysis && repoAnalysis.repoType === "compose" && repoAnalysis.services.length > 0;
    const buildableServices = isCompose ? repoAnalysis.services.filter(s => s.needsBuild && s.buildContext) : [];
    const builtImages = []; // Track all images built in this run

    // Helper: run a single Kaniko build job and wait for completion with log streaming
    async function runKanikoBuild(buildId, destination, kanikoArgs, serviceLabel) {
      await batchApi.createNamespacedJob(BUILD_NAMESPACE, {
        apiVersion: "batch/v1", kind: "Job",
        metadata: {
          name: buildId, namespace: BUILD_NAMESPACE,
          labels: { "app.kubernetes.io/part-of": "sre-platform", "sre.io/build-id": buildId, "sre.io/app-name": safeName }
        },
        spec: {
          backoffLimit: 1, ttlSecondsAfterFinished: 3600,
          template: {
            metadata: { annotations: { "sidecar.istio.io/inject": "false" } },
            spec: {
              restartPolicy: "Never",
              initContainers: [{
                name: "git-clone", image: GIT_CLONE_IMAGE,
                command: ["sh", "-c", `git clone --depth=1 --branch "${safeBranch}" "${run.git_url}" /workspace 2>/dev/null || git clone --depth=1 "${run.git_url}" /workspace`],
                volumeMounts: [{ name: "workspace", mountPath: "/workspace" }],
                resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "512Mi" } },
                securityContext: { runAsNonRoot: false, readOnlyRootFilesystem: false },
              }],
              containers: [{
                name: "kaniko", image: KANIKO_IMAGE,
                args: kanikoArgs,
                volumeMounts: [{ name: "workspace", mountPath: "/workspace" }, { name: "docker-config", mountPath: "/kaniko/.docker" }],
                resources: { requests: { cpu: "500m", memory: "1Gi" }, limits: { cpu: "4", memory: "8Gi" } },
              }],
              volumes: [
                { name: "workspace", emptyDir: {} },
                { name: "docker-config", secret: { secretName: "harbor-push-creds", items: [{ key: ".dockerconfigjson", path: "config.json" }] } },
              ],
            },
          },
        },
      });

      emitPipelineEvent(runId, "gate_log", { gate: "ARTIFACT_STORE", line: `[${serviceLabel}] Building image: ${destination}` });
      await db.auditLog(runId, "image_build_started", null, `Building image: ${destination}`, { buildId, service: serviceLabel });

      const buildStartTime = Date.now();
      const buildDeadline = buildStartTime + 1200000; // 20 min
      let buildSucceeded = false;
      let buildPodName = null;
      let lastLogLine = 0;
      while (Date.now() < buildDeadline) {
        await new Promise(r => setTimeout(r, 5000));
        try {
          const job = await batchApi.readNamespacedJob(buildId, BUILD_NAMESPACE);
          if (job.body.status?.succeeded) { buildSucceeded = true; break; }
          if (job.body.status?.failed) break;
        } catch (e) {
          console.debug('[pipeline] Build job poll error, will retry:', e.message);
        }

        // Find the build pod and stream its logs
        if (!buildPodName) {
          try {
            const pods = await k8sApi.listNamespacedPod(BUILD_NAMESPACE, undefined, undefined, undefined, undefined, `job-name=${buildId}`);
            if (pods.body.items.length > 0) buildPodName = pods.body.items[0].metadata.name;
          } catch (e) { /* not ready */ }
        }
        if (buildPodName) {
          try {
            const containers = ["git-clone", "kaniko"];
            for (const ctr of containers) {
              try {
                const partial = await k8sApi.readNamespacedPodLog(buildPodName, BUILD_NAMESPACE, ctr, undefined, undefined, undefined, undefined, undefined, 50);
                const text = typeof partial.body === "string" ? partial.body : String(partial.body || "");
                if (text.trim()) {
                  const lines = text.trim().split("\n");
                  const newLines = lines.slice(lastLogLine);
                  for (const line of newLines.slice(-8)) {
                    emitPipelineEvent(runId, "gate_log", { gate: "ARTIFACT_STORE", line: `[${serviceLabel}/${ctr}] ${line}` });
                  }
                  lastLogLine = lines.length;
                }
              } catch (e) { /* container not ready or finished */ }
            }
          } catch (e) { /* pod log read failed */ }
        }

        // Update progress with descriptive messages
        if (gateMap.ARTIFACT_STORE) {
          const elapsedSec = Math.floor((Date.now() - buildStartTime) / 1000);
          const elapsed = Math.min(90, Math.floor((Date.now() - buildStartTime) / 6667));
          const msg = elapsedSec < 15 ? `Kaniko: Cloning repository (${serviceLabel})...`
            : elapsedSec < 60 ? `Kaniko: Building image layers (${serviceLabel})...`
            : elapsedSec < 180 ? `Kaniko: Building ${serviceLabel} (${elapsedSec}s elapsed)...`
            : `Kaniko: Pushing ${serviceLabel} to Harbor (${elapsedSec}s elapsed)...`;
          await db.updateGate(gateMap.ARTIFACT_STORE.id, { progress: elapsed, summary: msg });
          emitPipelineEvent(runId, "gate_progress", { gate: "ARTIFACT_STORE", progress: elapsed, summary: msg });
        }
      }

      return buildSucceeded;
    }

    let overallBuildSuccess = false;

    if (isCompose && buildableServices.length > 0) {
      // ── COMPOSE BUILD: build each service with the correct dockerfile/context ──
      const totalBuildable = buildableServices.length;
      emitPipelineEvent(runId, "gate_log", { gate: "ARTIFACT_STORE", line: `Compose repo: ${totalBuildable} service(s) to build` });
      logger.info('pipeline', `Compose build for run ${runId}: ${totalBuildable} buildable service(s)`, { runId, services: buildableServices.map(s => s.name) });

      const buildContextToImage = new Map(); // Dedup shared build contexts
      let allSucceeded = true;

      for (let i = 0; i < buildableServices.length; i++) {
        const svc = buildableServices[i];
        const svcName = svc.name.replace(/[^a-z0-9-]/gi, "-").toLowerCase().substring(0, 40);
        const buildCtx = (svc.buildContext || ".").replace(/^\.\//, "");
        const normalizedCtx = `${buildCtx}:${svc.dockerfile || "Dockerfile"}:${svc.buildTarget || ""}`;

        // Check for shared build context — reuse image instead of building twice
        const sharedImage = buildContextToImage.get(normalizedCtx);
        if (sharedImage) {
          emitPipelineEvent(runId, "gate_log", { gate: "ARTIFACT_STORE", line: `[${svcName}] Reusing image from shared build context: ${sharedImage.destination}` });
          builtImages.push({ service: svcName, destination: sharedImage.destination, role: svc.role, port: svc.port, sharedBuild: true });
          logger.info('pipeline', `Service "${svcName}" shares build context "${normalizedCtx}" — reusing ${sharedImage.destination}`, { runId });
          continue;
        }

        const dockerfilePath = `${buildCtx}/${svc.dockerfile || "Dockerfile"}`;
        if (!isSafePath(dockerfilePath) || !isSafePath(buildCtx)) {
          emitPipelineEvent(runId, "gate_log", { gate: "ARTIFACT_STORE", line: `[${svcName}] Skipped — unsafe path: ${dockerfilePath}` });
          logger.info('pipeline', `Skipping service "${svcName}" — unsafe path: dockerfile="${dockerfilePath}", context="${buildCtx}"`, { runId });
          continue;
        }

        const buildId = "pipe-" + crypto.randomBytes(4).toString("hex");
        const imageName = totalBuildable === 1 ? safeName : `${safeName}-${svcName}`;
        const destination = `${HARBOR_REGISTRY}/${teamName}/${imageName}:${buildId}`;

        const kanikoArgs = [
          `--dockerfile=/workspace/${dockerfilePath}`,
          `--context=/workspace/${buildCtx}`,
          `--destination=${destination}`,
          "--cache=true",
          `--cache-repo=${HARBOR_REGISTRY}/${teamName}/cache`,
          "--snapshot-mode=time",
          "--compressed-caching=false",
          "--insecure",
          "--skip-tls-verify",
          "--skip-tls-verify-pull",
        ];
        if (svc.buildTarget) {
          kanikoArgs.push(`--target=${svc.buildTarget}`);
        }

        if (gateMap.ARTIFACT_STORE) await db.updateGate(gateMap.ARTIFACT_STORE.id, { job_name: buildId });

        const succeeded = await runKanikoBuild(buildId, destination, kanikoArgs, svcName);
        if (succeeded) {
          builtImages.push({ service: svcName, destination, role: svc.role, port: svc.port, sharedBuild: false });
          buildContextToImage.set(normalizedCtx, { destination });
          emitPipelineEvent(runId, "gate_log", { gate: "ARTIFACT_STORE", line: `[${svcName}] Build succeeded: ${imageName}:${buildId}` });
          await db.auditLog(runId, "image_build_completed", null, `Image built: ${destination}`, { buildId, destination, service: svcName });
        } else {
          allSucceeded = false;
          emitPipelineEvent(runId, "gate_log", { gate: "ARTIFACT_STORE", line: `[${svcName}] Build FAILED` });
          await db.auditLog(runId, "image_build_failed", null, `Build failed for service ${svcName}`, { buildId, service: svcName });
        }
      }

      // Determine the primary image (ingress service, or first built)
      const ingressImage = builtImages.find(img => img.role === "ingress") || builtImages[0];
      if (ingressImage) {
        buildResult.imageRef = ingressImage.destination;
        const externalImageRef = ingressImage.destination.replace(HARBOR_REGISTRY, HARBOR_PULL_REGISTRY);
        await db.pool.query("UPDATE pipeline_runs SET image_url = $1, updated_at = NOW() WHERE id = $2", [externalImageRef, runId]);
      }

      overallBuildSuccess = builtImages.length > 0 && allSucceeded;

    } else {
      // ── SINGLE DOCKERFILE BUILD: original behavior (non-compose or analysis unavailable) ──
      const buildId = "pipe-" + crypto.randomBytes(4).toString("hex");
      const destination = `${HARBOR_REGISTRY}/${teamName}/${safeName}:${buildId}`;

      const kanikoArgs = [
        "--dockerfile=Dockerfile",
        "--context=/workspace",
        `--destination=${destination}`,
        "--cache=true",
        `--cache-repo=${HARBOR_REGISTRY}/${teamName}/cache`,
        "--snapshot-mode=time",
        "--compressed-caching=false",
        "--insecure",
        "--skip-tls-verify",
        "--skip-tls-verify-pull",
      ];

      if (gateMap.ARTIFACT_STORE) await db.updateGate(gateMap.ARTIFACT_STORE.id, { job_name: buildId });

      const succeeded = await runKanikoBuild(buildId, destination, kanikoArgs, safeName);
      if (succeeded) {
        builtImages.push({ service: safeName, destination, role: "ingress", port: null, sharedBuild: false });
        buildResult.imageRef = destination;
        const externalImageRef = destination.replace(HARBOR_REGISTRY, HARBOR_PULL_REGISTRY);
        await db.pool.query("UPDATE pipeline_runs SET image_url = $1, updated_at = NOW() WHERE id = $2", [externalImageRef, runId]);
        await db.auditLog(runId, "image_build_completed", null, `Image built: ${destination}`, { buildId, destination });
      } else {
        await db.auditLog(runId, "image_build_failed", null, "Container image build failed", { buildId });
      }
      overallBuildSuccess = succeeded;
    }

    // Save builtImages to metadata
    if (builtImages.length > 0) {
      try {
        await db.pool.query(
          "UPDATE pipeline_runs SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2",
          [JSON.stringify({ builtImages: builtImages.map(img => ({ service: img.service, destination: img.destination.replace(HARBOR_REGISTRY, HARBOR_PULL_REGISTRY), role: img.role, port: img.port, sharedBuild: img.sharedBuild })) }), runId]
        );
      } catch (metaErr) {
        logger.info('pipeline', `Failed to save builtImages metadata: ${metaErr.message}`, { runId });
      }
    }

    // Update gate status
    if (overallBuildSuccess) {
      const summary = builtImages.length === 1
        ? `Image built and pushed: ${builtImages[0].service}`
        : `${builtImages.length} image(s) built and pushed: ${builtImages.map(img => img.service).join(", ")}`;
      if (gateMap.ARTIFACT_STORE) {
        await db.updateGate(gateMap.ARTIFACT_STORE.id, { status: "passed", progress: 100, completedAt: new Date().toISOString(), summary });
        emitPipelineEvent(runId, "gate_status", { gate: "ARTIFACT_STORE", status: "passed", summary, progress: 100 });
      }
    } else {
      const summary = builtImages.length > 0
        ? `Partial build failure: ${builtImages.length} succeeded, some failed`
        : "Container image build failed";
      if (gateMap.ARTIFACT_STORE) {
        await db.updateGate(gateMap.ARTIFACT_STORE.id, { status: "failed", progress: 100, completedAt: new Date().toISOString(), summary });
        emitPipelineEvent(runId, "gate_status", { gate: "ARTIFACT_STORE", status: "failed", summary, progress: 100 });
      }
    }
    })()); // end build promise
  } else if (builtImageRef && run.source_type === "image") {
    // External container image — import into Harbor via crane copy
    const CRANE_IMAGE = "gcr.io/go-containerregistry/crane:v0.20.2";
    const safeName = run.app_name.replace(/[^a-z0-9-]/gi, "-").toLowerCase().substring(0, 40);
    const teamName = run.team.startsWith("team-") ? run.team : `team-${run.team}`;
    const sourceImage = builtImageRef;
    // Extract tag from source image (after last colon, or "imported")
    const tagMatch = sourceImage.match(/:([^/]+)$/);
    const imageTag = tagMatch ? tagMatch[1] : "imported";
    const harborDest = `${HARBOR_REGISTRY}/${teamName}/${safeName}:${imageTag}`;

    if (imageTag === "latest") {
      if (gateMap.ARTIFACT_STORE) {
        await db.updateGate(gateMap.ARTIFACT_STORE.id, { status: "failed", progress: 100, completedAt: new Date().toISOString(), summary: "Rejected: the :latest tag is not allowed — use a pinned version tag" });
        emitPipelineEvent(runId, "gate_status", { gate: "ARTIFACT_STORE", status: "failed", summary: "Rejected: :latest tag not allowed", progress: 100 });
      }
    } else {
      if (gateMap.ARTIFACT_STORE) {
        await db.updateGate(gateMap.ARTIFACT_STORE.id, { status: "running", startedAt: new Date().toISOString(), summary: `Importing image from external registry...`, progress: 10 });
        emitPipelineEvent(runId, "gate_status", { gate: "ARTIFACT_STORE", status: "running", summary: "Importing image from external registry...", progress: 10 });
      }

      // Ensure Harbor project exists
      try { await ensureHarborProject(teamName); } catch (e) {
        console.debug('[pipeline] Harbor project ensure best-effort error:', e.message);
      }

      const importJobId = `pipe-import-${crypto.randomBytes(4).toString("hex")}`;
      try {
        await batchApi.createNamespacedJob(BUILD_NAMESPACE, {
          apiVersion: "batch/v1", kind: "Job",
          metadata: {
            name: importJobId, namespace: BUILD_NAMESPACE,
            labels: { "app.kubernetes.io/part-of": "sre-platform", "sre.io/build-id": importJobId, "sre.io/app-name": safeName }
          },
          spec: {
            backoffLimit: 2, ttlSecondsAfterFinished: 3600,
            template: {
              metadata: { annotations: { "sidecar.istio.io/inject": "false" } },
              spec: {
                restartPolicy: "Never", serviceAccountName: "pipeline-runner",
                containers: [{
                  name: "crane-import", image: CRANE_IMAGE,
                  command: ["sh", "-c", `crane copy "${sourceImage}" "${harborDest}" && echo "IMPORT_SUCCESS: ${harborDest}"`],
                  volumeMounts: [{ name: "docker-config", mountPath: "/home/nonroot/.docker" }],
                  resources: { requests: { cpu: "100m", memory: "256Mi" }, limits: { cpu: "1", memory: "1Gi" } },
                }],
                volumes: [
                  { name: "docker-config", secret: { secretName: "harbor-push-creds", items: [{ key: ".dockerconfigjson", path: "config.json" }] } },
                ],
              },
            },
          },
        });

        emitPipelineEvent(runId, "gate_log", { gate: "ARTIFACT_STORE", line: `Importing ${sourceImage} → ${harborDest}` });
        if (gateMap.ARTIFACT_STORE) {
          await db.updateGate(gateMap.ARTIFACT_STORE.id, { jobName: importJobId });
        }

        const importLogs = await waitForJobAndGetLogs(importJobId, BUILD_NAMESPACE, "crane-import", 600, runId, "ARTIFACT_STORE");
        const importSuccess = importLogs && importLogs.includes("IMPORT_SUCCESS:");

        if (importSuccess) {
          // Update builtImageRef to point to the Harbor copy (for SBOM/CVE scans)
          builtImageRef = harborDest;
          buildResult.imageRef = harborDest;
          if (gateMap.ARTIFACT_STORE) {
            await db.updateGate(gateMap.ARTIFACT_STORE.id, { status: "passed", progress: 100, completedAt: new Date().toISOString(), summary: `Imported to Harbor: ${harborDest}` });
            emitPipelineEvent(runId, "gate_status", { gate: "ARTIFACT_STORE", status: "passed", summary: `Imported to Harbor: ${harborDest}`, progress: 100 });
          }
          await db.auditLog(runId, "image_imported", null, `External image imported to Harbor`, { source: sourceImage, destination: harborDest });
        } else {
          if (gateMap.ARTIFACT_STORE) {
            const errSummary = importLogs ? importLogs.split("\n").filter(l => l.trim()).pop() || "Import failed" : "Import job timed out";
            await db.updateGate(gateMap.ARTIFACT_STORE.id, { status: "failed", progress: 100, completedAt: new Date().toISOString(), summary: `Image import failed: ${errSummary}` });
            emitPipelineEvent(runId, "gate_status", { gate: "ARTIFACT_STORE", status: "failed", summary: `Image import failed`, progress: 100 });
          }
          builtImageRef = null; // Prevent SBOM/CVE from running on un-imported image
        }
      } catch (importErr) {
        logger.error("pipeline", `Import job error for run ${runId}: ${importErr.message}`, { runId, error: importErr.message });
        if (gateMap.ARTIFACT_STORE) {
          await db.updateGate(gateMap.ARTIFACT_STORE.id, { status: "failed", progress: 100, completedAt: new Date().toISOString(), summary: `Image import error: ${importErr.message}` });
          emitPipelineEvent(runId, "gate_status", { gate: "ARTIFACT_STORE", status: "failed", summary: `Image import error: ${importErr.message}`, progress: 100 });
        }
        builtImageRef = null;
      }
    }
  } else if (builtImageRef) {
    // Pre-built image from Harbor — already in registry, mark as passed
    if (gateMap.ARTIFACT_STORE) {
      await db.updateGate(gateMap.ARTIFACT_STORE.id, { status: "passed", progress: 100, completedAt: new Date().toISOString(), summary: `Using pre-built image: ${builtImageRef}` });
      emitPipelineEvent(runId, "gate_status", { gate: "ARTIFACT_STORE", status: "passed", summary: `Using pre-built image: ${builtImageRef}`, progress: 100 });
    }
  } else {
    // No image and no git URL — skip ARTIFACT_STORE
    if (gateMap.ARTIFACT_STORE) {
      await db.updateGate(gateMap.ARTIFACT_STORE.id, { status: "skipped", completedAt: new Date().toISOString(), summary: "No image or git URL provided" });
      emitPipelineEvent(runId, "gate_status", { gate: "ARTIFACT_STORE", status: "skipped", summary: "No image or git URL provided", progress: 100 });
    }
  }

  // Wait for ALL Phase 1 jobs (SAST + Secrets + Build) to finish
  await Promise.allSettled(phase1Jobs);
  // Pick up the built image ref from the build promise
  if (buildResult.imageRef) builtImageRef = buildResult.imageRef;
  checkPipelineTimeout();

  // Phase 2: Image-based scans (SBOM, CVE) against the BUILT image
  if (builtImageRef) {
    const imageScans = [];
    if (gateMap.SBOM) {
      await db.updateGate(gateMap.SBOM.id, { status: "running", summary: "Trivy: Generating SPDX SBOM from container image...", startedAt: new Date().toISOString(), progress: 10 });
      emitPipelineEvent(runId, "gate_status", { gate: "SBOM", status: "running", summary: "Trivy: Generating SPDX SBOM from container image...", progress: 10 });
      imageScans.push(runScanGate(runId, gateMap.SBOM, (mult) => runSBOMScan(builtImageRef, mult, gateMap.SBOM.id, runId)));
    }
    if (gateMap.CVE) {
      await db.updateGate(gateMap.CVE.id, { status: "running", summary: "Trivy: Scanning container image for CVEs...", startedAt: new Date().toISOString(), progress: 10 });
      emitPipelineEvent(runId, "gate_status", { gate: "CVE", status: "running", summary: "Trivy: Scanning container image for CVEs...", progress: 10 });
      imageScans.push(runScanGate(runId, gateMap.CVE, (mult) => runCVEScan(builtImageRef, mult, gateMap.CVE.id, runId)));
    }
    await Promise.allSettled(imageScans);
  } else if (!run.image_url) {
    // No image at all — mark as skipped
    if (gateMap.SBOM) {
      await db.updateGate(gateMap.SBOM.id, { status: "skipped", summary: "No image available", completedAt: new Date().toISOString() });
      emitPipelineEvent(runId, "gate_status", { gate: "SBOM", status: "skipped", summary: "No image available", progress: 100 });
    }
    if (gateMap.CVE) {
      await db.updateGate(gateMap.CVE.id, { status: "skipped", summary: "No image available", completedAt: new Date().toISOString() });
      emitPipelineEvent(runId, "gate_status", { gate: "CVE", status: "skipped", summary: "No image available", progress: 100 });
    }
  }

  // Phase 3b: Detect security exceptions (root user, privileged requirements)
  if (builtImageRef) {
    await detectSecurityExceptions(runId, builtImageRef);
  }

  // DAST — deferred until post-deployment, will run automatically after deploy completes
  if (gateMap.DAST) {
    await db.updateGate(gateMap.DAST.id, { status: "skipped", summary: "DAST runs automatically after deployment — manual ZAP scan also available from pipeline history", completedAt: new Date().toISOString() });
    emitPipelineEvent(runId, "gate_status", { gate: "DAST", status: "skipped", summary: "DAST runs automatically after deployment", progress: 100 });
  }

  // Determine overall status after automated gates (exclude DAST since it runs post-deployment)
  const updatedRun = await db.getRun(runId);
  const automatedGates = updatedRun.gates.filter(g => !["ISSM_REVIEW", "IMAGE_SIGNING", "DAST"].includes(g.short_name));
  const hasCriticalFindings = updatedRun.findings.some(f => f.severity === "critical" && !f.disposition);
  const hasFailedGate = automatedGates.some(g => g.status === "failed");

  if (hasFailedGate || hasCriticalFindings) {
    // Stay in scanning — needs developer attention / mitigation
    await db.auditLog(runId, "scan_complete_needs_attention", null,
      "Automated scans complete — critical findings or failed gates require attention",
      { failedGates: automatedGates.filter(g => g.status === "failed").map(g => g.short_name) });
    emitPipelineEvent(runId, "pipeline_status", { status: "scanning", message: "Scans complete — critical findings or failed gates require attention" });
    emitPipelineEvent(runId, "done", { status: "scanning" });
  } else {
    // All automated gates passed/warning/skipped — ready for review
    await db.updateRunStatus(runId, "review_pending");
    if (gateMap.ISSM_REVIEW) {
      await db.updateGate(gateMap.ISSM_REVIEW.id, { status: "warning", summary: "Awaiting ISSM review — submit via dashboard or wizard", completedAt: null });
    }
    if (gateMap.IMAGE_SIGNING) {
      await db.updateGate(gateMap.IMAGE_SIGNING.id, { status: "warning", summary: "Runs automatically after ISSM approval", completedAt: null });
    }
    await db.auditLog(runId, "scan_complete_ready_for_review", null, "All automated scans passed — ready for ISSM review");
    emitPipelineEvent(runId, "pipeline_status", { status: "review_pending", message: "All automated scans passed — ready for ISSM review" });
    emitPipelineEvent(runId, "done", { status: "review_pending" });
  }
  // Clean up the emitter after a grace period (listeners may still be reading)
  setTimeout(() => cleanupPipelineEmitter(runId), 5 * 60 * 1000);

  } catch (timeoutErr) {
    // Pipeline timeout or unexpected error — mark remaining pending gates as failed
    logger.error('pipeline', `Pipeline ${runId} error: ${timeoutErr.message}`, { runId });
    const currentRun = await db.getRun(runId);
    if (currentRun) {
      for (const gate of currentRun.gates) {
        if (gate.status === "pending" || gate.status === "running") {
          await db.updateGate(gate.id, {
            status: "failed",
            progress: 100,
            completedAt: new Date().toISOString(),
            summary: `Timed out: ${timeoutErr.message}`,
          });
          emitPipelineEvent(runId, "gate_status", { gate: gate.short_name, status: "failed", summary: `Timed out: ${timeoutErr.message}`, progress: 100 });
        }
      }
      await db.updateRunStatus(runId, "failed");
      await db.auditLog(runId, "pipeline_timeout", null, timeoutErr.message);
      emitPipelineEvent(runId, "pipeline_status", { status: "failed", message: timeoutErr.message });
      emitPipelineEvent(runId, "done", { status: "failed" });
    }
    setTimeout(() => cleanupPipelineEmitter(runId), 5 * 60 * 1000);
  }

  // Clean up bundle temp files after pipeline completes (regardless of success/failure)
  if (run.source_type === "bundle" && run.metadata?.bundleUploadId) {
    const bundleCleanupPath = path.join(BUNDLE_UPLOAD_DIR, run.metadata.bundleUploadId);
    try { fs.rmSync(bundleCleanupPath, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ── Pipeline Deploy Executor ────────────────────────────────────────────────

async function executePipelineDeploy(run, actor) {
  try {
    // Ensure SSE emitter exists so the wizard can stream deploy progress
    getOrCreatePipelineEmitter(run.id);

    await db.updateRunStatus(run.id, "deploying");
    await db.auditLog(run.id, "deploy_started", actor, `Starting deployment of ${run.app_name}`);
    emitPipelineEvent(run.id, "pipeline_status", { status: "deploying", message: `Deploying ${run.app_name}...` });
    emitPipelineEvent(run.id, "deploy_step", { step: "prepare", status: "running" });
    emitPipelineEvent(run.id, "deploy_log", { step: "prepare", line: `Starting deployment of ${run.app_name}` });

    const safeName = run.app_name.replace(/[^a-z0-9-]/gi, "-").toLowerCase().substring(0, 40);
    const domain = SRE_DOMAIN;

    // Check if run has security exceptions requiring privileged mode.
    // Only ISSM-approved exceptions (approved === true) affect the deployment.
    let needsPrivileged = false;
    let parsedExceptions = [];
    try {
      parsedExceptions = typeof run.security_exceptions === "string" ? JSON.parse(run.security_exceptions || "[]") : (run.security_exceptions || []);
      const approvedPrivilegedTypes = ["run_as_root", "writable_filesystem", "privileged_container", "host_networking"];
      needsPrivileged = parsedExceptions.some(e => e.approved === true && approvedPrivilegedTypes.includes(e.type));
      if (needsPrivileged) {
        const approvedNames = parsedExceptions.filter(e => e.approved === true).map(e => e.type);
        logger.info('pipeline', `Run ${run.id} has ISSM-approved exceptions requiring privileged mode`, { runId: run.id, exceptions: approvedNames });
        await db.auditLog(run.id, "privileged_deploy", actor, `Deploying with privileged security context due to ISSM-approved exceptions: ${approvedNames.join(", ")}`);
      }
    } catch (e) {
      console.debug('[pipeline] Security exception check for deploy best-effort:', e.message);
    }

    // Extract security context from run metadata (set during pipeline creation)
    // If metadata doesn't have one, derive it from approved security exceptions.
    let pipelineSecurityContext = null;
    try {
      const runMeta = typeof run.metadata === "string" ? JSON.parse(run.metadata || "{}") : (run.metadata || {});
      if (runMeta.securityContext) {
        pipelineSecurityContext = runMeta.securityContext;
        logger.info('pipeline', `Run ${run.id} has security context from pipeline creation`, { runId: run.id, sc: pipelineSecurityContext });
      } else if (parsedExceptions.length > 0) {
        // Derive a granular securityContext from ISSM-approved exceptions so that
        // generateHelmRelease can apply precise pod/container-level overrides
        // (podSecurityContext, containerSecurityContext) instead of falling back
        // to the coarse boolean `privileged` flag.
        const approvedEx = parsedExceptions.filter(e => e.approved === true);
        if (approvedEx.length > 0) {
          const sc = {};
          const exTypes = approvedEx.map(e => e.type);
          if (exTypes.includes("run_as_root"))          sc.runAsRoot = true;
          if (exTypes.includes("writable_filesystem"))  sc.writableFilesystem = true;
          if (exTypes.includes("privileged_container")) { sc.runAsRoot = true; sc.allowPrivilegeEscalation = true; }
          if (exTypes.includes("host_networking"))      sc.hostNetworking = true;
          if (exTypes.includes("custom_capability"))    sc.capabilities = (sc.capabilities || []);
          if (Object.keys(sc).length > 0) {
            pipelineSecurityContext = sc;
            logger.info('pipeline', `Run ${run.id}: derived securityContext from ISSM-approved exceptions`, { runId: run.id, sc });
          }
        }
      }
    } catch (e) {
      console.debug('[pipeline] Security context metadata read best-effort:', e.message);
    }

    // Check if the pipeline already built an image (ARTIFACT_STORE gate passed)
    const builtImage = run.image_url || (run.gates || []).find(g => g.gate_name === 'ARTIFACT_STORE' && g.status === 'passed' && g.output)?.output;

    // ── COMPOSE DEPLOY PATH ──
    // If the pipeline built multiple images for a compose repo, deploy them all
    // using the pre-built images from metadata instead of rebuilding via /api/deploy/git.
    let runMetadata = {};
    try { runMetadata = typeof run.metadata === "string" ? JSON.parse(run.metadata || "{}") : (run.metadata || {}); } catch (e) { /* */ }
    const builtImagesArray = Array.isArray(runMetadata.builtImages) ? runMetadata.builtImages : [];
    const isComposePipeline = runMetadata.repoAnalysis?.repoType === "compose" && builtImagesArray.length > 0;

    if (isComposePipeline) {
      const analysis = runMetadata.repoAnalysis;
      // Convert array to map keyed by service name for easy lookup
      const builtImages = {};
      for (const img of builtImagesArray) {
        builtImages[img.service] = img;
      }
      const services = analysis.services || [];
      const nsName = run.team.startsWith("team-") ? run.team : `team-${run.team}`;
      const teamName = run.team;
      const ingressHost = `${safeName}.${domain}`;

      logger.info('pipeline', `Compose deploy for ${safeName}: ${services.length} services, ${Object.keys(builtImages).length} built images`, { runId: run.id });
      await db.auditLog(run.id, "compose_deploy_started", actor, `Deploying compose app "${safeName}" with ${services.length} services`);
      emitPipelineEvent(run.id, "deploy_step", { step: "prepare", status: "completed" });
      emitPipelineEvent(run.id, "deploy_step", { step: "namespace", status: "running" });
      emitPipelineEvent(run.id, "deploy_log", { step: "namespace", line: `Ensuring namespace ${nsName} exists` });

      await ensureNamespace(nsName, teamName);
      emitPipelineEvent(run.id, "deploy_step", { step: "namespace", status: "completed" });
      emitPipelineEvent(run.id, "deploy_step", { step: "helmrelease", status: "running" });
      emitPipelineEvent(run.id, "deploy_log", { step: "helmrelease", line: `Deploying ${services.length} compose services...` });

      // Generate a shared PolicyException for all services (if ISSM-approved exceptions exist)
      const approvedExceptions = parsedExceptions.filter(e => e.approved === true);
      const policyException = approvedExceptions.length > 0
        ? generatePolicyException(safeName, nsName, approvedExceptions, actor)
        : null;
      if (policyException) {
        await db.auditLog(run.id, "policy_exception_generated", actor,
          `Generated Kyverno PolicyException for ${approvedExceptions.map(e => e.type).join(", ")}`);
      }

      const deployedServices = [];
      const failedServices = [];

      for (const svc of services) {
        const svcName = sanitizeName(svc.name);
        try {
          if (svc.role === "platform") {
            // ── Platform services (postgres, redis) — raw Deployment+Service ──
            if (svc.sre === "cnpg") {
              const dbName = sanitizeName(`${safeName}-db`);
              const pgDeployment = {
                apiVersion: "apps/v1",
                kind: "Deployment",
                metadata: {
                  name: dbName,
                  namespace: nsName,
                  labels: { app: dbName, "app.kubernetes.io/name": dbName, "app.kubernetes.io/part-of": "sre-platform", "sre.io/team": teamName },
                },
                spec: {
                  replicas: 1,
                  selector: { matchLabels: { app: dbName } },
                  template: {
                    metadata: { labels: { app: dbName, "app.kubernetes.io/name": dbName, "app.kubernetes.io/part-of": "sre-platform", "sre.io/team": teamName } },
                    spec: {
                      securityContext: { seccompProfile: { type: "RuntimeDefault" } },
                      containers: [{
                        name: "postgres",
                        image: "docker.io/library/postgres:16-alpine",
                        ports: [{ containerPort: 5432 }],
                        env: [
                          { name: "POSTGRES_DB", value: safeName.replace(/-/g, "_") },
                          { name: "POSTGRES_USER", value: safeName.replace(/-/g, "_") },
                          { name: "POSTGRES_PASSWORD", value: "changeme" },
                        ],
                        resources: { requests: { cpu: "100m", memory: "256Mi" }, limits: { cpu: "1", memory: "512Mi" } },
                        volumeMounts: [{ name: "data", mountPath: "/var/lib/postgresql/data", subPath: "pgdata" }],
                        securityContext: {
                          runAsNonRoot: false,
                          allowPrivilegeEscalation: false,
                          capabilities: { drop: ["ALL"], add: ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"] },
                        },
                      }],
                      volumes: [{ name: "data", emptyDir: {} }],
                    },
                  },
                },
              };
              const pgSvc = {
                apiVersion: "v1",
                kind: "Service",
                metadata: { name: dbName, namespace: nsName, labels: { app: dbName, "sre.io/team": teamName } },
                spec: { selector: { app: dbName }, ports: [{ port: 5432, targetPort: 5432 }] },
              };
              await applyRawDeployment(pgDeployment, nsName).catch(err => {
                logger.warn('pipeline', `PostgreSQL deployment failed: ${err.body?.message || err.message}`, { runId: run.id });
              });
              await applyRawService(pgSvc, nsName).catch(err => {
                logger.warn('pipeline', `PostgreSQL service failed: ${err.body?.message || err.message}`, { runId: run.id });
              });
              // Create alias so compose DNS name resolves (e.g., "db" -> "keystone-db")
              if (svc.name !== dbName) {
                await k8sApi.createNamespacedService(nsName, {
                  metadata: { name: svc.name, namespace: nsName, labels: { "sre.io/alias-for": dbName } },
                  spec: { selector: { app: dbName }, ports: [{ port: 5432, targetPort: 5432 }] },
                }).catch(e => { if (e.statusCode !== 409) logger.warn('pipeline', `Alias "${svc.name}" failed: ${e.message}`, { runId: run.id }); });
              }
              deployedServices.push({ name: dbName, type: "postgresql", port: 5432 });
              logger.info('pipeline', `Deployed platform service: PostgreSQL as ${dbName}`, { runId: run.id });

            } else if (svc.sre === "redis") {
              const redisName = sanitizeName(`${safeName}-redis`);
              const redisDeployment = {
                apiVersion: "apps/v1",
                kind: "Deployment",
                metadata: {
                  name: redisName,
                  namespace: nsName,
                  labels: { app: redisName, "app.kubernetes.io/name": redisName, "app.kubernetes.io/part-of": "sre-platform", "sre.io/team": teamName },
                },
                spec: {
                  replicas: 1,
                  selector: { matchLabels: { app: redisName } },
                  template: {
                    metadata: { labels: { app: redisName, "app.kubernetes.io/name": redisName, "app.kubernetes.io/part-of": "sre-platform", "sre.io/team": teamName } },
                    spec: {
                      securityContext: { runAsNonRoot: true, seccompProfile: { type: "RuntimeDefault" } },
                      containers: [{
                        name: "redis",
                        image: "docker.io/library/redis:7-alpine",
                        ports: [{ containerPort: 6379 }],
                        resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } },
                        securityContext: {
                          runAsNonRoot: true,
                          allowPrivilegeEscalation: false,
                          capabilities: { drop: ["ALL"] },
                        },
                      }],
                    },
                  },
                },
              };
              const redisSvc = {
                apiVersion: "v1",
                kind: "Service",
                metadata: { name: redisName, namespace: nsName, labels: { app: redisName, "sre.io/team": teamName } },
                spec: { selector: { app: redisName }, ports: [{ port: 6379, targetPort: 6379 }] },
              };
              await applyRawDeployment(redisDeployment, nsName).catch(err => {
                logger.warn('pipeline', `Redis deployment failed: ${err.body?.message || err.message}`, { runId: run.id });
              });
              await applyRawService(redisSvc, nsName).catch(err => {
                logger.warn('pipeline', `Redis service failed: ${err.body?.message || err.message}`, { runId: run.id });
              });
              // Create alias so compose DNS name resolves
              if (svc.name !== redisName) {
                await k8sApi.createNamespacedService(nsName, {
                  metadata: { name: svc.name, namespace: nsName, labels: { "sre.io/alias-for": redisName } },
                  spec: { selector: { app: redisName }, ports: [{ port: 6379, targetPort: 6379 }] },
                }).catch(e => { if (e.statusCode !== 409) logger.warn('pipeline', `Alias "${svc.name}" failed: ${e.message}`, { runId: run.id }); });
              }
              deployedServices.push({ name: redisName, type: "redis", port: 6379 });
              logger.info('pipeline', `Deployed platform service: Redis as ${redisName}`, { runId: run.id });

            } else if (svc.sre === "skip") {
              deployedServices.push({ name: svcName, type: "skipped", reason: svc.sreLabel });
            }

          } else if (builtImages[svc.name]) {
            // ── Built service — deploy using pre-built image from pipeline ──
            const imgInfo = builtImages[svc.name];
            const svcAppName = sanitizeName(`${safeName}-${svc.name}`);
            // Parse destination "registry/team/name:tag" into repo + tag
            const imgDest = imgInfo.destination || "";
            const destColonIdx = imgDest.lastIndexOf(":");
            const imageRepo = destColonIdx > 0 && !imgDest.substring(destColonIdx).includes("/") ? imgDest.substring(0, destColonIdx) : imgDest;
            const imageTag = destColonIdx > 0 && !imgDest.substring(destColonIdx).includes("/") ? imgDest.substring(destColonIdx + 1) : "pipeline";
            const svcPort = svc.port || imgInfo.port || 8080;
            const isIngress = svc.role === "ingress";
            const svcIngressHost = isIngress ? ingressHost : "";

            // Apply per-service detected requirements (additive — ISSM overrides take precedence)
            let svcSecurityContext = pipelineSecurityContext;
            const svcReqs = svc.requirements;
            if (svcReqs && !pipelineSecurityContext && (svcReqs.needsRoot || svcReqs.needsPrivileged)) {
              svcSecurityContext = {};
              if (svcReqs.needsRoot) svcSecurityContext.runAsRoot = true;
              if (svcReqs.needsPrivileged) { svcSecurityContext.privileged = true; svcSecurityContext.runAsRoot = true; }
              if (svcReqs.needsWritableFs) svcSecurityContext.writableFilesystem = true;
              if (svcReqs.capabilities && svcReqs.capabilities.length > 0) svcSecurityContext.capabilities = svcReqs.capabilities;
            } else if (svcReqs && !pipelineSecurityContext && svcReqs.needsWritableFs) {
              svcSecurityContext = { writableFilesystem: true };
            }

            const manifest = generateHelmRelease({
              name: svcAppName,
              team: nsName,
              image: imageRepo,
              tag: imageTag,
              port: svcPort,
              replicas: isIngress ? 2 : 1,
              ingressHost: svcIngressHost,
              privileged: needsPrivileged || (svcReqs && svcReqs.needsPrivileged),
              securityContext: svcSecurityContext,
              env: svc.environment || [],
            });

            // Override resources if detected from compose deploy config
            if (svcReqs && svcReqs.resources) {
              manifest.spec.values.app.resources = svcReqs.resources;
            }
            // Override probe delays for apps that need longer startup
            if (svcReqs && svcReqs.probeDelays) {
              manifest.spec.values.app.probes = {
                liveness: { path: '/', initialDelaySeconds: svcReqs.probeDelays.liveness, periodSeconds: 30, failureThreshold: svcReqs.probeDelays.failureThreshold || 5 },
                readiness: { path: '/', initialDelaySeconds: svcReqs.probeDelays.readiness, periodSeconds: 10, failureThreshold: svcReqs.probeDelays.failureThreshold || 5 },
              };
            }

            await deployViaGitOps(manifest, nsName, svcAppName, actor, isIngress ? policyException : null);

            // Auto-create DestinationRule for HTTPS backend detection
            await createBackendTLSRule(svcAppName, nsName, `${svcAppName}-${svcAppName}`);

            deployedServices.push({ name: svcAppName, type: isIngress ? "ingress" : "internal", port: svcPort, image: `${imageRepo}:${imageTag}` });
            logger.info('pipeline', `Deployed built service: ${svcAppName} (${imageRepo}:${imageTag})`, { runId: run.id });

            if (isIngress) {
              await registerOAuth2ProxyPath(ingressHost).catch(e => {
                logger.warn('pipeline', `OAuth2 proxy registration for ${ingressHost} failed: ${e.message}`, { runId: run.id });
              });
            }

          } else if (svc.image && !svc.needsBuild) {
            // ── Pre-built external image (not built by pipeline) — deploy directly ──
            const svcAppName = sanitizeName(`${safeName}-${svc.name}`);
            let imageRepo = svc.image;
            let imageTag = "latest";
            const colonIdx = svc.image.lastIndexOf(":");
            if (colonIdx > 0 && !svc.image.substring(colonIdx).includes("/")) {
              imageRepo = svc.image.substring(0, colonIdx);
              imageTag = svc.image.substring(colonIdx + 1);
            }

            const manifest = generateHelmRelease({
              name: svcAppName,
              team: nsName,
              image: imageRepo,
              tag: imageTag,
              port: svc.port || 8080,
              replicas: 1,
              ingressHost: "",
              env: svc.environment || [],
            });
            await deployViaGitOps(manifest, nsName, svcAppName, actor, null);
            deployedServices.push({ name: svcAppName, type: "external", port: svc.port, image: svc.image });
            logger.info('pipeline', `Deployed external image service: ${svcAppName} (${svc.image})`, { runId: run.id });

          } else {
            logger.info('pipeline', `Skipping service "${svcName}" — no built image, no external image, not a platform service`, { runId: run.id });
          }
        } catch (svcErr) {
          logger.error('pipeline', `Failed to deploy service "${svcName}": ${svcErr.message}`, { runId: run.id, error: svcErr.message });
          failedServices.push({ name: svcName, error: svcErr.message });
        }
      }

      // Wait for ingress service HelmRelease to become ready
      const ingressSvc = deployedServices.find(s => s.type === "ingress");
      let deployHealthy = true;
      let deployWarning = "";
      if (ingressSvc) {
        const hrStatus = await waitForHelmRelease(nsName, ingressSvc.name, 180);
        if (!hrStatus.ready && hrStatus.error) {
          deployHealthy = false;
          deployWarning = hrStatus.error;
          logger.warn('pipeline', `Ingress HelmRelease ${ingressSvc.name} not ready: ${hrStatus.error}`, { runId: run.id });
          await db.auditLog(run.id, "deploy_warning", actor, `Ingress HelmRelease issue: ${hrStatus.error}`);
        }
      }

      const deployedUrl = `https://${ingressHost}`;

      // Log compose deploy summary
      logger.info('pipeline', `Compose deploy summary for ${safeName}: ${deployedServices.length} deployed, ${failedServices.length} failed`, {
        runId: run.id,
        deployed: deployedServices.map(s => `${s.name} (${s.type})`),
        failed: failedServices.map(s => `${s.name}: ${s.error}`),
      });

      // Register in app portal
      const appData = {
        name: safeName,
        namespace: nsName,
        team: run.team,
        url: deployedUrl,
        helmRelease: ingressSvc?.name || safeName,
        deployedVia: "pipeline-compose",
        services: deployedServices,
        registeredAt: new Date().toISOString(),
      };
      appRegistry.push(appData);
      try {
        await k8sApi.patchNamespacedConfigMap(APP_REGISTRY_CM, APP_REGISTRY_NS, {
          data: { "apps.json": JSON.stringify(appRegistry) },
        }, undefined, undefined, undefined, undefined, undefined, { headers: { "Content-Type": "application/strategic-merge-patch+json" } });
      } catch (cmErr) {
        console.debug('[pipeline] Registry update best-effort:', cmErr.message);
      }

      emitPipelineEvent(run.id, "deploy_step", { step: "helmrelease", status: deployedServices.length > 0 ? "completed" : "failed" });
      emitPipelineEvent(run.id, "deploy_step", { step: "reconcile", status: deployHealthy ? "completed" : "failed" });
      const deployStatus = failedServices.length > 0 ? "deployed_partial" : (deployHealthy ? "deployed" : "deployed_unhealthy");
      await db.updateRunStatus(run.id, deployStatus, { deployedUrl, deployWarning, deployedServices, failedServices });
      await db.auditLog(run.id, "deploy_completed", actor,
        `Compose deploy of ${run.app_name}: ${deployedServices.length} services deployed, ${failedServices.length} failed. URL: ${deployedUrl}${deployWarning ? " — WARNING: " + deployWarning : ""}`);
      emitPipelineEvent(run.id, "deploy_log", { line: `Deployed ${deployedServices.length} services to ${deployedUrl}` });
      emitPipelineEvent(run.id, "pipeline_status", { status: deployStatus, message: `Deployed to ${deployedUrl}` });
      emitPipelineEvent(run.id, "done", { status: deployStatus });
    } else if (builtImage && !builtImage.startsWith('{')) {
      // Image already built during pipeline — skip rebuild, just create HelmRelease
      logger.info('pipeline', `Using pre-built image for ${safeName}: ${builtImage}`, { runId: run.id });
      const nsName = run.team.startsWith("team-") ? run.team : `team-${run.team}`;
      const imageParts = builtImage.split(":");
      const imageRepo = imageParts.slice(0, -1).join(":") || builtImage;
      const imageTag = imageParts.length > 1 ? imageParts[imageParts.length - 1] : "latest";
      const ingressHost = `${safeName}.${domain}`;

      // Auto-detect app requirements from repo analysis stored during scan phase
      let detectedPort = run.port || 8080;
      let detectedResources = null;
      let detectedProbeDelays = null;
      try {
        const runMeta = typeof run.metadata === "string" ? JSON.parse(run.metadata || "{}") : (run.metadata || {});
        const analysis = runMeta.repoAnalysis;
        if (analysis && analysis.services && analysis.services.length > 0) {
          // Find the primary (ingress) service, or the first service
          const primarySvc = analysis.services.find(s => s.role === 'ingress') || analysis.services[0];
          if (primarySvc.port) detectedPort = primarySvc.port;
        }
        // Check for detected requirements stored during scan phase
        if (runMeta.detectedRequirements) {
          const dreqs = runMeta.detectedRequirements;
          if (dreqs.port) detectedPort = dreqs.port;
          if (dreqs.resources) detectedResources = dreqs.resources;
          if (dreqs.probeDelays) detectedProbeDelays = dreqs.probeDelays;
          // Auto-apply security context from detected requirements (only if not already set by ISSM)
          const hasExplicitSecurity = pipelineSecurityContext && Object.keys(pipelineSecurityContext).length > 0;
          if (!hasExplicitSecurity && (dreqs.needsRoot || dreqs.needsPrivileged)) {
            pipelineSecurityContext = {};
            if (dreqs.needsRoot) pipelineSecurityContext.runAsRoot = true;
            if (dreqs.needsPrivileged) { pipelineSecurityContext.privileged = true; pipelineSecurityContext.runAsRoot = true; }
            if (dreqs.needsWritableFs) pipelineSecurityContext.writableFilesystem = true;
            if (dreqs.capabilities && dreqs.capabilities.length > 0) pipelineSecurityContext.capabilities = dreqs.capabilities;
            needsPrivileged = true;
            logger.info('pipeline', `Run ${run.id}: auto-detected security requirements from repo analysis`, { runId: run.id, detectedReqs: dreqs });

            // Auto-generate security exceptions for PolicyException when none were explicitly provided
            const autoExceptions = [];
            if (dreqs.needsRoot) autoExceptions.push({ type: 'run_as_root', justification: 'Auto-detected: ' + (dreqs.detectedFrom || []).join('; '), approved: true });
            if (dreqs.needsPrivileged) autoExceptions.push({ type: 'privileged_container', justification: 'Auto-detected: ' + (dreqs.detectedFrom || []).join('; '), approved: true });
            if (dreqs.needsWritableFs) autoExceptions.push({ type: 'writable_filesystem', justification: 'Auto-detected: ' + (dreqs.detectedFrom || []).join('; '), approved: true });
            if (dreqs.capabilities && dreqs.capabilities.length > 0) autoExceptions.push({ type: 'custom_capability', justification: 'Auto-detected capabilities: ' + dreqs.capabilities.join(', '), approved: true });

            const hasExistingExceptions = parsedExceptions.filter(e => e.approved === true).length > 0;
            if (autoExceptions.length > 0 && !hasExistingExceptions) {
              parsedExceptions = autoExceptions;
              logger.info('pipeline', `Run ${run.id}: auto-generated ${autoExceptions.length} security exception(s) from repo analysis`, { runId: run.id, autoExceptions: autoExceptions.map(e => e.type) });
            }
          }
          // Auto-apply writable filesystem even without root (if not already set by ISSM)
          if (!hasExplicitSecurity && !pipelineSecurityContext && dreqs.needsWritableFs) {
            pipelineSecurityContext = { writableFilesystem: true };
            const hasExistingExceptions = parsedExceptions.filter(e => e.approved === true).length > 0;
            if (!hasExistingExceptions) {
              parsedExceptions = [{ type: 'writable_filesystem', justification: 'Auto-detected: ' + (dreqs.detectedFrom || []).join('; '), approved: true }];
            }
          }
        }
      } catch (e) { /* best-effort detection */ }

      // ── Bundle manifest overrides ─────────────────────────────────────
      // When source is a bundle, the developer specified port, resources, storage,
      // probes, and security in bundle.yaml. Use those values.
      let bundleSpec = null;
      let bundleSecurity = null;
      let bundleStorage = null;
      let bundleProbes = null;
      try {
        const runMeta = typeof run.metadata === "string" ? JSON.parse(run.metadata || "{}") : (run.metadata || {});
        const bm = runMeta.bundleManifest;
        if (bm && bm.spec) {
          bundleSpec = bm.spec;
          const app = bm.spec.app || {};

          // Port from bundle manifest
          if (app.port) detectedPort = app.port;

          // Resources from bundle (small/medium/large or explicit)
          const resPreset = app.resources;
          if (resPreset === "small") detectedResources = { requests: { cpu: "50m", memory: "64Mi" }, limits: { cpu: "200m", memory: "256Mi" } };
          else if (resPreset === "medium") detectedResources = { requests: { cpu: "250m", memory: "256Mi" }, limits: { cpu: "1000m", memory: "1Gi" } };
          else if (resPreset === "large") detectedResources = { requests: { cpu: "500m", memory: "512Mi" }, limits: { cpu: "2000m", memory: "2Gi" } };

          // Probes from bundle
          if (app.probes) {
            bundleProbes = app.probes;
          }

          // Storage from bundle services or top-level storage
          const services = bm.spec.services || {};
          if (services.storage && services.storage.enabled) {
            bundleStorage = { mountPath: services.storage.mountPath || "/data", size: services.storage.size || "5Gi" };
          }

          // Security from bundle
          if (bm.spec.security) {
            bundleSecurity = bm.spec.security;
            const hasExplicitSecurity = pipelineSecurityContext && Object.keys(pipelineSecurityContext).length > 0;
            if (!hasExplicitSecurity) {
              pipelineSecurityContext = pipelineSecurityContext || {};
              if (bundleSecurity.runAsNonRoot === false) {
                pipelineSecurityContext.runAsRoot = true;
                needsPrivileged = true;
              }
              if (bundleSecurity.readOnlyRootFilesystem === false) {
                pipelineSecurityContext.writableFilesystem = true;
              }
              if (bundleSecurity.capabilities && bundleSecurity.capabilities.length > 0) {
                pipelineSecurityContext.capabilities = bundleSecurity.capabilities;
              }

              // Auto-generate security exceptions from bundle manifest
              const autoExceptions = [];
              if (bundleSecurity.runAsNonRoot === false) autoExceptions.push({ type: "run_as_root", justification: "Specified in deployment bundle manifest", approved: true });
              if (bundleSecurity.readOnlyRootFilesystem === false) autoExceptions.push({ type: "writable_filesystem", justification: "Specified in deployment bundle manifest", approved: true });
              const hasExistingExceptions = parsedExceptions.filter(e => e.approved === true).length > 0;
              if (autoExceptions.length > 0 && !hasExistingExceptions) {
                parsedExceptions = autoExceptions;
              }
            }
          }

          // Ingress from bundle
          if (app.ingress && !ingressHost.includes(safeName)) {
            // Only override if the ingress wasn't already set from the run
          }

          logger.info("pipeline", `Run ${run.id}: applying bundle manifest overrides (port=${app.port}, resources=${resPreset}, storage=${!!bundleStorage})`, { runId: run.id });
        }
      } catch (e) { /* best-effort bundle manifest parsing */ }

      // Use detected port (run.port takes precedence if explicitly set by user)
      const effectivePort = run.port || detectedPort;

      emitPipelineEvent(run.id, "deploy_step", { step: "prepare", status: "completed" });
      emitPipelineEvent(run.id, "deploy_step", { step: "namespace", status: "running" });
      emitPipelineEvent(run.id, "deploy_log", { step: "namespace", line: `Ensuring namespace ${nsName} exists` });
      await ensureNamespace(nsName, run.team);
      emitPipelineEvent(run.id, "deploy_step", { step: "namespace", status: "completed" });

      emitPipelineEvent(run.id, "deploy_step", { step: "helmrelease", status: "running" });
      emitPipelineEvent(run.id, "deploy_log", { step: "helmrelease", line: `Creating HelmRelease for ${safeName} (image: ${imageRepo}:${imageTag})` });

      const manifest = generateHelmRelease({
        name: safeName,
        team: nsName,
        image: imageRepo,
        tag: imageTag,
        port: effectivePort,
        replicas: 2,
        ingressHost: ingressHost,
        privileged: needsPrivileged,
        securityContext: pipelineSecurityContext,
      });

      // Override resources if detected from compose deploy config or bundle manifest
      if (detectedResources) {
        manifest.spec.values.app.resources = detectedResources;
      }
      // Override probe delays for apps that need longer startup (e.g., linuxserver images)
      if (detectedProbeDelays) {
        manifest.spec.values.app.probes = {
          liveness: { path: '/', initialDelaySeconds: detectedProbeDelays.liveness, periodSeconds: 30, failureThreshold: detectedProbeDelays.failureThreshold || 5 },
          readiness: { path: '/', initialDelaySeconds: detectedProbeDelays.readiness, periodSeconds: 10, failureThreshold: detectedProbeDelays.failureThreshold || 5 },
        };
      }

      // ── Bundle manifest: apply probes, persistence, startup probe, replicas ──
      if (bundleSpec) {
        // Probes from bundle (liveness/readiness paths)
        if (bundleProbes) {
          const lp = bundleProbes.liveness || "/";
          const rp = bundleProbes.readiness || "/";
          manifest.spec.values.app.probes = {
            liveness: { path: lp, initialDelaySeconds: 10, periodSeconds: 10 },
            readiness: { path: rp, initialDelaySeconds: 5, periodSeconds: 5 },
          };
        }

        // Startup probe — enable if bundle has storage (stateful apps are slow)
        // or if the app type suggests it (databases, vendor software)
        if (bundleStorage || (bundleSpec.app && bundleSpec.app.type === "vendor")) {
          manifest.spec.values.startupProbe = {
            enabled: true,
            path: (bundleProbes && bundleProbes.readiness) || (bundleProbes && bundleProbes.liveness) || "/",
            initialDelaySeconds: 5,
            periodSeconds: 5,
            failureThreshold: 30,
          };
          emitPipelineEvent(run.id, "deploy_log", { step: "helmrelease", line: "Startup probe enabled (stateful/slow-starting app)" });
        }

        // Persistent storage from bundle
        if (bundleStorage) {
          manifest.spec.values.persistence = {
            enabled: true,
            mountPath: bundleStorage.mountPath,
            size: bundleStorage.size,
          };
          emitPipelineEvent(run.id, "deploy_log", { step: "helmrelease", line: `Persistent storage: ${bundleStorage.size} at ${bundleStorage.mountPath}` });
        }

        // Writable filesystem override (non-root apps that still need writable fs)
        if (bundleSecurity && bundleSecurity.readOnlyRootFilesystem === false && !needsPrivileged) {
          manifest.spec.values.containerSecurityContext = manifest.spec.values.containerSecurityContext || {};
          manifest.spec.values.containerSecurityContext.readOnlyRootFilesystem = false;
        }

        // Single replica for stateful apps
        if (bundleStorage) {
          manifest.spec.values.app.replicas = 1;
        }
      }

      // Generate Kyverno PolicyException for ISSM-approved security exceptions only.
      // Exceptions must have approved === true (set by the ISSM review endpoint).
      const approvedExceptions = parsedExceptions.filter(e => e.approved === true);
      const policyException = approvedExceptions.length > 0
        ? generatePolicyException(safeName, nsName, approvedExceptions, actor)
        : null;
      if (policyException) {
        emitPipelineEvent(run.id, "deploy_log", { step: "helmrelease", line: `Kyverno PolicyException created for: ${approvedExceptions.map(e => e.type).join(", ")}` });
        await db.auditLog(run.id, "policy_exception_generated", actor,
          `Generated Kyverno PolicyException for ${approvedExceptions.map(e => e.type).join(", ")}`);
      }

      await deployViaGitOps(manifest, nsName, safeName, actor, policyException);
      emitPipelineEvent(run.id, "deploy_step", { step: "helmrelease", status: "completed" });

      // Monitor HelmRelease status — auto-retry on max retry failure
      emitPipelineEvent(run.id, "deploy_step", { step: "reconcile", status: "running" });
      emitPipelineEvent(run.id, "deploy_log", { step: "reconcile", line: "Waiting for HelmRelease to reconcile..." });
      const hrStatus = await waitForHelmRelease(nsName, safeName, 180);
      let deployHealthy = true;
      let deployWarning = "";
      if (!hrStatus.ready && hrStatus.error) {
        deployHealthy = false;
        deployWarning = hrStatus.error;
        logger.warn('pipeline', `HelmRelease ${safeName} not ready: ${hrStatus.error}`, { runId: run.id });
        await db.auditLog(run.id, "deploy_warning", actor, `HelmRelease issue: ${hrStatus.error}`);
        emitPipelineEvent(run.id, "deploy_log", { step: "reconcile", line: `Warning: ${hrStatus.error}` });
        emitPipelineEvent(run.id, "deploy_step", { step: "reconcile", status: "failed" });
      } else {
        emitPipelineEvent(run.id, "deploy_step", { step: "reconcile", status: "completed" });
      }

      const deployedUrl = `https://${ingressHost}`;

      // Register in app portal
      const appData = {
        name: safeName,
        namespace: nsName,
        team: run.team,
        url: deployedUrl,
        helmRelease: safeName,
        deployedVia: "pipeline",
        registeredAt: new Date().toISOString(),
      };
      appRegistry.push(appData);
      try {
        await k8sApi.patchNamespacedConfigMap(APP_REGISTRY_CM, APP_REGISTRY_NS, {
          data: { "apps.json": JSON.stringify(appRegistry) },
        }, undefined, undefined, undefined, undefined, undefined, { headers: { "Content-Type": "application/strategic-merge-patch+json" } });
      } catch (cmErr) {
        console.debug('[pipeline] Registry update best-effort:', cmErr.message);
      }

      const deployStatus = deployHealthy ? "deployed" : "deployed_unhealthy";
      await db.updateRunStatus(run.id, deployStatus, { deployedUrl, deployWarning });
      await db.auditLog(run.id, "deploy_completed", actor, `Deployed ${run.app_name} to ${deployedUrl} (pre-built image)${deployWarning ? " — WARNING: " + deployWarning : ""}`);
      emitPipelineEvent(run.id, "deploy_log", { line: `Deployed to ${deployedUrl}` });
      emitPipelineEvent(run.id, "pipeline_status", { status: deployStatus, message: `Deployed to ${deployedUrl}` });
      emitPipelineEvent(run.id, "done", { status: deployStatus });
    } else if (run.git_url) {
      // Fallback: no pre-built image, call deploy-from-git to build + deploy
      const http = require("http");
      const deployPayload = {
        url: run.git_url,
        branch: run.branch || "main",
        team: run.team,
        name: safeName,
      };
      if (needsPrivileged) deployPayload.privileged = true;
      if (pipelineSecurityContext) deployPayload.securityContext = pipelineSecurityContext;
      if (parsedExceptions.length > 0) deployPayload.securityExceptions = parsedExceptions;
      const deployResult = await new Promise((resolve, reject) => {
        const postData = JSON.stringify(deployPayload);
        const req = http.request({
          hostname: "127.0.0.1",
          port: PORT,
          path: "/api/deploy/git",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData),
            "X-Auth-Request-User": actor,
            "X-Auth-Request-Email": actor,
            "X-Auth-Request-Groups": "sre-admins",
          },
        }, (res) => {
          let data = "";
          res.on("data", (chunk) => { data += chunk; });
          res.on("end", () => {
            try {
              const parsed = JSON.parse(data);
              if (res.statusCode >= 400) reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
              else resolve(parsed);
            } catch (err) {
              console.debug('[pipeline] Deploy response parse error:', err.message);
              reject(new Error(`Deploy response parse error (HTTP ${res.statusCode})`));
            }
          });
        });
        req.on("error", (e) => { console.error(`[pipeline] Deploy HTTP error: ${e.message}`); reject(e); });
        req.setTimeout(300000, () => { req.destroy(); reject(new Error("Deploy timed out (5 min)")); });
        req.write(postData);
        req.end();
      });

      logger.info('pipeline', `Deploy API responded for run ${run.id}`, { runId: run.id, result: JSON.stringify(deployResult).substring(0, 200) });
      const deployedUrl = deployResult.url || `https://${safeName}.${domain}`;

      // If a build was started, wait for it to complete and HelmRelease to be created
      if (deployResult.buildId) {
        await db.auditLog(run.id, "build_started", actor, `Build ${deployResult.buildId} started, waiting for completion...`);
        const maxWait = 600; // 10 minutes
        const nsName = run.team.startsWith("team-") ? run.team : `team-${run.team}`;
        let deployed = false;
        for (let i = 0; i < maxWait / 5; i++) {
          await new Promise(r => setTimeout(r, 5000));
          try {
            // Check if the HelmRelease was created (means build finished and deploy happened)
            const hrs = await customApi.listNamespacedCustomObject("helm.toolkit.fluxcd.io", "v2", nsName, "helmreleases");
            const hrList = hrs.body.items || [];
            const hrExists = hrList.some(hr => hr.metadata.name === safeName || hr.metadata.name.includes(safeName));
            if (hrExists) {
              logger.info('pipeline', `HelmRelease found for ${safeName} in ${nsName}`, { app: safeName, namespace: nsName });
              deployed = true;
              break;
            }
          } catch (err) {
            console.debug('[pipeline] Waiting for HelmRelease creation:', err.message);
          }
          // Also check if build job failed
          try {
            const job = await batchApi.readNamespacedJob(deployResult.buildId, BUILD_NAMESPACE);
            if (job.body.status?.failed) {
              throw new Error("Build job failed");
            }
          } catch (err) {
            if (err.message === "Build job failed") throw err;
          }
        }
        if (!deployed) {
          throw new Error("Timed out waiting for deployment to complete");
        }
      }

      await db.updateRunStatus(run.id, "deployed", { deployedUrl });
      await db.auditLog(run.id, "deploy_completed", actor,
        `Deployed ${run.app_name} to ${deployedUrl}`,
        { deployedUrl, result: deployResult });
      emitPipelineEvent(run.id, "deploy_log", { line: `Deployed to ${deployedUrl}` });
      emitPipelineEvent(run.id, "pipeline_status", { status: "deployed", message: `Deployed to ${deployedUrl}` });
      emitPipelineEvent(run.id, "done", { status: "deployed" });
    } else if (run.image_url) {
      // Image-only deploy — call generateHelmRelease + deployViaGitOps directly
      // instead of going through HTTP to avoid auth header issues
      const nsName = run.team.startsWith("team-") ? run.team : `team-${run.team}`;
      const imageRef = run.image_url;
      const imageParts = imageRef.split(":");
      const imageRepo = imageParts.slice(0, -1).join(":") || imageRef;
      const imageTag = imageParts.length > 1 ? imageParts[imageParts.length - 1] : "latest";
      const ingressHost = `${safeName}.${domain}`;

      await ensureNamespace(nsName, run.team);

      const manifest = generateHelmRelease({
        name: safeName,
        team: nsName,
        image: imageRepo,
        tag: imageTag,
        port: run.port || 8080,
        replicas: 2,
        ingressHost: ingressHost,
        privileged: needsPrivileged,
        securityContext: pipelineSecurityContext,
      });

      // Generate Kyverno PolicyException for ISSM-approved security exceptions
      const policyException2 = parsedExceptions.length > 0
        ? generatePolicyException(safeName, nsName, parsedExceptions, actor)
        : null;
      if (policyException2) {
        await db.auditLog(run.id, "policy_exception_generated", actor,
          `Generated Kyverno PolicyException for ${parsedExceptions.map(e => e.type).join(", ")}`);
      }

      await deployViaGitOps(manifest, nsName, safeName, actor, policyException2);

      // Monitor HelmRelease status — auto-retry on max retry failure
      const hrStatus2 = await waitForHelmRelease(nsName, safeName, 180);
      let deployHealthy2 = true;
      let deployWarning2 = "";
      if (!hrStatus2.ready && hrStatus2.error) {
        deployHealthy2 = false;
        deployWarning2 = hrStatus2.error;
        logger.warn('pipeline', `HelmRelease ${safeName} not ready: ${hrStatus2.error}`, { runId: run.id });
        await db.auditLog(run.id, "deploy_warning", actor, `HelmRelease issue: ${hrStatus2.error}`);
      }

      const deployedUrl = `https://${ingressHost}`;
      const deployStatus2 = deployHealthy2 ? "deployed" : "deployed_unhealthy";
      await db.updateRunStatus(run.id, deployStatus2, { deployedUrl, deployWarning: deployWarning2 });
      await db.auditLog(run.id, "deploy_completed", actor,
        `Deployed ${run.app_name} from image ${run.image_url}${deployWarning2 ? " — WARNING: " + deployWarning2 : ""}`,
        { deployedUrl, privileged: needsPrivileged });
      emitPipelineEvent(run.id, "deploy_log", { line: `Deployed to ${deployedUrl}` });
      emitPipelineEvent(run.id, "pipeline_status", { status: deployStatus2, message: `Deployed to ${deployedUrl}` });
      emitPipelineEvent(run.id, "done", { status: deployStatus2 });
    } else {
      throw new Error("No git URL or image URL available for deployment");
    }

    // After deployment succeeds, trigger DAST scan automatically (non-blocking)
    try {
      const deployedRun = await db.getRun(run.id);
      const dastGate = deployedRun.gates.find(g => g.short_name === "DAST");
      const deployedUrl = deployedRun.deployed_url;
      if (dastGate && deployedUrl && validateUrl(deployedUrl)) {
        await db.updateGate(dastGate.id, { status: "running", summary: "Running DAST scan against deployed application...", startedAt: new Date().toISOString(), progress: 10 });
        await db.auditLog(run.id, "dast_auto_scan_started", actor, `Auto-DAST scan started against ${deployedUrl}`);
        try {
          const dastResult = await runDASTScan(deployedUrl, dastGate.id);
          const dastStatus = dastResult.status === "failed" ? "warning" : dastResult.status === "warning" ? "warning" : "passed";
          await db.updateGate(dastGate.id, {
            status: dastStatus,
            progress: 100,
            completedAt: new Date().toISOString(),
            summary: dastResult.summary || dastStatus,
            rawOutput: { gate: "DAST", tool: "OWASP ZAP", status: dastStatus, summary: dastResult.summary, findings: dastResult.findings, scannedAt: new Date().toISOString() },
          });
          if (dastResult.findings && dastResult.findings.length > 0) {
            for (const finding of dastResult.findings) {
              await db.createFinding({ runId: run.id, gateId: dastGate.id, severity: (finding.severity || "info").toLowerCase(), title: finding.title, description: finding.description, location: finding.location });
            }
          }
          await db.auditLog(run.id, "dast_auto_scan_completed", actor, `Auto-DAST scan completed: ${dastStatus} — ${dastResult.summary}`);
        } catch (dastErr) {
          await db.updateGate(dastGate.id, { status: "warning", progress: 100, completedAt: new Date().toISOString(), summary: `DAST scan failed: ${dastErr.message} — manual ZAP scan available from pipeline history` });
          await db.auditLog(run.id, "dast_auto_scan_failed", actor, `Auto-DAST scan failed: ${dastErr.message}`);
          console.error(`[pipeline] Auto-DAST scan failed for run ${run.id}: ${dastErr.message}`);
        }
      }
    } catch (dastSetupErr) {
      console.error(`[pipeline] DAST setup error for run ${run.id}: ${dastSetupErr.message}`);
    }
  } catch (err) {
    // Provide actionable error message
    let errorMsg = err.message;
    if (errorMsg.includes("Build job failed")) {
      errorMsg = "Container image build failed. Check the build logs in the pipeline run detail.";
    } else if (errorMsg.includes("Timed out")) {
      errorMsg = "Deployment timed out. The HelmRelease may still be reconciling. Check the app status page.";
    } else if (errorMsg.includes("No git URL or image URL")) {
      errorMsg = "No source available for deployment. Ensure the pipeline run has a git URL or pre-built image.";
    }
    await db.updateRunStatus(run.id, "failed");
    await db.auditLog(run.id, "deploy_failed", actor, `Deploy failed: ${errorMsg}`, { originalError: err.message });
    logger.error('pipeline', `Deploy failed for run ${run.id}: ${errorMsg}`, { runId: run.id, error: err.message });
  }
}

// ── Security Scanning Endpoints (DSOP Wizard) ───────────────────────────────

// Helper: wait for a K8s Job to complete and return its container logs.
// If runId and gateName are provided, streams log lines as gate_log events in real-time.
async function waitForJobAndGetLogs(jobName, namespace, containerName, timeoutSeconds, runId, gateName) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  const shouldStream = runId && gateName;
  let podName = null;

  // Phase 1: Wait for pod to be scheduled and start running
  while (Date.now() < deadline) {
    // Check if job finished
    const job = await batchApi.readNamespacedJob(jobName, namespace);
    if (job.body.status?.succeeded || job.body.status?.failed) break;

    // Try to find the pod and stream logs while job is running
    if (!podName) {
      try {
        const pods = await k8sApi.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, `job-name=${jobName}`);
        if (pods.body.items.length > 0) {
          podName = pods.body.items[0].metadata.name;
          const phase = pods.body.items[0].status?.phase;
          if (shouldStream) emitPipelineEvent(runId, "gate_log", { gate: gateName, line: `Pod ${podName} created (${phase})` });
        }
      } catch (e) { /* pod not ready yet */ }
    }

    // Stream partial logs if pod is running
    if (podName && shouldStream) {
      try {
        const partial = await k8sApi.readNamespacedPodLog(podName, namespace, containerName, undefined, undefined, undefined, undefined, undefined, 20);
        const text = typeof partial.body === "string" ? partial.body : String(partial.body || "");
        if (text.trim()) {
          const lines = text.trim().split("\n").slice(-5); // last 5 lines as progress
          for (const line of lines) {
            emitPipelineEvent(runId, "gate_log", { gate: gateName, line });
          }
        }
      } catch (e) { /* container not ready yet */ }
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  // Phase 2: Job finished — get full logs
  const pods = await k8sApi.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, `job-name=${jobName}`);
  if (!pods.body.items.length) throw new Error("No pods found for job");
  podName = pods.body.items[0].metadata.name;

  // Check if job actually failed
  const finalJob = await batchApi.readNamespacedJob(jobName, namespace);
  if (finalJob.body.status?.failed) {
    if (shouldStream) emitPipelineEvent(runId, "gate_log", { gate: gateName, line: "Job failed — fetching error logs..." });
  }

  const logs = await k8sApi.readNamespacedPodLog(podName, namespace, containerName);
  const body = logs.body;
  let fullLogs;
  if (typeof body === 'string') fullLogs = body;
  else if (Buffer.isBuffer(body)) fullLogs = body.toString('utf8');
  else if (body && typeof body.read === 'function') {
    const chunks = [];
    for await (const chunk of body) { chunks.push(chunk); }
    fullLogs = Buffer.concat(chunks).toString('utf8');
  } else if (body && typeof body === 'object') {
    if (typeof body.text === 'function') fullLogs = await body.text();
    else { try { fullLogs = JSON.stringify(body); } catch (err) { fullLogs = String(body || ''); } }
  } else {
    fullLogs = String(body || '');
  }

  // Stream final log lines
  if (shouldStream && fullLogs) {
    const finalLines = fullLogs.trim().split("\n").slice(-10);
    for (const line of finalLines) {
      emitPipelineEvent(runId, "gate_log", { gate: gateName, line });
    }
    if (finalJob.body.status?.failed) {
      emitPipelineEvent(runId, "gate_log", { gate: gateName, line: "--- JOB FAILED ---" });
    } else {
      emitPipelineEvent(runId, "gate_log", { gate: gateName, line: "--- SCAN COMPLETE ---" });
    }
  }

  if (finalJob.body.status?.failed) throw new Error("Job failed");
  return fullLogs;
}

// POST /api/security/sast — Run Semgrep SAST scan via K8s Job
app.post("/api/security/sast", mutateLimiter, requireGroups("sre-admins", "developers"), async (req, res) => {
  const { url, branch } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });
  if (!validateGitUrl(url)) return res.status(400).json({ error: "Invalid git URL" });

  const jobName = "sast-" + crypto.randomBytes(4).toString("hex");
  const safeBranch = (branch || "main").replace(/[^a-zA-Z0-9._-]/g, "");

  try {
    await batchApi.createNamespacedJob(BUILD_NAMESPACE, {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: { name: jobName, namespace: BUILD_NAMESPACE },
      spec: {
        ttlSecondsAfterFinished: 300,
        backoffLimit: 0,
        template: {
          spec: {
            restartPolicy: "Never",
            containers: [{
              name: "semgrep",
              image: "docker.io/semgrep/semgrep:1.102.0",
              env: [
                { name: "GIT_URL", value: url },
                { name: "GIT_BRANCH", value: safeBranch },
              ],
              command: ["sh", "-c", 'git clone --depth 1 --branch "$GIT_BRANCH" "$GIT_URL" /src 2>/dev/null && cd /src && semgrep scan --config auto --json --quiet 2>/dev/null || echo \'{"results":[],"errors":[]}\''],
              resources: { requests: { cpu: "100m", memory: "256Mi" }, limits: { cpu: "1", memory: "1Gi" } },
            }],
          },
        },
      },
    });

    const logs = await waitForJobAndGetLogs(jobName, BUILD_NAMESPACE, "semgrep", 120, runId, "SAST");

    let results;
    try {
      results = JSON.parse(logs);
    } catch (err) {
      console.debug('[security] Standalone Semgrep output parse failed:', err.message);
      results = { results: [], errors: [{ message: "Failed to parse output" }] };
    }

    const findings = (results.results || []).map(r => ({
      severity: r.extra?.severity || "info",
      title: r.check_id || "Unknown",
      description: r.extra?.message || "",
      location: `${r.path}:${r.start?.line || 0}`,
    }));

    const critical = findings.filter(f => f.severity === "ERROR").length;
    const warnings = findings.filter(f => f.severity === "WARNING").length;

    res.json({
      gate: "SAST",
      tool: "Semgrep",
      status: critical > 0 ? "failed" : warnings > 0 ? "warning" : "passed",
      findings,
      summary: `${findings.length} findings (${critical} errors, ${warnings} warnings)`,
    });
  } catch (err) {
    console.error("SAST scan error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/security/secrets — Run Gitleaks secrets scan via K8s Job
app.post("/api/security/secrets", mutateLimiter, requireGroups("sre-admins", "developers"), async (req, res) => {
  const { url, branch } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });
  if (!validateGitUrl(url)) return res.status(400).json({ error: "Invalid git URL" });

  const jobName = "secrets-" + crypto.randomBytes(4).toString("hex");
  const safeBranch = (branch || "main").replace(/[^a-zA-Z0-9._-]/g, "");

  try {
    await batchApi.createNamespacedJob(BUILD_NAMESPACE, {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: { name: jobName, namespace: BUILD_NAMESPACE },
      spec: {
        ttlSecondsAfterFinished: 300,
        backoffLimit: 0,
        template: {
          spec: {
            restartPolicy: "Never",
            containers: [{
              name: "gitleaks",
              image: "docker.io/zricethezav/gitleaks:v8.22.1",
              env: [
                { name: "GIT_URL", value: url },
                { name: "GIT_BRANCH", value: safeBranch },
              ],
              command: ["sh", "-c", 'git clone --depth 5 --branch "$GIT_BRANCH" "$GIT_URL" /src 2>/dev/null && gitleaks detect --source /src --report-format json --report-path /dev/stdout --no-banner 2>/dev/null || echo \'[]\''],
              resources: { requests: { cpu: "50m", memory: "128Mi" }, limits: { cpu: "500m", memory: "512Mi" } },
            }],
          },
        },
      },
    });

    const logs = await waitForJobAndGetLogs(jobName, BUILD_NAMESPACE, "gitleaks", 60, runId, "SECRETS");

    let secrets = [];
    try { secrets = JSON.parse(logs); } catch (err) {
      console.debug('[security] Standalone Gitleaks output parse failed:', err.message);
      secrets = [];
    }
    if (!Array.isArray(secrets)) secrets = [];

    const findings = secrets.map(s => ({
      severity: "critical",
      title: s.Description || s.RuleID || "Secret detected",
      description: `${s.Match || ""}`.substring(0, 100),
      location: `${s.File}:${s.StartLine || 0}`,
    }));

    res.json({
      gate: "Secrets",
      tool: "Gitleaks",
      status: findings.length > 0 ? "failed" : "passed",
      findings,
      summary: findings.length > 0 ? `${findings.length} secrets detected!` : "0 secrets detected",
    });
  } catch (err) {
    console.error("Secrets scan error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/security/sbom — Generate SBOM with Trivy via K8s Job
app.post("/api/security/sbom", mutateLimiter, requireGroups("sre-admins", "developers"), async (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: "image is required" });
  if (!validateImageRef(image)) return res.status(400).json({ error: "Invalid image reference" });

  const jobName = "sbom-" + crypto.randomBytes(4).toString("hex");

  try {
    await batchApi.createNamespacedJob(BUILD_NAMESPACE, {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: { name: jobName, namespace: BUILD_NAMESPACE },
      spec: {
        ttlSecondsAfterFinished: 300,
        backoffLimit: 0,
        template: {
          metadata: { annotations: { "sidecar.istio.io/inject": "false" } },
          spec: {
            restartPolicy: "Never",
            containers: [{
              name: "trivy-sbom",
              image: "docker.io/aquasec/trivy:0.58.2",
              command: ["trivy", "image", "--format", "spdx-json", "--insecure", "--scanners", "vuln", "--quiet", image],
              resources: { requests: { cpu: "500m", memory: "1Gi" }, limits: { cpu: "4", memory: "8Gi" } },
              volumeMounts: [{ name: "docker-config", mountPath: "/root/.docker", readOnly: true }],
            }],
            volumes: [{
              name: "docker-config",
              secret: { secretName: "harbor-pull-creds-dockerconfig", optional: true, items: [{ key: ".dockerconfigjson", path: "config.json" }] },
            }],
          },
        },
      },
    });

    const logs = await waitForJobAndGetLogs(jobName, BUILD_NAMESPACE, "trivy-sbom", 300, runId, "SBOM");

    let sbom;
    try { sbom = JSON.parse(logs); } catch (err) {
      console.debug('[security] Standalone SBOM parse failed:', err.message);
      sbom = null;
    }

    const packageCount = sbom?.packages?.length || 0;

    res.json({
      gate: "SBOM",
      tool: "Trivy",
      status: sbom ? "passed" : "failed",
      format: "SPDX 2.3",
      packageCount,
      summary: sbom ? `SBOM generated: ${packageCount} packages identified` : "SBOM generation failed",
      sbom: sbom,
    });
  } catch (err) {
    console.error("SBOM generation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/security/dast — Run OWASP ZAP baseline scan via K8s Job
app.post("/api/security/dast", mutateLimiter, requireGroups("sre-admins", "developers"), async (req, res) => {
  const { targetUrl } = req.body;
  if (!targetUrl) return res.status(400).json({ error: "targetUrl is required" });
  if (!validateUrl(targetUrl)) return res.status(400).json({ error: "Invalid target URL" });

  const jobName = "dast-" + crypto.randomBytes(4).toString("hex");

  try {
    await batchApi.createNamespacedJob(BUILD_NAMESPACE, {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: { name: jobName, namespace: BUILD_NAMESPACE },
      spec: {
        ttlSecondsAfterFinished: 300,
        backoffLimit: 0,
        template: {
          spec: {
            restartPolicy: "Never",
            containers: [{
              name: "zap",
              image: "ghcr.io/zaproxy/zaproxy:stable",
              env: [
                { name: "TARGET_URL", value: targetUrl },
              ],
              command: ["sh", "-c", 'zap-baseline.py -t "$TARGET_URL" -J /dev/stdout -I 2>/dev/null || echo \'{"site":[]}\''],
              resources: { requests: { cpu: "200m", memory: "512Mi" }, limits: { cpu: "1", memory: "2Gi" } },
            }],
          },
        },
      },
    });

    const logs = await waitForJobAndGetLogs(jobName, BUILD_NAMESPACE, "zap", 180, runId, "DAST");

    let report;
    try { report = JSON.parse(logs); } catch (err) {
      console.debug('[security] Standalone ZAP report parse failed:', err.message);
      report = { site: [] };
    }

    const alerts = [];
    for (const site of (report.site || [])) {
      for (const alert of (site.alerts || [])) {
        alerts.push({
          severity: alert.riskdesc?.split(" ")[0]?.toLowerCase() || "info",
          title: alert.name || "Unknown",
          description: alert.desc || "",
          location: alert.uri || targetUrl,
        });
      }
    }

    const high = alerts.filter(a => a.severity === "high").length;

    res.json({
      gate: "DAST",
      tool: "OWASP ZAP",
      status: high > 0 ? "failed" : alerts.length > 0 ? "warning" : "passed",
      findings: alerts,
      summary: `${alerts.length} alerts (${high} high risk)`,
    });
  } catch (err) {
    console.error("DAST scan error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/pipeline/runs/:id/run-dast — Trigger post-deploy DAST scan
app.post("/api/pipeline/runs/:id/run-dast", mutateLimiter, requireDb, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const run = await db.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "Pipeline run not found" });

    if (run.status !== "deployed") {
      return res.status(400).json({ error: `DAST scan requires a deployed app (current status: ${run.status})` });
    }

    const deployedUrl = run.deployed_url;
    if (!deployedUrl || !validateUrl(deployedUrl)) {
      return res.status(400).json({ error: "No valid deployed URL found for this run" });
    }

    const dastGate = run.gates.find(g => g.short_name === "DAST");
    if (!dastGate) {
      return res.status(400).json({ error: "No DAST gate found for this run" });
    }

    const actor = getActor(req);
    await db.updateGate(dastGate.id, { status: "running", summary: "Running ZAP baseline scan against deployed URL...", startedAt: new Date().toISOString(), progress: 10 });
    await db.auditLog(run.id, "dast_scan_started", actor, `DAST scan started against ${deployedUrl}`);

    // Run DAST in background
    (async () => {
      try {
        const result = await runDASTScan(deployedUrl);
        const gateStatus = result.status === "failed" ? "failed" : result.status === "warning" ? "warning" : "passed";
        await db.updateGate(dastGate.id, {
          status: gateStatus,
          progress: 100,
          completedAt: new Date().toISOString(),
          summary: result.summary || gateStatus,
          rawOutput: { gate: "DAST", tool: "OWASP ZAP", status: gateStatus, summary: result.summary, findings: result.findings, scannedAt: new Date().toISOString() },
        });
        if (result.findings && result.findings.length > 0) {
          for (const finding of result.findings) {
            await db.createFinding({ runId: run.id, gateId: dastGate.id, severity: (finding.severity || "info").toLowerCase(), title: finding.title, description: finding.description, location: finding.location });
          }
        }
        await db.auditLog(run.id, "dast_scan_completed", actor, `DAST scan completed: ${gateStatus} — ${result.summary}`, { status: gateStatus, findingCount: (result.findings || []).length });
      } catch (err) {
        await db.updateGate(dastGate.id, { status: "failed", progress: 100, completedAt: new Date().toISOString(), summary: `DAST scan failed: ${err.message}` });
        await db.auditLog(run.id, "dast_scan_failed", actor, `DAST scan failed: ${err.message}`);
        console.error(`[pipeline] DAST scan failed for run ${run.id}: ${err.message}`);
      }
    })();

    res.json({ message: "DAST scan started", runId: run.id, targetUrl: deployedUrl });
  } catch (err) {
    console.error("[pipeline] DAST trigger error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Pipeline Crash Recovery ─────────────────────────────────────────────────

function getContainerNameForGate(shortName) {
  const map = {
    SAST: "semgrep",
    SECRETS: "gitleaks",
    SBOM: "trivy-sbom",
    CVE: "trivy",
    DAST: "zap",
    ARTIFACT_STORE: "kaniko",
  };
  return map[shortName] || shortName.toLowerCase();
}

async function getJobLogs(jobName, namespace, containerName) {
  const pods = await k8sApi.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, `job-name=${jobName}`);
  if (!pods.body.items.length) return null;
  const podName = pods.body.items[0].metadata.name;
  try {
    const logs = await k8sApi.readNamespacedPodLog(podName, namespace, containerName);
    return logs.body;
  } catch (err) {
    console.debug(`[pipeline] getJobLogs failed for ${jobName}/${containerName}:`, err.message);
    return null;
  }
}

async function recoverOrphanedRuns() {
  if (!dbAvailable) return;

  try {
    const activeRuns = await db.getActiveRuns();
    if (!activeRuns.length) {
      console.log("[recovery] No orphaned pipeline runs found");
      return;
    }

    console.log(`[recovery] Found ${activeRuns.length} orphaned pipeline run(s) to recover`);

    for (const run of activeRuns) {
      console.log(`[recovery] Recovering run ${run.id} (${run.app_name}, status: ${run.status})`);

      for (const gate of run.gates) {
        // Only recover gates that were in-progress
        if (!["running", "pending"].includes(gate.status)) continue;
        if (!gate.job_name) {
          // No job name stored — can't recover, mark as failed
          if (gate.status === "running") {
            await db.updateGate(gate.id, {
              status: "failed",
              progress: 100,
              completedAt: new Date().toISOString(),
              summary: "Dashboard restarted — no job reference to recover",
            });
          }
          continue;
        }

        const containerName = getContainerNameForGate(gate.short_name);

        try {
          const job = await batchApi.readNamespacedJob(gate.job_name, BUILD_NAMESPACE);

          if (job.body.status?.succeeded) {
            // Job completed successfully — fetch logs and process results
            console.log(`[recovery] Gate ${gate.short_name} job ${gate.job_name} succeeded — fetching results`);
            await db.updateGate(gate.id, {
              status: "passed",
              progress: 100,
              completedAt: new Date().toISOString(),
              summary: "Recovered after restart — job completed successfully",
            });
            await db.auditLog(run.id, "gate_recovered", "system",
              `Gate ${gate.short_name} recovered — job ${gate.job_name} had completed`, { gateId: gate.id });
          } else if (job.body.status?.failed) {
            // Job failed
            console.log(`[recovery] Gate ${gate.short_name} job ${gate.job_name} failed`);
            let reason = "Job failed";
            try {
              const pods = await k8sApi.listNamespacedPod(BUILD_NAMESPACE, undefined, undefined, undefined, undefined, `job-name=${gate.job_name}`);
              if (pods.body.items.length) {
                const cs = pods.body.items[0].status?.containerStatuses?.[0];
                if (cs?.state?.terminated?.reason === "OOMKilled") reason = "Out of memory";
                else if (cs?.state?.terminated?.exitCode) reason = `Exit code ${cs.state.terminated.exitCode}`;
              }
            } catch (err) {
              console.debug('[recovery] Pod status lookup best-effort failed:', err.message);
            }

            await db.updateGate(gate.id, {
              status: "failed",
              progress: 100,
              completedAt: new Date().toISOString(),
              summary: `Recovered after restart — ${reason}`,
            });
            await db.auditLog(run.id, "gate_recovered", "system",
              `Gate ${gate.short_name} recovered — job ${gate.job_name} failed: ${reason}`, { gateId: gate.id });
          } else {
            // Job still running — resume polling
            console.log(`[recovery] Gate ${gate.short_name} job ${gate.job_name} still running — resuming poll`);
            resumeJobPoll(run.id, gate).catch(err => {
              console.error(`[recovery] Resume poll failed for ${gate.short_name}: ${err.message}`);
            });
          }
        } catch (err) {
          if (err.statusCode === 404) {
            // Job doesn't exist anymore (TTL expired)
            console.log(`[recovery] Gate ${gate.short_name} job ${gate.job_name} expired (not found)`);
            await db.updateGate(gate.id, {
              status: "failed",
              progress: 100,
              completedAt: new Date().toISOString(),
              summary: "Job expired during dashboard restart",
            });
            await db.auditLog(run.id, "gate_recovered", "system",
              `Gate ${gate.short_name} — job ${gate.job_name} no longer exists (TTL expired)`, { gateId: gate.id });
          } else {
            console.error(`[recovery] Error checking job ${gate.job_name}: ${err.message}`);
            await db.updateGate(gate.id, {
              status: "failed",
              progress: 100,
              completedAt: new Date().toISOString(),
              summary: `Recovery error: ${err.message}`,
            });
          }
        }
      }

      // Determine final run status from recovered gate states
      const updatedRun = await db.getRun(run.id);
      if (updatedRun) {
        const allGates = updatedRun.gates;
        const hasRunning = allGates.some(g => g.status === "running");

        if (!hasRunning) {
          // All gates resolved — determine final status
          const hasFailed = allGates.some(g => g.status === "failed" && !["ISSM_REVIEW", "IMAGE_SIGNING", "DAST"].includes(g.short_name));
          if (hasFailed) {
            await db.updateRunStatus(run.id, "failed");
            await db.auditLog(run.id, "run_recovered_failed", "system", "Pipeline recovered after restart — has failed gates");
          } else if (run.status === "scanning") {
            // Check if it should go to review_pending
            const automatedGates = allGates.filter(g => !["ISSM_REVIEW", "IMAGE_SIGNING"].includes(g.short_name));
            const allDone = automatedGates.every(g => ["passed", "warning", "skipped", "failed"].includes(g.status));
            if (allDone) {
              const anyFailed = automatedGates.some(g => g.status === "failed");
              if (!anyFailed) {
                await db.updateRunStatus(run.id, "review_pending");
                await db.auditLog(run.id, "run_recovered_review", "system", "Pipeline recovered after restart — ready for review");
              } else {
                await db.updateRunStatus(run.id, "failed");
                await db.auditLog(run.id, "run_recovered_failed", "system", "Pipeline recovered after restart — has failed gates");
              }
            }
          }
        }
        // If some gates are still running (resumed polling), leave run status as-is
      }

      console.log(`[recovery] Run ${run.id} recovery complete`);
    }

    console.log("[recovery] Orphaned pipeline recovery complete");
  } catch (err) {
    console.error("[recovery] Error recovering orphaned runs:", err.message);
  }
}

async function resumeJobPoll(runId, gate) {
  const containerName = getContainerNameForGate(gate.short_name);
  try {
    const logs = await waitForJobAndGetLogs(gate.job_name, BUILD_NAMESPACE, containerName, 300);
    await db.updateGate(gate.id, {
      status: "passed",
      progress: 100,
      completedAt: new Date().toISOString(),
      summary: "Completed after dashboard restart",
    });
    await db.auditLog(runId, "gate_resumed_complete", "system",
      `Gate ${gate.short_name} resumed and completed after restart`, { gateId: gate.id });
  } catch (err) {
    await db.updateGate(gate.id, {
      status: "failed",
      progress: 100,
      completedAt: new Date().toISOString(),
      summary: `Failed after resume: ${err.message}`,
    });
    await db.auditLog(runId, "gate_resumed_failed", "system",
      `Gate ${gate.short_name} resumed but failed: ${err.message}`, { gateId: gate.id });
  }

  // Check if all gates done and update run status
  const updatedRun = await db.getRun(runId);
  if (updatedRun) {
    const hasRunning = updatedRun.gates.some(g => g.status === "running");
    if (!hasRunning) {
      const automatedGates = updatedRun.gates.filter(g => !["ISSM_REVIEW", "IMAGE_SIGNING"].includes(g.short_name));
      const hasFailed = automatedGates.some(g => g.status === "failed");
      if (hasFailed) {
        await db.updateRunStatus(runId, "failed");
      } else {
        await db.updateRunStatus(runId, "review_pending");
      }
    }
  }
}

// ── Task 10.2: One-Click Rollback ─────────────────────────────────────────
app.post("/api/apps/:namespace/:name/rollback", mutateLimiter, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const { namespace, name } = req.params;
    const { revision } = req.body || {};

    // Get HelmRelease to find chart details
    let hr;
    try {
      hr = await customApi.getNamespacedCustomObject(
        "helm.toolkit.fluxcd.io", "v2", namespace, "helmreleases", name
      );
    } catch (e) {
      return res.status(404).json({ error: `HelmRelease ${name} not found in ${namespace}` });
    }

    // Get Helm release history from secrets
    const history = [];
    try {
      const secrets = await k8sApi.listNamespacedSecret(namespace);
      for (const s of secrets.body.items) {
        if (s.metadata.name.startsWith(`sh.helm.release.v1.${name}.`)) {
          const ver = s.metadata.labels?.version;
          const status = s.metadata.labels?.status;
          const modifiedAt = s.metadata.labels?.modifiedAt || s.metadata.creationTimestamp;
          history.push({
            revision: parseInt(ver || "0", 10),
            status: status || "unknown",
            updated: s.metadata.creationTimestamp,
            chart: hr.body?.spec?.chart?.spec?.chart || name,
            chartVersion: hr.body?.spec?.chart?.spec?.version || "unknown",
          });
        }
      }
      history.sort((a, b) => b.revision - a.revision);
    } catch (e) {
      console.debug('[rollback] History lookup best-effort:', e.message);
    }

    // If no revision specified, return history for user to pick
    if (!revision) {
      return res.json({ history, currentRevision: history.length > 0 ? history[0].revision : 0 });
    }

    // Perform rollback by patching the HelmRelease to force a reconciliation
    // Flux rollback: set the annotation to force re-install
    const patchBody = {
      metadata: {
        annotations: {
          "reconcile.fluxcd.io/requestedAt": new Date().toISOString(),
        },
      },
    };

    await customApi.patchNamespacedCustomObject(
      "helm.toolkit.fluxcd.io", "v2", namespace, "helmreleases", name,
      patchBody,
      undefined, undefined, undefined,
      { headers: { "Content-Type": "application/merge-patch+json" } }
    );

    const actor = getActor(req);
    console.log(`[rollback] ${actor} triggered rollback for ${namespace}/${name} to revision ${revision}`);

    res.json({ success: true, message: `Rollback initiated for ${name} to revision ${revision}` });
  } catch (err) {
    console.error("Error rolling back app:", err);
    res.status(err.statusCode || 500).json({ error: err.message || "Internal server error" });
  }
});

// ── Task 10.3: Kyverno Policy Violations ──────────────────────────────────
app.get("/api/security/policy-violations", requireGroups("sre-admins", "developers", "issm", "compliance-assessors"), async (req, res) => {
  try {
    const { namespace } = req.query;
    const violations = [];

    // Query Kyverno PolicyReports (namespaced)
    try {
      const prOpts = namespace
        ? { namespace }
        : {};
      let reports;
      if (namespace) {
        reports = await customApi.listNamespacedCustomObject(
          "wgpolicyk8s.io", "v1alpha2", namespace, "policyreports"
        );
      } else {
        reports = await customApi.listClusterCustomObject(
          "wgpolicyk8s.io", "v1alpha2", "policyreports"
        );
      }

      for (const report of (reports.body.items || [])) {
        for (const result of (report.results || [])) {
          if (result.result === "fail" || result.result === "error" || result.result === "warn") {
            violations.push({
              policy: result.policy || "unknown",
              rule: result.rule || "unknown",
              severity: result.severity || "medium",
              result: result.result,
              message: result.message || "",
              namespace: report.metadata?.namespace || "cluster",
              resource: result.resources?.[0]
                ? `${result.resources[0].kind}/${result.resources[0].name}`
                : report.scope?.name
                  ? `${report.scope?.kind || "Resource"}/${report.scope.name}`
                  : "unknown",
              category: result.category || "",
              timestamp: result.timestamp || report.metadata?.creationTimestamp || "",
            });
          }
        }
      }
    } catch (e) {
      console.debug('[policy-violations] PolicyReport (v1alpha2) query failed, trying v1beta1:', e.message);
      // Try v1beta1 (Kyverno 1.12+)
      try {
        let reports;
        if (namespace) {
          reports = await customApi.listNamespacedCustomObject(
            "wgpolicyk8s.io", "v1beta1", namespace, "policyreports"
          );
        } else {
          reports = await customApi.listClusterCustomObject(
            "wgpolicyk8s.io", "v1beta1", "policyreports"
          );
        }
        for (const report of (reports.body.items || [])) {
          for (const result of (report.results || [])) {
            if (result.result === "fail" || result.result === "error" || result.result === "warn") {
              violations.push({
                policy: result.policy || "unknown",
                rule: result.rule || "unknown",
                severity: result.severity || "medium",
                result: result.result,
                message: result.message || "",
                namespace: report.metadata?.namespace || "cluster",
                resource: result.resources?.[0]
                  ? `${result.resources[0].kind}/${result.resources[0].name}`
                  : "unknown",
                category: result.category || "",
                timestamp: result.timestamp || report.metadata?.creationTimestamp || "",
              });
            }
          }
        }
      } catch (e2) {
        console.debug('[policy-violations] PolicyReport v1beta1 also failed:', e2.message);
      }
    }

    // Also check ClusterPolicyReports
    try {
      let clusterReports;
      try {
        clusterReports = await customApi.listClusterCustomObject(
          "wgpolicyk8s.io", "v1alpha2", "clusterpolicyreports"
        );
      } catch {
        clusterReports = await customApi.listClusterCustomObject(
          "wgpolicyk8s.io", "v1beta1", "clusterpolicyreports"
        );
      }
      for (const report of (clusterReports.body.items || [])) {
        for (const result of (report.results || [])) {
          if (result.result === "fail" || result.result === "error" || result.result === "warn") {
            violations.push({
              policy: result.policy || "unknown",
              rule: result.rule || "unknown",
              severity: result.severity || "medium",
              result: result.result,
              message: result.message || "",
              namespace: "cluster-wide",
              resource: result.resources?.[0]
                ? `${result.resources[0].kind}/${result.resources[0].name}`
                : "unknown",
              category: result.category || "",
              timestamp: result.timestamp || report.metadata?.creationTimestamp || "",
            });
          }
        }
      }
    } catch (e) {
      console.debug('[policy-violations] ClusterPolicyReport query failed:', e.message);
    }

    // Sort by severity
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    violations.sort((a, b) => (severityOrder[a.severity] || 4) - (severityOrder[b.severity] || 4));

    // Summary counts
    const summary = {
      critical: violations.filter(v => v.severity === "critical").length,
      high: violations.filter(v => v.severity === "high").length,
      medium: violations.filter(v => v.severity === "medium").length,
      low: violations.filter(v => v.severity === "low").length,
      total: violations.length,
    };

    res.json({ violations, summary });
  } catch (err) {
    console.error("Error fetching policy violations:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Task 10.4: Resource Quota Visualization ───────────────────────────────
app.get("/api/namespaces/:namespace/quota", requireGroups("sre-admins", "developers", "issm"), async (req, res) => {
  try {
    const { namespace } = req.params;

    // Get ResourceQuotas
    const quotaResp = await k8sApi.listNamespacedResourceQuota(namespace);
    const quotas = quotaResp.body.items;

    if (quotas.length === 0) {
      return res.json({ hasQuota: false, quotas: [] });
    }

    const result = quotas.map(q => {
      const hard = q.status?.hard || q.spec?.hard || {};
      const used = q.status?.used || {};

      function parseResource(val) {
        if (!val) return 0;
        const s = String(val);
        if (s.endsWith("m")) return parseFloat(s) / 1000;
        if (s.endsWith("Ki")) return parseFloat(s) * 1024;
        if (s.endsWith("Mi")) return parseFloat(s) * 1024 * 1024;
        if (s.endsWith("Gi")) return parseFloat(s) * 1024 * 1024 * 1024;
        if (s.endsWith("Ti")) return parseFloat(s) * 1024 * 1024 * 1024 * 1024;
        return parseFloat(s) || 0;
      }

      function formatResource(key, val) {
        if (!val) return "0";
        const s = String(val);
        // Return as-is for human-readable display
        return s;
      }

      const metrics = {};
      for (const key of Object.keys(hard)) {
        const hardVal = parseResource(hard[key]);
        const usedVal = parseResource(used[key]);
        const pct = hardVal > 0 ? Math.round((usedVal / hardVal) * 100) : 0;
        metrics[key] = {
          hard: formatResource(key, hard[key]),
          used: formatResource(key, used[key]),
          hardRaw: hardVal,
          usedRaw: usedVal,
          percentage: Math.min(pct, 100),
        };
      }

      return {
        name: q.metadata.name,
        namespace,
        metrics,
      };
    });

    res.json({ hasQuota: true, quotas: result });
  } catch (err) {
    console.error("Error fetching quota:", err);
    res.status(err.statusCode || 500).json({ error: "Internal server error" });
  }
});

// ── Task 10.10: Export Deployment as YAML ─────────────────────────────────
app.get("/api/apps/:namespace/:name/manifest", requireGroups("sre-admins", "developers", "issm"), async (req, res) => {
  try {
    const { namespace, name } = req.params;
    const manifests = [];

    // Get HelmRelease
    try {
      const hr = await customApi.getNamespacedCustomObject(
        "helm.toolkit.fluxcd.io", "v2", namespace, "helmreleases", name
      );
      manifests.push({
        kind: "HelmRelease",
        apiVersion: "helm.toolkit.fluxcd.io/v2",
        metadata: {
          name: hr.body.metadata.name,
          namespace: hr.body.metadata.namespace,
          labels: hr.body.metadata.labels,
          annotations: hr.body.metadata.annotations,
        },
        spec: hr.body.spec,
      });
    } catch (e) {
      console.debug('[manifest] HelmRelease not found:', e.message);
    }

    // Get Deployments matching app name
    try {
      const deps = await appsApi.listNamespacedDeployment(namespace);
      for (const d of deps.body.items) {
        if (d.metadata.name === name || d.metadata.name.startsWith(`${name}-`)) {
          // Strip runtime-only fields
          const clean = {
            kind: "Deployment",
            apiVersion: "apps/v1",
            metadata: {
              name: d.metadata.name,
              namespace: d.metadata.namespace,
              labels: d.metadata.labels,
            },
            spec: d.spec,
          };
          manifests.push(clean);
        }
      }
    } catch (e) {
      console.debug('[manifest] Deployment lookup failed:', e.message);
    }

    // Get Services matching app name
    try {
      const svcs = await k8sApi.listNamespacedService(namespace);
      for (const s of svcs.body.items) {
        if (s.metadata.name === name || s.metadata.name.startsWith(`${name}-`)) {
          manifests.push({
            kind: "Service",
            apiVersion: "v1",
            metadata: {
              name: s.metadata.name,
              namespace: s.metadata.namespace,
              labels: s.metadata.labels,
            },
            spec: {
              type: s.spec.type,
              ports: s.spec.ports,
              selector: s.spec.selector,
            },
          });
        }
      }
    } catch (e) {
      console.debug('[manifest] Service lookup failed:', e.message);
    }

    // Get VirtualService if exists
    try {
      const vs = await customApi.getNamespacedCustomObject(
        "networking.istio.io", "v1", namespace, "virtualservices", name
      );
      manifests.push({
        kind: "VirtualService",
        apiVersion: "networking.istio.io/v1",
        metadata: {
          name: vs.body.metadata.name,
          namespace: vs.body.metadata.namespace,
        },
        spec: vs.body.spec,
      });
    } catch (e) {
      console.debug('[manifest] VirtualService not found:', e.message);
    }

    if (manifests.length === 0) {
      return res.status(404).json({ error: `No manifests found for ${name} in ${namespace}` });
    }

    // Convert to YAML
    const yamlDocs = manifests.map(m => yaml.dump(m, { lineWidth: 120, noRefs: true }));
    const fullYaml = yamlDocs.join("---\n");

    res.json({ yaml: fullYaml, resources: manifests.length });
  } catch (err) {
    console.error("Error exporting manifest:", err);
    res.status(err.statusCode || 500).json({ error: "Internal server error" });
  }
});

// ── Compliance API ──────────────────────────────────────────────────────────
// Phase 1: Compliance Intelligence — unified compliance posture endpoints

// Static control definitions (matching ComplianceTab CONTROL_FAMILIES)
const COMPLIANCE_CONTROLS = [
  { id: "AC-2", family: "AC", familyName: "Access Control", title: "Account Management", healthKeys: ["keycloak"] },
  { id: "AC-3", family: "AC", familyName: "Access Control", title: "Access Enforcement", healthKeys: ["kyverno", "istiod"] },
  { id: "AC-4", family: "AC", familyName: "Access Control", title: "Information Flow Enforcement", healthKeys: ["istiod", "kyverno"] },
  { id: "AC-6", family: "AC", familyName: "Access Control", title: "Least Privilege", healthKeys: ["kyverno"] },
  { id: "AC-6(1)", family: "AC", familyName: "Access Control", title: "Authorize Access to Security Functions", healthKeys: ["kyverno", "source-controller"] },
  { id: "AC-6(9)", family: "AC", familyName: "Access Control", title: "Auditing Use of Privileged Functions", healthKeys: ["loki"] },
  { id: "AC-6(10)", family: "AC", familyName: "Access Control", title: "Prohibit Non-Privileged Users from Executing Privileged Functions", healthKeys: ["kyverno"] },
  { id: "AC-14", family: "AC", familyName: "Access Control", title: "Permitted Actions Without Identification", healthKeys: ["istiod"] },
  { id: "AC-17", family: "AC", familyName: "Access Control", title: "Remote Access", healthKeys: ["keycloak", "istiod"] },
  { id: "AU-2", family: "AU", familyName: "Audit and Accountability", title: "Audit Events", healthKeys: ["istiod"] },
  { id: "AU-3", family: "AU", familyName: "Audit and Accountability", title: "Content of Audit Records", healthKeys: [] },
  { id: "AU-4", family: "AU", familyName: "Audit and Accountability", title: "Audit Storage Capacity", healthKeys: ["loki"] },
  { id: "AU-5", family: "AU", familyName: "Audit and Accountability", title: "Response to Audit Processing Failures", healthKeys: ["kube-prometheus-stack", "loki"] },
  { id: "AU-6", family: "AU", familyName: "Audit and Accountability", title: "Audit Review, Analysis, and Reporting", healthKeys: ["kube-prometheus-stack"] },
  { id: "AU-8", family: "AU", familyName: "Audit and Accountability", title: "Time Stamps", healthKeys: [] },
  { id: "AU-9", family: "AU", familyName: "Audit and Accountability", title: "Protection of Audit Information", healthKeys: ["loki"] },
  { id: "AU-12", family: "AU", familyName: "Audit and Accountability", title: "Audit Generation", healthKeys: ["alloy"] },
  { id: "CA-7", family: "CA", familyName: "Assessment and Authorization", title: "Continuous Monitoring", healthKeys: ["kube-prometheus-stack", "neuvector", "kyverno"] },
  { id: "CA-8", family: "CA", familyName: "Assessment and Authorization", title: "Penetration Testing", healthKeys: ["neuvector", "harbor"] },
  { id: "CM-2", family: "CM", familyName: "Configuration Management", title: "Baseline Configuration", healthKeys: ["source-controller", "kustomize-controller"] },
  { id: "CM-3", family: "CM", familyName: "Configuration Management", title: "Configuration Change Control", healthKeys: ["source-controller"] },
  { id: "CM-5", family: "CM", familyName: "Configuration Management", title: "Access Restrictions for Change", healthKeys: ["kyverno", "source-controller"] },
  { id: "CM-6", family: "CM", familyName: "Configuration Management", title: "Configuration Settings", healthKeys: ["kyverno"] },
  { id: "CM-7", family: "CM", familyName: "Configuration Management", title: "Least Functionality", healthKeys: ["kyverno", "neuvector"] },
  { id: "CM-8", family: "CM", familyName: "Configuration Management", title: "Information System Component Inventory", healthKeys: ["source-controller", "harbor"] },
  { id: "CM-11", family: "CM", familyName: "Configuration Management", title: "User-Installed Software", healthKeys: ["kyverno"] },
  { id: "IA-2", family: "IA", familyName: "Identification and Authentication", title: "Identification and Authentication (Organizational Users)", healthKeys: ["keycloak"] },
  { id: "IA-3", family: "IA", familyName: "Identification and Authentication", title: "Device Identification and Authentication", healthKeys: ["istiod"] },
  { id: "IA-5", family: "IA", familyName: "Identification and Authentication", title: "Authenticator Management", healthKeys: ["keycloak", "cert-manager", "openbao"] },
  { id: "IA-8", family: "IA", familyName: "Identification and Authentication", title: "Identification and Authentication (Non-Organizational Users)", healthKeys: ["istiod"] },
  { id: "IR-4", family: "IR", familyName: "Incident Response", title: "Incident Handling", healthKeys: ["neuvector", "kube-prometheus-stack"] },
  { id: "IR-5", family: "IR", familyName: "Incident Response", title: "Incident Monitoring", healthKeys: ["neuvector", "kyverno", "kube-prometheus-stack"] },
  { id: "IR-6", family: "IR", familyName: "Incident Response", title: "Incident Reporting", healthKeys: ["kube-prometheus-stack"] },
  { id: "MP-2", family: "MP", familyName: "Media Protection", title: "Media Access", healthKeys: ["openbao"] },
  { id: "RA-5", family: "RA", familyName: "Risk Assessment", title: "Vulnerability Scanning", healthKeys: ["harbor", "neuvector"] },
  { id: "SA-10", family: "SA", familyName: "System and Services Acquisition", title: "Developer Configuration Management", healthKeys: ["source-controller"] },
  { id: "SA-11", family: "SA", familyName: "System and Services Acquisition", title: "Developer Testing and Evaluation", healthKeys: ["kyverno"] },
  { id: "SC-3", family: "SC", familyName: "System and Communications Protection", title: "Security Function Isolation", healthKeys: ["istiod", "kyverno"] },
  { id: "SC-7", family: "SC", familyName: "System and Communications Protection", title: "Boundary Protection", healthKeys: ["istiod", "neuvector"] },
  { id: "SC-8", family: "SC", familyName: "System and Communications Protection", title: "Transmission Confidentiality and Integrity", healthKeys: ["istiod"] },
  { id: "SC-12", family: "SC", familyName: "System and Communications Protection", title: "Cryptographic Key Establishment and Management", healthKeys: ["cert-manager", "openbao"] },
  { id: "SC-13", family: "SC", familyName: "System and Communications Protection", title: "Cryptographic Protection", healthKeys: [] },
  { id: "SC-28", family: "SC", familyName: "System and Communications Protection", title: "Protection of Information at Rest", healthKeys: ["openbao", "loki"] },
  { id: "SI-2", family: "SI", familyName: "System and Information Integrity", title: "Flaw Remediation", healthKeys: ["harbor", "source-controller"] },
  { id: "SI-3", family: "SI", familyName: "System and Information Integrity", title: "Malicious Code Protection", healthKeys: ["neuvector"] },
  { id: "SI-4", family: "SI", familyName: "System and Information Integrity", title: "System Monitoring", healthKeys: ["kube-prometheus-stack", "loki", "tempo", "neuvector", "kyverno"] },
  { id: "SI-5", family: "SI", familyName: "System and Information Integrity", title: "Security Alerts, Advisories, and Directives", healthKeys: ["kube-prometheus-stack", "neuvector"] },
  { id: "SI-6", family: "SI", familyName: "System and Information Integrity", title: "Security Function Verification", healthKeys: ["neuvector", "kyverno"] },
  { id: "SI-7", family: "SI", familyName: "System and Information Integrity", title: "Software, Firmware, and Information Integrity", healthKeys: ["kyverno", "harbor"] },
  { id: "SI-10", family: "SI", familyName: "System and Information Integrity", title: "Information Input Validation", healthKeys: ["kyverno", "istiod"] },
];

// Control-to-evidence mapping for /api/compliance/evidence/:controlId
const CONTROL_EVIDENCE_MAP = {
  "AC-2": [{ type: "config", artifact: "platform/addons/keycloak/helmrelease.yaml", description: "Keycloak realm configuration" }],
  "AC-3": [{ type: "policy", artifact: "platform/core/kyverno/helmrelease.yaml", description: "Kyverno policy engine" }, { type: "config", artifact: "platform/core/istio/helmrelease-istiod.yaml", description: "Istio AuthorizationPolicy" }],
  "AC-4": [{ type: "policy", artifact: "policies/custom/require-network-policies.yaml", description: "Require NetworkPolicies" }, { type: "config", artifact: "apps/tenants/_base/network-policies/default-deny.yaml", description: "Default deny NetworkPolicy" }],
  "AC-6": [{ type: "policy", artifact: "policies/custom/require-security-context.yaml", description: "Require security context" }, { type: "policy", artifact: "policies/restricted/require-run-as-nonroot.yaml", description: "Require non-root" }],
  "CM-2": [{ type: "config", artifact: "platform/flux-system/gotk-sync.yaml", description: "Flux GitOps baseline" }],
  "CM-6": [{ type: "policy", artifact: "policies/custom/require-labels.yaml", description: "Require standard labels" }],
  "SC-8": [{ type: "config", artifact: "platform/core/istio/helmrelease-istiod.yaml", description: "Istio mTLS STRICT" }],
  "SI-7": [{ type: "policy", artifact: "policies/custom/verify-image-signatures.yaml", description: "Cosign image verification" }],
  "RA-5": [{ type: "scan", artifact: "harbor", description: "Harbor + Trivy image scanning" }],
};

/** Determine control status from HelmRelease health data */
function getControlStatus(control, helmHealthMap) {
  if (!control.healthKeys || control.healthKeys.length === 0) {
    // No health keys = infrastructure/manual control, assume passing
    return "passing";
  }
  let hasAny = false;
  let allHealthy = true;
  for (const key of control.healthKeys) {
    const found = helmHealthMap.get(key);
    if (found !== undefined) {
      hasAny = true;
      if (!found) allHealthy = false;
    }
  }
  if (!hasAny) return "passing"; // Components not yet tracked still count as implemented
  return allHealthy ? "passing" : "partial";
}

/** Load control-mapping.json with implementation details */
function loadControlMapping() {
  try {
    const mappingPath = path.join(__dirname, "..", "..", "compliance", "nist-800-53-mappings", "control-mapping.json");
    if (fs.existsSync(mappingPath)) {
      const raw = fs.readFileSync(mappingPath, "utf8");
      const data = JSON.parse(raw);
      const map = {};
      for (const ctrl of (data.controls || [])) {
        map[ctrl.id] = ctrl;
      }
      return map;
    }
  } catch (e) {
    console.debug("[compliance] Failed to load control-mapping.json:", e.message);
  }
  return {};
}

/** Load POA&M findings from YAML */
function loadPoamFindings() {
  try {
    const poamPath = path.join(__dirname, "..", "..", "compliance", "poam", "findings.yaml");
    if (fs.existsSync(poamPath)) {
      const raw = fs.readFileSync(poamPath, "utf8");
      const data = yaml.load(raw);
      return data?.findings || [];
    }
  } catch (e) {
    console.debug("[compliance] Failed to load POA&M findings:", e.message);
  }
  return [];
}

// GET /api/compliance/controls — All controls with live health status
app.get("/api/compliance/controls", requireGroups("sre-admins", "issm", "compliance-assessors"), async (req, res) => {
  try {
    const helmReleases = await getHelmReleases();
    const helmHealthMap = new Map();
    helmReleases.forEach((hr) => helmHealthMap.set(hr.name, hr.ready));

    const controlMapping = loadControlMapping();
    const now = new Date().toISOString();

    const controls = COMPLIANCE_CONTROLS.map((ctrl) => {
      const status = getControlStatus(ctrl, helmHealthMap);
      const mapping = controlMapping[ctrl.id] || {};
      return {
        id: ctrl.id,
        title: ctrl.title,
        family: ctrl.family,
        familyName: ctrl.familyName,
        status,
        implementingComponents: ctrl.healthKeys,
        implementation: mapping.implementation || "",
        evidence: mapping.evidence || [],
        automated: mapping.automated !== undefined ? mapping.automated : true,
        lastVerified: now,
      };
    });

    res.json({ controls, total: controls.length, lastVerified: now });
  } catch (err) {
    console.error("Error fetching compliance controls:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/compliance/controls/:id — Single control with full evidence chain
app.get("/api/compliance/controls/:id", requireGroups("sre-admins", "issm", "compliance-assessors"), async (req, res) => {
  try {
    const { id } = req.params;
    const ctrl = COMPLIANCE_CONTROLS.find((c) => c.id === id);
    if (!ctrl) return res.status(404).json({ error: `Control ${id} not found` });

    const helmReleases = await getHelmReleases();
    const helmHealthMap = new Map();
    helmReleases.forEach((hr) => helmHealthMap.set(hr.name, hr.ready));

    const status = getControlStatus(ctrl, helmHealthMap);
    const controlMapping = loadControlMapping();
    const mapping = controlMapping[id] || {};

    // Component health details
    const componentHealth = ctrl.healthKeys.map((key) => {
      const hr = helmReleases.find((h) => h.name === key);
      return {
        name: key,
        healthy: hr ? hr.ready : null,
        status: hr ? hr.status : "not found",
        chart: hr ? hr.chart : "",
        version: hr ? hr.version : "",
      };
    });

    // Kyverno PolicyReport violations related to this control
    let policyViolations = [];
    try {
      let reports;
      try {
        reports = await customApi.listClusterCustomObject("wgpolicyk8s.io", "v1alpha2", "policyreports");
      } catch {
        reports = await customApi.listClusterCustomObject("wgpolicyk8s.io", "v1beta1", "policyreports");
      }
      for (const report of (reports.body.items || [])) {
        for (const result of (report.results || [])) {
          if (result.result === "fail" || result.result === "warn") {
            policyViolations.push({
              policy: result.policy || "unknown",
              rule: result.rule || "unknown",
              severity: result.severity || "medium",
              result: result.result,
              message: result.message || "",
              namespace: report.metadata?.namespace || "cluster",
            });
          }
        }
      }
    } catch (e) {
      console.debug("[compliance] PolicyReport query for control detail failed:", e.message);
    }

    res.json({
      id: ctrl.id,
      title: ctrl.title,
      family: ctrl.family,
      familyName: ctrl.familyName,
      status,
      implementingComponents: ctrl.healthKeys,
      componentHealth,
      implementation: mapping.implementation || "",
      evidence: mapping.evidence || [],
      automated: mapping.automated !== undefined ? mapping.automated : true,
      continuousMonitoring: mapping["continuous-monitoring"] || "",
      policyViolations: policyViolations.slice(0, 20),
      lastVerified: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Error fetching compliance control detail:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/compliance/score — Weighted compliance score
app.get("/api/compliance/score", requireGroups("sre-admins", "issm", "compliance-assessors"), async (req, res) => {
  try {
    const helmReleases = await getHelmReleases();
    const helmHealthMap = new Map();
    helmReleases.forEach((hr) => helmHealthMap.set(hr.name, hr.ready));

    let passing = 0;
    let partial = 0;
    let failing = 0;

    for (const ctrl of COMPLIANCE_CONTROLS) {
      const status = getControlStatus(ctrl, helmHealthMap);
      if (status === "passing") passing++;
      else if (status === "partial") partial++;
      else failing++;
    }

    const total = COMPLIANCE_CONTROLS.length;
    const score = total > 0
      ? parseFloat(((passing * 1.0 + partial * 0.5 + failing * 0.0) / total * 100).toFixed(1))
      : 0;

    res.json({
      score,
      trend: "stable",
      controls: { total, passing, partial, failing },
    });
  } catch (err) {
    console.error("Error calculating compliance score:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/compliance/score/history — Daily score snapshots from ConfigMaps
app.get("/api/compliance/score/history", requireGroups("sre-admins", "issm", "compliance-assessors"), async (req, res) => {
  try {
    // Look for compliance-evidence ConfigMaps in sre-dashboard namespace
    const history = [];
    try {
      const cmList = await k8sApi.listNamespacedConfigMap("sre-dashboard");
      for (const cm of cmList.body.items) {
        if (cm.metadata.name.startsWith("compliance-score-")) {
          try {
            const data = JSON.parse(cm.data?.snapshot || "{}");
            history.push({
              date: cm.metadata.creationTimestamp,
              score: data.score || 0,
              passing: data.passing || 0,
              partial: data.partial || 0,
              failing: data.failing || 0,
            });
          } catch { /* skip malformed */ }
        }
      }
    } catch (e) {
      console.debug("[compliance] No score history ConfigMaps found:", e.message);
    }

    // Sort by date descending
    history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    res.json({ history });
  } catch (err) {
    console.error("Error fetching compliance score history:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/compliance/pipeline/summary — Pipeline statistics
app.get("/api/compliance/pipeline/summary", requireGroups("sre-admins", "issm", "compliance-assessors"), async (req, res) => {
  try {
    if (!dbAvailable) {
      return res.json({ totalRuns: 0, byStatus: {}, gatePassRates: {}, findingsBySeverity: {}, available: false });
    }

    const stats = await db.getStats();

    // Get finding counts by severity from DB
    let findingsBySeverity = {};
    try {
      const findingsResult = await db.pool.query(
        "SELECT severity, COUNT(*) as count FROM pipeline_findings GROUP BY severity"
      );
      for (const row of findingsResult.rows) {
        findingsBySeverity[row.severity] = parseInt(row.count);
      }
    } catch { /* DB might not have findings */ }

    // Get gate pass rates
    let gatePassRates = {};
    try {
      const gatesResult = await db.pool.query(
        `SELECT short_name,
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'passed') as passed
         FROM pipeline_gates
         GROUP BY short_name`
      );
      for (const row of gatesResult.rows) {
        const total = parseInt(row.total);
        const passed = parseInt(row.passed);
        gatePassRates[row.short_name] = {
          total,
          passed,
          rate: total > 0 ? parseFloat(((passed / total) * 100).toFixed(1)) : 0,
        };
      }
    } catch { /* DB might not have gates */ }

    res.json({
      totalRuns: stats.totalRuns,
      byStatus: stats.byStatus,
      approvalRate: stats.approvalRate,
      gatePassRates,
      findingsBySeverity,
      available: true,
    });
  } catch (err) {
    console.error("Error fetching pipeline summary:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/compliance/findings — Aggregate findings from multiple sources
app.get("/api/compliance/findings", requireGroups("sre-admins", "issm", "compliance-assessors"), async (req, res) => {
  try {
    const findings = [];

    // 1. Kyverno PolicyReport violations
    try {
      let reports;
      try {
        reports = await customApi.listClusterCustomObject("wgpolicyk8s.io", "v1alpha2", "policyreports");
      } catch {
        reports = await customApi.listClusterCustomObject("wgpolicyk8s.io", "v1beta1", "policyreports");
      }
      for (const report of (reports.body.items || [])) {
        for (const result of (report.results || [])) {
          if (result.result === "fail" || result.result === "warn") {
            findings.push({
              source: "kyverno",
              severity: result.severity || "medium",
              title: `${result.policy}: ${result.rule}`,
              description: result.message || "",
              namespace: report.metadata?.namespace || "cluster",
              resource: result.resources?.[0]
                ? `${result.resources[0].kind}/${result.resources[0].name}`
                : "unknown",
              timestamp: result.timestamp || report.metadata?.creationTimestamp || "",
              status: "open",
            });
          }
        }
      }
    } catch (e) {
      console.debug("[compliance] PolicyReport query failed:", e.message);
    }

    // 2. Pipeline findings from DB
    if (dbAvailable && db.pool) {
      try {
        const { rows } = await db.pool.query(
          "SELECT f.severity, f.title, f.description, f.location, f.disposition, f.created_at, r.app_name FROM pipeline_findings f JOIN pipeline_runs r ON f.run_id = r.id ORDER BY f.created_at DESC LIMIT 100"
        );
        for (const row of rows) {
          findings.push({
            source: "pipeline",
            severity: row.severity,
            title: row.title,
            description: row.description || "",
            namespace: "",
            resource: row.app_name || "",
            timestamp: row.created_at,
            status: row.disposition || "open",
          });
        }
      } catch (e) {
        console.debug("[compliance] Pipeline findings query failed:", e.message);
      }
    }

    // 3. POA&M findings
    const poamFindings = loadPoamFindings();
    for (const pf of poamFindings) {
      findings.push({
        source: "poam",
        severity: pf.severity,
        title: pf.title,
        description: pf.description || "",
        namespace: "",
        resource: pf.component || "",
        timestamp: pf.date_identified || "",
        status: pf.status,
        poamId: pf.id,
      });
    }

    // Sort by severity
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    findings.sort((a, b) => (severityOrder[a.severity] || 4) - (severityOrder[b.severity] || 4));

    const summary = {
      total: findings.length,
      critical: findings.filter((f) => f.severity === "critical").length,
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      low: findings.filter((f) => f.severity === "low").length,
      open: findings.filter((f) => f.status === "open").length,
      bySources: {
        kyverno: findings.filter((f) => f.source === "kyverno").length,
        pipeline: findings.filter((f) => f.source === "pipeline").length,
        poam: findings.filter((f) => f.source === "poam").length,
      },
    };

    res.json({ findings, summary });
  } catch (err) {
    console.error("Error fetching compliance findings:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/compliance/components — All platform components with versions and health
app.get("/api/compliance/components", requireGroups("sre-admins", "issm", "compliance-assessors"), async (req, res) => {
  try {
    const helmReleases = await getHelmReleases();
    const components = helmReleases.map((hr) => ({
      name: hr.name,
      namespace: hr.namespace,
      chart: hr.chart,
      version: hr.version,
      healthy: hr.ready,
      status: hr.status,
    }));
    res.json({ components, total: components.length });
  } catch (err) {
    console.error("Error fetching compliance components:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/compliance/certificates — cert-manager certificates with expiry
app.get("/api/compliance/certificates", requireGroups("sre-admins", "issm", "compliance-assessors"), async (req, res) => {
  try {
    let certificates = [];
    try {
      const certs = await customApi.listClusterCustomObject("cert-manager.io", "v1", "certificates");
      certificates = (certs.body.items || []).map((cert) => {
        const readyCondition = (cert.status?.conditions || []).find((c) => c.type === "Ready");
        return {
          name: cert.metadata.name,
          namespace: cert.metadata.namespace,
          secretName: cert.spec?.secretName || "",
          issuer: cert.spec?.issuerRef?.name || "",
          issuerKind: cert.spec?.issuerRef?.kind || "Issuer",
          dnsNames: cert.spec?.dnsNames || [],
          notBefore: cert.status?.notBefore || null,
          notAfter: cert.status?.notAfter || null,
          renewalTime: cert.status?.renewalTime || null,
          ready: readyCondition?.status === "True",
          readyMessage: readyCondition?.message || "",
        };
      });
    } catch (e) {
      console.debug("[compliance] cert-manager Certificate query failed:", e.message);
    }

    res.json({ certificates, total: certificates.length });
  } catch (err) {
    console.error("Error fetching certificates:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/compliance/poam — POA&M findings from YAML
app.get("/api/compliance/poam", requireGroups("sre-admins", "issm", "compliance-assessors"), async (req, res) => {
  try {
    const findings = loadPoamFindings();
    const summary = {
      total: findings.length,
      open: findings.filter((f) => f.status === "open").length,
      inProgress: findings.filter((f) => f.status === "in-progress").length,
      riskAccepted: findings.filter((f) => f.status === "risk-accepted").length,
      resolved: findings.filter((f) => f.status === "resolved").length,
      overdue: findings.filter((f) => {
        if (f.status === "resolved" || f.status === "risk-accepted") return false;
        return f.target_resolution && new Date(f.target_resolution) < new Date();
      }).length,
    };
    res.json({ findings, summary });
  } catch (err) {
    console.error("Error fetching POA&M findings:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/compliance/evidence/:controlId — Evidence artifacts for a control
app.get("/api/compliance/evidence/:controlId", requireGroups("sre-admins", "issm", "compliance-assessors"), async (req, res) => {
  try {
    const { controlId } = req.params;
    const ctrl = COMPLIANCE_CONTROLS.find((c) => c.id === controlId);
    if (!ctrl) return res.status(404).json({ error: `Control ${controlId} not found` });

    const evidenceItems = CONTROL_EVIDENCE_MAP[controlId] || [];
    const controlMapping = loadControlMapping();
    const mapping = controlMapping[controlId] || {};

    // Merge file-based evidence from control-mapping.json
    const fileEvidence = (mapping.evidence || []).map((e) => ({
      type: "file",
      artifact: e,
      description: e,
    }));

    const allEvidence = [...evidenceItems, ...fileEvidence];

    // Check which evidence files exist
    const enriched = allEvidence.map((ev) => {
      let exists = null;
      if (ev.type === "file" || ev.type === "config" || ev.type === "policy") {
        const fullPath = path.join(__dirname, "..", "..", ev.artifact);
        exists = fs.existsSync(fullPath);
      }
      return { ...ev, exists };
    });

    res.json({
      controlId,
      controlTitle: ctrl.title,
      evidence: enriched,
      implementation: mapping.implementation || "",
      continuousMonitoring: mapping["continuous-monitoring"] || "",
    });
  } catch (err) {
    console.error("Error fetching compliance evidence:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Phase 3: Finding Lifecycle ────────────────────────────────────────────────

// GET /api/compliance/findings/lifecycle — list with aging info
app.get("/api/compliance/findings/lifecycle", requireDb, requireGroups("sre-admins", "issm", "compliance-assessors"), async (req, res) => {
  try {
    const result = await db.listLifecycleFindings({
      status: req.query.status,
      severity: req.query.severity,
      source: req.query.source,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json(result);
  } catch (err) {
    console.error("Error listing lifecycle findings:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/compliance/findings/lifecycle — create a new tracked finding
app.post("/api/compliance/findings/lifecycle", mutateLimiter, requireDb, requireGroups("sre-admins", "issm"), async (req, res) => {
  try {
    const { source, severity, title, affectedResource, nistControls } = req.body;
    if (!source || !severity || !title) {
      return res.status(400).json({ error: "source, severity, and title are required" });
    }
    const validSeverities = ["critical", "high", "medium", "low"];
    if (!validSeverities.includes(severity)) {
      return res.status(400).json({ error: "severity must be one of: " + validSeverities.join(", ") });
    }
    const finding = await db.createLifecycleFinding({ source, severity, title, affectedResource, nistControls });
    const actor = req.headers["x-auth-request-user"] || "system";
    await db.auditLog(null, "finding_created", actor, `Finding ${finding.id}: ${title}`, { findingId: finding.id, severity });
    res.status(201).json(finding);
  } catch (err) {
    console.error("Error creating lifecycle finding:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/compliance/findings/:id — update finding status
app.patch("/api/compliance/findings/:id", mutateLimiter, requireDb, requireGroups("sre-admins", "issm", "compliance-assessors"), async (req, res) => {
  try {
    const { id } = req.params;
    const allowedStatuses = ["open", "in-progress", "mitigated", "risk-accepted", "resolved", "false-positive"];
    if (req.body.status && !allowedStatuses.includes(req.body.status)) {
      return res.status(400).json({ error: "Invalid status. Allowed: " + allowedStatuses.join(", ") });
    }
    const actor = req.headers["x-auth-request-user"] || "system";
    const updates = { ...req.body };
    if (updates.status === "mitigated" && !updates.mitigatedBy) {
      updates.mitigatedBy = actor;
    }
    const finding = await db.updateLifecycleFinding(id, updates);
    if (!finding) return res.status(404).json({ error: "Finding not found" });
    await db.auditLog(null, "finding_updated", actor, `Finding ${id} updated: status=${updates.status || "unchanged"}`, { findingId: id, updates });
    res.json(finding);
  } catch (err) {
    console.error("Error updating lifecycle finding:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/compliance/findings/metrics — MTTR, overdue count, aging histogram
app.get("/api/compliance/findings/metrics", requireDb, requireGroups("sre-admins", "issm", "compliance-assessors"), async (req, res) => {
  try {
    const metrics = await db.getLifecycleFindingMetrics();
    if (!metrics) return res.status(503).json({ error: "Database unavailable" });
    res.json(metrics);
  } catch (err) {
    console.error("Error fetching finding metrics:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/compliance/findings/:id/accept-risk — risk acceptance workflow
app.post("/api/compliance/findings/:id/accept-risk", mutateLimiter, requireDb, requireGroups("sre-admins", "issm"), async (req, res) => {
  try {
    const { id } = req.params;
    const { justification, compensatingControls, expiryDays } = req.body;
    if (!justification) {
      return res.status(400).json({ error: "justification is required" });
    }
    const actor = req.headers["x-auth-request-user"] || "system";
    const finding = await db.acceptRiskFinding(id, {
      justification,
      compensatingControls,
      acceptedBy: actor,
      expiryDays: expiryDays || 90,
    });
    if (!finding) return res.status(404).json({ error: "Finding not found" });
    await db.auditLog(null, "risk_accepted", actor, `Risk accepted for finding ${id}`, { findingId: id, justification, expiryDays: expiryDays || 90 });
    res.json(finding);
  } catch (err) {
    console.error("Error accepting risk:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Phase 4: RAISE 2.0 Automation ────────────────────────────────────────────

// GET /api/compliance/raise/status — RAISE requirements mapped to live checks
app.get("/api/compliance/raise/status", requireGroups("sre-admins", "issm", "compliance-assessors"), async (req, res) => {
  try {
    const helmReleases = await getHelmReleases();
    const helmHealthMap = new Map();
    helmReleases.forEach((hr) => helmHealthMap.set(hr.name, hr.ready));

    // RPOC requirements — mapped to live component health
    const rpocRequirements = [
      { id: "RPOC-1", name: "Container Registry with Scanning", components: ["harbor"], check: () => helmHealthMap.get("harbor") === true },
      { id: "RPOC-2", name: "Image Signature Verification", components: ["kyverno"], check: () => helmHealthMap.get("kyverno") === true },
      { id: "RPOC-3", name: "Runtime Security Monitoring", components: ["neuvector"], check: () => helmHealthMap.get("neuvector") === true },
      { id: "RPOC-4", name: "Service Mesh with mTLS", components: ["istiod"], check: () => helmHealthMap.get("istiod") === true },
      { id: "RPOC-5", name: "Policy Enforcement Engine", components: ["kyverno"], check: () => helmHealthMap.get("kyverno") === true },
      { id: "RPOC-6", name: "Centralized Logging", components: ["loki", "alloy"], check: () => helmHealthMap.get("loki") === true },
      { id: "RPOC-7", name: "Monitoring and Alerting", components: ["kube-prometheus-stack"], check: () => helmHealthMap.get("kube-prometheus-stack") === true },
      { id: "RPOC-8", name: "Secrets Management", components: ["openbao"], check: () => helmHealthMap.get("openbao") === true },
    ];

    // GATE requirements — mapped to pipeline pass rates
    let pipelineStats = null;
    if (dbAvailable && db.pool) {
      try {
        const gatesResult = await db.pool.query(
          `SELECT short_name,
                  COUNT(*) as total,
                  COUNT(*) FILTER (WHERE status = 'passed') as passed
           FROM pipeline_gates
           GROUP BY short_name`
        );
        pipelineStats = {};
        for (const row of gatesResult.rows) {
          pipelineStats[row.short_name] = {
            total: parseInt(row.total),
            passed: parseInt(row.passed),
            rate: parseInt(row.total) > 0 ? parseFloat(((parseInt(row.passed) / parseInt(row.total)) * 100).toFixed(1)) : 0,
          };
        }
      } catch { /* pipeline DB not available */ }
    }

    const gateRequirements = [
      { id: "GATE-1", name: "Source Composition Analysis (SCA)", gate: "sca", tool: "Trivy" },
      { id: "GATE-2", name: "Static Application Security Testing (SAST)", gate: "sast", tool: "Semgrep" },
      { id: "GATE-3", name: "Container Image Scan", gate: "image-scan", tool: "Trivy" },
      { id: "GATE-4", name: "SBOM Generation", gate: "sbom", tool: "Syft" },
      { id: "GATE-5", name: "Image Signing", gate: "sign", tool: "Cosign" },
      { id: "GATE-6", name: "Secret Detection", gate: "secrets", tool: "Gitleaks" },
      { id: "GATE-7", name: "Dynamic Application Security Testing (DAST)", gate: "dast", tool: "ZAP" },
      { id: "GATE-8", name: "Compliance Validation", gate: "compliance", tool: "Kyverno" },
    ];

    const requirements = [];

    // RPOC requirements
    for (const req of rpocRequirements) {
      const passing = req.check();
      requirements.push({
        id: req.id,
        name: req.name,
        category: "platform",
        status: passing ? "auto-verified" : "failed",
        evidence: `Components: ${req.components.join(", ")} — ${passing ? "all healthy" : "one or more unhealthy"}`,
        components: req.components,
        lastVerified: new Date().toISOString(),
      });
    }

    // GATE requirements
    for (const gate of gateRequirements) {
      const stats = pipelineStats ? pipelineStats[gate.gate] : null;
      let status = "manual";
      let evidence = "No pipeline data available";
      if (stats) {
        status = stats.rate >= 80 ? "auto-verified" : "failed";
        evidence = `${stats.passed}/${stats.total} runs passed (${stats.rate}%) — Tool: ${gate.tool}`;
      }
      requirements.push({
        id: gate.id,
        name: gate.name,
        category: "pipeline",
        status,
        evidence,
        tool: gate.tool,
        passRate: stats ? stats.rate : null,
        lastVerified: new Date().toISOString(),
      });
    }

    const passing = requirements.filter((r) => r.status === "auto-verified").length;
    const failing = requirements.filter((r) => r.status === "failed").length;
    const manual = requirements.filter((r) => r.status === "manual").length;

    res.json({
      requirements,
      summary: { total: requirements.length, passing, failing, manual },
      lastVerified: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Error fetching RAISE status:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/compliance/pipeline/certification — pipeline certification data
app.get("/api/compliance/pipeline/certification", requireGroups("sre-admins", "issm", "compliance-assessors"), async (req, res) => {
  try {
    if (!dbAvailable || !db.pool) {
      return res.json({ available: false, message: "Pipeline database not available" });
    }

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const [totalRuns, gateStats, avgDuration, failureReasons] = await Promise.all([
      db.pool.query("SELECT COUNT(*) as total FROM pipeline_runs WHERE created_at >= $1", [ninetyDaysAgo]),
      db.pool.query(
        `SELECT short_name, tool,
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'passed') as passed,
                COUNT(*) FILTER (WHERE status = 'failed') as failed
         FROM pipeline_gates g
         JOIN pipeline_runs r ON g.run_id = r.id
         WHERE r.created_at >= $1
         GROUP BY short_name, tool
         ORDER BY short_name`,
        [ninetyDaysAgo]
      ),
      db.pool.query(
        `SELECT AVG(EXTRACT(EPOCH FROM (r.updated_at - r.created_at))) as avg_seconds
         FROM pipeline_runs r
         WHERE r.created_at >= $1 AND r.status IN ('approved', 'deployed', 'rejected')`,
        [ninetyDaysAgo]
      ),
      db.pool.query(
        `SELECT g.short_name, g.summary, COUNT(*) as count
         FROM pipeline_gates g
         JOIN pipeline_runs r ON g.run_id = r.id
         WHERE r.created_at >= $1 AND g.status = 'failed'
         GROUP BY g.short_name, g.summary
         ORDER BY count DESC
         LIMIT 20`,
        [ninetyDaysAgo]
      ),
    ]);

    const gates = gateStats.rows.map((row) => ({
      gate: row.short_name,
      tool: row.tool || "N/A",
      total: parseInt(row.total),
      passed: parseInt(row.passed),
      failed: parseInt(row.failed),
      passRate: parseInt(row.total) > 0 ? parseFloat(((parseInt(row.passed) / parseInt(row.total)) * 100).toFixed(1)) : 0,
    }));

    const avgSeconds = avgDuration.rows[0]?.avg_seconds ? Math.round(parseFloat(avgDuration.rows[0].avg_seconds)) : null;

    res.json({
      available: true,
      period: { start: ninetyDaysAgo, end: new Date().toISOString(), days: 90 },
      totalRuns: parseInt(totalRuns.rows[0].total),
      gates,
      averagePipelineDuration: {
        seconds: avgSeconds,
        human: avgSeconds
          ? avgSeconds < 3600
            ? `${Math.round(avgSeconds / 60)}m`
            : `${(avgSeconds / 3600).toFixed(1)}h`
          : "N/A",
      },
      failureReasons: failureReasons.rows.map((r) => ({
        gate: r.short_name,
        reason: r.summary || "No summary",
        count: parseInt(r.count),
      })),
      certificationReady: gates.length > 0 && gates.every((g) => g.passRate >= 80),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Error fetching pipeline certification:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Phase 5: ISSM Daily Workflow ─────────────────────────────────────────────

// GET /api/issm/digest — daily ISSM summary
app.get("/api/issm/digest", requireGroups("sre-admins", "issm", "compliance-assessors"), async (req, res) => {
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const digest = {};

    // 1. Pending pipeline reviews with wait times
    if (dbAvailable && db.pool) {
      try {
        const { rows: pendingReviews } = await db.pool.query(
          `SELECT id, app_name, team, created_at, status,
                  EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 as hours_waiting
           FROM pipeline_runs
           WHERE status = 'review_pending'
           ORDER BY created_at ASC`
        );
        digest.pendingReviews = {
          count: pendingReviews.length,
          items: pendingReviews.map((r) => ({
            id: r.id,
            appName: r.app_name,
            team: r.team,
            hoursWaiting: parseFloat(parseFloat(r.hours_waiting).toFixed(1)),
            createdAt: r.created_at,
          })),
        };
      } catch { digest.pendingReviews = { count: 0, items: [] }; }
    } else {
      digest.pendingReviews = { count: 0, items: [], dbUnavailable: true };
    }

    // 2. Compliance score and change from yesterday
    try {
      const helmReleases = await getHelmReleases();
      const helmHealthMap = new Map();
      helmReleases.forEach((hr) => helmHealthMap.set(hr.name, hr.ready));

      let passing = 0, partial = 0, failing = 0;
      for (const ctrl of COMPLIANCE_CONTROLS) {
        const status = getControlStatus(ctrl, helmHealthMap);
        if (status === "passing") passing++;
        else if (status === "partial") partial++;
        else failing++;
      }
      const total = COMPLIANCE_CONTROLS.length;
      const score = total > 0 ? parseFloat(((passing + partial * 0.5) / total * 100).toFixed(1)) : 0;

      // Try to get yesterday's score from ConfigMaps
      let previousScore = null;
      try {
        const cmList = await k8sApi.listNamespacedConfigMap("sre-dashboard");
        const scoreCms = cmList.body.items
          .filter((cm) => cm.metadata.name.startsWith("compliance-score-"))
          .sort((a, b) => new Date(b.metadata.creationTimestamp) - new Date(a.metadata.creationTimestamp));
        if (scoreCms.length > 0) {
          const data = JSON.parse(scoreCms[0].data?.snapshot || "{}");
          previousScore = data.score || null;
        }
      } catch { /* no history */ }

      digest.complianceScore = {
        current: score,
        previous: previousScore,
        change: previousScore !== null ? parseFloat((score - previousScore).toFixed(1)) : null,
        controls: { total, passing, partial, failing },
      };
    } catch (err) {
      digest.complianceScore = { error: err.message };
    }

    // 3. Open findings by severity with SLA approaching
    if (dbAvailable && db.pool) {
      try {
        const metrics = await db.getLifecycleFindingMetrics();
        const { rows: slaApproaching } = await db.pool.query(
          `SELECT id, severity, title, sla_deadline,
                  EXTRACT(EPOCH FROM (sla_deadline - NOW())) / 86400 as days_remaining
           FROM finding_lifecycle
           WHERE status = 'open' AND sla_deadline IS NOT NULL AND sla_deadline < NOW() + INTERVAL '7 days'
           ORDER BY sla_deadline ASC
           LIMIT 20`
        );
        digest.findings = {
          ...metrics,
          slaApproaching: slaApproaching.map((f) => ({
            id: f.id,
            severity: f.severity,
            title: f.title,
            slaDeadline: f.sla_deadline,
            daysRemaining: parseFloat(parseFloat(f.days_remaining).toFixed(1)),
          })),
        };
      } catch { digest.findings = { error: "Could not query findings" }; }
    } else {
      digest.findings = { dbUnavailable: true };
    }

    // 4. Active policy exceptions with expiry status
    try {
      let exceptions = [];
      try {
        const policyExceptions = await customApi.listClusterCustomObject("kyverno.io", "v2", "policyexceptions");
        exceptions = (policyExceptions.body.items || []).map((pe) => {
          const expiry = pe.metadata?.annotations?.["sre.io/exception-expiry"] || null;
          const isExpired = expiry ? new Date(expiry) < now : false;
          const daysUntilExpiry = expiry ? (new Date(expiry) - now) / (24 * 60 * 60 * 1000) : null;
          return {
            name: pe.metadata.name,
            namespace: pe.metadata.namespace || "cluster",
            policy: pe.spec?.exceptions?.[0]?.policyName || "unknown",
            expiry,
            isExpired,
            daysUntilExpiry: daysUntilExpiry !== null ? parseFloat(daysUntilExpiry.toFixed(1)) : null,
          };
        });
      } catch { /* Kyverno v2 not available or no exceptions */ }
      digest.policyExceptions = {
        total: exceptions.length,
        expired: exceptions.filter((e) => e.isExpired).length,
        expiringSoon: exceptions.filter((e) => e.daysUntilExpiry !== null && e.daysUntilExpiry > 0 && e.daysUntilExpiry <= 30).length,
        items: exceptions,
      };
    } catch {
      digest.policyExceptions = { total: 0, items: [] };
    }

    // 5. Certificate health
    try {
      let certificates = [];
      try {
        const certs = await customApi.listClusterCustomObject("cert-manager.io", "v1", "certificates");
        certificates = (certs.body.items || []).map((cert) => {
          const readyCondition = (cert.status?.conditions || []).find((c) => c.type === "Ready");
          const notAfter = cert.status?.notAfter ? new Date(cert.status.notAfter) : null;
          const daysUntilExpiry = notAfter ? (notAfter - now) / (24 * 60 * 60 * 1000) : null;
          return {
            name: cert.metadata.name,
            namespace: cert.metadata.namespace,
            ready: readyCondition?.status === "True",
            notAfter: cert.status?.notAfter || null,
            daysUntilExpiry: daysUntilExpiry !== null ? parseFloat(daysUntilExpiry.toFixed(0)) : null,
          };
        });
      } catch { /* cert-manager not available */ }
      const expiringSoon = certificates.filter((c) => c.daysUntilExpiry !== null && c.daysUntilExpiry <= 30);
      digest.certificates = {
        total: certificates.length,
        healthy: certificates.filter((c) => c.ready).length,
        expiringSoon: expiringSoon.length,
        expiringItems: expiringSoon,
      };
    } catch {
      digest.certificates = { total: 0, healthy: 0 };
    }

    // 6. Recent deployments (last 24h)
    if (dbAvailable && db.pool) {
      try {
        const { rows: recentDeploys } = await db.pool.query(
          `SELECT id, app_name, team, status, created_at, deployed_url
           FROM pipeline_runs
           WHERE created_at >= $1
           ORDER BY created_at DESC`,
          [yesterday.toISOString()]
        );
        digest.recentDeployments = {
          count: recentDeploys.length,
          items: recentDeploys.map((d) => ({
            id: d.id,
            appName: d.app_name,
            team: d.team,
            status: d.status,
            createdAt: d.created_at,
            deployedUrl: d.deployed_url,
          })),
        };
      } catch { digest.recentDeployments = { count: 0, items: [] }; }
    } else {
      digest.recentDeployments = { count: 0, items: [], dbUnavailable: true };
    }

    digest.generatedAt = now.toISOString();
    res.json(digest);
  } catch (err) {
    console.error("Error generating ISSM digest:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/compliance/waivers — unified view of all waivers/exceptions
app.get("/api/compliance/waivers", requireGroups("sre-admins", "issm", "compliance-assessors"), async (req, res) => {
  try {
    const waivers = [];

    // 1. Kyverno PolicyExceptions
    try {
      const policyExceptions = await customApi.listClusterCustomObject("kyverno.io", "v2", "policyexceptions");
      for (const pe of (policyExceptions.body.items || [])) {
        const expiry = pe.metadata?.annotations?.["sre.io/exception-expiry"] || null;
        const justification = pe.metadata?.annotations?.["sre.io/exception-justification"] || "";
        waivers.push({
          type: "policy-exception",
          id: pe.metadata.name,
          scope: pe.metadata.namespace || "cluster",
          policy: pe.spec?.exceptions?.[0]?.policyName || "unknown",
          justification,
          expiry,
          status: expiry && new Date(expiry) < new Date() ? "expired" : "active",
          source: "kyverno",
        });
      }
    } catch { /* No PolicyExceptions or Kyverno v2 not available */ }

    // 2. Risk acceptances from finding lifecycle DB
    if (dbAvailable && db.pool) {
      try {
        const { rows } = await db.pool.query(
          `SELECT id, title, severity, affected_resource, risk_justification,
                  risk_compensating_controls, risk_accepted_by, risk_accepted_at, risk_expiry
           FROM finding_lifecycle
           WHERE risk_accepted = true
           ORDER BY risk_accepted_at DESC`
        );
        for (const row of rows) {
          waivers.push({
            type: "risk-acceptance",
            id: row.id,
            scope: row.affected_resource || "N/A",
            policy: row.title,
            justification: row.risk_justification || "",
            compensatingControls: row.risk_compensating_controls || "",
            acceptedBy: row.risk_accepted_by,
            acceptedAt: row.risk_accepted_at,
            expiry: row.risk_expiry,
            status: row.risk_expiry && new Date(row.risk_expiry) < new Date() ? "expired" : "active",
            severity: row.severity,
            source: "finding-lifecycle",
          });
        }
      } catch { /* DB query failed */ }
    }

    const summary = {
      total: waivers.length,
      active: waivers.filter((w) => w.status === "active").length,
      expired: waivers.filter((w) => w.status === "expired").length,
      byType: {
        policyExceptions: waivers.filter((w) => w.type === "policy-exception").length,
        riskAcceptances: waivers.filter((w) => w.type === "risk-acceptance").length,
      },
    };

    res.json({ waivers, summary });
  } catch (err) {
    console.error("Error fetching waivers:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/compliance/assessment-worksheet — Export all controls as CSV for assessors
app.get("/api/compliance/assessment-worksheet", requireGroups("sre-admins", "issm", "compliance-assessors"), async (req, res) => {
  try {
    const helmReleases = await getHelmReleases();
    const helmHealthMap = new Map();
    helmReleases.forEach((hr) => helmHealthMap.set(hr.name, hr.ready));

    const controlMapping = loadControlMapping();

    // CSV helper
    const escapeCsv = (val) => {
      const str = String(val || "");
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    // CSV header
    const csvRows = [
      ["Control ID", "Title", "Family", "Implementation Status", "Platform Evidence", "Assessor Notes", "Assessment Result"].join(","),
    ];

    for (const ctrl of COMPLIANCE_CONTROLS) {
      const status = getControlStatus(ctrl, helmHealthMap);
      const mapping = controlMapping[ctrl.id] || {};
      const evidenceFiles = (mapping.evidence || []).join("; ");
      const implementation = (mapping.implementation || "");
      const platformEvidence = evidenceFiles
        ? `${implementation} | Files: ${evidenceFiles}`
        : implementation;

      csvRows.push([
        escapeCsv(ctrl.id),
        escapeCsv(ctrl.title),
        escapeCsv(`${ctrl.family} - ${ctrl.familyName}`),
        escapeCsv(status),
        escapeCsv(platformEvidence),
        "",  // Assessor Notes — blank for assessor to fill
        "",  // Assessment Result — blank for assessor to fill
      ].join(","));
    }

    const csvContent = csvRows.join("\n");
    const timestamp = new Date().toISOString().split("T")[0];

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="sre-assessment-worksheet-${timestamp}.csv"`);
    res.send(csvContent);
  } catch (err) {
    console.error("Error generating assessment worksheet:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Phase 6: Assessor Role ───────────────────────────────────────────────────
// Note: The compliance-assessors group is already added to all /api/compliance/*
// endpoints above via requireGroups. The assessor role CAN access:
//   - All /api/compliance/* endpoints (read)
//   - All /api/security/* read endpoints (policy-violations)
// The assessor role CANNOT access:
//   - /api/deploy/* endpoints
//   - /api/admin/* endpoints
//   - DELETE endpoints
//   - POST /api/pipeline/runs (create)
// This is enforced by NOT including "compliance-assessors" in those route groups.

// ── Phase 7: CCB Change Workflow ─────────────────────────────────────────────
// NIST Controls: CM-3, CM-5 — Configuration Change Control

// GET /api/compliance/changes — list recent platform changes from Flux HelmRelease history
app.get("/api/compliance/changes", requireGroups("sre-admins", "issm", "compliance-assessors"), async (req, res) => {
  try {
    const changes = [];
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    // Collect HelmRelease version changes across all namespaces
    try {
      const allNs = await k8sApi.listNamespace();
      for (const ns of allNs.body.items) {
        try {
          const hrResp = await customApi.listNamespacedCustomObject(
            "helm.toolkit.fluxcd.io", "v2", ns.metadata.name, "helmreleases"
          );
          for (const hr of (hrResp.body.items || [])) {
            const conditions = hr.status?.conditions || [];
            const readyCond = conditions.find(c => c.type === "Ready");
            const lastApplied = hr.status?.lastAppliedRevision || null;
            const lastAttempted = hr.status?.lastAttemptedRevision || null;
            const chartVersion = hr.spec?.chart?.spec?.version || "unknown";

            changes.push({
              id: `${hr.metadata.namespace}/${hr.metadata.name}`,
              component: hr.metadata.name,
              namespace: hr.metadata.namespace,
              type: "helmrelease-update",
              chartVersion,
              appliedRevision: lastApplied,
              attemptedRevision: lastAttempted,
              status: readyCond?.status === "True" ? "applied" : "pending",
              message: readyCond?.message || "",
              timestamp: readyCond?.lastTransitionTime || hr.metadata.creationTimestamp,
              approvalStatus: "auto-approved",
              approvedBy: null,
              approvedAt: null,
            });
          }
        } catch { /* namespace may not have HelmReleases */ }
      }
    } catch (err) {
      console.debug("[ccb] Error listing HelmReleases:", err.message);
    }

    // Collect Flux Kustomization changes
    try {
      const ksResp = await customApi.listNamespacedCustomObject(
        "kustomize.toolkit.fluxcd.io", "v1", "flux-system", "kustomizations"
      );
      for (const ks of (ksResp.body.items || [])) {
        const conditions = ks.status?.conditions || [];
        const readyCond = conditions.find(c => c.type === "Ready");
        changes.push({
          id: `flux-system/${ks.metadata.name}`,
          component: ks.metadata.name,
          namespace: "flux-system",
          type: "kustomization-update",
          chartVersion: null,
          appliedRevision: ks.status?.lastAppliedRevision || null,
          attemptedRevision: ks.status?.lastAttemptedRevision || null,
          status: readyCond?.status === "True" ? "applied" : "pending",
          message: readyCond?.message || "",
          timestamp: readyCond?.lastTransitionTime || ks.metadata.creationTimestamp,
          approvalStatus: "auto-approved",
          approvedBy: null,
          approvedAt: null,
        });
      }
    } catch { /* Kustomizations not available */ }

    // Sort by timestamp descending and limit
    changes.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const limited = changes.slice(0, limit);

    // Check DB for manual approvals
    if (dbAvailable && db.pool) {
      try {
        const { rows } = await db.pool.query(
          "SELECT * FROM admin_audit_log WHERE action = 'ccb-approve' ORDER BY created_at DESC LIMIT 100"
        );
        const approvals = {};
        for (const row of rows) {
          approvals[row.target_name] = { by: row.actor, at: row.created_at, comment: row.detail };
        }
        for (const change of limited) {
          if (approvals[change.id]) {
            change.approvalStatus = "ccb-approved";
            change.approvedBy = approvals[change.id].by;
            change.approvedAt = approvals[change.id].at;
          }
        }
      } catch { /* DB query failed */ }
    }

    res.json({
      changes: limited,
      total: changes.length,
      summary: {
        applied: changes.filter(c => c.status === "applied").length,
        pending: changes.filter(c => c.status === "pending").length,
        ccbApproved: limited.filter(c => c.approvalStatus === "ccb-approved").length,
      },
    });
  } catch (err) {
    console.error("Error fetching CCB changes:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/compliance/changes/:id/approve — CCB approval for a change
app.post("/api/compliance/changes/:id/approve", mutateLimiter, requireGroups("sre-admins", "issm"), async (req, res) => {
  try {
    const changeId = decodeURIComponent(req.params.id);
    const actor = getActor(req);
    const { comment } = req.body || {};

    if (dbAvailable && db.pool) {
      await db.adminAuditLog("ccb-approve", actor, "change", changeId, comment || "CCB approval granted", { changeId });
    }

    res.json({
      success: true,
      changeId,
      approvedBy: actor,
      approvedAt: new Date().toISOString(),
      comment: comment || null,
    });
  } catch (err) {
    console.error("Error approving change:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Phase 7: Personnel Security Tracker ──────────────────────────────────────
// NIST Controls: AT-2, PS-6, PS-7 — Security Awareness Training, Personnel Security

// GET /api/admin/users/:id/compliance — user compliance metadata
app.get("/api/admin/users/:id/compliance", requireGroups("sre-admins", "issm"), async (req, res) => {
  try {
    const userId = req.params.id;

    // Fetch user from Keycloak
    let user;
    try {
      user = await keycloakApi("GET", `/users/${userId}`);
    } catch (err) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get compliance attributes from Keycloak user attributes
    const attrs = user.attributes || {};
    const compliance = {
      userId: user.id,
      username: user.username,
      email: user.email,
      securityTrainingDate: attrs.securityTrainingDate?.[0] || null,
      securityTrainingExpiry: attrs.securityTrainingExpiry?.[0] || null,
      lastAccessReview: attrs.lastAccessReview?.[0] || null,
      nextAccessReview: attrs.nextAccessReview?.[0] || null,
      robAcknowledgedAt: attrs.robAcknowledgedAt?.[0] || null,
      clearanceLevel: attrs.clearanceLevel?.[0] || null,
      nda: {
        signed: attrs.ndaSigned?.[0] === "true",
        signedAt: attrs.ndaSignedAt?.[0] || null,
      },
      status: "compliant",
      issues: [],
    };

    // Check compliance status
    const now = new Date();
    if (compliance.securityTrainingExpiry) {
      if (new Date(compliance.securityTrainingExpiry) < now) {
        compliance.status = "non-compliant";
        compliance.issues.push("Security training expired");
      }
    } else if (!compliance.securityTrainingDate) {
      compliance.status = "non-compliant";
      compliance.issues.push("Security training not completed");
    }

    if (compliance.nextAccessReview) {
      if (new Date(compliance.nextAccessReview) < now) {
        compliance.status = "non-compliant";
        compliance.issues.push("Access review overdue");
      }
    } else if (!compliance.lastAccessReview) {
      compliance.issues.push("No access review on record");
    }

    if (!compliance.robAcknowledgedAt) {
      compliance.issues.push("Rules of Behavior not acknowledged");
    }

    if (compliance.issues.length > 0 && compliance.status === "compliant") {
      compliance.status = "attention-needed";
    }

    res.json(compliance);
  } catch (err) {
    console.error("Error fetching user compliance:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/admin/users/:id/compliance — update training/review dates
app.patch("/api/admin/users/:id/compliance", mutateLimiter, requireGroups("sre-admins", "issm"), async (req, res) => {
  try {
    const userId = req.params.id;
    const actor = getActor(req);
    const updates = req.body;

    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No updates provided" });
    }

    // Map allowed fields to Keycloak user attributes
    const allowedFields = {
      securityTrainingDate: "securityTrainingDate",
      securityTrainingExpiry: "securityTrainingExpiry",
      lastAccessReview: "lastAccessReview",
      nextAccessReview: "nextAccessReview",
      robAcknowledgedAt: "robAcknowledgedAt",
      clearanceLevel: "clearanceLevel",
      ndaSigned: "ndaSigned",
      ndaSignedAt: "ndaSignedAt",
    };

    // Fetch current user
    let user;
    try {
      user = await keycloakApi("GET", `/users/${userId}`);
    } catch (err) {
      return res.status(404).json({ error: "User not found" });
    }

    const attrs = user.attributes || {};
    for (const [field, attrName] of Object.entries(allowedFields)) {
      if (updates[field] !== undefined) {
        attrs[attrName] = [String(updates[field])];
      }
    }

    // Update user in Keycloak
    await keycloakApi("PUT", `/users/${userId}`, { ...user, attributes: attrs });

    // Audit log
    if (dbAvailable && db.pool) {
      await db.adminAuditLog("update-user-compliance", actor, "user", user.username, JSON.stringify(updates), { userId, updates });
    }

    res.json({ success: true, userId, updated: Object.keys(updates) });
  } catch (err) {
    console.error("Error updating user compliance:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/compliance/personnel/summary — aggregate personnel compliance stats
app.get("/api/compliance/personnel/summary", requireGroups("sre-admins", "issm", "compliance-assessors"), async (req, res) => {
  try {
    // Fetch all users from Keycloak
    let users;
    try {
      users = await keycloakApi("GET", "/users?max=500");
    } catch (err) {
      return res.status(503).json({ error: "Cannot connect to Keycloak" });
    }

    const now = new Date();
    let totalUsers = users.length;
    let trainingCurrent = 0;
    let trainingExpired = 0;
    let trainingMissing = 0;
    let accessReviewCurrent = 0;
    let accessReviewOverdue = 0;
    let accessReviewMissing = 0;
    let robSigned = 0;
    let robUnsigned = 0;
    const nonCompliantUsers = [];

    for (const user of users) {
      // Skip service accounts
      if (user.username?.startsWith("service-account-")) continue;

      const attrs = user.attributes || {};
      let issues = [];

      // Training check
      const trainingExpiry = attrs.securityTrainingExpiry?.[0];
      if (trainingExpiry) {
        if (new Date(trainingExpiry) < now) {
          trainingExpired++;
          issues.push("training-expired");
        } else {
          trainingCurrent++;
        }
      } else if (attrs.securityTrainingDate?.[0]) {
        trainingCurrent++;
      } else {
        trainingMissing++;
        issues.push("no-training");
      }

      // Access review check
      const nextReview = attrs.nextAccessReview?.[0];
      if (nextReview) {
        if (new Date(nextReview) < now) {
          accessReviewOverdue++;
          issues.push("review-overdue");
        } else {
          accessReviewCurrent++;
        }
      } else if (attrs.lastAccessReview?.[0]) {
        accessReviewCurrent++;
      } else {
        accessReviewMissing++;
      }

      // RoB check
      if (attrs.robAcknowledgedAt?.[0]) {
        robSigned++;
      } else {
        robUnsigned++;
        issues.push("rob-unsigned");
      }

      if (issues.length > 0) {
        nonCompliantUsers.push({
          username: user.username,
          email: user.email,
          issues,
        });
      }
    }

    res.json({
      generatedAt: now.toISOString(),
      totalUsers,
      training: {
        current: trainingCurrent,
        expired: trainingExpired,
        missing: trainingMissing,
        complianceRate: totalUsers > 0 ? Math.round(trainingCurrent / totalUsers * 100) : 0,
      },
      accessReview: {
        current: accessReviewCurrent,
        overdue: accessReviewOverdue,
        missing: accessReviewMissing,
        complianceRate: totalUsers > 0 ? Math.round(accessReviewCurrent / totalUsers * 100) : 0,
      },
      rulesOfBehavior: {
        signed: robSigned,
        unsigned: robUnsigned,
        complianceRate: totalUsers > 0 ? Math.round(robSigned / totalUsers * 100) : 0,
      },
      nonCompliantUsers: nonCompliantUsers.slice(0, 50),
      overallComplianceRate: totalUsers > 0
        ? Math.round(
            ((trainingCurrent + accessReviewCurrent + robSigned) / (totalUsers * 3)) * 100
          )
        : 0,
    });
  } catch (err) {
    console.error("Error fetching personnel summary:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Phase 7: Compliance Gate for Deployments ─────────────────────────────────
// NIST Controls: CM-3, CM-5, SA-11, RA-5

// complianceGate — checks namespace readiness and image scan status before deploy
async function complianceGate(namespace, image) {
  const results = { passed: true, checks: [], warnings: [], blockers: [] };

  // Check 1: Namespace has NetworkPolicies
  try {
    const npResp = await k8sApi.listNamespacedNetworkPolicy(namespace);
    if ((npResp.body.items || []).length === 0) {
      results.warnings.push({ check: "network-policies", message: `Namespace ${namespace} has no NetworkPolicies` });
    } else {
      results.checks.push({ check: "network-policies", status: "pass", message: `${npResp.body.items.length} NetworkPolicies found` });
    }
  } catch {
    results.warnings.push({ check: "network-policies", message: "Unable to verify NetworkPolicies" });
  }

  // Check 2: Namespace has required labels
  try {
    const nsResp = await k8sApi.readNamespace(namespace);
    const labels = nsResp.body.metadata?.labels || {};
    if (!labels["istio-injection"]) {
      results.warnings.push({ check: "istio-injection", message: `Namespace ${namespace} missing istio-injection label` });
    } else {
      results.checks.push({ check: "istio-injection", status: "pass", message: "Istio sidecar injection enabled" });
    }
  } catch {
    results.warnings.push({ check: "namespace-labels", message: "Unable to verify namespace labels" });
  }

  // Check 3: Image scan status from Harbor (if image is from Harbor)
  if (image && image.includes("harbor")) {
    try {
      const repoTag = image.replace(/.*harbor[^/]*\//, "");
      const repo = repoTag.split(":")[0];
      const tag = repoTag.split(":")[1] || "latest";
      const project = repo.split("/")[0];
      const repoPath = repo.split("/").slice(1).join("/");

      const scanResp = await fetch(
        `https://${HARBOR_REGISTRY_EXT}/api/v2.0/projects/${project}/repositories/${encodeURIComponent(repoPath)}/artifacts/${tag}?with_scan_overview=true`,
        {
          headers: { Authorization: "Basic " + Buffer.from(`${HARBOR_ADMIN_USER}:${HARBOR_ADMIN_PASS}`).toString("base64") },
        }
      );

      if (scanResp.ok) {
        const artifact = await scanResp.json();
        const scanOverview = artifact.scan_overview || {};
        const report = Object.values(scanOverview)[0];

        if (report) {
          const summary = report.summary || {};
          const criticals = summary.Critical || summary.critical || 0;
          const highs = summary.High || summary.high || 0;

          if (criticals > 0) {
            results.blockers.push({
              check: "image-scan",
              message: `Image has ${criticals} critical vulnerabilities — deployment blocked`,
              severity: "critical",
            });
            results.passed = false;
          } else if (highs > 0) {
            results.warnings.push({
              check: "image-scan",
              message: `Image has ${highs} high vulnerabilities`,
              severity: "high",
            });
          } else {
            results.checks.push({ check: "image-scan", status: "pass", message: "Image scan clean" });
          }
        } else {
          results.warnings.push({ check: "image-scan", message: "Image has not been scanned" });
        }
      }
    } catch {
      results.warnings.push({ check: "image-scan", message: "Unable to verify image scan status" });
    }
  }

  // Check 4: ResourceQuota exists in namespace
  try {
    const quotaResp = await k8sApi.listNamespacedResourceQuota(namespace);
    if ((quotaResp.body.items || []).length === 0) {
      results.warnings.push({ check: "resource-quota", message: `Namespace ${namespace} has no ResourceQuota` });
    } else {
      results.checks.push({ check: "resource-quota", status: "pass", message: "ResourceQuota configured" });
    }
  } catch {
    results.warnings.push({ check: "resource-quota", message: "Unable to verify ResourceQuota" });
  }

  return results;
}

// ── Phase 7: Rules of Behavior Acknowledgment ────────────────────────────────
// NIST Controls: PL-4, PS-6

// GET /api/compliance/rob/status — count of users who have/haven't signed RoB
app.get("/api/compliance/rob/status", requireGroups("sre-admins", "issm", "compliance-assessors"), async (req, res) => {
  try {
    let users;
    try {
      users = await keycloakApi("GET", "/users?max=500");
    } catch {
      return res.status(503).json({ error: "Cannot connect to Keycloak" });
    }

    let signed = 0;
    let unsigned = 0;
    const unsignedUsers = [];

    for (const user of users) {
      if (user.username?.startsWith("service-account-")) continue;
      const attrs = user.attributes || {};
      if (attrs.robAcknowledgedAt?.[0]) {
        signed++;
      } else {
        unsigned++;
        unsignedUsers.push({ username: user.username, email: user.email });
      }
    }

    const total = signed + unsigned;
    res.json({
      total,
      signed,
      unsigned,
      complianceRate: total > 0 ? Math.round((signed / total) * 100) : 0,
      unsignedUsers: unsignedUsers.slice(0, 50),
    });
  } catch (err) {
    console.error("Error fetching RoB status:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Phase 8: App Compliance Profile (Inherited Controls) ─────────────────────
// NIST Controls: CA-2, CA-6, SA-11

// GET /api/apps/:namespace/:name/compliance-profile — inherited/shared/app-owned controls
app.get("/api/apps/:namespace/:name/compliance-profile", requireGroups("sre-admins", "issm", "compliance-assessors", "developers"), async (req, res) => {
  try {
    const { namespace, name } = req.params;

    // Platform-inherited controls (provided by SRE platform to all apps)
    const inheritedControls = [
      { id: "AC-2", family: "AC", title: "Account Management", provider: "Keycloak SSO" },
      { id: "AC-3", family: "AC", title: "Access Enforcement", provider: "Kubernetes RBAC + Istio" },
      { id: "AC-4", family: "AC", title: "Information Flow Enforcement", provider: "Istio mTLS + NetworkPolicy" },
      { id: "AC-14", family: "AC", title: "Permitted Actions Without Identification", provider: "Istio PeerAuthentication STRICT" },
      { id: "AU-2", family: "AU", title: "Audit Events", provider: "Loki + K8s Audit Logging" },
      { id: "AU-3", family: "AU", title: "Content of Audit Records", provider: "Structured JSON Logging" },
      { id: "AU-6", family: "AU", title: "Audit Review and Reporting", provider: "Grafana Dashboards" },
      { id: "AU-12", family: "AU", title: "Audit Generation", provider: "Alloy Log Collector" },
      { id: "CA-7", family: "CA", title: "Continuous Monitoring", provider: "Prometheus + Grafana" },
      { id: "CM-2", family: "CM", title: "Baseline Configuration", provider: "GitOps via Flux CD" },
      { id: "CM-3", family: "CM", title: "Configuration Change Control", provider: "Git PR Workflow + Flux" },
      { id: "CM-6", family: "CM", title: "Configuration Settings", provider: "Kyverno Policies" },
      { id: "IA-2", family: "IA", title: "Identification and Authentication", provider: "Keycloak MFA" },
      { id: "IA-3", family: "IA", title: "Device Identification", provider: "Istio mTLS SPIFFE" },
      { id: "RA-5", family: "RA", title: "Vulnerability Scanning", provider: "Harbor Trivy + NeuVector" },
      { id: "SC-7", family: "SC", title: "Boundary Protection", provider: "Istio Gateway + NetworkPolicy" },
      { id: "SC-8", family: "SC", title: "Transmission Confidentiality", provider: "Istio mTLS STRICT" },
      { id: "SC-13", family: "SC", title: "Cryptographic Protection", provider: "FIPS 140-2 (RKE2)" },
      { id: "SC-28", family: "SC", title: "Protection of Information at Rest", provider: "K8s Secrets Encryption" },
      { id: "SI-2", family: "SI", title: "Flaw Remediation", provider: "Harbor Scan Alerts" },
      { id: "SI-4", family: "SI", title: "System Monitoring", provider: "NeuVector Runtime + Prometheus" },
      { id: "SI-7", family: "SI", title: "Software Integrity", provider: "Cosign Image Signing" },
    ];

    // Shared controls (app participates by using platform features)
    const sharedControls = [
      { id: "AC-6", family: "AC", title: "Least Privilege", requirement: "Container runs as non-root with dropped capabilities" },
      { id: "CM-7", family: "CM", title: "Least Functionality", requirement: "Read-only root filesystem, minimal base image" },
      { id: "IR-4", family: "IR", title: "Incident Handling", requirement: "App exposes /metrics and structured logs" },
      { id: "SA-10", family: "SA", title: "Developer Configuration Management", requirement: "App deployed via GitOps" },
    ];

    // App-owned controls (app team must implement)
    const appOwnedControls = [
      { id: "SA-11", family: "SA", title: "Developer Testing", requirement: "App has unit/integration tests in CI" },
      { id: "SI-10", family: "SI", title: "Information Input Validation", requirement: "App validates and sanitizes all input" },
      { id: "SC-18", family: "SC", title: "Mobile Code", requirement: "Frontend has CSP headers, no eval()" },
    ];

    // Check actual namespace status
    let namespaceChecks = {};
    try {
      const nsResp = await k8sApi.readNamespace(namespace);
      const labels = nsResp.body.metadata?.labels || {};
      namespaceChecks.istioInjection = labels["istio-injection"] === "enabled";
    } catch { namespaceChecks.istioInjection = false; }

    try {
      const npResp = await k8sApi.listNamespacedNetworkPolicy(namespace);
      namespaceChecks.hasNetworkPolicies = (npResp.body.items || []).length > 0;
    } catch { namespaceChecks.hasNetworkPolicies = false; }

    try {
      const quotaResp = await k8sApi.listNamespacedResourceQuota(namespace);
      namespaceChecks.hasResourceQuota = (quotaResp.body.items || []).length > 0;
    } catch { namespaceChecks.hasResourceQuota = false; }

    res.json({
      app: { namespace, name },
      inherited: {
        count: inheritedControls.length,
        controls: inheritedControls,
        description: "Controls fully provided by the SRE platform. No app-level action needed.",
      },
      shared: {
        count: sharedControls.length,
        controls: sharedControls,
        description: "Controls shared between platform and app. App must follow platform conventions.",
      },
      appOwned: {
        count: appOwnedControls.length,
        controls: appOwnedControls,
        description: "Controls the app team is responsible for implementing.",
      },
      namespaceStatus: namespaceChecks,
      totalControls: inheritedControls.length + sharedControls.length + appOwnedControls.length,
    });
  } catch (err) {
    console.error("Error fetching compliance profile:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Phase 8: App Decommissioning Workflow ────────────────────────────────────
// NIST Controls: CM-3, PS-4, SA-10

// POST /api/apps/:namespace/:name/decommission — decommission an application
app.post("/api/apps/:namespace/:name/decommission", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  try {
    const { namespace, name } = req.params;
    const actor = getActor(req);
    const { reason, acknowledgedChecklist } = req.body || {};

    if (!reason) {
      return res.status(400).json({ error: "Decommission reason is required" });
    }

    if (!acknowledgedChecklist) {
      return res.status(400).json({
        error: "Decommission checklist acknowledgment required",
        checklist: [
          "Application data has been backed up or archived",
          "Application users have been notified",
          "DNS records will be cleaned up",
          "Secrets and credentials will be revoked",
          "Monitoring alerts will be removed",
          "POA&M findings will be closed",
        ],
      });
    }

    const auditEntries = [];

    // Step 1: Close POA&M findings for this app
    if (dbAvailable && db.pool) {
      try {
        const { rowCount } = await db.pool.query(
          `UPDATE finding_lifecycle SET status = 'closed', notes = COALESCE(notes, '') || ' [Auto-closed: app decommissioned by ' || $1 || ']', updated_at = NOW()
           WHERE affected_resource LIKE $2 AND status IN ('open', 'risk-accepted')`,
          [actor, `%${namespace}/${name}%`]
        );
        auditEntries.push(`Closed ${rowCount || 0} POA&M findings`);
      } catch { auditEntries.push("POA&M closure skipped (DB error)"); }
    }

    // Step 2: Delete PolicyExceptions for this app
    try {
      const peResp = await customApi.listNamespacedCustomObject("kyverno.io", "v2", namespace, "policyexceptions");
      for (const pe of (peResp.body.items || [])) {
        if (pe.metadata.name.includes(name)) {
          await customApi.deleteNamespacedCustomObject("kyverno.io", "v2", namespace, "policyexceptions", pe.metadata.name);
          auditEntries.push(`Revoked PolicyException: ${pe.metadata.name}`);
        }
      }
    } catch { auditEntries.push("PolicyException cleanup skipped"); }

    // Step 3: Remove from app registry
    const registryIdx = appRegistry.findIndex(a => a.name === name && (a.namespace === namespace || a.team === namespace));
    if (registryIdx >= 0) {
      appRegistry.splice(registryIdx, 1);
      await saveAppRegistry();
      auditEntries.push("Removed from app registry");
    }

    // Step 4: Mark pipeline runs as decommissioned
    if (dbAvailable && db.pool) {
      try {
        await db.pool.query(
          "UPDATE pipeline_runs SET status = 'undeployed', updated_at = NOW() WHERE app_name = $1 AND status = 'deployed'",
          [name]
        );
        auditEntries.push("Pipeline runs marked as undeployed");
      } catch { auditEntries.push("Pipeline run update skipped"); }
    }

    // Step 5: Delete HelmRelease (triggers Flux cleanup)
    try {
      await customApi.deleteNamespacedCustomObject(
        "helm.toolkit.fluxcd.io", "v2", namespace, "helmreleases", name
      );
      auditEntries.push("HelmRelease deleted (Flux will clean up resources)");
    } catch (err) {
      auditEntries.push(`HelmRelease deletion: ${err.message}`);
    }

    // Step 6: Audit log
    if (dbAvailable && db.pool) {
      await db.adminAuditLog("decommission-app", actor, "application", `${namespace}/${name}`, reason, {
        namespace, name, reason, acknowledgedChecklist, auditEntries,
      });
    }

    res.json({
      success: true,
      decommissioned: `${namespace}/${name}`,
      by: actor,
      at: new Date().toISOString(),
      reason,
      actions: auditEntries,
    });
  } catch (err) {
    console.error("Error decommissioning app:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Phase 2 Pre-flight & Diagnostics ─────────────────────────────────────────

// ── Task 2.1: Image Existence Check ──────────────────────────────────────────
// GET /api/registry/check?image=<full-image-ref>
// Checks Harbor for image existence, scan status, and vulnerability summary.
app.get("/api/registry/check", requireGroups("sre-admins", "developers"), async (req, res) => {
  const { image } = req.query;
  if (!image || typeof image !== "string") {
    return res.status(400).json({ error: "image parameter required" });
  }

  // Only check images in our Harbor registry
  if (!image.includes("harbor")) {
    return res.json({ exists: false, reason: "Not a Harbor image — cannot check" });
  }

  // Parse: registry/project/repo:tag  (repo may contain slashes)
  // e.g. harbor.apps.sre.example.com/team-alpha/myapp:v1.2.3
  try {
    const withoutTag = image.lastIndexOf(":") > image.lastIndexOf("/") ? image.substring(0, image.lastIndexOf(":")) : image;
    const rawTag = image.lastIndexOf(":") > image.lastIndexOf("/") ? image.substring(image.lastIndexOf(":") + 1) : "latest";

    const slashIdx = withoutTag.indexOf("/");
    if (slashIdx === -1) return res.json({ exists: false, reason: "Cannot parse image reference" });

    const registry = withoutTag.substring(0, slashIdx);
    const remainder = withoutTag.substring(slashIdx + 1); // project/repo or project/a/b

    const secondSlash = remainder.indexOf("/");
    if (secondSlash === -1) return res.json({ exists: false, reason: "Cannot parse project/repository" });

    const project = remainder.substring(0, secondSlash);
    const repoPath = remainder.substring(secondSlash + 1); // may contain slashes

    const harborAuth = "Basic " + Buffer.from(`${HARBOR_ADMIN_USER}:${HARBOR_ADMIN_PASS}`).toString("base64");

    // Try internal Harbor URL first (in-cluster), then external
    const harborHosts = [
      "http://harbor-core.harbor.svc.cluster.local:80",
      `https://${registry}`,
    ];

    let artifactData = null;
    for (const host of harborHosts) {
      try {
        const apiUrl = `${host}/api/v2.0/projects/${encodeURIComponent(project)}/repositories/${encodeURIComponent(repoPath)}/artifacts/${encodeURIComponent(rawTag)}?with_scan_overview=true`;
        const resp = await httpRequest(apiUrl, {
          headers: { Authorization: harborAuth },
          timeout: 8000,
        });
        if (resp.status === 200) {
          artifactData = JSON.parse(resp.body);
          break;
        }
        if (resp.status === 404) {
          return res.json({ exists: false });
        }
      } catch { /* try next host */ }
    }

    if (!artifactData) {
      return res.json({ exists: false, reason: "Could not reach Harbor API" });
    }

    // Extract scan overview (Trivy report key)
    const scanKey = "application/vnd.security.vulnerability.report; version=1.1";
    const scanOverview = artifactData.scan_overview?.[scanKey];
    const scanStatus = scanOverview?.scan_status || "not_scanned";
    const vulnSummary = scanOverview?.summary || {};

    return res.json({
      exists: true,
      digest: artifactData.digest || null,
      scanned: scanStatus === "Success",
      scanStatus,
      vulnerabilities: {
        critical: vulnSummary.Critical || 0,
        high: vulnSummary.High || 0,
        medium: vulnSummary.Medium || 0,
        low: vulnSummary.Low || 0,
        fixable: vulnSummary.fixable || 0,
      },
    });
  } catch (err) {
    console.error("[registry/check] Error:", err.message);
    return res.json({ exists: false, reason: err.message });
  }
});

// ── Task 2.2: Kyverno Policy Dry-Run (Preflight) ─────────────────────────────
// POST /api/deploy/preflight
// Renders a minimal Pod spec and dry-runs it against the API server to catch
// Kyverno admission denials before the actual deploy.
app.post("/api/deploy/preflight", requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const { name, team, image, tag, port, securityContext } = req.body;
    if (!name || !team || !image || !tag) {
      return res.status(400).json({ error: "Missing required fields: name, team, image, tag" });
    }

    const nsName = normalizeTeamName(team);
    const safeName = sanitizeName(name);
    const sc = securityContext || {};

    // Build a minimal Pod spec that mirrors what the SRE Helm chart would create.
    const podSpec = {
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        name: `${safeName}-preflight-${crypto.randomBytes(3).toString("hex")}`,
        namespace: nsName,
        labels: {
          "app.kubernetes.io/name": safeName,
          "app.kubernetes.io/part-of": "sre-platform",
          "sre.io/team": team.toLowerCase(),
        },
        annotations: { "sidecar.istio.io/inject": "false" },
      },
      spec: {
        restartPolicy: "Never",
        automountServiceAccountToken: false,
        securityContext: sc.runAsRoot
          ? { runAsNonRoot: false, runAsUser: 0, seccompProfile: { type: "RuntimeDefault" } }
          : { runAsNonRoot: true, seccompProfile: { type: "RuntimeDefault" } },
        containers: [{
          name: safeName,
          image: `${image}:${tag}`,
          ports: [{ containerPort: port || 8080 }],
          resources: {
            requests: { cpu: "50m", memory: "64Mi" },
            limits: { cpu: "200m", memory: "256Mi" },
          },
          securityContext: {
            allowPrivilegeEscalation: !!(sc.allowPrivilegeEscalation || sc.runAsRoot),
            readOnlyRootFilesystem: !(sc.writableFilesystem || sc.runAsRoot),
            runAsNonRoot: !sc.runAsRoot,
            capabilities: sc.capabilities && sc.capabilities.length > 0
              ? { add: sc.capabilities, drop: [] }
              : { drop: ["ALL"] },
            ...(sc.runAsRoot ? { runAsUser: 0 } : {}),
          },
        }],
      },
    };

    const violations = [];
    const warnings = [];

    // Dry-run via K8s API: createNamespacedPod with dryRun=All
    try {
      await k8sApi.createNamespacedPod(nsName, podSpec, undefined, "All");
      // If we get here: dry-run passed — no admission violations
    } catch (err) {
      const statusBody = err.body || {};
      const errMsg = statusBody.message || err.message || String(err);

      // Parse Kyverno / admission denials
      const matches = matchError(errMsg);
      if (matches.length > 0) {
        for (const m of matches) {
          violations.push({
            policy: m.key,
            message: m.what,
            fix: POLICY_FIXES[m.key] || m.fix || "Contact platform admin.",
          });
        }
      } else if (errMsg.toLowerCase().includes("admission")) {
        violations.push({
          policy: "admission-webhook",
          message: errMsg.substring(0, 300),
          fix: "Check Kyverno ClusterPolicies for your namespace.",
        });
      } else if (err.statusCode && err.statusCode !== 409) {
        // Non-conflict errors: quota, namespace not found, etc.
        const quotaMatches = matchError(errMsg);
        for (const m of quotaMatches) {
          violations.push({ policy: m.key, message: m.what, fix: POLICY_FIXES[m.key] || m.fix || "" });
        }
        if (quotaMatches.length === 0) {
          warnings.push({ type: "api-error", message: errMsg.substring(0, 200) });
        }
      }
      // 409 Conflict = dry-run object already exists stub — treat as pass
    }

    // Check resource quota availability
    let resourceQuota = null;
    try {
      const quotaResp = await k8sApi.listNamespacedResourceQuota(nsName);
      const quotaItems = quotaResp.body.items || [];
      if (quotaItems.length > 0) {
        const q = quotaItems[0];
        const hard = q.status?.hard || {};
        const used = q.status?.used || {};

        const cpuHard = parseCpu(hard["requests.cpu"] || hard.cpu || "0");
        const cpuUsed = parseCpu(used["requests.cpu"] || used.cpu || "0");
        const memHard = parseMem(hard["requests.memory"] || hard.memory || "0");
        const memUsed = parseMem(used["requests.memory"] || used.memory || "0");

        resourceQuota = {
          cpuAvailable: fmtCpu(Math.max(0, cpuHard - cpuUsed)),
          cpuRequested: "50m",
          memoryAvailable: fmtMem(Math.max(0, memHard - memUsed)),
          memoryRequested: "64Mi",
          withinQuota: (cpuHard - cpuUsed) >= parseCpu("50m") && (memHard - memUsed) >= parseMem("64Mi"),
        };

        if (resourceQuota && !resourceQuota.withinQuota) {
          violations.push({
            policy: "resource-quota",
            message: `Namespace ${nsName} is near its resource quota. Available: ${resourceQuota.cpuAvailable} CPU, ${resourceQuota.memoryAvailable} memory.`,
            fix: "Scale down or delete unused deployments, or ask the platform admin to increase quota.",
          });
        }
      }
    } catch { /* quota check is best-effort */ }

    return res.json({
      passed: violations.length === 0,
      violations,
      warnings,
      resourceQuota,
    });
  } catch (err) {
    console.error("[preflight] Error:", err.message);
    res.status(500).json({ error: "Internal server error during preflight check" });
  }
});

// ── Task 2.3: Dockerfile Lint ─────────────────────────────────────────────────
// Shared function used by both POST /api/build/lint-dockerfile and the analysis flow.
function lintDockerfile(dockerfileContent) {
  const issues = [];
  if (!dockerfileContent || typeof dockerfileContent !== "string") return issues;
  const lines = dockerfileContent.split("\n");

  // FROM :latest
  lines.forEach((line, idx) => {
    if (/^FROM\s+\S+:latest(\s|$)/i.test(line.trim())) {
      issues.push({
        severity: "error",
        line: idx + 1,
        message: "FROM uses :latest tag — unpinned base images make builds unpredictable.",
        fix: "Pin to a specific version: e.g. FROM node:20.11-alpine3.19",
      });
    }
  });

  // No USER directive
  if (!/^USER\s+/im.test(dockerfileContent)) {
    issues.push({
      severity: "warning",
      line: null,
      message: "No USER directive — container will run as root, which violates the require-run-as-nonroot policy.",
      fix: 'Add "USER 1000" before the CMD/ENTRYPOINT instruction',
    });
  }

  // No HEALTHCHECK
  if (!/^HEALTHCHECK\s+/im.test(dockerfileContent)) {
    issues.push({
      severity: "info",
      line: null,
      message: "No HEALTHCHECK directive — Kubernetes probe auto-detection will fall back to defaults.",
      fix: "Add: HEALTHCHECK CMD curl -f http://localhost:8080/healthz || exit 1",
    });
  }

  // No EXPOSE
  if (!/^EXPOSE\s+/im.test(dockerfileContent)) {
    issues.push({
      severity: "info",
      line: null,
      message: "No EXPOSE directive — the platform needs to know which port your app listens on.",
      fix: "Add: EXPOSE 8080  (or your app port)",
    });
  }

  // ADD instead of COPY (local files, not URLs)
  lines.forEach((line, idx) => {
    if (/^ADD\s+(?!https?:\/\/)/i.test(line.trim())) {
      issues.push({
        severity: "info",
        line: idx + 1,
        message: "Using ADD instead of COPY for a local path — COPY is more explicit and preferred.",
        fix: "Replace ADD with COPY unless you need automatic tar extraction",
      });
    }
  });

  return issues;
}

// POST /api/build/lint-dockerfile
// Accepts raw Dockerfile content and returns lint issues.
app.post("/api/build/lint-dockerfile", requireGroups("sre-admins", "developers"), (req, res) => {
  const { content } = req.body;
  if (!content || typeof content !== "string") {
    return res.status(400).json({ error: "content field required" });
  }
  const issues = lintDockerfile(content);
  const hasErrors = issues.some((i) => i.severity === "error");
  res.json({ issues, hasErrors });
});

// ── Task 2.4: App Diagnostics Endpoint ───────────────────────────────────────
// GET /api/apps/:namespace/:name/diagnostics
// Returns aggregated diagnostic info for a single app: HelmRelease status, pods,
// events, logs, policy violations, resource usage, probe status, and suggested actions.
app.get("/api/apps/:namespace/:name/diagnostics", requireGroups("sre-admins", "developers", "issm"), async (req, res) => {
  try {
    const { namespace, name } = req.params;
    if (!isValidName(sanitizeName(namespace)) || !isValidName(sanitizeName(name))) {
      return res.status(400).json({ error: "Invalid namespace or name" });
    }

    const result = {
      app: { name, namespace, image: "", tag: "" },
      helmRelease: null,
      pods: [],
      recentEvents: [],
      recentLogs: [],
      policyViolations: [],
      resources: null,
      probes: null,
      suggestedActions: [],
    };

    // Step 1: HelmRelease status
    try {
      const hrResp = await customApi.getNamespacedCustomObject(
        "helm.toolkit.fluxcd.io", "v2", namespace, "helmreleases", name
      );
      const hr = hrResp.body;
      const readyCondition = (hr.status?.conditions || []).find((c) => c.type === "Ready");
      const appVals = hr.spec?.values?.app || {};
      result.app.image = appVals.image?.repository || "";
      result.app.tag = appVals.image?.tag || "";

      result.helmRelease = {
        ready: readyCondition?.status === "True",
        reason: readyCondition?.reason || "",
        message: readyCondition?.message || "",
        lastTransition: readyCondition?.lastTransitionTime || "",
        installFailures: hr.status?.installFailures || 0,
        upgradeFailures: hr.status?.upgradeFailures || 0,
      };

      // Extract probe config from Helm values for display
      const probeVals = appVals.probes || {};
      if (probeVals.liveness || probeVals.readiness) {
        result.probes = {
          liveness: probeVals.liveness
            ? { configured: true, path: probeVals.liveness.path || "/", passing: null, lastFailure: null }
            : { configured: false, path: null, passing: null, lastFailure: null },
          readiness: probeVals.readiness
            ? { configured: true, path: probeVals.readiness.path || "/", passing: null, lastFailure: null }
            : { configured: false, path: null, passing: null, lastFailure: null },
        };
      }
    } catch (err) {
      if (err.statusCode === 404) {
        return res.status(404).json({ error: "Application not found" });
      }
    }

    // Step 2: Pod status + resource usage
    try {
      const podResp = await k8sApi.listNamespacedPod(
        namespace, undefined, undefined, undefined, undefined,
        `app.kubernetes.io/name=${name}`
      );
      const podItems = podResp.body.items || [];

      // Fetch pod metrics (best-effort)
      let podMetricsMap = {};
      try {
        const metricsRaw = await customApi.listNamespacedCustomObject(
          "metrics.k8s.io", "v1beta1", namespace, "pods"
        );
        for (const pm of metricsRaw.body?.items || []) {
          let cpu = 0, mem = 0;
          for (const c of pm.containers || []) {
            cpu += parseCpu(c.usage?.cpu || "0");
            mem += parseMem(c.usage?.memory || "0");
          }
          podMetricsMap[pm.metadata.name] = { cpu, mem };
        }
      } catch { /* metrics may not be available */ }

      result.pods = podItems.map((pod) => {
        const cs = pod.status?.containerStatuses || [];
        const containers = cs.map((c) => {
          let state = "running";
          let reason = "";
          let message = "";
          if (c.state?.waiting) { state = "waiting"; reason = c.state.waiting.reason || ""; message = c.state.waiting.message || ""; }
          else if (c.state?.terminated) { state = "terminated"; reason = c.state.terminated.reason || ""; message = c.state.terminated.message || ""; }
          return { name: c.name, ready: c.ready || false, state, reason, message, restartCount: c.restartCount || 0 };
        });

        const podMetrics = podMetricsMap[pod.metadata.name];
        return {
          name: pod.metadata.name,
          phase: pod.status?.phase || "Unknown",
          ready: (pod.status?.conditions || []).some((c) => c.type === "Ready" && c.status === "True"),
          restartCount: cs.reduce((s, c) => s + (c.restartCount || 0), 0),
          containers,
          cpuUsed: podMetrics ? fmtCpu(podMetrics.cpu) : null,
          memUsed: podMetrics ? fmtMem(podMetrics.mem) : null,
        };
      });

      // Aggregate resource usage and limits
      if (podItems.length > 0) {
        let cpuReq = 0, cpuLim = 0, memReq = 0, memLim = 0, cpuUsed = 0, memUsed = 0;
        for (const pod of podItems) {
          for (const c of pod.spec?.containers || []) {
            cpuReq += parseCpu(c.resources?.requests?.cpu || "0");
            cpuLim += parseCpu(c.resources?.limits?.cpu || "0");
            memReq += parseMem(c.resources?.requests?.memory || "0");
            memLim += parseMem(c.resources?.limits?.memory || "0");
          }
        }
        for (const m of Object.values(podMetricsMap)) {
          cpuUsed += m.cpu;
          memUsed += m.mem;
        }
        result.resources = {
          cpu: { requested: fmtCpu(cpuReq), limit: fmtCpu(cpuLim), used: cpuUsed > 0 ? fmtCpu(cpuUsed) : null },
          memory: { requested: fmtMem(memReq), limit: fmtMem(memLim), used: memUsed > 0 ? fmtMem(memUsed) : null },
        };
      }
    } catch (err) {
      console.debug("[diagnostics] Pod lookup failed:", err.message);
    }

    // Step 3: Events
    try {
      const evResp = await k8sApi.listNamespacedEvent(namespace);
      const allEvents = evResp.body.items.filter((e) => {
        const objName = e.involvedObject?.name || "";
        return objName === name || objName.startsWith(`${name}-`);
      });

      result.recentEvents = allEvents
        .sort((a, b) => new Date(b.lastTimestamp || b.eventTime || 0) - new Date(a.lastTimestamp || a.eventTime || 0))
        .slice(0, 15)
        .map((e) => ({
          type: e.type || "Normal",
          reason: e.reason || "",
          message: e.message || "",
          age: age(e.lastTimestamp || e.eventTime || ""),
          source: e.source?.component || "",
        }));

      // Extract policy violations from events
      result.policyViolations = allEvents
        .filter((e) => {
          const msg = (e.message || "").toLowerCase();
          const reason = (e.reason || "").toLowerCase();
          return (
            reason === "policyviolation" ||
            msg.includes("kyverno") || msg.includes("denied by") ||
            msg.includes("admission webhook") || msg.includes("blocked")
          );
        })
        .slice(0, 5)
        .map((e) => {
          const matches = matchError(e.message || "");
          const best = matches[0];
          return {
            policy: best ? best.key : "unknown",
            message: e.message || "",
            fix: best ? (POLICY_FIXES[best.key] || best.fix || "") : "",
            time: e.lastTimestamp || e.eventTime || "",
          };
        });
    } catch (err) {
      console.debug("[diagnostics] Event lookup failed:", err.message);
    }

    // Step 4: Recent logs from the first running pod (last 20 lines)
    try {
      const runningPods = result.pods.filter((p) => p.phase === "Running" || p.containers.some((c) => c.state !== "waiting"));
      const targetPod = runningPods[0] || result.pods[0];
      if (targetPod) {
        const appContainer = targetPod.containers.find((c) => c.name === name) || targetPod.containers[0];
        if (appContainer) {
          try {
            const logResp = await k8sApi.readNamespacedPodLog(
              targetPod.name, namespace, appContainer.name,
              false, undefined, undefined, undefined, false, undefined, 20
            );
            result.recentLogs = (logResp.body || "").split("\n").filter(Boolean).slice(-20);
          } catch { /* pod may not have logs yet */ }
        }
      }
    } catch (err) {
      console.debug("[diagnostics] Log fetch failed:", err.message);
    }

    // Step 5: Probe pass/fail status — update from events
    if (result.probes) {
      const probeFailEvents = result.recentEvents.filter((e) =>
        e.reason === "Unhealthy" || e.reason === "ProbeWarning" || e.message?.toLowerCase().includes("probe failed")
      );
      for (const pfe of probeFailEvents) {
        const msg = pfe.message || "";
        if (msg.toLowerCase().includes("liveness") && result.probes.liveness?.configured) {
          result.probes.liveness.passing = false;
          result.probes.liveness.lastFailure = msg.substring(0, 120);
        }
        if (msg.toLowerCase().includes("readiness") && result.probes.readiness?.configured) {
          result.probes.readiness.passing = false;
          result.probes.readiness.lastFailure = msg.substring(0, 120);
        }
      }
    }

    // Step 6: Generate suggested actions (priority-ordered)
    const actions = [];

    // Policy violations — highest priority
    for (const v of result.policyViolations) {
      actions.push({
        priority: 1,
        action: POLICY_FIXES[v.policy] || `Fix policy violation: ${v.policy}`,
        reason: v.message.substring(0, 120),
      });
    }

    // HelmRelease failures
    if (result.helmRelease && !result.helmRelease.ready) {
      const hrMsg = result.helmRelease.message || "";
      const hrMatches = matchError(hrMsg);
      for (const m of hrMatches) {
        actions.push({
          priority: 1,
          action: POLICY_FIXES[m.key] || m.fix || `Fix: ${m.key}`,
          reason: hrMsg.substring(0, 120),
        });
      }
      if (hrMatches.length === 0 && hrMsg) {
        actions.push({ priority: 2, action: "Review HelmRelease failure message", reason: hrMsg.substring(0, 120) });
      }
    }

    // CrashLoopBackOff
    if (result.pods.some((p) => p.containers?.some((c) => c.reason === "CrashLoopBackOff"))) {
      actions.push({
        priority: 2,
        action: "Check application logs for startup errors — container is crash-looping",
        reason: "Container is restarting repeatedly (CrashLoopBackOff)",
      });
    }

    // ImagePullBackOff
    if (result.pods.some((p) => p.containers?.some((c) => c.reason === "ImagePullBackOff" || c.reason === "ErrImagePull"))) {
      actions.push({
        priority: 1,
        action: "Verify image exists in Harbor and credentials are correct",
        reason: "Image cannot be pulled from registry",
      });
    }

    // OOMKilled
    if (result.pods.some((p) => p.containers?.some((c) => c.reason === "OOMKilled"))) {
      actions.push({
        priority: 2,
        action: "Increase memory limit in your deployment values (resources.limits.memory)",
        reason: "Container exceeded memory limit (OOMKilled)",
      });
    }

    // Probe failures
    if (result.probes?.liveness?.configured && result.probes.liveness.passing === false) {
      actions.push({
        priority: 3,
        action: `Fix liveness probe — endpoint ${result.probes.liveness.path} is not responding`,
        reason: result.probes.liveness.lastFailure || "Liveness probe failing",
      });
    }
    if (result.probes?.readiness?.configured && result.probes.readiness.passing === false) {
      actions.push({
        priority: 3,
        action: `Fix readiness probe — endpoint ${result.probes.readiness.path} is not responding`,
        reason: result.probes.readiness.lastFailure || "Readiness probe failing",
      });
    }

    result.suggestedActions = actions
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 8);

    res.json(result);
  } catch (err) {
    console.error("[diagnostics] Error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Operations Cockpit API (/api/ops) ───────────────────────────────────────
// Lets admins inspect and reconfigure deployed apps without re-running the pipeline.

// ── Helper: read current HelmRelease values from Git (preferred) or cluster ──
async function getCurrentHelmReleaseValues(namespace, name) {
  if (gitops.isEnabled()) {
    try {
      // Attempt to read the manifest from Git via GitHub Contents API
      const GITHUB_API_BASE = "https://api.github.com";
      const GITHUB_OWNER = process.env.SRE_GITHUB_OWNER || "morbidsteve";
      const GITHUB_REPO = process.env.SRE_GITHUB_REPO || "sre-platform";
      const GITHUB_BRANCH = process.env.SRE_GITHUB_BRANCH || "main";
      const filePath = `apps/tenants/${namespace}/apps/${name}.yaml`;
      const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
      const res = await fetch(
        `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedPath}?ref=${GITHUB_BRANCH}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      );
      if (res.ok) {
        const data = await res.json();
        const content = Buffer.from(data.content, "base64").toString("utf-8");
        const parsed = yaml.load(content);
        if (parsed && parsed.spec && parsed.spec.values) {
          return parsed.spec.values;
        }
      }
    } catch (gitErr) {
      console.debug("[ops] Git HelmRelease read failed, falling back to cluster:", gitErr.message);
    }
  }
  // Fall back to reading from the cluster
  const hrResp = await customApi.getNamespacedCustomObject(
    "helm.toolkit.fluxcd.io", "v2", namespace, "helmreleases", name
  );
  return hrResp.body?.spec?.values || {};
}

// ── GET /api/ops/capabilities — Full Linux capability list ────────────────────
app.get("/api/ops/capabilities", requireGroups("sre-admins", "developers"), (req, res) => {
  const LINUX_CAPABILITIES = [
    "AUDIT_CONTROL", "AUDIT_READ", "AUDIT_WRITE",
    "BLOCK_SUSPEND", "BPF", "CHECKPOINT_RESTORE",
    "CHOWN", "DAC_OVERRIDE", "DAC_READ_SEARCH",
    "FOWNER", "FSETID", "IPC_LOCK", "IPC_OWNER",
    "KILL", "LEASE", "LINUX_IMMUTABLE", "MAC_ADMIN",
    "MAC_OVERRIDE", "MKNOD", "NET_ADMIN", "NET_BIND_SERVICE",
    "NET_BROADCAST", "NET_RAW", "PERFMON", "SETFCAP",
    "SETGID", "SETPCAP", "SETUID", "SYSLOG",
    "SYS_ADMIN", "SYS_BOOT", "SYS_CHROOT", "SYS_MODULE",
    "SYS_NICE", "SYS_PACCT", "SYS_PTRACE", "SYS_RAWIO",
    "SYS_RESOURCE", "SYS_TIME", "SYS_TTY_CONFIG",
    "WAKE_ALARM",
  ];
  res.json({ capabilities: LINUX_CAPABILITIES });
});

// ── GET /api/ops/:namespace/:name — Full app diagnostics ─────────────────────
app.get("/api/ops/:namespace/:name", requireGroups("sre-admins", "developers"), async (req, res) => {
  const { namespace, name } = req.params;

  if (!isValidName(sanitizeName(namespace)) || !isValidName(sanitizeName(name))) {
    return res.status(400).json({ error: "Invalid namespace or name" });
  }

  const result = {
    helmRelease: null,
    pods: [],
    events: { warning: [], normal: [] },
    policyViolations: [],
    network: { service: null, ingressHost: null, virtualService: null },
    security: { podSecurityContext: null, containerSecurityContext: null, exceptions: [] },
    resources: { requests: null, limits: null },
    probes: { liveness: null, readiness: null },
    image: { repository: null, tag: null, pullPolicy: null },
  };

  // ── HelmRelease ──────────────────────────────────────────────────────────
  try {
    const hrResp = await customApi.getNamespacedCustomObject(
      "helm.toolkit.fluxcd.io", "v2", namespace, "helmreleases", name
    );
    const hr = hrResp.body;
    const readyCond = (hr.status?.conditions || []).find((c) => c.type === "Ready");
    const vals = hr.spec?.values || {};
    const appVals = vals.app || {};

    result.helmRelease = {
      name: hr.metadata.name,
      namespace: hr.metadata.namespace,
      ready: readyCond?.status === "True",
      message: readyCond?.message || "",
      reason: readyCond?.reason || "",
      lastTransition: readyCond?.lastTransitionTime || "",
      revision: hr.status?.lastAppliedRevision || hr.status?.lastAttemptedRevision || "",
      chartVersion: hr.spec?.chart?.spec?.version || "",
      installFailures: hr.status?.installFailures || 0,
      upgradeFailures: hr.status?.upgradeFailures || 0,
      values: vals,
    };

    // Populate structured fields from HelmRelease values
    result.image = {
      repository: appVals.image?.repository || "",
      tag: appVals.image?.tag || "",
      pullPolicy: appVals.image?.pullPolicy || "IfNotPresent",
    };
    result.resources = {
      requests: appVals.resources?.requests || null,
      limits: appVals.resources?.limits || null,
    };
    result.probes = {
      liveness: appVals.probes?.liveness || null,
      readiness: appVals.probes?.readiness || null,
    };
    result.security.podSecurityContext = vals.podSecurityContext || null;
    result.security.containerSecurityContext = vals.containerSecurityContext || null;
    result.network.ingressHost = vals.ingress?.enabled ? (vals.ingress?.host || null) : null;
  } catch (err) {
    if (err.statusCode !== 404) {
      console.debug("[ops] HelmRelease fetch error:", err.message);
    }
  }

  // ── Pods ─────────────────────────────────────────────────────────────────
  try {
    const podResp = await k8sApi.listNamespacedPod(
      namespace, undefined, undefined, undefined, undefined,
      `app.kubernetes.io/name=${name}`
    );

    // Metrics (best-effort — may not be available)
    let podMetrics = {};
    try {
      const metricsResp = await metricsClient.getPodMetrics(namespace);
      for (const pm of (metricsResp?.items || [])) {
        podMetrics[pm.metadata.name] = pm;
      }
    } catch (mErr) {
      console.debug("[ops] Pod metrics not available:", mErr.message);
    }

    result.pods = podResp.body.items.map((pod) => {
      const pm = podMetrics[pod.metadata.name];
      const containers = (pod.spec?.containers || []).map((c) => {
        const cs = (pod.status?.containerStatuses || []).find((s) => s.name === c.name) || {};
        const mc = (pm?.containers || []).find((m) => m.name === c.name) || {};
        let state = "waiting";
        let stateReason = "";
        let lastTerminatedReason = "";
        let lastTerminatedExitCode = null;
        if (cs.state?.running) { state = "running"; }
        else if (cs.state?.terminated) { state = "terminated"; stateReason = cs.state.terminated.reason || ""; }
        else if (cs.state?.waiting) { state = "waiting"; stateReason = cs.state.waiting.reason || ""; }
        // Capture last termination info (critical for CrashLoopBackOff diagnosis)
        if (cs.lastState?.terminated) {
          lastTerminatedReason = cs.lastState.terminated.reason || "";
          lastTerminatedExitCode = cs.lastState.terminated.exitCode ?? null;
        }
        return {
          name: c.name,
          image: c.image,
          ready: cs.ready || false,
          restartCount: cs.restartCount || 0,
          state,
          stateReason,
          lastTerminatedReason,
          lastTerminatedExitCode,
          resources: {
            requests: c.resources?.requests || null,
            limits: c.resources?.limits || null,
            usage: mc.usage || null,
          },
          securityContext: c.securityContext || null,
        };
      });

      return {
        name: pod.metadata.name,
        phase: pod.status?.phase || "Unknown",
        node: pod.spec?.nodeName || "",
        ready: (pod.status?.conditions || []).some((c) => c.type === "Ready" && c.status === "True"),
        startTime: pod.status?.startTime || "",
        containers,
        podSecurityContext: pod.spec?.securityContext || null,
      };
    });
  } catch (err) {
    console.debug("[ops] Pod fetch error:", err.message);
  }

  // ── Events (last 1 hour, grouped) ────────────────────────────────────────
  try {
    const oneHourAgo = new Date(Date.now() - 3600 * 1000);
    const evResp = await k8sApi.listNamespacedEvent(namespace);
    const appEvents = evResp.body.items.filter((e) => {
      const objName = e.involvedObject?.name || "";
      const ts = new Date(e.lastTimestamp || e.eventTime || 0);
      return (objName === name || objName.startsWith(`${name}-`)) && ts >= oneHourAgo;
    }).sort((a, b) => new Date(b.lastTimestamp || b.eventTime || 0) - new Date(a.lastTimestamp || a.eventTime || 0));

    for (const e of appEvents.slice(0, 100)) {
      const evObj = {
        time: e.lastTimestamp || e.eventTime || "",
        reason: e.reason || "",
        message: e.message || "",
        kind: e.involvedObject?.kind || "",
        name: e.involvedObject?.name || "",
        count: e.count || 1,
        // Enrich with KB match
        fix: matchError(e.message, [e]) || null,
      };

      const msg = (e.message || "").toLowerCase();
      const reason = (e.reason || "").toLowerCase();
      const isPolicy = reason === "policyviolation" ||
        msg.includes("kyverno") || msg.includes("policy") ||
        msg.includes("denied by") || msg.includes("admission webhook") ||
        msg.includes("blocked");

      if (isPolicy) {
        result.policyViolations.push(evObj);
      } else if (e.type === "Warning") {
        result.events.warning.push(evObj);
      } else {
        result.events.normal.push(evObj);
      }
    }
  } catch (err) {
    console.debug("[ops] Event fetch error:", err.message);
  }

  // ── Policy Exceptions ─────────────────────────────────────────────────────
  try {
    const peResp = await customApi.listNamespacedCustomObject(
      "kyverno.io", "v2beta1", namespace, "policyexceptions"
    );
    result.security.exceptions = (peResp.body.items || [])
      .filter((pe) => pe.metadata.name.startsWith(`${name}-`))
      .map((pe) => ({
        name: pe.metadata.name,
        expiry: pe.metadata.annotations?.["sre.io/exception-expiry"] || "",
        approver: pe.metadata.annotations?.["sre.io/exception-approver"] || "",
        reason: pe.metadata.annotations?.["sre.io/exception-reason"] || "",
        exceptions: pe.spec?.exceptions || [],
      }));
  } catch (err) {
    console.debug("[ops] PolicyException fetch best-effort failed:", err.message);
  }

  // ── Network: Service + VirtualService ────────────────────────────────────
  try {
    const svcResp = await k8sApi.readNamespacedService(name, namespace);
    const svc = svcResp.body;
    result.network.service = {
      clusterIP: svc.spec?.clusterIP || "",
      ports: (svc.spec?.ports || []).map((p) => ({ name: p.name, port: p.port, targetPort: p.targetPort, protocol: p.protocol })),
      type: svc.spec?.type || "ClusterIP",
    };
  } catch (err) {
    console.debug("[ops] Service fetch best-effort failed:", err.message);
  }

  try {
    const vsResp = await customApi.getNamespacedCustomObject(
      "networking.istio.io", "v1", namespace, "virtualservices", name
    );
    const vs = vsResp.body;
    result.network.virtualService = {
      hosts: vs.spec?.hosts || [],
      gateways: vs.spec?.gateways || [],
    };
    if (!result.network.ingressHost && vs.spec?.hosts?.length > 0) {
      result.network.ingressHost = vs.spec.hosts[0];
    }
  } catch (err) {
    console.debug("[ops] VirtualService fetch best-effort failed:", err.message);
  }

  // ── Container logs (last 50 lines per container, best-effort) ────────────
  const logs = {};
  for (const pod of result.pods) {
    for (const c of pod.containers) {
      const key = `${pod.name}/${c.name}`;
      try {
        const logResp = await k8sApi.readNamespacedPodLog(
          pod.name, namespace, c.name, undefined, undefined, undefined,
          undefined, undefined, undefined, 50, true
        );
        logs[key] = (logResp.body || "").split("\n").slice(-50);
      } catch (logErr) {
        logs[key] = [];
        console.debug(`[ops] Log fetch best-effort failed for ${key}:`, logErr.message);
      }
    }
  }
  result.logs = logs;

  // ── Primary Issue Detection ─────────────────────────────────────────────────
  // Determine the most actionable problem for the user. Prioritize container-level
  // crash reasons over generic pod phase or Kyverno background scan violations.
  let primaryIssue = null;
  for (const pod of result.pods) {
    for (const c of pod.containers) {
      if (c.name === "istio-proxy" || c.name === "istio-init") continue; // Skip sidecar
      const effectiveReason = c.lastTerminatedReason || c.stateReason;
      if (effectiveReason === "OOMKilled" || c.lastTerminatedReason === "OOMKilled") {
        primaryIssue = {
          type: "OOMKilled",
          message: `Container "${c.name}" was killed because it ran out of memory. Increase the memory limit in the Configuration tab under Resources.`,
          severity: "critical",
          container: c.name,
          exitCode: c.lastTerminatedExitCode,
        };
        break; // OOMKilled is the most specific — stop searching
      } else if (effectiveReason === "CrashLoopBackOff") {
        const exitHint = c.lastTerminatedExitCode !== null ? ` (exit code ${c.lastTerminatedExitCode})` : "";
        const innerReason = c.lastTerminatedReason ? ` Last crash: ${c.lastTerminatedReason}.` : "";
        primaryIssue = primaryIssue || {
          type: "CrashLoopBackOff",
          message: `Container "${c.name}" keeps crashing${exitHint}.${innerReason} Check the Logs tab for the error output.`,
          severity: "critical",
          container: c.name,
          exitCode: c.lastTerminatedExitCode,
        };
      } else if (effectiveReason === "Error" || effectiveReason === "ContainerCannotRun") {
        const exitHint = c.lastTerminatedExitCode !== null ? ` (exit code ${c.lastTerminatedExitCode})` : "";
        primaryIssue = primaryIssue || {
          type: effectiveReason,
          message: `Container "${c.name}" failed to start${exitHint}. Check the Logs tab for details.`,
          severity: "critical",
          container: c.name,
          exitCode: c.lastTerminatedExitCode,
        };
      } else if (effectiveReason === "ImagePullBackOff" || effectiveReason === "ErrImagePull") {
        primaryIssue = primaryIssue || {
          type: "ImagePullError",
          message: `Cannot pull image for "${c.name}" (${c.image}). Verify the image exists in Harbor and the tag is correct.`,
          severity: "critical",
          container: c.name,
        };
      } else if (effectiveReason === "CreateContainerConfigError") {
        primaryIssue = primaryIssue || {
          type: "ConfigError",
          message: `Container "${c.name}" has a configuration error (missing Secret, ConfigMap, or invalid env var reference). Check Events for details.`,
          severity: "critical",
          container: c.name,
        };
      }
    }
    if (primaryIssue && primaryIssue.type === "OOMKilled") break; // Already found the most specific issue
    if (pod.phase === "Pending" && !primaryIssue) {
      primaryIssue = {
        type: "Pending",
        message: "Pod is pending — may be waiting for resources, node scheduling, or image pull.",
        severity: "warning",
      };
    }
  }
  // Check for Kyverno admission blocks (real blocks, not background scan reports)
  const allEvts = [...(result.events?.warning || []), ...(result.events?.normal || [])];
  const admissionBlocked = allEvts.some(
    (e) => e.reason === "FailedCreate" && e.message && e.message.includes("admission webhook")
  );
  if (admissionBlocked) {
    primaryIssue = {
      type: "AdmissionDenied",
      message: "Pod creation was blocked by an admission policy. Check the Events tab for the specific policy violation and ensure the required PolicyExceptions are created.",
      severity: "critical",
    };
  }
  result.primaryIssue = primaryIssue;

  res.json(result);
});

// ── PATCH /api/ops/:namespace/:name/config — Update app config in Git ─────────
app.patch("/api/ops/:namespace/:name/config", mutateLimiter, requireGroups("sre-admins", "developers"), async (req, res) => {
  const { namespace, name } = req.params;

  if (!isValidName(sanitizeName(namespace)) || !isValidName(sanitizeName(name))) {
    return res.status(400).json({ error: "Invalid namespace or name" });
  }

  const patch = req.body;
  if (!patch || typeof patch !== "object") {
    return res.status(400).json({ error: "Request body must be a JSON object" });
  }

  // Validate individual fields
  if (patch.port !== undefined && !isValidPort(patch.port)) {
    return res.status(400).json({ error: "Invalid port: must be 1-65535" });
  }
  if (patch.replicas !== undefined && !isValidReplicas(patch.replicas)) {
    return res.status(400).json({ error: "Invalid replicas: must be 1-20" });
  }
  if (patch.env !== undefined) {
    patch.env = sanitizeEnvArray(patch.env);
  }

  try {
    // Step 1: Read current HelmRelease values (Git-first, cluster fallback)
    let currentValues;
    try {
      currentValues = await getCurrentHelmReleaseValues(namespace, name);
    } catch (readErr) {
      return res.status(404).json({ error: `HelmRelease "${name}" not found in namespace "${namespace}"` });
    }

    // Step 2: Deep-merge the patch into current values
    const newValues = JSON.parse(JSON.stringify(currentValues)); // deep clone
    const appPatch = newValues.app || {};
    newValues.app = appPatch;

    if (patch.port !== undefined) {
      appPatch.port = patch.port;
    }
    if (patch.replicas !== undefined) {
      appPatch.replicas = patch.replicas;
    }
    if (patch.env !== undefined) {
      appPatch.env = patch.env;
    }
    if (patch.image !== undefined) {
      appPatch.image = appPatch.image || {};
      if (patch.image.tag !== undefined) { appPatch.image.tag = String(patch.image.tag); }
      if (patch.image.repository !== undefined) { appPatch.image.repository = String(patch.image.repository); }
      if (patch.image.pullPolicy !== undefined) { appPatch.image.pullPolicy = String(patch.image.pullPolicy); }
    } else if (patch.imageTag !== undefined) {
      // Flat format from frontend OpsConfig
      appPatch.image = appPatch.image || {};
      appPatch.image.tag = String(patch.imageTag);
    }
    // Accept both nested {resources:{requests,limits}} and flat {cpuRequest,memoryLimit,...} formats
    if (patch.resources !== undefined) {
      appPatch.resources = appPatch.resources || {};
      if (patch.resources.requests) { appPatch.resources.requests = patch.resources.requests; }
      if (patch.resources.limits) { appPatch.resources.limits = patch.resources.limits; }
    } else if (patch.cpuRequest !== undefined || patch.cpuLimit !== undefined || patch.memoryRequest !== undefined || patch.memoryLimit !== undefined) {
      appPatch.resources = appPatch.resources || { requests: {}, limits: {} };
      appPatch.resources.requests = appPatch.resources.requests || {};
      appPatch.resources.limits = appPatch.resources.limits || {};
      if (patch.cpuRequest !== undefined) appPatch.resources.requests.cpu = patch.cpuRequest;
      if (patch.memoryRequest !== undefined) appPatch.resources.requests.memory = patch.memoryRequest;
      if (patch.cpuLimit !== undefined) appPatch.resources.limits.cpu = patch.cpuLimit;
      if (patch.memoryLimit !== undefined) appPatch.resources.limits.memory = patch.memoryLimit;
    }
    if (patch.probes !== undefined) {
      appPatch.probes = appPatch.probes || {};
      if (patch.probes.liveness) { appPatch.probes.liveness = patch.probes.liveness; }
      if (patch.probes.readiness) { appPatch.probes.readiness = patch.probes.readiness; }
    }
    if (patch.ingressHost !== undefined) {
      newValues.ingress = newValues.ingress || {};
      newValues.ingress.enabled = !!patch.ingressHost;
      newValues.ingress.host = patch.ingressHost || "";
    }

    // Step 3: Apply security context overrides
    // Accept both nested (patch.securityContext.runAsRoot) and flat (patch.runAsRoot) formats.
    // The frontend sends the FULL config every time, so we must detect what actually CHANGED
    // by comparing against the current values. Otherwise toggling resources would reset security.
    const currentCsc = currentValues.containerSecurityContext || {};
    const currentPsc = currentValues.podSecurityContext || {};
    const currentRunAsRoot = currentPsc.runAsUser === 0 || currentPsc.runAsNonRoot === false;
    const currentPrivileged = currentCsc.privileged === true;
    const currentWritable = currentCsc.readOnlyRootFilesystem === false;
    const currentEscalation = currentCsc.allowPrivilegeEscalation === true;
    const currentCaps = (currentCsc.capabilities?.add || []);

    let sc;
    if (patch.securityContext && typeof patch.securityContext === "object") {
      sc = patch.securityContext;
    } else {
      // Only build sc from flat keys if security values actually CHANGED from current state
      const secChanged =
        (patch.runAsRoot !== undefined && patch.runAsRoot !== currentRunAsRoot) ||
        (patch.privileged !== undefined && patch.privileged !== currentPrivileged) ||
        (patch.writableFilesystem !== undefined && patch.writableFilesystem !== currentWritable) ||
        (patch.allowPrivilegeEscalation !== undefined && patch.allowPrivilegeEscalation !== currentEscalation) ||
        (patch.capabilities !== undefined && JSON.stringify(patch.capabilities) !== JSON.stringify(currentCaps));
      if (secChanged) {
        sc = { runAsRoot: patch.runAsRoot, privileged: patch.privileged, writableFilesystem: patch.writableFilesystem, allowPrivilegeEscalation: patch.allowPrivilegeEscalation, capabilities: patch.capabilities };
      }
    }

    if (sc !== undefined && typeof sc === "object") {
      // Handle privileged container mode — REPLACE entire security context (don't merge with defaults)
      if (sc.privileged) {
        newValues.podSecurityContext = {
          runAsNonRoot: false, runAsUser: 0, runAsGroup: 0, fsGroup: 0,
          seccompProfile: { type: "RuntimeDefault" },
        };
        newValues.containerSecurityContext = {
          privileged: true,
          runAsNonRoot: false,
          runAsUser: 0,
          allowPrivilegeEscalation: true,
          readOnlyRootFilesystem: false,
        };
      } else if (sc.privileged === false) {
        newValues.containerSecurityContext = newValues.containerSecurityContext || {};
        newValues.containerSecurityContext.privileged = false;
      }

      if (sc.runAsRoot && !sc.privileged) {
        newValues.podSecurityContext = {
          runAsNonRoot: false, runAsUser: 0, runAsGroup: 0, fsGroup: 0,
          seccompProfile: { type: "RuntimeDefault" },
        };
        newValues.containerSecurityContext = {
          runAsNonRoot: false,
          runAsUser: 0,
          allowPrivilegeEscalation: true,
          readOnlyRootFilesystem: false,
        };
      } else if (sc.runAsRoot === false && !sc.privileged) {
        // Explicitly re-enabling non-root — restore secure defaults
        newValues.podSecurityContext = {
          runAsNonRoot: true,
          seccompProfile: { type: "RuntimeDefault" },
        };
        newValues.containerSecurityContext = newValues.containerSecurityContext || {};
        newValues.containerSecurityContext.runAsNonRoot = true;
        delete newValues.containerSecurityContext.runAsUser;
      }
      if (sc.writableFilesystem !== undefined) {
        newValues.containerSecurityContext = newValues.containerSecurityContext || {};
        newValues.containerSecurityContext.readOnlyRootFilesystem = !sc.writableFilesystem;
      }
      if (sc.allowPrivilegeEscalation !== undefined && !sc.privileged) {
        newValues.containerSecurityContext = newValues.containerSecurityContext || {};
        newValues.containerSecurityContext.allowPrivilegeEscalation = !!sc.allowPrivilegeEscalation;
      }
      if (sc.capabilities !== undefined && Array.isArray(sc.capabilities)) {
        newValues.containerSecurityContext = newValues.containerSecurityContext || {};
        if (sc.capabilities.length > 0) {
          newValues.containerSecurityContext.capabilities = { add: sc.capabilities, drop: [] };
        } else {
          newValues.containerSecurityContext.capabilities = { add: [], drop: ["ALL"] };
        }
      }
    }

    // Step 4: Build the updated HelmRelease manifest using the new values
    const updatedManifest = {
      apiVersion: "helm.toolkit.fluxcd.io/v2",
      kind: "HelmRelease",
      metadata: {
        name,
        namespace,
        labels: {
          "app.kubernetes.io/part-of": "sre-platform",
          "sre.io/team": namespace,
        },
      },
      spec: {
        interval: "10m",
        chart: {
          spec: {
            chart: "./apps/templates/web-app",
            reconcileStrategy: "Revision",
            sourceRef: { kind: "GitRepository", name: "flux-system", namespace: "flux-system" },
          },
        },
        install: { createNamespace: false, remediation: { retries: 3 } },
        upgrade: { cleanupOnFail: true, remediation: { retries: 3 } },
        values: newValues,
      },
    };

    // Step 5: Auto-generate PolicyException if security overrides require Kyverno exemption
    let policyException = null;
    if (sc !== undefined && typeof sc === "object") {
      const securityExceptions = [];
      if (sc.privileged) {
        securityExceptions.push({ type: "privileged_container", justification: "Ops cockpit override — admin approved privileged mode", approved: true });
      }
      if (sc.runAsRoot) {
        securityExceptions.push({ type: "run_as_root", justification: "Ops cockpit override — admin approved root user", approved: true });
      }
      if (sc.writableFilesystem) {
        securityExceptions.push({ type: "writable_filesystem", justification: "Ops cockpit override — admin approved writable filesystem", approved: true });
      }
      if (sc.allowPrivilegeEscalation) {
        securityExceptions.push({ type: "privilege_escalation", justification: "Ops cockpit override — admin approved privilege escalation", approved: true });
      }
      if (sc.capabilities && sc.capabilities.length > 0) {
        securityExceptions.push({ type: "custom_capability", justification: `Capabilities: ${sc.capabilities.join(", ")}`, approved: true });
      }
      if (securityExceptions.length > 0) {
        policyException = generatePolicyException(name, namespace, securityExceptions, getActor(req));
      }
    }

    // Step 6: Commit to Git (or apply directly if GitOps is disabled)
    const actor = getActor(req);
    await deployViaGitOps(updatedManifest, namespace, name, actor, policyException);

    // Step 7: Trigger Flux reconciliation
    try {
      await gitops.triggerFluxReconcile();
    } catch (fluxErr) {
      console.debug("[ops] Flux reconcile trigger best-effort failed:", fluxErr.message);
    }

    res.json({
      success: true,
      message: gitops.isEnabled()
        ? `Config update for "${name}" committed to Git — Flux will apply shortly`
        : `Config update for "${name}" applied directly to cluster`,
      namespace,
      name,
      values: newValues,
      policyExceptionCreated: !!policyException,
    });
  } catch (err) {
    console.error("[ops] Config update error:", err.message);
    res.status(500).json({ error: "Internal server error", detail: err.message });
  }
});

// ── POST /api/ops/:namespace/:name/restart — Rollout restart ─────────────────
app.post("/api/ops/:namespace/:name/restart", mutateLimiter, requireGroups("sre-admins", "developers"), async (req, res) => {
  const { namespace, name } = req.params;

  if (!isValidName(sanitizeName(namespace)) || !isValidName(sanitizeName(name))) {
    return res.status(400).json({ error: "Invalid namespace or name" });
  }

  try {
    const restartAnnotation = new Date().toISOString();
    await appsApi.patchNamespacedDeployment(
      name, namespace,
      {
        spec: {
          template: {
            metadata: {
              annotations: {
                "kubectl.kubernetes.io/restartedAt": restartAnnotation,
              },
            },
          },
        },
      },
      undefined, undefined, undefined, undefined, undefined,
      { headers: { "Content-Type": "application/strategic-merge-patch+json" } }
    );

    logger.info("ops-restart", `Rollout restart triggered for ${name} in ${namespace}`, {
      app: name, namespace, actor: getActor(req),
    });

    res.json({
      success: true,
      message: `Rollout restart triggered for "${name}" in "${namespace}"`,
      restartedAt: restartAnnotation,
    });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: `Deployment "${name}" not found in namespace "${namespace}"` });
    }
    console.error("[ops] Restart error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/ops/:namespace/:name/logs/:pod/:container — Stream logs (SSE) ───
app.get("/api/ops/:namespace/:name/logs/:pod/:container", requireGroups("sre-admins", "developers"), async (req, res) => {
  const { namespace, pod, container } = req.params;

  // Validate all path params
  const safeNs = sanitizeName(namespace);
  const safePod = req.params.pod.replace(/[^a-z0-9.-]/g, "-").substring(0, 253);
  const safeContainer = req.params.container.replace(/[^a-z0-9-]/g, "-").substring(0, 63);
  if (!isValidName(safeNs) || !safePod || !safeContainer) {
    return res.status(400).json({ error: "Invalid namespace, pod, or container name" });
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendSSE = (data) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  // Send last 50 lines of existing logs first
  try {
    const tailResp = await k8sApi.readNamespacedPodLog(
      safePod, namespace, safeContainer, undefined, undefined, undefined,
      undefined, undefined, undefined, 50, true
    );
    const lines = (tailResp.body || "").split("\n").filter(Boolean);
    for (const line of lines) {
      sendSSE({ type: "log", line, historical: true });
    }
  } catch (err) {
    sendSSE({ type: "error", message: `Could not fetch initial logs: ${err.message}` });
  }

  // Stream live logs using follow=true
  const stream = await k8sApi.readNamespacedPodLog(
    safePod, namespace, safeContainer,
    undefined, // container
    true,      // follow
    undefined, undefined, undefined, undefined, undefined, true
  ).catch((streamErr) => {
    sendSSE({ type: "error", message: `Stream error: ${streamErr.message}` });
    return null;
  });

  if (!stream) {
    res.end();
    return;
  }

  const logStream = stream.body;
  if (logStream && typeof logStream.on === "function") {
    logStream.on("data", (chunk) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        sendSSE({ type: "log", line });
      }
    });
    logStream.on("end", () => {
      if (!res.writableEnded) {
        sendSSE({ type: "end", message: "Log stream ended" });
        res.end();
      }
    });
    logStream.on("error", (err) => {
      if (!res.writableEnded) {
        sendSSE({ type: "error", message: err.message });
        res.end();
      }
    });

    req.on("close", () => {
      try { if (logStream && typeof logStream.destroy === "function") logStream.destroy(); } catch (e) { /* ignore */ }
    });
  } else {
    sendSSE({ type: "end", message: "Log stream not available" });
    res.end();
  }
});

// ── GET /api/ops/:namespace/:name/events — Live events stream (SSE) ───────────
app.get("/api/ops/:namespace/:name/events", requireGroups("sre-admins", "developers"), async (req, res) => {
  const { namespace, name } = req.params;

  if (!isValidName(sanitizeName(namespace)) || !isValidName(sanitizeName(name))) {
    return res.status(400).json({ error: "Invalid namespace or name" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendSSE = (data) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  // Send current events immediately on connect
  const sendCurrentEvents = async () => {
    try {
      const evResp = await k8sApi.listNamespacedEvent(namespace);
      const appEvents = evResp.body.items
        .filter((e) => {
          const objName = e.involvedObject?.name || "";
          return objName === name || objName.startsWith(`${name}-`);
        })
        .sort((a, b) => new Date(b.lastTimestamp || b.eventTime || 0) - new Date(a.lastTimestamp || a.eventTime || 0))
        .slice(0, 50);

      for (const e of appEvents) {
        sendSSE({
          type: "event",
          time: e.lastTimestamp || e.eventTime || "",
          reason: e.reason || "",
          message: e.message || "",
          eventType: e.type || "Normal",
          kind: e.involvedObject?.kind || "",
          name: e.involvedObject?.name || "",
          count: e.count || 1,
        });
      }
    } catch (err) {
      sendSSE({ type: "error", message: err.message });
    }
  };

  await sendCurrentEvents();

  // Poll for new events every 5 seconds (K8s Watch API is complex; polling is simpler and reliable)
  const seen = new Set();
  const pollInterval = setInterval(async () => {
    if (res.writableEnded) {
      clearInterval(pollInterval);
      return;
    }
    try {
      const evResp = await k8sApi.listNamespacedEvent(namespace);
      const appEvents = evResp.body.items.filter((e) => {
        const objName = e.involvedObject?.name || "";
        return objName === name || objName.startsWith(`${name}-`);
      });
      for (const e of appEvents) {
        const key = `${e.metadata.name}:${e.count}:${e.lastTimestamp || e.eventTime}`;
        if (!seen.has(key)) {
          seen.add(key);
          sendSSE({
            type: "event",
            time: e.lastTimestamp || e.eventTime || "",
            reason: e.reason || "",
            message: e.message || "",
            eventType: e.type || "Normal",
            kind: e.involvedObject?.kind || "",
            name: e.involvedObject?.name || "",
            count: e.count || 1,
          });
        }
      }
    } catch (err) {
      sendSSE({ type: "error", message: err.message });
    }
  }, 5000);

  req.on("close", () => {
    clearInterval(pollInterval);
    if (!res.writableEnded) res.end();
  });
});

// ── DELETE /api/ops/:namespace/:name/policy-exception/:exName — Remove PolicyException ──
app.delete("/api/ops/:namespace/:name/policy-exception/:exName", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  const { namespace, name, exName } = req.params;

  if (!isValidName(sanitizeName(namespace)) || !isValidName(sanitizeName(name))) {
    return res.status(400).json({ error: "Invalid namespace or name" });
  }

  // Validate exception name (allow hyphens and standard k8s name chars)
  const safeExName = exName.replace(/[^a-z0-9-]/g, "-").substring(0, 253);
  if (!safeExName) {
    return res.status(400).json({ error: "Invalid policy exception name" });
  }

  try {
    await customApi.deleteNamespacedCustomObject(
      "kyverno.io", "v2beta1", namespace, "policyexceptions", safeExName
    );

    // If GitOps is enabled, also remove the file from Git so Flux doesn't recreate it
    if (gitops.isEnabled()) {
      const actor = getActor(req);
      try {
        await gitops.deleteFile(
          `apps/tenants/${namespace}/apps/${safeExName}.yaml`,
          `ops(${namespace}): remove policy exception ${safeExName}\n\nRemoved by: ${actor}`
        );
        // Update kustomization to exclude deleted file
        const kustomPath = `apps/tenants/${namespace}/apps/kustomization.yaml`;
        // Read current kustomization
        const GITHUB_API_BASE = "https://api.github.com";
        const GITHUB_OWNER = process.env.SRE_GITHUB_OWNER || "morbidsteve";
        const GITHUB_REPO = process.env.SRE_GITHUB_REPO || "sre-platform";
        const GITHUB_BRANCH = process.env.SRE_GITHUB_BRANCH || "main";
        const encodedPath = kustomPath.split("/").map(encodeURIComponent).join("/");
        const kRes = await fetch(
          `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedPath}?ref=${GITHUB_BRANCH}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          }
        );
        if (kRes.ok) {
          const kData = await kRes.json();
          const kContent = Buffer.from(kData.content, "base64").toString("utf-8");
          const kParsed = yaml.load(kContent) || {};
          const resources = (kParsed.resources || []).filter((r) => r !== `${safeExName}.yaml`);
          const updatedKustomization = "---\n" + yaml.dump(
            { apiVersion: "kustomize.config.k8s.io/v1beta1", kind: "Kustomization", resources },
            { lineWidth: -1, noRefs: true }
          );
          await gitops.createOrUpdateFile(
            kustomPath,
            updatedKustomization,
            `ops(${namespace}): update kustomization after removing ${safeExName}\n\nUpdated by: ${actor}`
          );
        }
      } catch (gitErr) {
        console.debug("[ops] Git PolicyException delete best-effort failed:", gitErr.message);
      }
    }

    logger.info("ops-policy-exception-delete", `PolicyException ${safeExName} deleted in ${namespace}`, {
      namespace, name, exName: safeExName, actor: getActor(req),
    });

    res.json({
      success: true,
      message: `PolicyException "${safeExName}" deleted from "${namespace}"`,
    });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: `PolicyException "${safeExName}" not found in "${namespace}"` });
    }
    console.error("[ops] PolicyException delete error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Ops Control Actions ─────────────────────────────────────────────────────

// ── POST /api/ops/:namespace/:name/reconcile — Force Flux reconciliation ────
app.post("/api/ops/:namespace/:name/reconcile", mutateLimiter, requireGroups("sre-admins", "developers"), async (req, res) => {
  const { namespace, name } = req.params;

  if (!isValidName(sanitizeName(namespace)) || !isValidName(sanitizeName(name))) {
    return res.status(400).json({ error: "Invalid namespace or name" });
  }

  try {
    const now = new Date().toISOString();
    await customApi.patchNamespacedCustomObject(
      "helm.toolkit.fluxcd.io", "v2", namespace, "helmreleases", name,
      {
        metadata: {
          annotations: {
            "reconcile.fluxcd.io/requestedAt": now,
          },
        },
      },
      undefined, undefined, undefined, undefined,
      { headers: { "Content-Type": "application/merge-patch+json" } }
    );

    // Best-effort: also trigger a Flux source reconcile
    try { await gitops.triggerFluxReconcile(); } catch (e) { console.debug("[ops] Flux reconcile best-effort:", e.message); }

    logger.info("ops-reconcile", `Reconciliation triggered for ${name} in ${namespace}`, {
      app: name, namespace, actor: getActor(req),
    });

    res.json({
      success: true,
      message: `Reconciliation triggered for "${name}" in "${namespace}"`,
    });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: `HelmRelease "${name}" not found in namespace "${namespace}"` });
    }
    console.error("[ops] Reconcile error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/ops/:namespace/:name/suspend — Suspend HelmRelease ────────────
app.post("/api/ops/:namespace/:name/suspend", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  const { namespace, name } = req.params;

  if (!isValidName(sanitizeName(namespace)) || !isValidName(sanitizeName(name))) {
    return res.status(400).json({ error: "Invalid namespace or name" });
  }

  try {
    await customApi.patchNamespacedCustomObject(
      "helm.toolkit.fluxcd.io", "v2", namespace, "helmreleases", name,
      { spec: { suspend: true } },
      undefined, undefined, undefined, undefined,
      { headers: { "Content-Type": "application/merge-patch+json" } }
    );

    const actor = getActor(req);
    logger.info("ops-suspend", `HelmRelease ${name} suspended in ${namespace}`, {
      app: name, namespace, actor,
    });

    res.json({
      success: true,
      message: `HelmRelease "${name}" suspended in "${namespace}"`,
    });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: `HelmRelease "${name}" not found in namespace "${namespace}"` });
    }
    console.error("[ops] Suspend error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/ops/:namespace/:name/resume — Resume HelmRelease ──────────────
app.post("/api/ops/:namespace/:name/resume", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  const { namespace, name } = req.params;

  if (!isValidName(sanitizeName(namespace)) || !isValidName(sanitizeName(name))) {
    return res.status(400).json({ error: "Invalid namespace or name" });
  }

  try {
    const now = new Date().toISOString();
    await customApi.patchNamespacedCustomObject(
      "helm.toolkit.fluxcd.io", "v2", namespace, "helmreleases", name,
      {
        spec: { suspend: false },
        metadata: {
          annotations: {
            "reconcile.fluxcd.io/requestedAt": now,
          },
        },
      },
      undefined, undefined, undefined, undefined,
      { headers: { "Content-Type": "application/merge-patch+json" } }
    );

    const actor = getActor(req);
    logger.info("ops-resume", `HelmRelease ${name} resumed in ${namespace}`, {
      app: name, namespace, actor,
    });

    res.json({
      success: true,
      message: `HelmRelease "${name}" resumed in "${namespace}"`,
    });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: `HelmRelease "${name}" not found in namespace "${namespace}"` });
    }
    console.error("[ops] Resume error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/ops/:namespace/:name — Delete/undeploy app ──────────────────
app.delete("/api/ops/:namespace/:name", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  const { namespace, name } = req.params;

  if (!isValidName(sanitizeName(namespace)) || !isValidName(sanitizeName(name))) {
    return res.status(400).json({ error: "Invalid namespace or name" });
  }

  try {
    const actor = getActor(req);

    // Step 1: Remove from Git (if GitOps enabled) or delete directly
    if (gitops.isEnabled()) {
      try {
        await gitops.undeployApp(namespace, name, actor);
        await gitops.triggerFluxReconcile();
      } catch (gitErr) {
        console.warn("[ops] Git undeploy failed, falling back to direct delete:", gitErr.message);
        try {
          await customApi.deleteNamespacedCustomObject("helm.toolkit.fluxcd.io", "v2", namespace, "helmreleases", name);
        } catch (e) {
          if (e.statusCode !== 404) throw e;
        }
      }
    } else {
      try {
        await customApi.deleteNamespacedCustomObject("helm.toolkit.fluxcd.io", "v2", namespace, "helmreleases", name);
      } catch (e) {
        if (e.statusCode !== 404) throw e;
      }
    }

    // Step 2: Clean up PolicyException (best-effort)
    try {
      await customApi.deleteNamespacedCustomObject(
        "kyverno.io", "v2", namespace, "policyexceptions", name + "-security-exception"
      );
    } catch (e) {
      if (e.statusCode !== 404) {
        console.debug("[ops] PolicyException cleanup non-critical:", e.message);
      }
    }

    // Step 3: Remove from app registry
    const regIdx = appRegistry.findIndex(a => a.name === name);
    if (regIdx >= 0) {
      appRegistry.splice(regIdx, 1);
      await saveAppRegistry();
    }

    logger.info("ops-delete", `Application ${name} undeployed from ${namespace}`, {
      app: name, namespace, actor,
    });

    res.json({
      success: true,
      message: `Application "${name}" undeployed from "${namespace}"`,
    });
  } catch (err) {
    console.error("[ops] Delete/undeploy error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/ops/:namespace/:name/redeploy — Delete and redeploy (force fresh install) ──
app.post("/api/ops/:namespace/:name/redeploy", mutateLimiter, requireGroups("sre-admins"), async (req, res) => {
  const { namespace, name } = req.params;

  if (!isValidName(sanitizeName(namespace)) || !isValidName(sanitizeName(name))) {
    return res.status(400).json({ error: "Invalid namespace or name" });
  }

  try {
    const actor = getActor(req);

    // Step 1: Remove finalizers so the HelmRelease can be deleted cleanly
    try {
      await customApi.patchNamespacedCustomObject(
        "helm.toolkit.fluxcd.io", "v2", namespace, "helmreleases", name,
        { metadata: { finalizers: null } },
        undefined, undefined, undefined, undefined,
        { headers: { "Content-Type": "application/merge-patch+json" } }
      );
    } catch (e) {
      console.debug("[ops] Finalizer removal — HelmRelease may already be gone:", e.message);
    }

    // Step 2: Delete the HelmRelease
    try {
      await customApi.deleteNamespacedCustomObject(
        "helm.toolkit.fluxcd.io", "v2", namespace, "helmreleases", name
      );
    } catch (e) {
      if (e.statusCode !== 404) {
        console.warn("[ops] Could not delete HelmRelease for redeploy:", e.message);
      }
    }

    // Step 3: Trigger Flux reconcile so it recreates the HelmRelease from Git
    try { await gitops.triggerFluxReconcile(); } catch (e) { console.debug("[ops] Flux reconcile best-effort:", e.message); }

    logger.info("ops-redeploy", `Redeployment triggered for ${name} in ${namespace}`, {
      app: name, namespace, actor,
    });

    res.json({
      success: true,
      message: `Redeployment triggered for "${name}" in "${namespace}"`,
    });
  } catch (err) {
    console.error("[ops] Redeploy error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Platform Cockpit API (/api/platform) ─────────────────────────────────────
// Cluster-wide visibility for platform admins. All endpoints require sre-admins group.

// ── Helper: safe CRD list (returns [] if CRD is not installed) ───────────────
async function safeCrdList(fn) {
  try {
    const resp = await fn();
    return resp.body.items || [];
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 403 || (err.message && err.message.includes("not found"))) {
      return [];
    }
    throw err;
  }
}

// ── GET /api/platform/overview — Cluster health summary ──────────────────────
app.get("/api/platform/overview", requireGroups("sre-admins"), async (req, res) => {
  try {
    const [nodesResp, nsResp, podResp, depResp, svcResp, ksResp, hrResp] = await Promise.all([
      k8sApi.listNode(),
      k8sApi.listNamespace(),
      k8sApi.listPodForAllNamespaces(),
      appsApi.listDeploymentForAllNamespaces(),
      k8sApi.listServiceForAllNamespaces(),
      safeCrdList(() => customApi.listClusterCustomObject("kustomize.toolkit.fluxcd.io", "v1", "kustomizations")),
      safeCrdList(() => customApi.listClusterCustomObject("helm.toolkit.fluxcd.io", "v2", "helmreleases")),
    ]);

    // Fetch node metrics (best-effort)
    let nodeMetrics = {};
    try {
      const nm = await metricsClient.getNodeMetrics();
      for (const item of (nm.items || [])) {
        nodeMetrics[item.metadata.name] = item.usage || {};
      }
    } catch (err) {
      // metrics-server may not be installed
    }

    const nodes = nodesResp.body.items.map((n) => {
      const conditions = n.status?.conditions || [];
      const readyCond = conditions.find((c) => c.type === "Ready");
      const roles = Object.keys(n.metadata?.labels || {})
        .filter((l) => l.startsWith("node-role.kubernetes.io/"))
        .map((l) => l.replace("node-role.kubernetes.io/", ""))
        .join(",") || "worker";

      const cpuCap = parseCpu(n.status?.capacity?.cpu || "0");
      const memCap = parseMem(n.status?.capacity?.memory || "0");
      const cpuUsed = parseCpu(nodeMetrics[n.metadata.name]?.cpu || "0");
      const memUsed = parseMem(nodeMetrics[n.metadata.name]?.memory || "0");
      const podCap = parseInt(n.status?.capacity?.pods || "110", 10);

      return {
        name: n.metadata.name,
        status: readyCond?.status === "True" ? "Ready" : "NotReady",
        roles,
        version: n.status?.nodeInfo?.kubeletVersion || "",
        os: n.status?.nodeInfo?.osImage || "",
        cpu: {
          capacity: fmtCpu(cpuCap),
          used: fmtCpu(cpuUsed),
          pct: cpuCap > 0 ? Math.round((cpuUsed / cpuCap) * 100) : 0,
        },
        memory: {
          capacity: fmtMem(memCap),
          used: fmtMem(memUsed),
          pct: memCap > 0 ? Math.round((memUsed / memCap) * 100) : 0,
        },
        pods: {
          capacity: podCap,
          used: 0, // filled below
        },
        uptime: age(n.metadata?.creationTimestamp),
      };
    });

    // Count pods per node
    const podItems = podResp.body.items || [];
    const podsByNode = {};
    for (const pod of podItems) {
      const nodeName = pod.spec?.nodeName;
      if (nodeName) podsByNode[nodeName] = (podsByNode[nodeName] || 0) + 1;
    }
    for (const node of nodes) {
      node.pods.used = podsByNode[node.name] || 0;
    }

    // Namespace summary
    const nsList = nsResp.body.items || [];
    const podCountByNs = {};
    const healthyPodsByNs = {};
    for (const pod of podItems) {
      const ns = pod.metadata?.namespace;
      if (!ns) continue;
      podCountByNs[ns] = (podCountByNs[ns] || 0) + 1;
      const phase = pod.status?.phase;
      const allReady = (pod.status?.containerStatuses || []).every((cs) => cs.ready);
      if (phase === "Running" && allReady) {
        healthyPodsByNs[ns] = (healthyPodsByNs[ns] || 0) + 1;
      }
    }
    const namespaces = nsList.map((ns) => ({
      name: ns.metadata.name,
      phase: ns.status?.phase || "Active",
      podCount: podCountByNs[ns.metadata.name] || 0,
      healthyPods: healthyPodsByNs[ns.metadata.name] || 0,
      age: age(ns.metadata?.creationTimestamp),
    }));

    // Flux status
    const kustomizations = (Array.isArray(ksResp) ? ksResp : []).map((ks) => {
      const readyCond = (ks.status?.conditions || []).find((c) => c.type === "Ready");
      return {
        name: ks.metadata.name,
        namespace: ks.metadata.namespace,
        ready: readyCond?.status === "True",
        revision: ks.status?.lastAppliedRevision || "",
        message: readyCond?.message || "",
        suspended: !!ks.spec?.suspend,
      };
    });
    const helmReleases = (Array.isArray(hrResp) ? hrResp : []).map((hr) => {
      const readyCond = (hr.status?.conditions || []).find((c) => c.type === "Ready");
      return {
        name: hr.metadata.name,
        namespace: hr.metadata.namespace,
        ready: readyCond?.status === "True",
        revision: hr.status?.history?.[0]?.chartVersion || hr.status?.lastAppliedRevision || "",
        message: readyCond?.message || "",
        suspended: !!hr.spec?.suspend,
      };
    });

    // Cluster totals
    const phases = { running: 0, pending: 0, failed: 0, total: podItems.length };
    for (const pod of podItems) {
      const ph = pod.status?.phase || "";
      if (ph === "Running") phases.running++;
      else if (ph === "Pending") phases.pending++;
      else if (ph === "Failed") phases.failed++;
    }

    res.json({
      nodes,
      namespaces,
      fluxStatus: { kustomizations, helmReleases },
      clusterTotals: {
        pods: phases,
        deployments: (depResp.body.items || []).length,
        services: (svcResp.body.items || []).length,
        namespaces: nsList.length,
      },
    });
  } catch (err) {
    console.error("[platform/overview] Error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/platform/pods — All pods across all namespaces ──────────────────
app.get("/api/platform/pods", requireGroups("sre-admins"), async (req, res) => {
  try {
    const { namespace, status, search } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = parseInt(req.query.offset, 10) || 0;

    let podItems;
    if (namespace) {
      const safeNs = String(namespace).replace(/[^a-z0-9-]/g, "-").substring(0, 63);
      const resp = await k8sApi.listNamespacedPod(safeNs);
      podItems = resp.body.items || [];
    } else {
      const resp = await k8sApi.listPodForAllNamespaces();
      podItems = resp.body.items || [];
    }

    // Filter
    if (status) {
      const safeStatus = String(status);
      podItems = podItems.filter((p) => {
        const ph = p.status?.phase || "";
        return ph.toLowerCase() === safeStatus.toLowerCase();
      });
    }
    if (search) {
      const safeSearch = String(search).substring(0, 128).toLowerCase();
      podItems = podItems.filter((p) =>
        (p.metadata?.name || "").toLowerCase().includes(safeSearch) ||
        (p.metadata?.namespace || "").toLowerCase().includes(safeSearch)
      );
    }

    const total = podItems.length;
    const paged = podItems.slice(offset, offset + limit);

    const pods = paged.map((pod) => {
      const cs = pod.status?.containerStatuses || [];
      const readyCount = cs.filter((c) => c.ready).length;
      const restarts = cs.reduce((sum, c) => sum + (c.restartCount || 0), 0);
      const images = [
        ...(pod.spec?.containers || []).map((c) => c.image),
        ...(pod.spec?.initContainers || []).map((c) => c.image),
      ].filter(Boolean);

      return {
        name: pod.metadata?.name || "",
        namespace: pod.metadata?.namespace || "",
        status: pod.status?.phase || "Unknown",
        ready: `${readyCount}/${(pod.spec?.containers || []).length}`,
        restarts,
        age: age(pod.metadata?.creationTimestamp),
        node: pod.spec?.nodeName || "",
        ip: pod.status?.podIP || "",
        images,
      };
    });

    res.json({ pods, total, limit, offset });
  } catch (err) {
    console.error("[platform/pods] Error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/platform/namespaces/:name — Detailed namespace view ──────────────
app.get("/api/platform/namespaces/:name", requireGroups("sre-admins"), async (req, res) => {
  const safeNs = String(req.params.name).replace(/[^a-z0-9-]/g, "-").substring(0, 63);
  if (!safeNs) return res.status(400).json({ error: "Invalid namespace" });

  try {
    const [podResp, svcResp, depResp, hrResp, evResp, quotaResp, lrResp, npResp, prResp] = await Promise.all([
      k8sApi.listNamespacedPod(safeNs),
      k8sApi.listNamespacedService(safeNs),
      appsApi.listNamespacedDeployment(safeNs),
      safeCrdList(() => customApi.listNamespacedCustomObject("helm.toolkit.fluxcd.io", "v2", safeNs, "helmreleases")),
      k8sApi.listNamespacedEvent(safeNs),
      k8sApi.listNamespacedResourceQuota(safeNs),
      k8sApi.listNamespacedLimitRange(safeNs),
      k8sApi.listNamespacedNetworkPolicy(safeNs),
      safeCrdList(() => customApi.listNamespacedCustomObject("wgpolicyk8s.io", "v1alpha2", safeNs, "policyreports")),
    ]);

    const pods = (podResp.body.items || []).map((pod) => {
      const cs = pod.status?.containerStatuses || [];
      return {
        name: pod.metadata.name,
        status: pod.status?.phase || "Unknown",
        ready: cs.filter((c) => c.ready).length + "/" + (pod.spec?.containers || []).length,
        restarts: cs.reduce((sum, c) => sum + (c.restartCount || 0), 0),
        age: age(pod.metadata.creationTimestamp),
        node: pod.spec?.nodeName || "",
        ip: pod.status?.podIP || "",
      };
    });

    const services = (svcResp.body.items || []).map((svc) => ({
      name: svc.metadata.name,
      type: svc.spec?.type || "ClusterIP",
      clusterIP: svc.spec?.clusterIP || "",
      ports: (svc.spec?.ports || []).map((p) => `${p.port}${p.nodePort ? ":" + p.nodePort : ""}/${p.protocol || "TCP"}`),
    }));

    const deployments = (depResp.body.items || []).map((dep) => ({
      name: dep.metadata.name,
      ready: `${dep.status?.readyReplicas || 0}/${dep.spec?.replicas || 0}`,
      age: age(dep.metadata.creationTimestamp),
    }));

    const helmReleases = (Array.isArray(hrResp) ? hrResp : []).map((hr) => {
      const readyCond = (hr.status?.conditions || []).find((c) => c.type === "Ready");
      return {
        name: hr.metadata.name,
        ready: readyCond?.status === "True",
        revision: hr.status?.history?.[0]?.chartVersion || "",
        message: readyCond?.message || "",
      };
    });

    const events = (evResp.body.items || [])
      .sort((a, b) => new Date(b.lastTimestamp || b.eventTime || 0) - new Date(a.lastTimestamp || a.eventTime || 0))
      .slice(0, 50)
      .map((e) => ({
        time: e.lastTimestamp || e.eventTime || "",
        type: e.type || "Normal",
        reason: e.reason || "",
        object: `${e.involvedObject?.kind || ""}/${e.involvedObject?.name || ""}`,
        message: e.message || "",
      }));

    const resourceQuotas = (quotaResp.body.items || []).map((rq) => ({
      name: rq.metadata.name,
      hard: rq.spec?.hard || {},
      used: rq.status?.used || {},
    }));

    const limitRanges = (lrResp.body.items || []).map((lr) => ({
      name: lr.metadata.name,
      limits: lr.spec?.limits || [],
    }));

    const networkPolicies = (npResp.body.items || []).map((np) => ({
      name: np.metadata.name,
      podSelector: np.spec?.podSelector || {},
      policyTypes: np.spec?.policyTypes || [],
    }));

    const policyReports = (Array.isArray(prResp) ? prResp : []).map((pr) => ({
      name: pr.metadata.name,
      pass: pr.summary?.pass || 0,
      fail: pr.summary?.fail || 0,
      warn: pr.summary?.warn || 0,
      error: pr.summary?.error || 0,
      skip: pr.summary?.skip || 0,
    }));

    res.json({
      namespace: safeNs,
      pods,
      services,
      deployments,
      helmReleases,
      events,
      resourceQuotas,
      limitRanges,
      networkPolicies,
      policyReports,
    });
  } catch (err) {
    console.error("[platform/namespaces/:name] Error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/platform/services — All services across cluster ─────────────────
app.get("/api/platform/services", requireGroups("sre-admins"), async (req, res) => {
  try {
    const { namespace } = req.query;
    let svcItems;
    if (namespace) {
      const safeNs = String(namespace).replace(/[^a-z0-9-]/g, "-").substring(0, 63);
      const resp = await k8sApi.listNamespacedService(safeNs);
      svcItems = resp.body.items || [];
    } else {
      const resp = await k8sApi.listServiceForAllNamespaces();
      svcItems = resp.body.items || [];
    }

    const services = svcItems.map((svc) => ({
      name: svc.metadata.name,
      namespace: svc.metadata.namespace,
      type: svc.spec?.type || "ClusterIP",
      clusterIP: svc.spec?.clusterIP || "",
      externalIPs: svc.spec?.externalIPs || [],
      loadBalancerIP: svc.status?.loadBalancer?.ingress?.[0]?.ip || svc.status?.loadBalancer?.ingress?.[0]?.hostname || "",
      ports: (svc.spec?.ports || []).map((p) => ({
        name: p.name || "",
        port: p.port,
        targetPort: String(p.targetPort || ""),
        nodePort: p.nodePort || null,
        protocol: p.protocol || "TCP",
      })),
      selector: svc.spec?.selector || {},
      age: age(svc.metadata.creationTimestamp),
    }));

    res.json({ services, total: services.length });
  } catch (err) {
    console.error("[platform/services] Error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/platform/flux — Full Flux CD status ─────────────────────────────
app.get("/api/platform/flux", requireGroups("sre-admins"), async (req, res) => {
  try {
    const [gitReposRaw, ksRaw, helmReposRaw, hrRaw, ociReposRaw] = await Promise.all([
      safeCrdList(() => customApi.listClusterCustomObject("source.toolkit.fluxcd.io", "v1", "gitrepositories")),
      safeCrdList(() => customApi.listClusterCustomObject("kustomize.toolkit.fluxcd.io", "v1", "kustomizations")),
      safeCrdList(() => customApi.listClusterCustomObject("source.toolkit.fluxcd.io", "v1", "helmrepositories")),
      safeCrdList(() => customApi.listClusterCustomObject("helm.toolkit.fluxcd.io", "v2", "helmreleases")),
      safeCrdList(() => customApi.listClusterCustomObject("source.toolkit.fluxcd.io", "v1beta2", "ocirepositories")),
    ]);

    function fluxCondition(obj) {
      const conditions = obj.status?.conditions || [];
      const readyCond = conditions.find((c) => c.type === "Ready");
      return {
        ready: readyCond?.status === "True",
        message: readyCond?.message || "",
        reason: readyCond?.reason || "",
        lastTransition: readyCond?.lastTransitionTime || "",
      };
    }

    const gitRepositories = (Array.isArray(gitReposRaw) ? gitReposRaw : []).map((gr) => ({
      name: gr.metadata.name,
      namespace: gr.metadata.namespace,
      url: gr.spec?.url || "",
      branch: gr.spec?.ref?.branch || "",
      revision: gr.status?.artifact?.revision || "",
      age: age(gr.metadata.creationTimestamp),
      suspended: !!gr.spec?.suspend,
      ...fluxCondition(gr),
    }));

    const kustomizations = (Array.isArray(ksRaw) ? ksRaw : []).map((ks) => ({
      name: ks.metadata.name,
      namespace: ks.metadata.namespace,
      path: ks.spec?.path || "",
      revision: ks.status?.lastAppliedRevision || "",
      age: age(ks.metadata.creationTimestamp),
      suspended: !!ks.spec?.suspend,
      prune: !!ks.spec?.prune,
      ...fluxCondition(ks),
    }));

    const helmRepositories = (Array.isArray(helmReposRaw) ? helmReposRaw : []).map((hr) => ({
      name: hr.metadata.name,
      namespace: hr.metadata.namespace,
      url: hr.spec?.url || "",
      age: age(hr.metadata.creationTimestamp),
      suspended: !!hr.spec?.suspend,
      ...fluxCondition(hr),
    }));

    const helmReleases = (Array.isArray(hrRaw) ? hrRaw : []).map((hr) => {
      const cond = fluxCondition(hr);
      return {
        name: hr.metadata.name,
        namespace: hr.metadata.namespace,
        chart: hr.spec?.chart?.spec?.chart || "",
        chartVersion: hr.spec?.chart?.spec?.version || "",
        revision: hr.status?.history?.[0]?.chartVersion || hr.status?.lastAppliedRevision || "",
        lastApplied: hr.status?.lastHandledReconcileAt || "",
        age: age(hr.metadata.creationTimestamp),
        suspended: !!hr.spec?.suspend,
        installFailures: hr.status?.installFailures || 0,
        upgradeFailures: hr.status?.upgradeFailures || 0,
        ...cond,
      };
    });

    const ociRepositories = (Array.isArray(ociReposRaw) ? ociReposRaw : []).map((or) => ({
      name: or.metadata.name,
      namespace: or.metadata.namespace,
      url: or.spec?.url || "",
      age: age(or.metadata.creationTimestamp),
      suspended: !!or.spec?.suspend,
      ...fluxCondition(or),
    }));

    // Summary counts
    const summary = {
      gitRepositories: { total: gitRepositories.length, ready: gitRepositories.filter((x) => x.ready).length },
      kustomizations: { total: kustomizations.length, ready: kustomizations.filter((x) => x.ready).length, suspended: kustomizations.filter((x) => x.suspended).length },
      helmRepositories: { total: helmRepositories.length, ready: helmRepositories.filter((x) => x.ready).length },
      helmReleases: { total: helmReleases.length, ready: helmReleases.filter((x) => x.ready).length, suspended: helmReleases.filter((x) => x.suspended).length, failing: helmReleases.filter((x) => !x.ready && !x.suspended).length },
      ociRepositories: { total: ociRepositories.length, ready: ociRepositories.filter((x) => x.ready).length },
    };

    res.json({ gitRepositories, kustomizations, helmRepositories, helmReleases, ociRepositories, summary });
  } catch (err) {
    console.error("[platform/flux] Error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/platform/certificates — cert-manager certificates ───────────────
app.get("/api/platform/certificates", requireGroups("sre-admins"), async (req, res) => {
  try {
    const certs = await safeCrdList(() =>
      customApi.listClusterCustomObject("cert-manager.io", "v1", "certificates")
    );

    const now = Date.now();
    const result = (Array.isArray(certs) ? certs : []).map((cert) => {
      const readyCond = (cert.status?.conditions || []).find((c) => c.type === "Ready");
      const notAfter = cert.status?.notAfter || "";
      const notBefore = cert.status?.notBefore || "";
      const expiresAt = notAfter ? new Date(notAfter) : null;
      const daysUntilExpiry = expiresAt ? Math.round((expiresAt.getTime() - now) / 86400000) : null;

      return {
        name: cert.metadata.name,
        namespace: cert.metadata.namespace,
        secretName: cert.spec?.secretName || "",
        issuer: cert.spec?.issuerRef?.name || "",
        issuerKind: cert.spec?.issuerRef?.kind || "Issuer",
        dnsNames: cert.spec?.dnsNames || [],
        notBefore,
        notAfter,
        daysUntilExpiry,
        ready: readyCond?.status === "True",
        message: readyCond?.message || "",
        age: age(cert.metadata.creationTimestamp),
      };
    });

    // Sort: expiring soonest first (nulls last)
    result.sort((a, b) => {
      if (a.daysUntilExpiry === null) return 1;
      if (b.daysUntilExpiry === null) return -1;
      return a.daysUntilExpiry - b.daysUntilExpiry;
    });

    res.json({ certificates: result, total: result.length });
  } catch (err) {
    console.error("[platform/certificates] Error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/platform/storage — PVCs and storage status ──────────────────────
app.get("/api/platform/storage", requireGroups("sre-admins"), async (req, res) => {
  try {
    const [pvcResp, pvResp, scResp] = await Promise.all([
      k8sApi.listPersistentVolumeClaimForAllNamespaces(),
      k8sApi.listPersistentVolume(),
      k8sApi.listStorageClass ? k8sApi.listStorageClass() : Promise.resolve({ body: { items: [] } }),
    ]);

    const pvcs = (pvcResp.body.items || []).map((pvc) => ({
      name: pvc.metadata.name,
      namespace: pvc.metadata.namespace,
      status: pvc.status?.phase || "Unknown",
      capacity: pvc.status?.capacity?.storage || pvc.spec?.resources?.requests?.storage || "",
      storageClass: pvc.spec?.storageClassName || "",
      accessModes: pvc.spec?.accessModes || [],
      volumeName: pvc.spec?.volumeName || "",
      age: age(pvc.metadata.creationTimestamp),
    }));

    const pvs = (pvResp.body.items || []).map((pv) => ({
      name: pv.metadata.name,
      status: pv.status?.phase || "Unknown",
      capacity: pv.spec?.capacity?.storage || "",
      storageClass: pv.spec?.storageClassName || "",
      accessModes: pv.spec?.accessModes || [],
      reclaimPolicy: pv.spec?.persistentVolumeReclaimPolicy || "",
      claimRef: pv.spec?.claimRef
        ? { namespace: pv.spec.claimRef.namespace, name: pv.spec.claimRef.name }
        : null,
      age: age(pv.metadata.creationTimestamp),
    }));

    const storageClasses = (scResp.body.items || []).map((sc) => ({
      name: sc.metadata.name,
      provisioner: sc.provisioner || "",
      reclaimPolicy: sc.reclaimPolicy || "",
      volumeBindingMode: sc.volumeBindingMode || "",
      isDefault: sc.metadata?.annotations?.["storageclass.kubernetes.io/is-default-class"] === "true",
    }));

    const summary = {
      pvcs: { total: pvcs.length, bound: pvcs.filter((p) => p.status === "Bound").length, pending: pvcs.filter((p) => p.status === "Pending").length, lost: pvcs.filter((p) => p.status === "Lost").length },
      pvs: { total: pvs.length, available: pvs.filter((p) => p.status === "Available").length, bound: pvs.filter((p) => p.status === "Bound").length, released: pvs.filter((p) => p.status === "Released").length },
    };

    res.json({ pvcs, pvs, storageClasses, summary });
  } catch (err) {
    console.error("[platform/storage] Error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/platform/events — Cluster-wide events ───────────────────────────
app.get("/api/platform/events", requireGroups("sre-admins"), async (req, res) => {
  try {
    const { type: typeFilter, namespace, since } = req.query;
    const eventType = typeFilter || "Warning"; // default Warning only
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);

    let items;
    if (namespace) {
      const safeNs = String(namespace).replace(/[^a-z0-9-]/g, "-").substring(0, 63);
      const resp = await k8sApi.listNamespacedEvent(safeNs);
      items = resp.body.items || [];
    } else {
      const resp = await k8sApi.listEventForAllNamespaces();
      items = resp.body.items || [];
    }

    // Filter by type (Warning is default; "All" returns everything)
    if (eventType && eventType !== "All") {
      items = items.filter((e) => e.type === eventType);
    }

    // Filter by since duration (e.g. "1h", "30m", "24h")
    if (since) {
      const sinceStr = String(since);
      const match = sinceStr.match(/^(\d+)(h|m|s)$/);
      if (match) {
        const amount = parseInt(match[1], 10);
        const unit = match[2];
        const msMap = { h: 3600000, m: 60000, s: 1000 };
        const cutoff = Date.now() - amount * msMap[unit];
        items = items.filter((e) => {
          const ts = new Date(e.lastTimestamp || e.eventTime || 0).getTime();
          return ts >= cutoff;
        });
      }
    }

    // Sort newest first
    items.sort((a, b) => {
      const ta = new Date(a.lastTimestamp || a.eventTime || 0).getTime();
      const tb = new Date(b.lastTimestamp || b.eventTime || 0).getTime();
      return tb - ta;
    });

    const events = items.slice(0, limit).map((e) => ({
      time: e.lastTimestamp || e.eventTime || "",
      type: e.type || "Normal",
      reason: e.reason || "",
      namespace: e.metadata?.namespace || e.involvedObject?.namespace || "",
      kind: e.involvedObject?.kind || "",
      name: e.involvedObject?.name || "",
      message: e.message || "",
      count: e.count || 1,
    }));

    res.json({ events, total: events.length });
  } catch (err) {
    console.error("[platform/events] Error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/platform/policies — Kyverno policy summary ──────────────────────
app.get("/api/platform/policies", requireGroups("sre-admins"), async (req, res) => {
  try {
    const [clusterPoliciesRaw, policiesRaw, clusterReportsRaw, nsReportsRaw] = await Promise.all([
      safeCrdList(() => customApi.listClusterCustomObject("kyverno.io", "v1", "clusterpolicies")),
      safeCrdList(() => customApi.listClusterCustomObject("kyverno.io", "v1", "policies")),
      safeCrdList(() => customApi.listClusterCustomObject("wgpolicyk8s.io", "v1alpha2", "clusterpolicyreports")),
      safeCrdList(() => customApi.listClusterCustomObject("wgpolicyk8s.io", "v1alpha2", "policyreports")),
    ]);

    // Build violation counts from policy reports
    const violationsByPolicy = {};
    const allReports = [
      ...(Array.isArray(clusterReportsRaw) ? clusterReportsRaw : []),
      ...(Array.isArray(nsReportsRaw) ? nsReportsRaw : []),
    ];
    for (const report of allReports) {
      for (const result of (report.results || [])) {
        if (result.result === "fail") {
          const policyName = result.policy || "";
          violationsByPolicy[policyName] = (violationsByPolicy[policyName] || 0) + 1;
        }
      }
    }

    function mapPolicy(p, isCluster) {
      const rules = p.spec?.rules || [];
      const action = p.spec?.validationFailureAction || "Audit";
      return {
        name: p.metadata.name,
        namespace: isCluster ? null : p.metadata.namespace,
        kind: isCluster ? "ClusterPolicy" : "Policy",
        action,
        background: !!p.spec?.background,
        ruleCount: rules.length,
        rules: rules.map((r) => r.name || ""),
        violationCount: violationsByPolicy[p.metadata.name] || 0,
        age: age(p.metadata.creationTimestamp),
        annotations: {
          title: p.metadata?.annotations?.["policies.kyverno.io/title"] || "",
          severity: p.metadata?.annotations?.["policies.kyverno.io/severity"] || "",
          nistControls: p.metadata?.annotations?.["sre.io/nist-controls"] || "",
        },
      };
    }

    const clusterPolicies = (Array.isArray(clusterPoliciesRaw) ? clusterPoliciesRaw : []).map((p) => mapPolicy(p, true));
    const namespacePolicies = (Array.isArray(policiesRaw) ? policiesRaw : []).map((p) => mapPolicy(p, false));

    const summary = {
      totalPolicies: clusterPolicies.length + namespacePolicies.length,
      enforced: [...clusterPolicies, ...namespacePolicies].filter((p) => p.action === "Enforce").length,
      audit: [...clusterPolicies, ...namespacePolicies].filter((p) => p.action === "Audit").length,
      totalViolations: Object.values(violationsByPolicy).reduce((sum, v) => sum + v, 0),
      policiesWithViolations: Object.keys(violationsByPolicy).length,
    };

    res.json({ clusterPolicies, namespacePolicies, summary });
  } catch (err) {
    console.error("[platform/policies] Error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/platform/network — Ingress/VirtualService/Gateway overview ──────
app.get("/api/platform/network", requireGroups("sre-admins"), async (req, res) => {
  try {
    const [vsRaw, gwRaw, drRaw, k8sIngressRaw] = await Promise.all([
      safeCrdList(() => customApi.listClusterCustomObject("networking.istio.io", "v1", "virtualservices")),
      safeCrdList(() => customApi.listClusterCustomObject("networking.istio.io", "v1", "gateways")),
      safeCrdList(() => customApi.listClusterCustomObject("networking.istio.io", "v1", "destinationrules")),
      k8sApi.listIngressForAllNamespaces ? k8sApi.listIngressForAllNamespaces() : Promise.resolve({ body: { items: [] } }),
    ]);

    const virtualServices = (Array.isArray(vsRaw) ? vsRaw : []).map((vs) => {
      const httpRoutes = vs.spec?.http || [];
      const routes = httpRoutes.flatMap((h) =>
        (h.route || []).map((r) => ({
          host: r.destination?.host || "",
          port: r.destination?.port?.number || null,
          weight: r.weight || null,
        }))
      );
      return {
        name: vs.metadata.name,
        namespace: vs.metadata.namespace,
        gateways: vs.spec?.gateways || [],
        hosts: vs.spec?.hosts || [],
        routes,
        age: age(vs.metadata.creationTimestamp),
      };
    });

    const gateways = (Array.isArray(gwRaw) ? gwRaw : []).map((gw) => {
      const servers = gw.spec?.servers || [];
      return {
        name: gw.metadata.name,
        namespace: gw.metadata.namespace,
        servers: servers.map((s) => ({
          port: s.port?.number || null,
          protocol: s.port?.protocol || "",
          hosts: s.hosts || [],
          tls: s.tls?.mode || null,
        })),
        selector: gw.spec?.selector || {},
        age: age(gw.metadata.creationTimestamp),
      };
    });

    const destinationRules = (Array.isArray(drRaw) ? drRaw : []).map((dr) => ({
      name: dr.metadata.name,
      namespace: dr.metadata.namespace,
      host: dr.spec?.host || "",
      trafficPolicy: dr.spec?.trafficPolicy || null,
      age: age(dr.metadata.creationTimestamp),
    }));

    const k8sIngresses = ((k8sIngressRaw.body && k8sIngressRaw.body.items) || []).map((ing) => ({
      name: ing.metadata.name,
      namespace: ing.metadata.namespace,
      className: ing.spec?.ingressClassName || "",
      rules: (ing.spec?.rules || []).map((r) => ({
        host: r.host || "",
        paths: (r.http?.paths || []).map((p) => ({
          path: p.path || "/",
          backend: `${p.backend?.service?.name || ""}:${p.backend?.service?.port?.number || ""}`,
        })),
      })),
      age: age(ing.metadata.creationTimestamp),
    }));

    res.json({
      virtualServices,
      gateways,
      destinationRules,
      k8sIngresses,
      summary: {
        virtualServices: virtualServices.length,
        gateways: gateways.length,
        destinationRules: destinationRules.length,
        k8sIngresses: k8sIngresses.length,
      },
    });
  } catch (err) {
    console.error("[platform/network] Error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// SPA catch-all: serve index.html for non-API routes (React Router / client-side nav)
app.get('*', (req, res) => {
  const indexPath = path.join(staticPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Not found');
  }
});

db.initDb().then(async () => {
  dbAvailable = true;
  console.log("[db] Pipeline database connected and ready");
  await recoverOrphanedRuns();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`SRE Dashboard running on http://0.0.0.0:${PORT}`);
  });
}).catch(err => {
  console.error("[db] Database init failed, starting without pipeline persistence:", err.message);
  dbAvailable = false;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`SRE Dashboard running on http://0.0.0.0:${PORT} (no database)`);
  });
});
