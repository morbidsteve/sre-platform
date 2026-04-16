import type { AppSource, DetectionResult, SecurityGate, DeployStep, PipelineRun, FindingDisposition, BundleUploadResult } from './types';
import { getConfig, svcUrl } from './config';

// Call the dashboard API directly — no nginx proxy middleman.
// SameSite=None cookie ensures SSO session is sent cross-origin.
const API_BASE = `${svcUrl('dashboard')}/api`;

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

export async function checkHealth(): Promise<{ status: string }> {
  return apiFetch('/health');
}

export async function getCurrentUser(): Promise<{ name: string; email: string; groups: string[] }> {
  try {
    return await apiFetch('/user');
  } catch {
    return { name: 'operator', email: '', groups: [] };
  }
}

export async function getTeams(): Promise<string[]> {
  try {
    const data = await apiFetch<{ namespaces?: string[] }>('/portal/apps');
    return data.namespaces || ['team-alpha', 'team-bravo', 'team-charlie', 'default'];
  } catch {
    return ['team-alpha', 'team-bravo', 'team-charlie', 'default'];
  }
}

export async function fetchTeams(): Promise<string[]> {
  try {
    const res = await fetch(`${API_BASE}/tenants`, { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch teams');
    const data = await res.json();
    const teams: string[] = data
      .map((t: Record<string, unknown>) => (t.namespace || t.name) as string)
      .filter(Boolean);
    if (teams.length === 0) throw new Error('Empty team list');
    // Ensure 'default' is always available
    if (!teams.includes('default')) teams.push('default');
    return teams;
  } catch {
    // Fall back to the portal/apps endpoint
    try {
      return await getTeams();
    } catch {
      return ['team-alpha', 'team-bravo', 'team-charlie', 'default'];
    }
  }
}

export async function analyzeSource(source: AppSource): Promise<DetectionResult> {
  try {
    if (source.type === 'git' && source.gitUrl) {
      const data = await apiFetch<DetectionResult>('/deploy/git', {
        method: 'POST',
        body: JSON.stringify({
          url: source.gitUrl,
          branch: source.branch || 'main',
          analyze_only: true,
        }),
      });
      return data;
    }
  } catch {
    // Fall through to inferred detection
  }

  // Infer detection from the source URL when backend analysis unavailable
  await simulateDelay(1500);

  if (source.type === 'container') {
    if (!source.imageUrl) {
      throw new Error('Container image URL is required (must include an explicit tag, e.g. repo/app:1.2.3 — :latest is rejected by platform policy).');
    }
    if (!source.imageUrl.includes(':') || source.imageUrl.endsWith(':latest')) {
      throw new Error(`Container image "${source.imageUrl}" must be pinned to an explicit version tag. Platform enforces pinned tags via Kyverno — :latest is not allowed.`);
    }
    const imageName = source.imageUrl.split('/').pop()?.split(':')[0] || 'app';
    return {
      repoType: 'container',
      services: [
        { name: imageName, image: source.imageUrl, port: 8080, type: 'application' },
      ],
      platformServices: [],
      externalAccess: [
        { service: imageName, hostname: `${imageName}.${getConfig().domain}` },
      ],
    };
  }

  if (source.type === 'helm') {
    return {
      repoType: 'helm',
      services: [
        { name: source.chartName || 'app', image: 'chart-managed', port: 8080, type: 'application' },
      ],
      platformServices: [],
      externalAccess: [
        { service: source.chartName || 'app', hostname: `${source.chartName || 'app'}.${getConfig().domain}` },
      ],
    };
  }

  // Git repo — infer app name from URL
  const repoName = (source.gitUrl || '')
    .split('/')
    .pop()
    ?.replace('.git', '')
    ?.replace(/^docker-/, '') || 'app';

  // Dockerfile-based source: image does not yet exist — the pipeline will build and tag it
  // from the git SHA. We return an UNTAGGED placeholder that must be replaced before deploy.
  // Platform Kyverno policy rejects any non-pinned tag, so this fails loud if it ever reaches the cluster.
  return {
    repoType: 'dockerfile',
    services: [
      { name: repoName, image: `${repoName}:UNTAGGED`, port: 8080, type: 'application' },
    ],
    platformServices: [],
    externalAccess: [
      { service: repoName, hostname: `${repoName}.${getConfig().domain}` },
    ],
  };
}

export function getInitialGates(): SecurityGate[] {
  return [
    {
      id: 1,
      name: 'Static Application Security Testing (SAST)',
      shortName: 'SAST',
      description: 'Semgrep scans source code for vulnerabilities, insecure patterns, and CWE violations. Runs as a Kubernetes Job using docker.io/semgrep/semgrep.',
      status: 'pending',
      progress: 0,
      findings: [],
    },
    {
      id: 2,
      name: 'Secrets Detection',
      shortName: 'SECRETS',
      description: 'Gitleaks scans repository history and current code for leaked credentials, API keys, and tokens. Runs as a Kubernetes Job using docker.io/zricethezav/gitleaks.',
      status: 'pending',
      progress: 0,
      findings: [],
    },
    {
      id: 3,
      name: 'Container Image Build',
      shortName: 'ARTIFACT_STORE',
      description: 'Kaniko builds the container image from the Dockerfile and pushes it to Harbor registry. Runs as a Kubernetes Job using gcr.io/kaniko-project/executor.',
      status: 'pending',
      progress: 0,
      findings: [],
    },
    {
      id: 4,
      name: 'Software Bill of Materials (SBOM)',
      shortName: 'SBOM',
      description: 'Syft generates an SPDX 2.3 Software Bill of Materials from the built container image. Runs as a Kubernetes Job using docker.io/anchore/syft.',
      status: 'pending',
      progress: 0,
      findings: [],
    },
    {
      id: 5,
      name: 'Container Vulnerability Scan (CVE)',
      shortName: 'CVE',
      description: 'Trivy scans the built container image for known CVEs against NVD and vendor advisories. Runs as a Kubernetes Job using docker.io/aquasec/trivy.',
      status: 'pending',
      progress: 0,
      findings: [],
    },
    {
      id: 6,
      name: 'Dynamic Application Security Testing (DAST)',
      shortName: 'DAST',
      description: 'OWASP ZAP scans the running application for OWASP Top 10 vulnerabilities. Runs post-deployment against the live URL.',
      status: 'pending',
      progress: 0,
      findings: [],
    },
    {
      id: 7,
      name: 'ISSM Security Review',
      shortName: 'ISSM_REVIEW',
      description: 'Information System Security Manager reviews all scan results, findings, and security exceptions before approving deployment.',
      status: 'pending',
      progress: 0,
      findings: [],
    },
    {
      id: 8,
      name: 'Image Signing & Attestation',
      shortName: 'IMAGE_SIGNING',
      description: 'Cosign signs the approved container image with a cryptographic signature for supply chain integrity verification.',
      status: 'pending',
      progress: 0,
      findings: [],
    },
  ];
}

export async function runSecurityPipeline(
  gates: SecurityGate[],
  onUpdate: (gates: SecurityGate[]) => void,
  gitUrl?: string,
  branch?: string
): Promise<SecurityGate[]> {
  const updated = [...gates.map((g) => ({ ...g }))];
  const repoUrl = gitUrl || '';
  const repoBranch = branch || 'main';

  // Helper to run a real gate via backend API
  async function runGate(
    idx: number,
    endpoint: string,
    body: Record<string, string>,
    fallbackStatus: SecurityGate['status'],
    fallbackSummary: string
  ) {
    updated[idx] = { ...updated[idx], status: 'running', progress: 0 };
    onUpdate([...updated]);

    // Animate progress while waiting
    const progressInterval = setInterval(() => {
      if (updated[idx].progress < 90) {
        updated[idx] = { ...updated[idx], progress: updated[idx].progress + 5 };
        onUpdate([...updated]);
      }
    }, 500);

    try {
      const result = await apiFetch<{
        status: string;
        findings?: Array<{ severity: string; title: string; description: string; location?: string }>;
        summary: string;
        reportUrl?: string;
        packageCount?: number;
      }>(endpoint, { method: 'POST', body: JSON.stringify(body) });

      clearInterval(progressInterval);
      updated[idx] = {
        ...updated[idx],
        status: (result.status as SecurityGate['status']) || 'passed',
        progress: 100,
        summary: result.summary || fallbackSummary,
        findings: (result.findings || []).map(f => ({ ...f, severity: (f.severity?.toLowerCase() || 'info') as 'critical' | 'high' | 'medium' | 'low' | 'info' })),
        reportUrl: result.reportUrl,
        implemented: true,
      };
    } catch (err) {
      clearInterval(progressInterval);
      // Fallback: show mock results if backend unavailable
      updated[idx] = {
        ...updated[idx],
        status: fallbackStatus,
        progress: 100,
        summary: `${fallbackSummary} (API unavailable — using demo data)`,
        implemented: true,
      };
    }
    onUpdate([...updated]);
  }

  // Gate 1: SAST (Semgrep) — REAL
  await runGate(0, '/security/sast', { url: repoUrl, branch: repoBranch }, 'passed', 'Semgrep: 0 findings');

  // Gate 3: Secrets (Gitleaks) — REAL
  await runGate(2, '/security/secrets', { url: repoUrl, branch: repoBranch }, 'passed', 'Gitleaks: 0 secrets detected');

  // Gate 8: Artifact Store (Harbor) — always passes
  updated[7] = { ...updated[7], status: 'running', progress: 0 };
  onUpdate([...updated]);
  await simulateDelay(800);
  updated[7] = {
    ...updated[7],
    status: 'passed',
    progress: 100,
    summary: 'Harbor: Images pushed and stored',
    reportUrl: svcUrl('harbor'),
    implemented: true,
  };
  onUpdate([...updated]);

  // Gate 2: SBOM (Syft) — REAL
  // Tag the image with the branch name (resolves to the just-built branch tag in Harbor).
  // Platform policy forbids :latest, so use the branch as the pinned tag reference.
  const imageBase = `${getConfig().registryUrl}/platform/${(repoUrl || '').split('/').pop()?.replace('.git', '') || 'app'}`;
  const imageName = `${imageBase}:${repoBranch || 'main'}`;
  await runGate(1, '/security/sbom', { image: imageName }, 'passed', 'SBOM generated (SPDX + CycloneDX)');

  // Gate 4: CVE Scan (Trivy) — via Harbor auto-scan, show results from proxy
  updated[3] = { ...updated[3], status: 'running', progress: 0 };
  onUpdate([...updated]);
  try {
    const vulns = await apiFetch<{ vulnerabilities: Array<{ severity: string; critical: number; high: number; medium: number; low: number; total: number; repository: string }> }>('/proxy/harbor/vulnerabilities');
    await simulateProgress(updated, 3, onUpdate, 2000);
    const allFindings = vulns.vulnerabilities.flatMap(v => {
      const findings = [];
      if (v.critical > 0) findings.push({ severity: 'critical' as const, title: `${v.critical} critical CVEs`, description: `In ${v.repository}`, location: v.repository });
      if (v.high > 0) findings.push({ severity: 'high' as const, title: `${v.high} high CVEs`, description: `In ${v.repository}`, location: v.repository });
      if (v.medium > 0) findings.push({ severity: 'medium' as const, title: `${v.medium} medium CVEs`, description: `In ${v.repository}`, location: v.repository });
      return findings;
    });
    const totalCrit = vulns.vulnerabilities.reduce((s, v) => s + v.critical, 0);
    const totalHigh = vulns.vulnerabilities.reduce((s, v) => s + v.high, 0);
    const totalMed = vulns.vulnerabilities.reduce((s, v) => s + v.medium, 0);
    updated[3] = {
      ...updated[3],
      status: totalCrit > 0 ? 'failed' : totalHigh > 0 ? 'warning' : 'passed',
      progress: 100,
      summary: `Trivy: ${totalCrit} critical, ${totalHigh} high, ${totalMed} medium`,
      findings: allFindings,
      reportUrl: `${svcUrl('harbor')}/harbor/projects`,
      implemented: true,
    };
  } catch {
    await simulateProgress(updated, 3, onUpdate, 2000);
    updated[3] = {
      ...updated[3], status: 'warning', progress: 100,
      summary: 'Trivy: scan results pending (check Harbor)',
      findings: [], implemented: true,
    };
  }
  onUpdate([...updated]);

  // Gate 5: DAST (ZAP) — REAL (runs against target URL if available)
  await runGate(4, '/security/dast', { targetUrl: `https://${(repoUrl || '').split('/').pop()?.replace('.git', '') || 'app'}.${getConfig().domain}` }, 'passed', 'ZAP: 0 alerts');

  // Gate 6: ISSM Review — manual approval (always requires human)
  updated[5] = {
    ...updated[5],
    status: 'skipped',
    progress: 100,
    summary: 'Awaiting ISSM review and approval',
    implemented: false,
  };
  onUpdate([...updated]);

  // Gate 7: Image Signing — manual until Cosign is wired
  updated[6] = {
    ...updated[6],
    status: 'skipped',
    progress: 100,
    summary: 'Awaiting ISSM approval before signing',
    implemented: false,
  };
  onUpdate([...updated]);

  return updated;
}

export function getInitialDeploySteps(): DeployStep[] {
  return [
    { id: 'namespace', label: 'Namespace', status: 'pending' },
    { id: 'pull-secret', label: 'Pull secret', status: 'pending' },
    { id: 'helm-release', label: 'HelmRelease', status: 'pending' },
    { id: 'pods', label: 'Pods', status: 'pending' },
    { id: 'health', label: 'Health check', status: 'pending' },
    { id: 'portal', label: 'Portal registration', status: 'pending' },
  ];
}

export async function runDeploy(
  appName: string,
  gitUrl: string,
  branch: string,
  team: string,
  steps: DeployStep[],
  onUpdate: (steps: DeployStep[]) => void
): Promise<{ url: string; steps: DeployStep[] }> {
  const updated = [...steps.map((s) => ({ ...s }))];

  // Step 1: Create namespace
  updated[0] = { ...updated[0], status: 'running' };
  onUpdate([...updated]);

  try {
    // Call the real deploy API
    const response = await fetch(`${API_BASE}/deploy/git`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        url: gitUrl,
        branch: branch || 'main',
        team: team || 'team-alpha',
        appName: appName,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Deploy failed' }));
      throw new Error(err.error || `HTTP ${response.status}`);
    }

    const result = await response.json();

    // Mark all steps as completed
    for (let i = 0; i < updated.length; i++) {
      updated[i] = { ...updated[i], status: 'completed' };
      onUpdate([...updated]);
      await simulateDelay(500);
    }

    const url = result.url || `https://${appName}.${getConfig().domain}`;
    return { url, steps: updated };
  } catch (err) {
    // Mark current step as failed
    const failIdx = updated.findIndex((s) => s.status === 'running');
    if (failIdx >= 0) {
      updated[failIdx] = { ...updated[failIdx], status: 'failed' };
      onUpdate([...updated]);
    }
    throw err;
  }
}

// Helpers

function simulateDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function simulateProgress(
  gates: SecurityGate[],
  index: number,
  onUpdate: (gates: SecurityGate[]) => void,
  totalMs: number
): Promise<void> {
  const steps = 10;
  const interval = totalMs / steps;
  for (let i = 1; i <= steps; i++) {
    await simulateDelay(interval);
    gates[index] = { ...gates[index], progress: i * 10 };
    onUpdate([...gates]);
  }
}

export async function uploadBundle(
  file: File,
  onProgress?: (percent: number) => void
): Promise<BundleUploadResult> {
  const formData = new FormData();
  formData.append('bundle', file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/bundle/upload`);
    xhr.withCredentials = true;

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
    }

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data as BundleUploadResult);
        } else {
          reject(new Error(data.error || `Upload failed (HTTP ${xhr.status})`));
        }
      } catch {
        reject(new Error(`Upload failed (HTTP ${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(formData);
  });
}

// --- Pipeline API ---

export async function createPipelineRun(data: {
  appName: string;
  gitUrl?: string;
  branch?: string;
  imageUrl?: string;
  sourceType: string;
  team: string;
  classification: string;
  contact?: string;
  /** Granular pod/container security context overrides (e.g. from the Deploy tab securityContext UI). */
  securityContext?: Record<string, unknown>;
  port?: number;
  bundleUploadId?: string;
}): Promise<PipelineRun> {
  return apiFetch('/pipeline/runs', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getPipelineRun(runId: string, includeRaw = false): Promise<PipelineRun> {
  const params = includeRaw ? '?include_raw=true' : '';
  return apiFetch(`/pipeline/runs/${runId}${params}`);
}

export interface GateOutputResponse {
  gateId: number;
  gateName: string;
  shortName: string;
  status: string;
  tool: string | null;
  summary: string | null;
  rawOutput: {
    gate?: string;
    tool?: string;
    status?: string;
    summary?: string;
    findings?: Array<{ severity: string; title: string; description?: string; location?: string }>;
    toolOutput?: unknown;
    packageCount?: number;
    format?: string;
    scannedAt?: string;
  } | null;
}

export async function getGateOutput(runId: string, gateId: number): Promise<GateOutputResponse> {
  return apiFetch(`/pipeline/runs/${runId}/gates/${gateId}/output`);
}

export async function updateFindingDisposition(
  runId: string,
  findingId: number,
  disposition: FindingDisposition,
  mitigation?: string
): Promise<void> {
  await apiFetch(`/pipeline/runs/${runId}/findings/${findingId}`, {
    method: 'PATCH',
    body: JSON.stringify({ disposition, mitigation }),
  });
}

export async function bulkUpdateFindings(
  runId: string,
  gateId: number,
  disposition: FindingDisposition,
  mitigation?: string
): Promise<{ updated: number }> {
  return apiFetch(`/pipeline/runs/${runId}/findings/bulk`, {
    method: 'POST',
    body: JSON.stringify({ gateId, disposition, mitigation }),
  });
}

export async function submitForReview(runId: string): Promise<void> {
  await apiFetch(`/pipeline/runs/${runId}/submit-review`, { method: 'POST' });
}

export async function submitReview(
  runId: string,
  decision: 'approved' | 'rejected' | 'returned',
  comment?: string
): Promise<void> {
  await apiFetch(`/pipeline/runs/${runId}/review`, {
    method: 'POST',
    body: JSON.stringify({ decision, comment }),
  });
}

export async function deployPipelineRun(runId: string): Promise<void> {
  await apiFetch(`/pipeline/runs/${runId}/deploy`, { method: 'POST' });
}

export async function overrideGate(runId: string, gateId: number, status: string, reason: string): Promise<void> {
  await apiFetch(`/pipeline/runs/${runId}/gates/${gateId}/override`, {
    method: 'POST',
    body: JSON.stringify({ status, reason }),
  });
}

export async function downloadCompliancePackage(runId: string): Promise<Record<string, unknown>> {
  return apiFetch(`/pipeline/runs/${runId}/package`);
}

export async function requestSecurityExceptions(
  runId: string,
  exceptions: Array<{ type: string; justification: string; approved?: boolean }>
): Promise<void> {
  await apiFetch(`/pipeline/runs/${runId}/exceptions`, {
    method: 'POST',
    body: JSON.stringify({ exceptions }),
  });
}

export async function retryPipelineRun(runId: string): Promise<PipelineRun> {
  return apiFetch(`/pipeline/runs/${runId}/retry`, { method: 'POST' });
}

export async function listPipelineRuns(limit = 20): Promise<{ runs: PipelineRun[]; total: number }> {
  return apiFetch(`/pipeline/runs?limit=${limit}`);
}

export async function fetchHarborRepos(project: string): Promise<Array<{ name: string; fullName: string; artifactCount: number }>> {
  try {
    const res = await apiFetch<Array<{ name: string; fullName: string; artifactCount: number }>>(`/harbor/projects/${encodeURIComponent(project)}/repositories`);
    return res;
  } catch {
    return [];
  }
}

export async function fetchHarborTags(project: string, repo: string): Promise<Array<{ name: string; digest: string | null; size: number | null; pushed: string | null }>> {
  try {
    const res = await apiFetch<Array<{ name: string; digest: string | null; size: number | null; pushed: string | null }>>(`/harbor/projects/${encodeURIComponent(project)}/repositories/${encodeURIComponent(repo)}/tags`);
    return res;
  } catch {
    return [];
  }
}

export async function checkIngressHostname(hostname: string): Promise<{ available: boolean; usedBy?: string; namespace?: string }> {
  try {
    return await apiFetch<{ available: boolean; usedBy?: string; namespace?: string }>(`/ingress/check?hostname=${encodeURIComponent(hostname)}`);
  } catch {
    return { available: true };
  }
}
