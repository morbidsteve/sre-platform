import React, { useEffect, useRef } from 'react';

interface BuildLogViewerProps {
  logs: string[];
  maxHeight?: string;
}

export function BuildLogViewer({ logs, maxHeight = '300px' }: BuildLogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  const classifyLine = (line: string): string => {
    const lower = line.toLowerCase();
    if (lower.includes('error') || lower.includes('failed') || lower.includes('fatal')) {
      return 'text-red';
    }
    if (lower.startsWith('step') || lower.startsWith('phase') || lower.startsWith('===') || lower.startsWith('---')) {
      return 'text-accent';
    }
    if (lower.startsWith('status:') || lower.includes('waiting') || lower.includes('pulling')) {
      return 'text-text-dim italic';
    }
    return 'text-text-primary';
  };

  if (logs.length === 0) {
    return (
      <div
        className="bg-bg border border-border rounded-[var(--radius)] p-4 font-mono text-xs text-text-dim"
        style={{ maxHeight }}
      >
        Waiting for build output...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="bg-bg border border-border rounded-[var(--radius)] p-3 font-mono text-xs overflow-y-auto"
      style={{ maxHeight }}
    >
      {logs.map((line, i) => (
        <div key={i} className={`py-0.5 whitespace-pre-wrap break-all ${classifyLine(line)}`}>
          {line}
        </div>
      ))}
    </div>
  );
}
