export function age(dateStr: string | undefined | null): string {
  if (!dateStr) return '?';
  const ms = Date.now() - new Date(dateStr).getTime();
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return d + 'd' + h + 'h';
  if (h > 0) return h + 'h' + m + 'm';
  return m + 'm';
}

export function fmtCpu(cores: number): string {
  if (cores >= 1) return cores.toFixed(2);
  return Math.round(cores * 1000) + 'm';
}

export function fmtMem(bytes: number): string {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(1) + ' Gi';
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(0) + ' Mi';
  return (bytes / 1024).toFixed(0) + ' Ki';
}

export function parseCpu(s: string | undefined | null): number {
  if (!s) return 0;
  const str = String(s);
  if (str.endsWith('n')) return parseInt(str) / 1e9;
  if (str.endsWith('m')) return parseInt(str) / 1000;
  return parseFloat(str) || 0;
}

export function parseMem(s: string | undefined | null): number {
  if (!s) return 0;
  const str = String(s);
  const units: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    K: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
  };
  for (const [u, m] of Object.entries(units)) {
    if (str.endsWith(u)) return parseInt(str) * m;
  }
  return parseInt(str) || 0;
}

export function escapeHtml(str: string): string {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function truncate(str: string, len: number): string {
  if (!str || str.length <= len) return str;
  return str.slice(0, len) + '...';
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
