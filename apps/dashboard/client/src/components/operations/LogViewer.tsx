import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Search, Pause, Play, Download, Trash2, ChevronDown } from 'lucide-react';
import { openLogStream } from '../../api/ops';

interface OpsLogViewerProps {
  namespace: string;
  name: string;
  pods: { name: string; containers: (string | { name: string; [k: string]: unknown })[] }[];
}

// Normalize container to string name
function cName(c: string | { name: string; [k: string]: unknown }): string {
  return typeof c === 'string' ? c : c.name;
}

const LOG_COLORS: Record<string, string> = {
  error: 'text-red',
  err: 'text-red',
  fatal: 'text-red',
  warn: 'text-yellow',
  warning: 'text-yellow',
  info: 'text-text-primary',
  debug: 'text-text-dim',
};

function colorLine(line: string): string {
  const lower = line.toLowerCase();
  for (const [keyword, cls] of Object.entries(LOG_COLORS)) {
    if (lower.includes(keyword)) return cls;
  }
  return 'text-text-dim';
}

const MAX_LOG_LINES = 2000;

export function OpsLogViewer({ namespace, name, pods }: OpsLogViewerProps) {
  const [selectedPod, setSelectedPod] = useState(pods[0]?.name || '');
  const [selectedContainer, setSelectedContainer] = useState(cName(pods[0]?.containers[0] || ''));
  const [lines, setLines] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // When pod changes, reset container selection
  useEffect(() => {
    const pod = pods.find((p) => p.name === selectedPod);
    if (pod && pod.containers[0]) {
      setSelectedContainer(cName(pod.containers[0]));
    }
  }, [selectedPod, pods]);

  // Open SSE stream
  const startStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (!selectedPod || !selectedContainer) return;

    setLines([]);
    const es = openLogStream(namespace, name, selectedPod, selectedContainer);
    esRef.current = es;

    es.addEventListener('message', (e: MessageEvent) => {
      if (pausedRef.current) return;
      let logLine = e.data as string;
      try {
        const parsed = JSON.parse(logLine);
        if (parsed.type === 'done') {
          setLines((prev) => [...prev, '--- stream complete ---']);
          es.close();
          return;
        }
        logLine = parsed.line || logLine;
      } catch { /* raw text line, use as-is */ }
      setLines((prev) => {
        const next = [...prev, logLine];
        return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
      });
    });

    es.addEventListener('error', () => {
      if (es.readyState === EventSource.CLOSED) {
        setLines((prev) => [...prev, '--- stream ended ---']);
      }
    });
  }, [namespace, name, selectedPod, selectedContainer]);

  useEffect(() => {
    startStream();
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [startStream]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logRef.current && !paused) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines, autoScroll, paused]);

  const handleScroll = () => {
    if (!logRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(atBottom);
  };

  const handleClear = () => setLines([]);

  const handleDownload = () => {
    const content = lines.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${namespace}-${name}-${selectedPod}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const currentPod = pods.find((p) => p.name === selectedPod);
  const containers = currentPod?.containers || [];

  const displayedLines = searchQuery
    ? lines.filter((l) => l.toLowerCase().includes(searchQuery.toLowerCase()))
    : lines;

  return (
    <div className="flex flex-col h-full">
      {/* Controls bar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {/* Pod selector */}
        {pods.length > 1 && (
          <div className="relative">
            <select
              value={selectedPod}
              onChange={(e) => setSelectedPod(e.target.value)}
              className="appearance-none pl-2.5 pr-7 py-1.5 bg-surface border border-border rounded-[var(--radius)] text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
            >
              {pods.map((p) => (
                <option key={p.name} value={p.name}>{p.name.replace(/-[a-z0-9]{5,10}-[a-z0-9]{5}$/, '-…')}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-dim pointer-events-none" />
          </div>
        )}

        {/* Container selector */}
        {containers.length > 1 && (
          <div className="relative">
            <select
              value={selectedContainer}
              onChange={(e) => setSelectedContainer(e.target.value)}
              className="appearance-none pl-2.5 pr-7 py-1.5 bg-surface border border-border rounded-[var(--radius)] text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
            >
              {containers.map((c) => (
                <option key={cName(c)} value={cName(c)}>{cName(c)}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-dim pointer-events-none" />
          </div>
        )}

        {/* Search */}
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-dim" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter logs..."
            className="w-full pl-7 pr-2.5 py-1.5 bg-surface border border-border rounded-[var(--radius)] text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
          {searchQuery && (
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] font-mono text-text-muted">
              {displayedLines.length} matches
            </span>
          )}
        </div>

        {/* Actions */}
        <button
          onClick={() => setPaused((p) => !p)}
          className={`btn text-[11px] !px-2.5 !py-1 !min-h-0 flex items-center gap-1 ${paused ? 'btn-primary' : ''}`}
          title={paused ? 'Resume streaming' : 'Pause streaming'}
        >
          {paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          onClick={handleClear}
          className="btn text-[11px] !px-2 !py-1 !min-h-0 flex items-center gap-1"
          title="Clear log buffer"
        >
          <Trash2 className="w-3 h-3" />
        </button>
        <button
          onClick={handleDownload}
          className="btn text-[11px] !px-2 !py-1 !min-h-0 flex items-center gap-1"
          title="Download logs"
        >
          <Download className="w-3 h-3" />
        </button>
      </div>

      {/* Log output */}
      <div
        ref={logRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-[#060911] border border-border rounded-[var(--radius)] p-3 font-mono text-[11px] leading-relaxed"
        style={{ minHeight: '320px' }}
      >
        {displayedLines.length === 0 ? (
          <span className="text-text-muted">
            {paused ? 'Stream paused. Click Resume to continue.' : 'Waiting for logs…'}
          </span>
        ) : (
          displayedLines.map((line, i) => (
            <div key={i} className={`whitespace-pre-wrap break-all ${colorLine(line)}`}>
              {line}
            </div>
          ))
        )}

        {/* Paused indicator */}
        {paused && (
          <div className="sticky bottom-0 mt-1 text-[10px] text-yellow font-mono opacity-80">
            ▌ PAUSED — new lines are being discarded
          </div>
        )}

        {/* Auto-scroll indicator */}
        {!autoScroll && !paused && (
          <button
            onClick={() => {
              setAutoScroll(true);
              if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
            }}
            className="sticky bottom-0 mt-1 text-[10px] text-accent font-mono underline"
          >
            ↓ Jump to bottom (auto-scroll off)
          </button>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between mt-1.5 text-[10px] font-mono text-text-muted">
        <span>{lines.length} lines buffered (max {MAX_LOG_LINES})</span>
        <span className={`flex items-center gap-1 ${paused ? 'text-yellow' : 'text-green'}`}>
          <span
            className={`w-1.5 h-1.5 rounded-full ${paused ? 'bg-yellow' : 'bg-green'}`}
            style={!paused ? { boxShadow: '0 0 4px var(--green)' } : undefined}
          />
          {paused ? 'Paused' : 'Live'}
        </span>
      </div>
    </div>
  );
}
