/**
 * gitops.js — GitOps-backed deployments via the GitHub API
 *
 * Enables the SRE Dashboard to deploy applications by committing manifests
 * to the Git repository, letting Flux CD reconcile the cluster state.
 *
 * Requires GITHUB_TOKEN environment variable for authentication.
 * Uses Node 20 built-in fetch() — no external HTTP dependencies.
 */

const yaml = require("js-yaml");
const k8s = require("@kubernetes/client-node");

// ── Configuration ────────────────────────────────────────────────────────────

const GITHUB_API = "https://api.github.com";
const GITHUB_OWNER = process.env.SRE_GITHUB_OWNER || "morbidsteve";
const GITHUB_REPO = process.env.SRE_GITHUB_REPO || "sre-platform";
const GITHUB_BRANCH = process.env.SRE_GITHUB_BRANCH || "main";

// ── Kubernetes client (for Flux reconciliation trigger) ──────────────────────

const kc = new k8s.KubeConfig();
try {
  kc.loadFromCluster();
} catch {
  kc.loadFromDefault();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true if the GITHUB_TOKEN environment variable is set.
 */
function isEnabled() {
  return !!process.env.GITHUB_TOKEN;
}

/**
 * Throws if GitOps is not configured.
 */
function requireEnabled() {
  if (!isEnabled()) {
    throw new Error("GitOps not configured: GITHUB_TOKEN not set");
  }
}

/**
 * Makes an authenticated request to the GitHub API.
 * Wraps errors with status and response body for easier debugging.
 */
async function githubFetch(path, options = {}) {
  const url = `${GITHUB_API}${path}`;
  const headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...options.headers,
  };

  const res = await fetch(url, { ...options, headers });

  if (!res.ok && res.status !== 404 && res.status !== 409 && res.status !== 422) {
    const body = await res.text();
    throw new Error(`GitHub API ${options.method || "GET"} ${path} failed (${res.status}): ${body}`);
  }

  return res;
}

/**
 * Sleep helper for retry logic.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── GitHub Contents API ──────────────────────────────────────────────────────

/**
 * Gets the blob SHA of a file in the repository.
 * Returns the SHA string if the file exists, null if it does not (404).
 */
