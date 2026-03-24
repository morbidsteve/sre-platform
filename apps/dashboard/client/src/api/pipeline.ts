import { apiFetch } from './client';
import type {
  PipelineStats,
  PipelineRunsResponse,
  PipelineRun,
  GateOutputResponse,
} from '../types/api';

interface ServerPipelineStats {
  totalRuns: number;
  byStatus: Record<string, number>;
  approvalRate: string;
  avgReviewTimeSeconds: number | null;
  avgReviewTimeHuman: string;
}

export async function fetchPipelineStats(): Promise<PipelineStats> {
  const raw = await apiFetch<ServerPipelineStats>('/api/pipeline/stats');
  const byStatus = raw.byStatus || {};
  return {
    total: raw.totalRuns ?? 0,
    passed: (byStatus['passed'] ?? 0),
    failed: (byStatus['failed'] ?? 0),
    pending: (byStatus['pending'] ?? 0),
    running: (byStatus['running'] ?? 0),
    review_pending: (byStatus['review_pending'] ?? 0),
    approved: (byStatus['approved'] ?? 0),
    deployed: (byStatus['deployed'] ?? 0),
  };
}

export function fetchPipelineRuns(params?: {
  status?: string;
  search?: string;
  offset?: number;
  limit?: number;
}): Promise<PipelineRunsResponse> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.search) qs.set('search', params.search);
  if (params?.offset !== undefined) qs.set('offset', String(params.offset));
  if (params?.limit !== undefined) qs.set('limit', String(params.limit));
  const q = qs.toString();
  return apiFetch<PipelineRunsResponse>('/api/pipeline/runs' + (q ? '?' + q : ''));
}

export function fetchPipelineRun(id: string, includeRaw?: boolean): Promise<PipelineRun> {
  const q = includeRaw ? '?include_raw=true' : '';
  return apiFetch<PipelineRun>('/api/pipeline/runs/' + id + q);
}

export function reviewPipelineRun(
  id: string,
  decision: 'approved' | 'rejected' | 'returned',
  comment?: string,
): Promise<void> {
  return apiFetch('/api/pipeline/runs/' + id + '/review', {
    method: 'POST',
    body: JSON.stringify({ decision, comment }),
  });
}

export function submitForReview(id: string): Promise<void> {
  return apiFetch('/api/pipeline/runs/' + id + '/submit-review', { method: 'POST' });
}

export function deployPipelineRun(id: string): Promise<void> {
  return apiFetch('/api/pipeline/runs/' + id + '/deploy', { method: 'POST' });
}

export function deletePipelineRun(id: string): Promise<void> {
  return apiFetch('/api/pipeline/runs/' + id, { method: 'DELETE' });
}

export function retryPipelineRun(id: string): Promise<PipelineRun> {
  return apiFetch<PipelineRun>('/api/pipeline/runs/' + id + '/retry', { method: 'POST' });
}

export function fetchGateOutput(runId: string, gateId: number): Promise<GateOutputResponse> {
  return apiFetch<GateOutputResponse>('/api/pipeline/runs/' + runId + '/gates/' + gateId + '/output');
}

export function fetchPipelinePackage(runId: string): Promise<Record<string, unknown>> {
  return apiFetch('/api/pipeline/runs/' + runId + '/package');
}

export function overrideGate(runId: string, gateId: number, status: string, reason: string): Promise<void> {
  return apiFetch('/api/pipeline/runs/' + runId + '/gates/' + gateId + '/override', {
    method: 'POST',
    body: JSON.stringify({ status, reason }),
  });
}

export function updateFindingDisposition(
  runId: string,
  findingId: number,
  disposition: string,
  mitigation?: string,
): Promise<void> {
  return apiFetch('/api/pipeline/runs/' + runId + '/findings/' + findingId, {
    method: 'PATCH',
    body: JSON.stringify({ disposition, mitigation }),
  });
}
