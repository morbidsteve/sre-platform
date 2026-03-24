import React, { useState, useEffect } from 'react';
import { Spinner } from '../ui/Spinner';
import { EmptyState } from '../ui/EmptyState';
import { NodeCard } from './NodeCard';
import { fetchNodes } from '../../api/cluster';
import type { ClusterNodeDetail } from '../../types/api';

interface NodesPanelProps {
  active: boolean;
  refreshKey: number;
}

export function NodesPanel({ active, refreshKey }: NodesPanelProps) {
  const [nodes, setNodes] = useState<ClusterNodeDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    fetchNodes()
      .then((data) => {
        if (!cancelled) {
          setNodes(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [active, refreshKey]);

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
      {nodes.map((node) => (
        <NodeCard key={node.name} node={node} />
      ))}
    </div>
  );
}