async function getFileSha(filePath) {
  requireEnabled();

  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const res = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedPath}?ref=${GITHUB_BRANCH}`
  );

  if (res.status === 404) {
    return null;
  }

  const data = await res.json();
  return data.sha || null;
}

/**
 * Creates or updates a single file via the GitHub Contents API.
 * Handles both create (no sha) and update (with sha).
 * Retries up to 3 times on 409 conflict errors (re-fetches SHA each retry).
 */
async function createOrUpdateFile(filePath, content, commitMessage) {
  requireEnabled();

  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const base64Content = Buffer.from(content, "utf-8").toString("base64");
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const sha = await getFileSha(filePath);

    const body = {
      message: commitMessage,
      content: base64Content,
      branch: GITHUB_BRANCH,
    };
    if (sha) {
      body.sha = sha;
    }

    const res = await githubFetch(
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedPath}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    if (res.status === 409) {
      console.warn(`[gitops] Conflict on ${filePath} (attempt ${attempt}/${maxRetries}), retrying...`);
      if (attempt < maxRetries) {
        await sleep(500);
        continue;
      }
      const errBody = await res.text();
      throw new Error(`GitHub API conflict after ${maxRetries} attempts on ${filePath}: ${errBody}`);
    }

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`GitHub API PUT ${filePath} failed (${res.status}): ${errBody}`);
    }

    const data = await res.json();
    console.log(`[gitops] ${sha ? "Updated" : "Created"} ${filePath} (commit: ${data.commit.sha.slice(0, 7)})`);
    return data;
  }
}

/**
 * Deletes a single file from the repository.
 */
async function deleteFile(filePath, commitMessage) {
  requireEnabled();

  const sha = await getFileSha(filePath);
  if (!sha) {
    console.log(`[gitops] File ${filePath} does not exist, nothing to delete`);
    return null;
  }

  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const res = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedPath}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: commitMessage,
        sha,
        branch: GITHUB_BRANCH,
      }),
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`GitHub API DELETE ${filePath} failed (${res.status}): ${errBody}`);
  }

  const data = await res.json();
  console.log(`[gitops] Deleted ${filePath} (commit: ${data.commit.sha.slice(0, 7)})`);
  return data;
}

// ── GitHub Git Trees API (atomic multi-file commits) ─────────────────────────

/**
 * Creates multiple files in a single atomic commit using the Git Trees API.
 *
 * @param {Array<{path: string, content: string}>} files - Files to create/update
 * @param {string} commitMessage - Commit message
 * @returns {object} The created commit object
 */
async function createMultipleFiles(files, commitMessage) {
  requireEnabled();

  // Step 1: Get the latest commit SHA on the branch
  const refRes = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/ref/heads/${GITHUB_BRANCH}`
  );
  if (!refRes.ok) {
    const body = await refRes.text();
    throw new Error(`Failed to get branch ref (${refRes.status}): ${body}`);
  }
  const refData = await refRes.json();
  const latestCommitSha = refData.object.sha;

  // Step 2: Get the tree SHA from the latest commit
  const commitRes = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits/${latestCommitSha}`
  );
  if (!commitRes.ok) {
    const body = await commitRes.text();
    throw new Error(`Failed to get commit (${commitRes.status}): ${body}`);
  }
  const commitData = await commitRes.json();
  const baseTreeSha = commitData.tree.sha;

  // Step 3: Create a new tree with all file changes
  const tree = files.map((f) => ({
    path: f.path,
    mode: "100644",
    type: "blob",
    content: f.content,
  }));

  const treeRes = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_tree: baseTreeSha, tree }),
    }
  );
  if (!treeRes.ok) {
    const body = await treeRes.text();
    throw new Error(`Failed to create tree (${treeRes.status}): ${body}`);
  }
  const treeData = await treeRes.json();

  // Step 4: Create a new commit pointing to the new tree
  const newCommitRes = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: commitMessage,
        tree: treeData.sha,
        parents: [latestCommitSha],
      }),
    }
  );
  if (!newCommitRes.ok) {
    const body = await newCommitRes.text();
    throw new Error(`Failed to create commit (${newCommitRes.status}): ${body}`);
  }
  const newCommitData = await newCommitRes.json();

  // Step 5: Update the branch ref to point to the new commit
  const updateRefRes = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${GITHUB_BRANCH}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: newCommitData.sha }),
    }
  );
  if (!updateRefRes.ok) {
    const body = await updateRefRes.text();
    throw new Error(`Failed to update branch ref (${updateRefRes.status}): ${body}`);
  }

  console.log(
    `[gitops] Atomic commit ${newCommitData.sha.slice(0, 7)}: ${files.length} file(s) — ${commitMessage.split("\n")[0]}`
  );
  return newCommitData;
}

/**
 * Deletes multiple files in a single atomic commit using the Git Trees API.
 * Sets sha to null for each deleted file entry in the tree.
 *
 * @param {string[]} filePaths - Paths of files to delete
 * @param {string} commitMessage - Commit message
 * @returns {object} The created commit object
 */
async function deleteMultipleFiles(filePaths, commitMessage) {
  requireEnabled();

  // Step 1: Get the latest commit SHA on the branch
  const refRes = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/ref/heads/${GITHUB_BRANCH}`
  );
  if (!refRes.ok) {
    const body = await refRes.text();
    throw new Error(`Failed to get branch ref (${refRes.status}): ${body}`);
  }
  const refData = await refRes.json();
  const latestCommitSha = refData.object.sha;

  // Step 2: Get the tree SHA from the latest commit
  const commitRes = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits/${latestCommitSha}`
  );
  if (!commitRes.ok) {
    const body = await commitRes.text();
    throw new Error(`Failed to get commit (${commitRes.status}): ${body}`);
  }
  const commitData = await commitRes.json();
  const baseTreeSha = commitData.tree.sha;

  // Step 3: Create a tree with deleted entries (sha: null removes the file)
  const tree = filePaths.map((p) => ({
    path: p,
    mode: "100644",
    type: "blob",
    sha: null,
  }));

  const treeRes = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_tree: baseTreeSha, tree }),
    }
  );
  if (!treeRes.ok) {
    const body = await treeRes.text();
    throw new Error(`Failed to create tree (${treeRes.status}): ${body}`);
  }
  const treeData = await treeRes.json();

  // Step 4: Create a new commit
  const newCommitRes = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: commitMessage,
        tree: treeData.sha,
        parents: [latestCommitSha],
      }),
    }
  );
  if (!newCommitRes.ok) {
    const body = await newCommitRes.text();
    throw new Error(`Failed to create commit (${newCommitRes.status}): ${body}`);
  }
  const newCommitData = await newCommitRes.json();

  // Step 5: Update the branch ref
  const updateRefRes = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${GITHUB_BRANCH}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: newCommitData.sha }),
    }
  );
  if (!updateRefRes.ok) {
    const body = await updateRefRes.text();
    throw new Error(`Failed to update branch ref (${updateRefRes.status}): ${body}`);
  }

  console.log(
    `[gitops] Atomic delete ${newCommitData.sha.slice(0, 7)}: ${filePaths.length} file(s) — ${commitMessage.split("\n")[0]}`
  );
  return newCommitData;
}

// ── Kustomization Management ─────────────────────────────────────────────────

/**
 * Reads the apps/ directory for a team from GitHub, filters for .yaml files
 * (excluding kustomization.yaml), and generates a kustomization.yaml listing them.
 *
 * @param {string} teamDir - Team directory name (e.g., "team-alpha")
 * @returns {string} The kustomization.yaml content as a string
 */
async function updateKustomization(teamDir) {
  requireEnabled();

  const dirPath = `apps/tenants/${teamDir}/apps`;
  const encodedPath = dirPath.split("/").map(encodeURIComponent).join("/");

  const res = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedPath}?ref=${GITHUB_BRANCH}`
  );

  let resources = [];

  if (res.ok) {
    const entries = await res.json();
    if (Array.isArray(entries)) {
      resources = entries
        .filter((entry) => entry.type === "file")
        .filter((entry) => entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))
        .filter((entry) => entry.name !== "kustomization.yaml")
        .map((entry) => entry.name)
        .sort();
    }
  }
  // If 404, directory does not exist yet — return empty kustomization

  const kustomization = {
    apiVersion: "kustomize.config.k8s.io/v1beta1",
    kind: "Kustomization",
    resources,
  };

  return "---\n" + yaml.dump(kustomization, { lineWidth: -1, noRefs: true });
}

