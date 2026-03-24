import React, { useState } from 'react';
import { FileText, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

interface ProblemPod {
  name: string;
  namespace: string;
  phase: string;
  reason: string;
  message: string;
  restarts: number;
  age: string;
  ownerKind?: string;
  ownerName?: string;
}

interface ProblemPodsPanelProps {
  pods: ProblemPod[];
  visible: boolean;
  isAdmin: boolean;
  onViewLogs: (namespace: string, podName: string) => void;
  onDeletePod: (namespace: string, podName: string) => void;
}

export function ProblemPodsPanel({ pods, visible, isAdmin, onViewLogs, onDeletePod }: ProblemPodsPanelProps) {
  const [expandedPod, setExpandedPod] = useState<string | null>(null);

  if (!visible || !pods || pods.length === 0) {
    return null;
  }

  const toggleExpand = (podKey: string) => {
    setExpandedPod(expandedPod === podKey ? null : podKey);
  };

  const getStatusDot = (pod: ProblemPod): string => {
    if (pod.reason === 'ImagePullBackOff' || pod.reason === 'ErrImagePull') return 'bg-red';
    if (pod.reason === 'CrashLoopBackOff') return 'bg-red';
    if (pod.phase === 'Pending') return 'bg-yellow';
    return 'bg-red';
  };

  const getReasonBadgeColor = (pod: ProblemPod): string => {
    const dot = getStatusDot(pod);
    return dot === 'bg-red'
      ? 'bg-[rgba(250,82,82,0.15)] text-red'
      : 'bg-[rgba(250,176,5,0.15)] text-yellow';
  };

  return (
    <div className="bg-card border border-border rounded-[var(--radius)] overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-bright">Problem Pods</h2>
        <span className="text-[13px] text-text-dim">
          {pods.length} pod{pods.length !== 1 ? 's' : ''} need attention
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-2 text-left text-xs font-mono uppercase tracking-wider text-text-dim">Status</th>
              <th className="px-4 py-2 text-left text-xs font-mono uppercase tracking-wider text-text-dim">Pod</th>
              <th className="px-4 py-2 text-left text-xs font-mono uppercase tracking-wider text-text-dim">Namespace</th>
              <th className="px-4 py-2 text-left text-xs font-mono uppercase tracking-wider text-text-dim">Reason</th>
              <th className="px-4 py-2 text-left text-xs font-mono uppercase tracking-wider text-text-dim">Restarts</th>
              <th className="px-4 py-2 text-left text-xs font-mono uppercase tracking-wider text-text-dim">Age</th>
              <th className="px-4 py-2 text-left text-xs font-mono uppercase tracking-wider text-text-dim">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pods.map((pod) => {
              const podKey = `${pod.namespace}/${pod.name}`;
              const isExpanded = expandedPod === podKey;

              return (
                <React.Fragment key={podKey}>
                  <tr
                    className="border-b border-border cursor-pointer hover:bg-surface-hover transition-colors"
                    onClick={() => toggleExpand(podKey)}
                  >
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${getStatusDot(pod)}`} />
                        {pod.phase}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div>
                        <strong className="text-[13px] text-text-bright">{pod.name}</strong>
                        {pod.ownerKind && (
                          <div className="text-[11px] text-text-dim">
                            {pod.ownerKind}: {pod.ownerName}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-text-dim">{pod.namespace}</td>
                    <td className="px-4 py-2">
                      {pod.reason ? (
                        <div>
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-mono ${getReasonBadgeColor(pod)}`}>
                            {pod.reason}
                          </span>
                          {pod.message && (
                            <div
                              className="text-[11px] text-text-dim max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap mt-0.5"
                              title={pod.message}
                            >
                              {pod.message}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-text-dim">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {pod.restarts > 0 ? (
                        <span className="text-yellow font-medium">{pod.restarts}</span>
                      ) : (
                        '0'
                      )}
                    </td>
                    <td className="px-4 py-2 text-text-dim">{pod.age}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <button
                          className="btn text-[11px] !px-2 !py-1 !min-h-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            onViewLogs(pod.namespace, pod.name);
                          }}
                          title="View Logs"
                        >
                          <FileText className="w-3 h-3" />
                        </button>
                        {isAdmin && (
                          <button
                            className="btn text-[11px] !px-2 !py-1 !min-h-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeletePod(pod.namespace, pod.name);
                            }}
                            title="Delete Pod"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                        {isExpanded ? (
                          <ChevronUp className="w-3 h-3 text-text-dim ml-1" />
                        ) : (
                          <ChevronDown className="w-3 h-3 text-text-dim ml-1" />
                        )}
                      </div>
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
