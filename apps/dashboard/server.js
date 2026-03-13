const express = require("express");
const k8s = require("@kubernetes/client-node");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const yaml = require("js-yaml");

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
const batchApi = kc.makeApiClient(k8s.BatchV1Api);
const metricsClient = new k8s.Metrics(kc);

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
  if (origin.endsWith(".apps.sre.example.com") || origin.endsWith("." + (process.env.SRE_DOMAIN || "apps.sre.example.com"))) {
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
          apps.push({
            name: hr.metadata.name,
            namespace: ns.metadata.name,
            team: ns.metadata.labels?.["sre.io/team"] || ns.metadata.name.replace(/^team-/, ""),
            ready: readyCondition?.status === "True",
            image: appValues.image?.repository || "",
            tag: appValues.image?.tag || "",
            port: appValues.port || 8080,
            host: ingressValues.host || "",
            url: ingressValues.host ? `https://${ingressValues.host}` : "",
            created: hr.metadata.creationTimestamp || "",
          });
        }
      } catch {
        // Skip namespaces where we can't read HelmReleases
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
    } catch {
      // VirtualService lookup is best-effort
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
  if (origin.endsWith(".apps.sre.example.com") || origin.endsWith("." + (process.env.SRE_DOMAIN || "apps.sre.example.com"))) {
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

function isValidGitUrl(url) {
  if (typeof url !== "string") return false;
  return /^https?:\/\/.+/.test(url) || /^git@.+:.+/.test(url);
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
    const nsName = teamName.startsWith("team-") ? teamName : `team-${teamName}`;
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

      await applyManifest(manifest, nsName);

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
    const nsName = teamName.startsWith("team-") ? teamName : `team-${teamName}`;

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

      await applyManifest(manifest, nsName);

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
app.get("/api/deploy/:namespace/:name/status", async (req, res) => {
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
      helmRelease = {
        ready: readyCondition?.status === "True",
        message: readyCondition?.message || "",
        lastTransition: readyCondition?.lastTransitionTime || "",
      };
      progress = 25;
      phase = "creating";

      if (readyCondition?.status === "False" && readyCondition?.reason === "InstallFailed") {
        phase = "failed";
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
    } catch {
      // Pod lookup is best-effort
    }

    // Step 3: List events for this app in the namespace
    try {
      const evResp = await k8sApi.listNamespacedEvent(namespace);
      events = evResp.body.items
        .filter((e) => {
          const objName = e.involvedObject?.name || "";
          return objName === name || objName.startsWith(`${name}-`);
        })
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
    } catch {
      // Event lookup is best-effort
    }

    res.json({
      name,
      namespace,
      phase,
      helmRelease,
      pods,
      events,
      progress,
    });
  } catch (err) {
    console.error("Error fetching deploy status:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/deploy/git — Deploy from a Git repository URL
app.post("/api/deploy/git", mutateLimiter, requireGroups("sre-admins", "developers"), async (req, res) => {
  try {
    const { url, branch, team, name } = req.body;

    if (!url || !isValidGitUrl(url)) {
      return res.status(400).json({ error: "Missing or invalid required field: url (must be a valid Git URL)" });
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
    const nsName = teamName.startsWith("team-") ? teamName : `team-${teamName}`;
    const safeBranch = (branch || "main").replace(/[^a-zA-Z0-9._/-]/g, "").substring(0, 128);

    await ensureNamespace(nsName, teamName);

    // Create a Flux GitRepository pointing to the repo
    const gitRepo = {
      apiVersion: "source.toolkit.fluxcd.io/v1",
      kind: "GitRepository",
      metadata: {
        name: `git-${safeName}`,
        namespace: nsName,
        labels: {
          "app.kubernetes.io/part-of": "sre-platform",
          "sre.io/team": nsName,
        },
      },
      spec: {
        interval: "5m",
        url: url,
        ref: {
          branch: safeBranch,
        },
      },
    };

    // Apply GitRepository
    try {
      await customApi.createNamespacedCustomObject(
        "source.toolkit.fluxcd.io",
        "v1",
        nsName,
        "gitrepositories",
        gitRepo
      );
    } catch (err) {
      if (err.statusCode === 409) {
        await customApi.patchNamespacedCustomObject(
          "source.toolkit.fluxcd.io",
          "v1",
          nsName,
          "gitrepositories",
          `git-${safeName}`,
          gitRepo,
          undefined,
          undefined,
          undefined,
          { headers: { "Content-Type": "application/merge-patch+json" } }
        );
      } else {
        throw err;
      }
    }

    // Create a Flux Kustomization to deploy from the repo
    const kustomization = {
      apiVersion: "kustomize.toolkit.fluxcd.io/v1",
      kind: "Kustomization",
      metadata: {
        name: `deploy-${safeName}`,
        namespace: nsName,
        labels: {
          "app.kubernetes.io/part-of": "sre-platform",
          "sre.io/team": nsName,
        },
      },
      spec: {
        interval: "5m",
        path: "./",
        prune: true,
        targetNamespace: nsName,
        sourceRef: {
          kind: "GitRepository",
          name: `git-${safeName}`,
        },
        healthChecks: [],
      },
    };

    // Apply Kustomization
    try {
      await customApi.createNamespacedCustomObject(
        "kustomize.toolkit.fluxcd.io",
        "v1",
        nsName,
        "kustomizations",
        kustomization
      );
    } catch (err) {
      if (err.statusCode === 409) {
        await customApi.patchNamespacedCustomObject(
          "kustomize.toolkit.fluxcd.io",
          "v1",
          nsName,
          "kustomizations",
          `deploy-${safeName}`,
          kustomization,
          undefined,
          undefined,
          undefined,
          { headers: { "Content-Type": "application/merge-patch+json" } }
        );
      } else {
        throw err;
      }
    }

    res.json({
      success: true,
      message: `Git deploy "${escapeHtml(safeName)}" created in namespace "${escapeHtml(nsName)}" from ${escapeHtml(url)} (branch: ${escapeHtml(safeBranch)})`,
      gitRepository: `git-${safeName}`,
      kustomization: `deploy-${safeName}`,
      namespace: nsName,
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
const HARBOR_REGISTRY = "harbor.apps.sre.example.com";
const KANIKO_IMAGE = "gcr.io/kaniko-project/executor:v1.23.2";
const GIT_CLONE_IMAGE = "alpine/git:2.43.0";
const REPO_ANALYZE_IMAGE = "alpine/git:2.43.0";

// In-memory build tracking (supplements K8s Job status)
const buildRegistry = new Map();

function generateBuildId() {
  return "build-" + crypto.randomBytes(4).toString("hex");
}

// ── Well-known SRE platform services that should NOT be built/deployed as containers ──
// When a docker-compose service matches one of these, we replace it with the SRE equivalent.
const SRE_PLATFORM_SERVICES = {
  postgres: { type: "database", sre: "cnpg", label: "CNPG PostgreSQL" },
  postgresql: { type: "database", sre: "cnpg", label: "CNPG PostgreSQL" },
  postgis: { type: "database", sre: "cnpg", label: "CNPG PostgreSQL (PostGIS)" },
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
    const hasBuild = svc.build || svc.dockerfile;
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
  // Second: check Dockerfile EXPOSE
  if (dockerfileContent) {
    const exposed = parseDockerfileExpose(dockerfileContent);
    if (exposed.length > 0) return exposed[0];
  }
  return 8080; // fallback
}

// Parse docker-compose build context
function parseComposeBuildContext(yamlText) {
  // Enhanced parser that also extracts build: context, depends_on, networks, profiles
  const services = parseDockerCompose(yamlText);
  const lines = yamlText.split("\n");
  let inServices = false;
  let currentService = null;
  let serviceIndent = -1;

  for (const raw of lines) {
    if (raw.trimStart().startsWith("#") || raw.trim() === "") continue;
    const stripped = raw.trimEnd();
    const indent = stripped.length - stripped.trimStart().length;
    const content = stripped.trim();

    if (/^services\s*:/.test(content) && indent === 0) { inServices = true; currentService = null; continue; }
    if (!inServices) continue;
    if (indent === 0 && /^\w/.test(content) && !content.startsWith("-")) { inServices = false; continue; }

    // Detect service names
    if (indent > 0 && indent <= 4 && /^[a-zA-Z0-9_-]+\s*:\s*$/.test(content)) {
      currentService = content.replace(/\s*:\s*$/, "").trim();
      serviceIndent = indent;
      continue;
    }

    if (!currentService || !services[currentService]) continue;

    // build: ./path or build:\n  context: ./path
    const buildMatch = content.match(/^build\s*:\s*(.+)$/);
    if (buildMatch && indent > serviceIndent) {
      const val = buildMatch[1].trim();
      if (val && !val.endsWith(":")) {
        // Inline build context: build: ./backend
        services[currentService].buildContext = val.replace(/^["']|["']$/g, "");
      }
      continue;
    }
    const contextMatch = content.match(/^context\s*:\s*(.+)$/);
    if (contextMatch && indent > serviceIndent + 2) {
      services[currentService].buildContext = contextMatch[1].trim().replace(/^["']|["']$/g, "");
      continue;
    }
    const targetMatch = content.match(/^target\s*:\s*(.+)$/);
    if (targetMatch && indent > serviceIndent + 2) {
      services[currentService].buildTarget = targetMatch[1].trim().replace(/^["']|["']$/g, "");
      continue;
    }
    const dockerfileMatch = content.match(/^dockerfile\s*:\s*(.+)$/);
    if (dockerfileMatch && indent > serviceIndent + 2) {
      services[currentService].dockerfile = dockerfileMatch[1].trim().replace(/^["']|["']$/g, "");
      continue;
    }
    // profiles:
    const profileMatch = content.match(/^-\s*["']?(\w+)["']?$/);
    // detect profiles block
    if (/^profiles\s*:\s*$/.test(content)) {
      services[currentService]._inProfiles = true;
      continue;
    }
    if (services[currentService]._inProfiles && content.startsWith("-")) {
      services[currentService].profiles = services[currentService].profiles || [];
      services[currentService].profiles.push(content.replace(/^-\s*/, "").replace(/^["']|["']$/g, ""));
      continue;
    }
    if (services[currentService]._inProfiles && !content.startsWith("-")) {
      delete services[currentService]._inProfiles;
    }
  }

  return services;
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

    // Create a lightweight Job that clones the repo and outputs file listing + key file contents
    const jobSpec = {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: {
        name: analyzeId,
        namespace: BUILD_NAMESPACE,
        labels: { "app.kubernetes.io/part-of": "sre-platform", "sre.io/type": "analyze" },
      },
      spec: {
        backoffLimit: 0,
        ttlSecondsAfterFinished: 300,
        activeDeadlineSeconds: 60,
        template: {
          spec: {
            restartPolicy: "Never",
            containers: [{
              name: "analyze",
              image: REPO_ANALYZE_IMAGE,
              command: ["/bin/sh", "-c", [
                `git clone --depth=1 --branch '${safeBranch}' '${gitUrl}' /workspace 2>&1`,
                `echo '===SRE_FILE_LIST==='`,
                `find /workspace -maxdepth 3 -type f \\( -name 'docker-compose*.yml' -o -name 'docker-compose*.yaml' -o -name 'Dockerfile' -o -name 'Dockerfile.*' \\) | sed 's|/workspace/||' | sort`,
                `echo '===SRE_COMPOSE_CONTENT==='`,
                // Output docker-compose.yml if it exists
                `for f in docker-compose.yml docker-compose.yaml; do if [ -f /workspace/$f ]; then echo "===FILE:$f==="; cat /workspace/$f; fi; done`,
                `echo '===SRE_DOCKERFILE_CONTENT==='`,
                // Output each Dockerfile (up to 3 levels deep)
                `find /workspace -maxdepth 3 -name 'Dockerfile' -o -name 'Dockerfile.*' | head -10 | while read df; do relpath=$(echo $df | sed 's|/workspace/||'); echo "===FILE:$relpath==="; cat $df; done`,
                `echo '===SRE_DONE==='`,
              ].join(" && ")],
              resources: {
                requests: { cpu: "100m", memory: "128Mi" },
                limits: { cpu: "500m", memory: "512Mi" },
              },
              securityContext: { runAsNonRoot: false, readOnlyRootFilesystem: false },
            }],
          },
        },
      },
    };

    await batchApi.createNamespacedJob(BUILD_NAMESPACE, jobSpec);

    // Wait for job to complete (up to 45s)
    let logs = "";
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const jr = await batchApi.readNamespacedJob(analyzeId, BUILD_NAMESPACE);
        if (jr.body.status?.succeeded) {
          const pods = await k8sApi.listNamespacedPod(BUILD_NAMESPACE, undefined, undefined, undefined, undefined, `job-name=${analyzeId}`);
          if (pods.body.items.length > 0) {
            const logResp = await k8sApi.readNamespacedPodLog(pods.body.items[0].metadata.name, BUILD_NAMESPACE, "analyze");
            logs = logResp.body || "";
          }
          break;
        }
        if (jr.body.status?.failed) {
          return res.status(400).json({ error: "Failed to clone repository. Check the URL and branch." });
        }
      } catch { /* retry */ }
    }

    if (!logs) {
      return res.status(504).json({ error: "Repository analysis timed out" });
    }

    // Parse the structured output
    const fileListMatch = logs.split("===SRE_FILE_LIST===")[1]?.split("===SRE_COMPOSE_CONTENT===")[0];
    const composeMatch = logs.split("===SRE_COMPOSE_CONTENT===")[1]?.split("===SRE_DOCKERFILE_CONTENT===")[0];
    const dockerfileMatch = logs.split("===SRE_DOCKERFILE_CONTENT===")[1]?.split("===SRE_DONE===")[0];

    const files = (fileListMatch || "").trim().split("\n").filter(Boolean);
    const hasCompose = files.some((f) => f.startsWith("docker-compose"));
    const hasDockerfile = files.some((f) => f === "Dockerfile" || f.match(/^Dockerfile\./));

    // Parse Dockerfiles content keyed by path
    const dockerfiles = {};
    if (dockerfileMatch) {
      const parts = dockerfileMatch.split(/===FILE:(.+?)===/);
      for (let i = 1; i < parts.length; i += 2) {
        dockerfiles[parts[i]] = parts[i + 1]?.trim() || "";
      }
    }

    // Build the analysis result
    const result = {
      repoType: hasCompose ? "compose" : hasDockerfile ? "dockerfile" : "unknown",
      files,
      services: [],
    };

    if (hasCompose && composeMatch) {
      // Parse the compose content
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

        result.services.push({
          name: svcName,
          image: svc.image || null,
          buildContext: svc.buildContext || null,
          buildTarget: svc.buildTarget || null,
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
        });
      }
    } else if (hasDockerfile) {
      // Single Dockerfile repo
      const rootDockerfile = dockerfiles["Dockerfile"] || "";
      const ports = parseDockerfileExpose(rootDockerfile);
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
      });
    }

    res.json({ success: true, ...result });
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
      const dockerfilePath = svc.buildContext
        ? `${svc.buildContext.replace(/^\.\//, "")}/${svc.dockerfile || "Dockerfile"}`
        : svc.dockerfile || "Dockerfile";

      // Kaniko args
      const kanikoArgs = [
        `--dockerfile=/workspace/${dockerfilePath}`,
        `--context=/workspace/${(svc.buildContext || ".").replace(/^\.\//, "")}`,
        `--destination=${destination}`,
        "--cache=true",
        `--cache-repo=${HARBOR_REGISTRY}/${teamName}/cache`,
        "--snapshot-mode=redo",
        "--skip-tls-verify",
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
          backoffLimit: 0,
          ttlSecondsAfterFinished: 3600,
          template: {
            metadata: { labels: { "sre.io/build-id": buildId, "sre.io/group-id": groupId } },
            spec: {
              restartPolicy: "Never",
              initContainers: [{
                name: "git-clone",
                image: GIT_CLONE_IMAGE,
                args: ["clone", "--depth=1", "--branch", safeBranch, gitUrl, "/workspace"],
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
                resources: { requests: { cpu: "250m", memory: "512Mi" }, limits: { cpu: "2", memory: "2Gi" } },
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
    const nsName = teamName.startsWith("team-") ? teamName : `team-${teamName}`;

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
        const ingressHost = isIngress ? `${svcAppName}.apps.sre.example.com` : "";

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

        await applyManifest(manifest, nsName);
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

        await applyManifest(manifest, nsName);
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
          backoffLimit: 0,
          ttlSecondsAfterFinished: 3600,
          template: {
            metadata: {
              labels: {
                "sre.io/build-id": buildId,
              },
            },
            spec: {
              restartPolicy: "Never",
              initContainers: [
                {
                  name: "git-clone",
                  image: GIT_CLONE_IMAGE,
                  args: ["clone", "--depth=1", "--branch", safeBranch, gitUrl, "/workspace"],
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
                    "--snapshot-mode=redo",
                    "--skip-tls-verify",
                  ],
                  volumeMounts: [
                    { name: "workspace", mountPath: "/workspace" },
                    { name: "docker-config", mountPath: "/kaniko/.docker" },
                  ],
                  resources: {
                    requests: { cpu: "250m", memory: "512Mi" },
                    limits: { cpu: "2", memory: "2Gi" },
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
          backoffLimit: 0,
          ttlSecondsAfterFinished: 3600,
          template: {
            metadata: {
              labels: { "sre.io/build-id": buildId },
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
                    "--skip-tls-verify",
                  ],
                  volumeMounts: [
                    { name: "dockerfile", mountPath: "/workspace" },
                    { name: "docker-config", mountPath: "/kaniko/.docker" },
                  ],
                  resources: {
                    requests: { cpu: "250m", memory: "512Mi" },
                    limits: { cpu: "2", memory: "2Gi" },
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
        } catch { /* best effort */ }
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
        } catch { /* best effort */ }
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
      } catch { /* ignore */ }
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
      } catch { /* init logs may not be available */ }
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
          } catch { /* best effort */ }
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
    } catch {
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
    const nsName = teamName.startsWith("team-") ? teamName : `team-${teamName}`;
    const containerPort = port || 8080;
    const ingressHost = ingress || `${safeName}.apps.sre.example.com`;

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

    await applyManifest(manifest, nsName);

    res.json({
      success: true,
      message: `App "${safeName}" deployed from build ${safeBuildId} to namespace "${nsName}"`,
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
    const nsName = teamName.startsWith("team-") ? teamName : `team-${teamName}`;
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
        } catch {
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

    await applyManifest(helmRelease, nsName);

    res.json({
      success: true,
      message: `Helm chart "${chartName}" deployed as "${safeName}" in namespace "${nsName}"`,
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
    const nsName = teamName.startsWith("team-") ? teamName : `team-${teamName}`;
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
      } catch { /* CNPG may not exist in this namespace */ }
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
    const metricsRes = await customApi.listClusterCustomObject(
      "metrics.k8s.io", "v1beta1", "pods"
    );
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

function generateHelmRelease({ name, team, image, tag, port, replicas, ingressHost, env }) {
  const safeEnv = Array.isArray(env) ? env.filter((e) => e && e.name) : [];
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
            "sre.io/network-policy-configured": "true",
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
  const result = { sso: {}, breakglass: {} };

  // SSO — the only credentials users need
  result.sso.keycloak = {
    url: "https://keycloak.apps.sre.example.com",
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
  } catch {
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
  } catch {
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
    } catch {
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
  } catch {
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
  } catch {
    result.breakglass.harbor = { username: "admin", password: "Harbor12345" };
  }

  return result;
}

// ── Start Server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`SRE Dashboard running on http://0.0.0.0:${PORT}`);
});