// ── Deploy / Undeploy ────────────────────────────────────────────────────────

/**
 * Deploys an application by committing its HelmRelease manifest and an
 * updated kustomization.yaml to Git in a single atomic commit.
 *
 * @param {string} team - Team/namespace name
 * @param {string} appName - Application name
 * @param {object} manifestObj - HelmRelease manifest object (JS object, not YAML)
 * @param {string} actor - User who triggered the deploy (for audit trail)
 */
async function deployApp(team, appName, manifestObj, actor, extraFiles = []) {
  requireEnabled();

  console.log(`[gitops] Deploying ${appName} to ${team} (by ${actor})${extraFiles.length ? ` with ${extraFiles.length} extra file(s)` : ""}`);

  // Serialize the manifest to YAML
  const manifestYaml = "---\n" + yaml.dump(manifestObj, { lineWidth: -1, noRefs: true });

  // Build the updated kustomization that includes this app and any extra files
  const allNames = [appName, ...extraFiles.map(f => f.filename.replace(/\.yaml$/, ""))];
  const kustomizationContent = await buildKustomizationWithApps(team, allNames);

  const files = [
    {
      path: `apps/tenants/${team}/apps/${appName}.yaml`,
      content: manifestYaml,
    },
    {
      path: `apps/tenants/${team}/apps/kustomization.yaml`,
      content: kustomizationContent,
    },
    ...extraFiles.map(f => ({
      path: `apps/tenants/${team}/apps/${f.filename}`,
      content: "---\n" + yaml.dump(f.manifest, { lineWidth: -1, noRefs: true }),
    })),
  ];

  const commitMessage = `deploy(${team}): ${appName}\n\nDeployed by: ${actor}`;

  const result = await createMultipleFiles(files, commitMessage);
  console.log(`[gitops] Deploy complete: ${appName} in ${team} (${files.length} files)`);
  return result;
}

/**
 * Undeploys an application by removing its manifest from Git and updating
 * the kustomization.yaml, all in a single atomic commit.
 *
 * @param {string} team - Team/namespace name
 * @param {string} appName - Application name
 * @param {string} actor - User who triggered the undeploy
 */
