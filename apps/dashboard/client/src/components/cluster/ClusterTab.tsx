import React, { useState, useCallback, useEffect } from 'react';
import { Tabs } from '../ui/Tabs';
import { NodesPanel } from './NodesPanel';
import { PodsPanel } from './PodsPanel';
import { EventsPanel } from './EventsPanel';
import { NamespacesPanel } from './NamespacesPanel';
import { ResourceTopPanel } from './ResourceTopPanel';
import { DeploymentsPanel } from './DeploymentsPanel';

const CLUSTER_TABS = [
  { id: 'nodes', label: 'Nodes' },
  { id: 'pods', label: 'Pods' },
  { id: 'events', label: 'Events' },
  { id: 'namespaces', label: 'Namespaces' },
  { id: 'resources', label: 'Resource Top' },
  { id: 'deployments', label: 'Deployments' },
];

interface ClusterTabProps {
  active: boolean;
}

export function ClusterTab({ active }: ClusterTabProps) {
  const [subTab, setSubTab] = useState('nodes');
  const [refreshKey, setRefreshKey] = useState(0);

  const triggerRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // Auto-refresh every 30s when the cluster tab is active
  useEffect(() => {
    if (!active) return;
    const id = setInterval(triggerRefresh, 30000);
    return () => clearInterval(id);
  }, [active, triggerRefresh]);

  return (
    <div>
      <Tabs tabs={CLUSTER_TABS} active={subTab} onChange={setSubTab} />

      {subTab === 'nodes' && <NodesPanel active={active} refreshKey={refreshKey} />}
      {subTab === 'pods' && <PodsPanel active={active} refreshKey={refreshKey} />}
      {subTab === 'events' && <EventsPanel active={active} refreshKey={refreshKey} />}
      {subTab === 'namespaces' && <NamespacesPanel active={active} refreshKey={refreshKey} />}
      {subTab === 'resources' && <ResourceTopPanel active={active} refreshKey={refreshKey} />}
      {subTab === 'deployments' && <DeploymentsPanel active={active} refreshKey={refreshKey} />}
    </div>
  );
}
