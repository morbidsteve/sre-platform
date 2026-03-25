import React from 'react';
import { ExternalLink, BarChart3, Trash2, Rocket } from 'lucide-react';
import { useConfig, serviceUrl } from '../../context/ConfigContext';

interface AppInfo {
  name: string;
  namespace: string;
  team?: string;
  image: string;
  tag: string;
  port?: number;
  host?: string;
  url?: string;
  ready: boolean;
  status?: string;
  // Pipeline run fields
  _isPipelineRun?: boolean;
  _runId?: string;
  gates?: { short_name: string; gate_name: string; status: string }[];
  classification?: string;
  created_at?: string;
}

interface AppTileProps {
  app: AppInfo;
  isAdmin: boolean;
  onDelete: (namespace: string, name: string) => void;
  onOpenService: (url: string) => void;
  onShowRunDetail?: (runId: string) => void;
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function AppTile({ app, isAdmin, onDelete, onOpenService, onShowRunDetail }: AppTileProps) {
  const config = useConfig();

  if (app._isPipelineRun) {
    return <PipelineAppTile app={app} onShowRunDetail={onShowRunDetail} />;
  }

  const hasUrl = !!(app.url && app.host);
  const grafanaUrl = `${serviceUrl(config, 'grafana')}/explore?orgId=1&left=%7B%22datasource%22:%22loki%22,%22queries%22:%5B%7B%22expr%22:%22%7Bnamespace%3D%5C%22${encodeURIComponent(app.namespace)}%5C%22%7D%22%7D%5D%7D`;

  return (
    <div
      className={`bg-card border border-border rounded-[var(--radius)] p-4 transition-all ${
        hasUrl ? 'cursor-pointer hover:border-border-hover hover:bg-surface-hover' : ''
      }`}
      onClick={hasUrl ? () => onOpenService(app.url!) : undefined}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${app.ready ? 'bg-green' : 'bg-yellow'}`} />
          <span className="font-semibold text-sm text-text-bright">{app.name}</span>
        </div>
        <span
          className={`text-[11px] font-mono px-2 py-0.5 rounded ${
            app.ready
              ? 'bg-[rgba(64,192,87,0.15)] text-green'
              : 'bg-[rgba(250,176,5,0.15)] text-yellow'
          }`}
        >
          {app.ready ? 'Running' : 'Deploying'}
        </span>
      </div>

      <div className="text-xs text-text-dim font-mono mb-2 truncate">
        {app.image ? `${app.image}:${app.tag}` : 'unknown'}
      </div>

      {hasUrl ? (
        <a
          className="text-xs text-accent hover:underline block mb-2 truncate"
          href={app.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          {app.host}
        </a>
      ) : (
        <span className="text-xs text-text-dim block mb-2">Cluster-internal only</span>
      )}

      <div className="flex items-center gap-3 text-[11px] text-text-dim mb-3">
        <span>{app.team || app.namespace}</span>
        <span>{app.namespace}</span>
        {app.port && <span>:{app.port}</span>}
      </div>

      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <a
          className="btn text-[11px] !px-2 !py-1 !min-h-0 inline-flex items-center gap-1 no-underline"
          href={grafanaUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <BarChart3 className="w-3 h-3" />
          Logs
        </a>
        {hasUrl && (
          <a
            className="btn btn-primary text-[11px] !px-2 !py-1 !min-h-0 inline-flex items-center gap-1 no-underline"
            href={app.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="w-3 h-3" />
            Open
          </a>
        )}
        {isAdmin && (
          <button
            className="btn btn-danger text-[11px] !px-2 !py-1 !min-h-0 inline-flex items-center gap-1"
            onClick={() => onDelete(app.namespace, app.name)}
          >
            <Trash2 className="w-3 h-3" />
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function PipelineAppTile({
  app,
  onShowRunDetail,
}: {
  app: AppInfo;
  onShowRunDetail?: (runId: string) => void;
}) {
  const st = app.status || 'pending';
  const gates = app.gates || [];
  const passed = gates.filter((g) => g.status === 'passed' || g.status === 'warning').length;
  const failed = gates.filter((g) => g.status === 'failed').length;
  const total = gates.length || 8;

  const borderColor =
    st === 'scanning' || st === 'deploying'
      ? 'border-l-accent'
      : st === 'review_pending'
      ? 'border-l-yellow'
      : st === 'approved'
      ? 'border-l-green'
      : 'border-l-text-dim';

  const dotColor =
    st === 'scanning' || st === 'deploying'
      ? 'bg-accent'
      : st === 'review_pending'
      ? 'bg-yellow'
      : st === 'approved'
      ? 'bg-green'
      : 'bg-text-dim';

  const dotAnim =
    st === 'scanning' || st === 'deploying' ? 'animate-pulse' : '';

  const statusMsg =
    st === 'scanning'
      ? `Scanning... ${passed}/${total} gates`
      : st === 'review_pending'
      ? 'Awaiting ISSM Review'
      : st === 'approved'
      ? 'Approved -- Ready to Deploy'
      : st === 'deploying'
      ? 'Deploying...'
      : st === 'pending'
      ? 'Pipeline starting...'
      : st;

  return (
    <div
      className={`bg-card border border-border ${borderColor} border-l-[3px] rounded-[var(--radius)] p-4 cursor-pointer hover:bg-surface-hover transition-all`}
      onClick={() => app._runId && onShowRunDetail?.(app._runId)}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${dotColor} ${dotAnim}`} />
          <span className="font-semibold text-sm text-text-bright">{app.name}</span>
        </div>
        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-accent/10 text-accent">
          {st.replace(/_/g, ' ')}
        </span>
      </div>

      {/* Gate progress circles */}
      <div className="flex gap-1 items-center my-1.5">
        {gates.map((g, i) => {
          const color =
            g.status === 'passed'
              ? 'bg-green'
              : g.status === 'warning'
              ? 'bg-yellow'
              : g.status === 'failed'
              ? 'bg-red'
              : g.status === 'running'
              ? 'bg-accent animate-pulse'
              : 'bg-surface-hover';
          return (
            <span
              key={i}
              className={`w-2.5 h-2.5 rounded-full ${color}`}
              title={`${g.short_name || g.gate_name}: ${g.status}`}
            />
          );
        })}
      </div>

      <div className="text-xs text-text-dim mb-2">
        {statusMsg}
        {failed > 0 && <span className="text-red ml-1">({failed} failed)</span>}
      </div>

      <div className="flex items-center gap-3 text-[11px] text-text-dim">
        <span>{app.team || ''}</span>
        {app.created_at && <span>{timeAgo(app.created_at)}</span>}
      </div>
    </div>
  );
}