async function undeployApp(team, appName, actor) {
  requireEnabled();

  console.log(`[gitops] Undeploying ${appName} from ${team} (by ${actor})`);

  // Build the updated kustomization WITHOUT this app
  const kustomizationContent = await buildKustomizationWithoutApp(team, appName);

  // We need to delete the app manifest AND update the kustomization atomically.
  // Use the Git Trees API: delete the app file (sha: null) and update kustomization.

  // Step 1: Get the latest commit SHA on the branch
  const refRes = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/ref/heads/${GITHUB_BRANCH}`
  );
  if (!refRes.ok) {
    const body = await refRes.text();
    throw new Error(`Failed to get branch ref (${refRes.status}): ${body}`);
  }
  const refData = await refRes.json();
  const latestCommitSha = refData.object.sha;

  // Step 2: Get the tree SHA
  const commitRes = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits/${latestCommitSha}`
  );
  if (!commitRes.ok) {
    const body = await commitRes.text();
    throw new Error(`Failed to get commit (${commitRes.status}): ${body}`);
  }
  const commitData = await commitRes.json();
  const baseTreeSha = commitData.tree.sha;

  // Step 3: Create tree with deletion + update
  const tree = [
    // Delete the app manifest
    {
      path: `apps/tenants/${team}/apps/${appName}.yaml`,
      mode: "100644",
      type: "blob",
      sha: null,
    },
    // Delete the policy exception file if it exists (best-effort)
    {
      path: `apps/tenants/${team}/apps/${appName}-policy-exception.yaml`,
      mode: "100644",
      type: "blob",
      sha: null,
    },
    // Update the kustomization
    {
      path: `apps/tenants/${team}/apps/kustomization.yaml`,
      mode: "100644",
      type: "blob",
      content: kustomizationContent,
    },
  ];

  const treeRes = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_tree: baseTreeSha, tree }),
    }
  );
  if (!treeRes.ok) {
    const body = await treeRes.text();
    throw new Error(`Failed to create tree (${treeRes.status}): ${body}`);
  }
  const treeData = await treeRes.json();

  // Step 4: Create commit
  const commitMessage = `undeploy(${team}): remove ${appName}\n\nRemoved by: ${actor}`;
  const newCommitRes = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: commitMessage,
        tree: treeData.sha,
        parents: [latestCommitSha],
      }),
    }
  );
  if (!newCommitRes.ok) {
    const body = await newCommitRes.text();
    throw new Error(`Failed to create commit (${newCommitRes.status}): ${body}`);
  }
  const newCommitData = await newCommitRes.json();

  // Step 5: Update branch ref
  const updateRefRes = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${GITHUB_BRANCH}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: newCommitData.sha }),
    }
  );
  if (!updateRefRes.ok) {
    const body = await updateRefRes.text();
    throw new Error(`Failed to update branch ref (${updateRefRes.status}): ${body}`);
  }

  console.log(
    `[gitops] Undeploy complete: ${appName} removed from ${team} (commit: ${newCommitData.sha.slice(0, 7)})`
  );
  return newCommitData;
}

/**
 * Deploys multiple applications in a single atomic commit.
 * Used for compose/multi-service deploys.
 *
 * @param {string} team - Team/namespace name
 * @param {Array<{name: string, manifest: object}>} apps - Apps to deploy
 * @param {string} actor - User who triggered the deploy
 */
async function deployMultipleApps(team, apps, actor) {
  requireEnabled();

  const appNames = apps.map((a) => a.name);
  console.log(`[gitops] Deploying ${appNames.length} apps to ${team}: ${appNames.join(", ")} (by ${actor})`);

  // Serialize all manifests to YAML
  const files = apps.map((app) => ({
    path: `apps/tenants/${team}/apps/${app.name}.yaml`,
    content: "---\n" + yaml.dump(app.manifest, { lineWidth: -1, noRefs: true }),
  }));

  // Build kustomization that includes all these apps plus any existing ones
  const kustomizationContent = await buildKustomizationWithApps(team, appNames);
  files.push({
    path: `apps/tenants/${team}/apps/kustomization.yaml`,
    content: kustomizationContent,
  });

  const commitMessage =
    `deploy(${team}): ${appNames.join(", ")}\n\nDeployed ${appNames.length} app(s) by: ${actor}`;

  const result = await createMultipleFiles(files, commitMessage);
  console.log(`[gitops] Multi-deploy complete: ${appNames.length} apps in ${team}`);
  return result;
}

// ── Kustomization Builder Helpers ────────────────────────────────────────────

