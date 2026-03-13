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
