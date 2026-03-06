const express = require("express");
const k8s = require("@kubernetes/client-node");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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
    description: "HTTP testing service — echoes requests back",
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
    res.status(500).json({ error: err.message });
  }
});

// Ingress routes
app.get("/api/ingress", async (req, res) => {
  try {
    const routes = await getIngressRoutes();
    const nodeIp = await getFirstNodeIp();
    const httpsPort = await getGatewayNodePort();
    res.json({ routes, nodeIp, httpsPort });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List tenant namespaces
app.get("/api/tenants", async (req, res) => {
  try {
    const tenants = await getTenants();
    res.json({ tenants });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List apps in a tenant namespace
app.get("/api/tenants/:namespace/apps", async (req, res) => {
  try {
    const apps = await getTenantApps(req.params.namespace);
    res.json({ apps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deploy a new app
app.post("/api/deploy", async (req, res) => {
  try {
    const { name, team, image, tag, port, replicas, ingress } = req.body;

    if (!name || !team || !image || !tag) {
      return res.status(400).json({
        error: "Missing required fields: name, team, image, tag",
      });
    }

    // Sanitize team name
    const teamName = team.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const nsName = teamName.startsWith("team-") ? teamName : `team-${teamName}`;

    // Auto-create namespace if it doesn't exist
    await ensureNamespace(nsName, teamName);

    const manifest = generateHelmRelease({
      name,
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
      message: `App "${name}" deployed to namespace "${nsName}"`,
      namespace: nsName,
      manifest,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete an app
app.delete("/api/deploy/:namespace/:name", async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

// Credentials
app.get("/api/credentials", async (req, res) => {
  try {
    const creds = await getCredentials();
    res.json(creds);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

async function getGatewayNodePort() {
  try {
    const resp = await k8sApi.readNamespacedService(
      "istio-gateway",
      "istio-system"
    );
    const httpsPort = resp.body.spec.ports.find((p) => p.name === "https");
    return httpsPort?.nodePort || 31443;
  } catch {
    return 31443;
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
