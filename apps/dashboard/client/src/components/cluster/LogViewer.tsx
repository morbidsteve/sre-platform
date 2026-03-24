import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '../ui/Button';
import { fetchPodLogs } from '../../api/cluster';

interface LogViewerProps {
  namespace: string;
  podName: string;
  containers: string[];
}

export function LogViewer({ namespace, podName, containers }: LogViewerProps) {
  const [container, setContainer] = useState('');
  const [tailLines, setTailLines] = useState(300);
  const [logs, setLogs] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const viewerRef = useRef<HTMLPreElement>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const text = await fetchPodLogs(namespace, podName, container || undefined, tailLines, false);
      setLogs(text || '(no logs)');
      setSearchQuery('');
      setMatchCount(0);
    } catch (err) {
      setLogs('Error loading logs: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }, [namespace, podName, container, tailLines]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    if (viewerRef.current) {
      viewerRef.current.scrollTop = viewerRef.current.scrollHeight;
    }
  }, [logs]);

  const displayedLogs = React.useMemo(() => {
    if (!searchQuery || !logs) {
      setMatchCount(0);
      return logs;
    }
    const lines = logs.split('\n');
    const matches = lines.filter((l) => l.toLowerCase().includes(searchQuery.toLowerCase()));
    setMatchCount(matches.length);
    return matches.join('\n') || '(no matches)';
  }, [logs, searchQuery]);

  const handleDownload = () => {
    if (!logs) return;
    const blob = new Blob([logs], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${namespace}_${podName}_logs.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        {containers.length > 1 && (
          <select
            className="form-input !mb-0 min-w-[140px]"
            value={container}
            onChange={(e) => setContainer(e.target.value)}
          >
            <option value="">All containers</option>
            {containers.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}

        <select
          className="form-input !mb-0 w-[120px]"
          value={tailLines}
          onChange={(e) => setTailLines(Number(e.target.value))}
        >
          <option value={100}>100 lines</option>
          <option value={300}>300 lines</option>
          <option value={1000}>1000 lines</option>
          <option value={5000}>5000 lines</option>
        </select>

        <Button size="sm" onClick={loadLogs} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </Button>

        <input
          type="text"
          className="form-input !mb-0 flex-1 min-w-[120px]"
          placeholder="Search in logs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        <Button size="sm" variant="outline" onClick={handleDownload}>Download</Button>
      </div>

      {/* Log output */}
      <pre
        ref={viewerRef}
        className="bg-bg border border-border rounded-lg p-3 text-xs font-mono text-text-dim overflow-auto max-h-[400px] whitespace-pre-wrap break-all"
      >
        {displayedLogs}
      </pre>

      {searchQuery && (
        <div className="text-[11px] text-text-dim mt-1">
          {matchCount} matching line{matchCount !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
