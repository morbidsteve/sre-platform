import { useState, useCallback } from 'react';
import {
  fetchNodes,
  fetchPods,
  fetchPodDetail,
  fetchPodLogs,
  fetchEvents,
  fetchNamespaces,
  fetchTopPods,
  fetchDeployments,
} from '../api/cluster';
import type {
  ClusterNodeDetail,
  ClusterPod,
  PodDetail,
  ClusterEvent,
  Namespace,
  TopPod,
  Deployment,
} from '../types/api';

export function useCluster() {
  const [nodes, setNodes] = useState<ClusterNodeDetail[]>([]);
  const [pods, setPods] = useState<ClusterPod[]>([]);
  const [podDetail, setPodDetail] = useState<PodDetail | null>(null);
  const [podLogs, setPodLogs] = useState('');
  const [events, setEvents] = useState<ClusterEvent[]>([]);
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [topPods, setTopPods] = useState<TopPod[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(false);

  const loadNodes = useCallback(async () => {
    setLoading(true);
    try {
      setNodes(await fetchNodes());
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPods = useCallback(async (namespace?: string, search?: string, status?: string) => {
    setLoading(true);
    try {
      setPods(await fetchPods(namespace, search, status));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPodDetail = useCallback(async (ns: string, name: string) => {
    setLoading(true);
    try {
      setPodDetail(await fetchPodDetail(ns, name));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPodLogs = useCallback(async (ns: string, name: string, container?: string, tail?: number, previous?: boolean) => {
    setLoading(true);
    try {
      setPodLogs(await fetchPodLogs(ns, name, container, tail, previous));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEvents = useCallback(async (namespace?: string, type?: string) => {
    setLoading(true);
    try {
      setEvents(await fetchEvents(namespace, type));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadNamespaces = useCallback(async () => {
    setLoading(true);
    try {
      setNamespaces(await fetchNamespaces());
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTopPods = useCallback(async (sortBy?: string, limit?: number) => {
    setLoading(true);
    try {
      setTopPods(await fetchTopPods(sortBy, limit));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDeployments = useCallback(async (namespace?: string) => {
    setLoading(true);
    try {
      setDeployments(await fetchDeployments(namespace));
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    nodes,
    pods,
    podDetail,
    podLogs,
    events,
    namespaces,
    topPods,
    deployments,
    loading,
    loadNodes,
    loadPods,
    loadPodDetail,
    loadPodLogs,
    loadEvents,
    loadNamespaces,
    loadTopPods,
    loadDeployments,
    setPodDetail,
    setPodLogs,
  };
}
