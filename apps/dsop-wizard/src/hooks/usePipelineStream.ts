import { useEffect, useRef, useState, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

export interface StreamFinding {
  severity: string;
  title: string;
  location: string;
}

export interface GateStreamState {
  status: string;
  summary: string;
  progress: number;
  logs: string[];
  findings: StreamFinding[];
}

export interface PipelineStreamState {
  connected: boolean;
  done: boolean;
  pipelineStatus: string | null;
  gates: Map<string, GateStreamState>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * usePipelineStream — subscribes to the SSE stream for a pipeline run and
 * returns live gate statuses, log lines, and findings.
 *
 * The existing polling mechanism is left untouched; this is purely additive.
 */
export function usePipelineStream(runId: string | null | undefined): PipelineStreamState {
  const [state, setState] = useState<PipelineStreamState>({
    connected: false,
    done: false,
    pipelineStatus: null,
    gates: new Map(),
  });

  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 5;

  const updateGate = useCallback((gateName: string, updates: Partial<GateStreamState>) => {
    setState((prev) => {
      const next = new Map(prev.gates);
      const existing = next.get(gateName) ?? {
        status: 'pending',
        summary: '',
        progress: 0,
        logs: [],
        findings: [],
      };
      next.set(gateName, { ...existing, ...updates });
      return { ...prev, gates: next };
    });
  }, []);

  const appendLog = useCallback((gateName: string, line: string) => {
    setState((prev) => {
      const next = new Map(prev.gates);
      const existing = next.get(gateName) ?? {
        status: 'pending',
        summary: '',
        progress: 0,
        logs: [],
        findings: [],
      };
      // Keep last 200 log lines to avoid unbounded memory growth
      const logs = [...existing.logs, line].slice(-200);
      next.set(gateName, { ...existing, logs });
      return { ...prev, gates: next };
    });
  }, []);

  const appendFinding = useCallback((gateName: string, finding: StreamFinding) => {
    setState((prev) => {
      const next = new Map(prev.gates);
      const existing = next.get(gateName) ?? {
        status: 'pending',
        summary: '',
        progress: 0,
        logs: [],
        findings: [],
      };
      next.set(gateName, { ...existing, findings: [...existing.findings, finding] });
      return { ...prev, gates: next };
    });
  }, []);

  useEffect(() => {
    if (!runId) return;

    let cancelled = false;

    function connect() {
      if (cancelled) return;

      const url = `/api/pipeline/runs/${encodeURIComponent(runId!)}/stream`;
      const es = new EventSource(url, { withCredentials: true });
      esRef.current = es;

      es.onopen = () => {
        if (cancelled) { es.close(); return; }
        reconnectAttemptsRef.current = 0;
        setState((prev) => ({ ...prev, connected: true }));
      };

      es.onerror = () => {
        if (cancelled) return;
        setState((prev) => ({ ...prev, connected: false }));
        es.close();
        esRef.current = null;
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current += 1;
          const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 30000);
          reconnectTimerRef.current = setTimeout(connect, delay);
        }
      };

      // Handle named SSE events
      const handleEvent = (eventType: string) => (e: MessageEvent) => {
        if (cancelled) return;
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(e.data);
        } catch {
          return;
        }

        if (eventType === 'gate_status') {
          const gate = data.gate as string;
          if (gate) {
            updateGate(gate, {
              status: (data.status as string) ?? 'pending',
              summary: (data.summary as string) ?? '',
              progress: (data.progress as number) ?? 0,
            });
          }
        } else if (eventType === 'gate_log') {
          const gate = data.gate as string;
          const line = data.line as string;
          if (gate && line) appendLog(gate, line);
        } else if (eventType === 'gate_finding') {
          const gate = data.gate as string;
          if (gate) {
            appendFinding(gate, {
              severity: (data.severity as string) ?? 'info',
              title: (data.title as string) ?? '',
              location: (data.location as string) ?? '',
            });
          }
        } else if (eventType === 'gate_progress') {
          const gate = data.gate as string;
          if (gate) {
            updateGate(gate, {
              progress: (data.progress as number) ?? 0,
              summary: (data.summary as string) ?? '',
            });
          }
        } else if (eventType === 'pipeline_status') {
          setState((prev) => ({
            ...prev,
            pipelineStatus: (data.status as string) ?? null,
          }));
        } else if (eventType === 'done') {
          setState((prev) => ({ ...prev, done: true, connected: false }));
          es.close();
          esRef.current = null;
        }
      };

      es.addEventListener('gate_status', handleEvent('gate_status'));
      es.addEventListener('gate_log', handleEvent('gate_log'));
      es.addEventListener('gate_finding', handleEvent('gate_finding'));
      es.addEventListener('gate_progress', handleEvent('gate_progress'));
      es.addEventListener('pipeline_status', handleEvent('pipeline_status'));
      es.addEventListener('done', handleEvent('done'));
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [runId, updateGate, appendLog, appendFinding]);

  return state;
}