/**
 * Gets the current list of app resources from the team's apps/ kustomization.
 * Returns an array of filenames (e.g., ["my-app.yaml", "other-app.yaml"]).
 */
async function getCurrentAppResources(team) {
  const dirPath = `apps/tenants/${team}/apps`;
  const encodedPath = dirPath.split("/").map(encodeURIComponent).join("/");

  const res = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedPath}?ref=${GITHUB_BRANCH}`
  );

  if (res.status === 404) {
    return [];
  }

  const entries = await res.json();
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .filter((entry) => entry.type === "file")
    .filter((entry) => entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))
    .filter((entry) => entry.name !== "kustomization.yaml")
    .map((entry) => entry.name)
    .sort();
}

/**
 * Builds a kustomization.yaml that includes a new app (merging with existing entries).
 */
async function buildKustomizationWithApp(team, appName) {
  const existing = await getCurrentAppResources(team);
  const filename = appName.endsWith(".yaml") ? appName : `${appName}.yaml`;

  const resources = [...new Set([...existing, filename])].sort();

  const kustomization = {
    apiVersion: "kustomize.config.k8s.io/v1beta1",
    kind: "Kustomization",
    resources,
  };

  return "---\n" + yaml.dump(kustomization, { lineWidth: -1, noRefs: true });
}

/**
 * Builds a kustomization.yaml that includes multiple new apps.
 */
async function buildKustomizationWithApps(team, appNames) {
  const existing = await getCurrentAppResources(team);
  const filenames = appNames.map((n) => (n.endsWith(".yaml") ? n : `${n}.yaml`));

  const resources = [...new Set([...existing, ...filenames])].sort();

  const kustomization = {
    apiVersion: "kustomize.config.k8s.io/v1beta1",
    kind: "Kustomization",
    resources,
  };

  return "---\n" + yaml.dump(kustomization, { lineWidth: -1, noRefs: true });
}

/**
 * Builds a kustomization.yaml that excludes a specific app.
 */
async function buildKustomizationWithoutApp(team, appName) {
  const existing = await getCurrentAppResources(team);
  const filename = appName.endsWith(".yaml") ? appName : `${appName}.yaml`;
  const exceptionFilename = `${appName}-policy-exception.yaml`;

  const resources = existing.filter((r) => r !== filename && r !== exceptionFilename);

  const kustomization = {
    apiVersion: "kustomize.config.k8s.io/v1beta1",
    kind: "Kustomization",
    resources,
  };

  return "---\n" + yaml.dump(kustomization, { lineWidth: -1, noRefs: true });
}

// ── Tenant Scaffold ──────────────────────────────────────────────────────────

/**
 * Ensures a tenant exists in Git with the full scaffold (namespace, RBAC,
 * resource quotas, limit ranges, network policies, and apps/ directory).
 *
 * If the tenant already exists, this is a no-op.
 * If not, creates the full scaffold based on the team-alpha template,
 * replacing "team-alpha" with the new team name.
 *
 * @param {string} teamName - The team/tenant name (e.g., "team-gamma")
 */
async function ensureTenantInGit(teamName) {
  requireEnabled();

  // Check if tenant already exists
  const existingSha = await getFileSha(`apps/tenants/${teamName}/kustomization.yaml`);
  if (existingSha) {
    console.log(`[gitops] Tenant ${teamName} already exists in Git`);
    return;
  }

  console.log(`[gitops] Creating tenant scaffold for ${teamName} in Git`);

  // Read the team-alpha template files from GitHub to use as a base
  const templateFiles = [
    "namespace.yaml",
    "rbac.yaml",
    "resource-quota.yaml",
    "limit-range.yaml",
    "network-policies/default-deny.yaml",
    "network-policies/allow-base.yaml",
    "kustomization.yaml",
  ];

  const files = [];

  for (const templateFile of templateFiles) {
    const templatePath = `apps/tenants/team-alpha/${templateFile}`;
    const encodedPath = templatePath.split("/").map(encodeURIComponent).join("/");

    const res = await githubFetch(
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedPath}?ref=${GITHUB_BRANCH}`
    );

    if (!res.ok) {
      console.warn(`[gitops] Template file not found: ${templatePath}, generating from scratch`);
      continue;
    }

    const data = await res.json();
    // GitHub returns base64-encoded content
    let content = Buffer.from(data.content, "base64").toString("utf-8");

    // Replace all occurrences of team-alpha with the new team name
    content = content.replace(/team-alpha/g, teamName);

    files.push({
      path: `apps/tenants/${teamName}/${templateFile}`,
      content,
    });
  }

  // Update the tenant kustomization.yaml to include the apps/ directory
  // The team-alpha template may not include apps/, so we ensure it does
  const tenantKustomIdx = files.findIndex(
    (f) => f.path === `apps/tenants/${teamName}/kustomization.yaml`
  );
  if (tenantKustomIdx >= 0) {
    const parsed = yaml.load(files[tenantKustomIdx].content) || {};
    const resources = parsed.resources || [];
    if (!resources.includes("apps/")) {
      resources.push("apps/");
    }
    files[tenantKustomIdx].content =
      "---\n" +
      yaml.dump(
        { apiVersion: "kustomize.config.k8s.io/v1beta1", kind: "Kustomization", resources },
        { lineWidth: -1, noRefs: true }
      );
  }

  // Add an empty apps/ kustomization.yaml
  files.push({
    path: `apps/tenants/${teamName}/apps/kustomization.yaml`,
    content:
      "---\n" +
      yaml.dump(
        { apiVersion: "kustomize.config.k8s.io/v1beta1", kind: "Kustomization", resources: [] },
        { lineWidth: -1, noRefs: true }
      ),
  });

  // Update the root apps/tenants/kustomization.yaml to include the new team
  const rootKustomPath = "apps/tenants/kustomization.yaml";
  const rootKustomSha = await getFileSha(rootKustomPath);
  let rootResources = [];

  if (rootKustomSha) {
    const encodedRootPath = rootKustomPath.split("/").map(encodeURIComponent).join("/");
    const rootRes = await githubFetch(
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedRootPath}?ref=${GITHUB_BRANCH}`
    );
    if (rootRes.ok) {
      const rootData = await rootRes.json();
      const rootContent = Buffer.from(rootData.content, "base64").toString("utf-8");
      const rootParsed = yaml.load(rootContent) || {};
      rootResources = rootParsed.resources || [];
    }
  }

  if (!rootResources.includes(teamName)) {
    rootResources.push(teamName);
    rootResources.sort();
    files.push({
      path: rootKustomPath,
      content:
        "---\n" +
        yaml.dump(
          { apiVersion: "kustomize.config.k8s.io/v1beta1", kind: "Kustomization", resources: rootResources },
          { lineWidth: -1, noRefs: true }
        ),
    });
  }

  // Atomic commit of the entire tenant scaffold
  const commitMessage = `feat(tenants): scaffold ${teamName}\n\nNew tenant created via SRE Dashboard`;
  await createMultipleFiles(files, commitMessage);

  console.log(`[gitops] Tenant ${teamName} scaffold created (${files.length} files)`);
}

// ── Flux Reconciliation Trigger ──────────────────────────────────────────────

/**
 * Annotates the sre-tenants Flux Kustomization to trigger immediate reconciliation.
 * Best-effort — if it fails, Flux will still reconcile on its normal interval.
 */
async function triggerFluxReconcile() {
  try {
    const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
    await customApi.patchNamespacedCustomObject(
      "kustomize.toolkit.fluxcd.io",
      "v1",
      "flux-system",
      "kustomizations",
      "sre-tenants",
      {
        metadata: {
          annotations: {
            "reconcile.fluxcd.io/requestedAt": new Date().toISOString(),
          },
        },
      },
      undefined,
      undefined,
      undefined,
      { headers: { "Content-Type": "application/merge-patch+json" } }
    );
    console.log("[gitops] Triggered Flux reconciliation for sre-tenants");
  } catch (err) {
    console.warn("[gitops] Could not trigger Flux reconciliation:", err.message);
  }
}

// ── Startup Log ──────────────────────────────────────────────────────────────

if (isEnabled()) {
  console.log(
    `[gitops] GitOps enabled — repo: ${GITHUB_OWNER}/${GITHUB_REPO}, branch: ${GITHUB_BRANCH}`
  );
} else {
  console.log(
    "[gitops] GitOps disabled — GITHUB_TOKEN not set. Deploy operations will use direct K8s API only."
  );
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  isEnabled,
  deployApp,
  undeployApp,
  deployMultipleApps,
  ensureTenantInGit,
  triggerFluxReconcile,
  createOrUpdateFile,
  deleteFile,
  getFileSha,
  createMultipleFiles,
};
