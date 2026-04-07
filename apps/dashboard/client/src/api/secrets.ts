import { apiFetch } from './client';

export interface SecretStatus {
  component: string;
  lastRotated: string | null;
  ageHours: number;
  ageDays: number;
  healthy: boolean;
}

export interface RotationResult {
  component: string;
  status: 'success' | 'dry_run' | 'failed';
  detail: string;
}

export function fetchSecretStatus(): Promise<{ components: SecretStatus[] }> {
  return apiFetch('/api/admin/secrets/status');
}

export function rotateSecrets(component: string, dryRun: boolean): Promise<{ results: RotationResult[]; dryRun: boolean }> {
  return apiFetch('/api/admin/secrets/rotate', {
    method: 'POST',
    body: JSON.stringify({ component, dryRun }),
  });
}
