import React, { useState, useEffect, useCallback } from 'react';
import { Spinner } from '../ui/Spinner';
import { EmptyState } from '../ui/EmptyState';
import { Badge } from '../ui/Badge';
import { UsageBar } from '../ui/UsageBar';
import { StatusDot } from '../ui/StatusDot';
import { fetchNodes, fetchPods, fetchEvents } from '../../api/cluster';
import type { ClusterNodeDetail, ClusterPod, ClusterEvent } from '../../types/api';

const POLL_INTERVAL = 5000;

interface NodesPanelProps {
  active: boolean;
  refreshKey: number;
}

interface NodeDetailData {
  podCount: number;
  pods: ClusterPod[];
  events: ClusterEvent[];
}

export function NodesPanel({ active, refreshKey }: NodesPanelProps) {
  const [nodes, setNodes] = useState<ClusterNodeDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const [nodeDetail, setNodeDetail] = useState<NodeDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadNodes = useCallback(async () => {
    if (!active) return;
    try {
      const data = await fetchNodes();
      setNodes(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load nodes');
    } finally {
      setLoading(false);
    }
  }, [active]);

  // Initial load + polling at 5s
  useEffect(() => {
    if (!active) return;
    setLoading(true);
    loadNodes();
    const timer = setInterval(loadNodes, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [active, loadNodes]);

  // Also refresh when parent triggers
  useEffect(() => {
    if (refreshKey > 0) loadNodes();
  }, [refreshKey, loadNodes]);

  // Load detail data when a node is expanded
  useEffect(() => {
    if (!expandedNode) {
      setNodeDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    Promise.all([
      fetchPods(),
      fetchEvents(),
    ])
      .then(([allPods, allEvents]) => {
        if (cancelled) return;
        const nodePods = allPods.filter((p) => p.node === expandedNode);
        const nodeEvents = allEvents.filter(
          (e) => e.object?.includes(expandedNode) || e.message?.includes(expandedNode)
        );
        setNodeDetail({
          podCount: nodePods.length,
          pods: nodePods,
          events: nodeEvents.slice(0, 20),
        });
      })
      .catch(() => {
        if (!cancelled) setNodeDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => { cancelled = true; };
  }, [expandedNode]);

  const toggleNode = (nodeName: string) => {
    setExpandedNode((prev) => (prev === nodeName ? null : nodeName));
  };

  if (loading && nodes.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red text-sm py-8 text-center">
        Failed to load nodes: {error}
      </div>
    );
  }

  if (nodes.length === 0) {
    return <EmptyState title="No nodes found" description="No cluster nodes available." />;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {nodes.map((node) => {
        const isExpanded = expandedNode === node.name;
        const statusColor = node.status === 'Ready' ? 'green' : 'red';
        const cpuPct = node.cpu?.pct ?? 0;
        const memPct = node.memory?.pct ?? 0;

        return (
          <div key={node.name} className={`${isExpanded ? 'col-span-full' : ''}`}>
            <div
              className={`card-base p-4 cursor-pointer transition-all hover:border-border-hover ${isExpanded ? 'border-accent' : ''}`}
              onClick={() => toggleNode(node.name)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') toggleNode(node.name); }}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <StatusDot color={statusColor as 'green' | 'red'} />
                  <h4 className="text-sm font-semibold text-text-primary">{node.name}</h4>
                  {node.roles.map((role) => (
                    <span
                      key={role}
                      className={`text-xs font-medium px-2 py-0.5 rounded ${
                        role === 'control-plane' || role === 'etcd'
                          ? 'bg-accent/15 text-accent'
                          : 'bg-green/15 text-green'
                      }`}
                    >
                      {role}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {node.unschedulable && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded bg-red/15 text-red">
                      CORDONED
                    </span>
                  )}
                  <span className="text-xs text-text-dim">
                    {isExpanded ? 'Click to collapse' : 'Click for details'}
                  </span>
                </div>
              </div>

              {/* Meta */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-dim mb-3">
                {node.kubelet && <span>{node.kubelet}</span>}
                {node.os && <span>{node.os}</span>}
                {node.runtime && <span>{node.runtime}</span>}
                {node.ip && <span className="font-mono">{node.ip}</span>}
                {node.age && <span>Age: {node.age}</span>}
              </div>

              {/* Usage Bars */}
              <UsageBar label="CPU" used={cpuPct} total={100} unit="%" />
              <div className="text-xs text-text-dim -mt-2 mb-2">
                {node.cpu?.usedFmt ?? '0'} / {node.cpu?.allocFmt ?? '?'}
              </div>
              <UsageBar label="Memory" used={memPct} total={100} unit="%" />
              <div className="text-xs text-text-dim -mt-2 mb-2">
                {node.memory?.usedFmt ?? '0'} / {node.memory?.allocFmt ?? '?'}
              </div>

              {/* Conditions */}
              <div className="flex flex-wrap gap-1 mt-2">
                {node.conditions.map((c) => {
                  const ok =
                    (c.type === 'Ready' && c.status === 'True') ||
                    (c.type !== 'Ready' && c.status === 'False');
                  return (
                    <Badge key={c.type} variant={ok ? 'green' : 'yellow'}>
                      {c.type}
                    </Badge>
                  );
                })}
              </div>
            </div>

            {/* Expanded Detail Panel */}
            {isExpanded && (
              <div className="mt-2 card-base p-4 animate-[slideDown_0.2s_ease]">
                {detailLoading ? (
                  <div className="flex justify-center py-8"><Spinner /></div>
                ) : nodeDetail ? (
                  <div className="space-y-4">
                    {/* Summary row */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <span className="text-xs uppercase text-text-dim tracking-[1px]">Pods on Node</span>
                        <div className="text-base font-semibold text-text-primary">{nodeDetail.podCount}</div>
                      </div>
                      <div>
                        <span className="text-xs uppercase text-text-dim tracking-[1px]">Pod Capacity</span>
                        <div className="text-base font-semibold text-text-primary">{node.pods?.allocatable ?? '-'}</div>
                      </div>
                      <div>
                        <span className="text-xs uppercase text-text-dim tracking-[1px]">CPU Usage</span>
                        <div className="text-base font-semibold text-text-primary">{cpuPct}%</div>
                      </div>
                      <div>
                        <span className="text-xs uppercase text-text-dim tracking-[1px]">Memory Usage</span>
                        <div className="text-base font-semibold text-text-primary">{memPct}%</div>
                      </div>
                    </div>

                    {/* All Conditions */}
                    <div>
                      <h4 className="text-xs font-semibold text-text-primary mb-2">All Conditions</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border text-left">
                              <th className="py-2 px-3 text-text-dim font-medium text-xs">Type</th>
                              <th className="py-2 px-3 text-text-dim font-medium text-xs">Status</th>
                              <th className="py-2 px-3 text-text-dim font-medium text-xs">Message</th>
                            </tr>
                          </thead>
                          <tbody>
                            {node.conditions.map((c) => {
                              const ok =
                                (c.type === 'Ready' && c.status === 'True') ||
                                (c.type !== 'Ready' && c.status === 'False');
                              return (
                                <tr key={c.type} className="border-b border-border">
                                  <td className="py-2 px-3 font-medium text-text-primary">{c.type}</td>
                                  <td className="py-2 px-3">
                                    <Badge variant={ok ? 'green' : 'yellow'}>{c.status}</Badge>
                                  </td>
                                  <td className="py-2 px-3 text-text-dim text-xs">{c.message || '-'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Pods on this node */}
                    <div>
                      <h4 className="text-xs font-semibold text-text-primary mb-2">Pods ({nodeDetail.podCount})</h4>
                      {nodeDetail.pods.length === 0 ? (
                        <div className="text-text-dim text-xs">No pods on this node</div>
                      ) : (
                        <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-card">
                              <tr className="border-b border-border text-left">
                                <th className="py-2 px-3 text-text-dim font-medium text-xs">Status</th>
                                <th className="py-2 px-3 text-text-dim font-medium text-xs">Name</th>
                                <th className="py-2 px-3 text-text-dim font-medium text-xs">Namespace</th>
                                <th className="py-2 px-3 text-text-dim font-medium text-xs">Ready</th>
                                <th className="py-2 px-3 text-text-dim font-medium text-xs">Restarts</th>
                              </tr>
                            </thead>
                            <tbody>
                              {nodeDetail.pods.map((p) => (
                                <tr key={p.namespace + '/' + p.name} className="border-b border-border">
                                  <td className="py-2 px-3">
                                    <StatusDot color={p.status === 'Running' ? 'green' : p.status === 'Pending' ? 'yellow' : 'red'} />
                                  </td>
                                  <td className="py-2 px-3 text-text-primary text-xs font-mono">{p.name}</td>
                                  <td className="py-2 px-3 text-text-dim text-xs">{p.namespace}</td>
                                  <td className="py-2 px-3 text-text-dim text-xs">{p.ready}</td>
                                  <td className="py-2 px-3">
                                    {p.restarts > 0 ? (
                                      <span className="text-yellow text-xs font-medium">{p.restarts}</span>
                                    ) : (
                                      <span className="text-text-dim text-xs">0</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Recent Events */}
                    <div>
                      <h4 className="text-xs font-semibold text-text-primary mb-2">Recent Node Events</h4>
                      {nodeDetail.events.length === 0 ? (
                        <div className="text-text-dim text-xs">No recent events for this node</div>
                      ) : (
                        <div className="space-y-1 max-h-[200px] overflow-y-auto">
                          {nodeDetail.events.map((e, i) => (
                            <div key={i} className="flex items-start gap-2 py-1.5">
                              <Badge variant={e.type === 'Warning' ? 'yellow' : 'green'}>
                                {e.type}
                              </Badge>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs text-text-primary">{e.message}</div>
                                <div className="text-xs text-text-dim">
                                  {e.reason} &middot; {e.age}
                                  {e.count > 1 && <span> &middot; x{e.count}</span>}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-text-dim text-sm">Failed to load node details</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
