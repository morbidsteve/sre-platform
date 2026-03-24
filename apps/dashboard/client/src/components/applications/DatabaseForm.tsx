import React, { useEffect, useState } from 'react';
import { Database, RefreshCw } from 'lucide-react';

interface DatabaseInfo {
  name: string;
  namespace: string;
  instances: number;
  status: string;
  storage: string;
}

interface DatabaseFormProps {
  onCreateDatabase: (payload: {
    name: string;
    team: string;
    storage: string;
    instances: number;
  }) => Promise<void>;
}

const STORAGE_OPTIONS = [
  { value: '1Gi', label: '1 Gi (dev)' },
  { value: '5Gi', label: '5 Gi (small)' },
  { value: '10Gi', label: '10 Gi (medium)' },
  { value: '20Gi', label: '20 Gi (large)' },
  { value: '50Gi', label: '50 Gi (xlarge)' },
];

const INSTANCE_OPTIONS = [
  { value: 1, label: '1 (standalone)' },
  { value: 2, label: '2 (HA, 1 replica)' },
  { value: 3, label: '3 (HA, 2 replicas)' },
];

export function DatabaseForm({ onCreateDatabase }: DatabaseFormProps) {
  const [dbName, setDbName] = useState('');
  const [team, setTeam] = useState('');
  const [storage, setStorage] = useState('10Gi');
  const [instances, setInstances] = useState(1);
  const [creating, setCreating] = useState(false);
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [loadingDbs, setLoadingDbs] = useState(false);

  const loadDatabases = async () => {
    setLoadingDbs(true);
    try {
      const resp = await fetch('/api/databases');
      const data = await resp.json();
      setDatabases(data.databases || []);
    } catch {
      setDatabases([]);
    } finally {
      setLoadingDbs(false);
    }
  };

  useEffect(() => {
    loadDatabases();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dbName || !team) return;
    setCreating(true);
    try {
      await onCreateDatabase({ name: dbName, team, storage, instances });
      setDbName('');
      // Reload databases list
      setTimeout(loadDatabases, 2000);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-[var(--radius)] p-5">
      <h2 className="text-base font-semibold text-text-bright mb-1">Create PostgreSQL Database</h2>
      <p className="text-text-dim text-[13px] mb-4">
        Provision a managed PostgreSQL database via CloudNativePG. Connection secret is auto-created.
      </p>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-text-dim mb-1">
              Database Name
            </label>
            <input
              type="text"
              value={dbName}
              onChange={(e) => setDbName(e.target.value)}
              placeholder="my-database"
              required
              pattern="[a-z0-9\-]+"
              className="w-full px-3 py-2 bg-surface border border-border rounded-[var(--radius)] text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-text-dim mb-1">
              Team Name
            </label>
            <input
              type="text"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              placeholder="my-team"
              required
              pattern="[a-z0-9\-]+"
              className="w-full px-3 py-2 bg-surface border border-border rounded-[var(--radius)] text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-text-dim mb-1">
              Storage Size
            </label>
            <select
              value={storage}
              onChange={(e) => setStorage(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-[var(--radius)] text-sm text-text-primary focus:outline-none focus:border-accent"
            >
              {STORAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-text-dim mb-1">
              Instances
            </label>
            <select
              value={instances}
              onChange={(e) => setInstances(parseInt(e.target.value))}
              className="w-full px-3 py-2 bg-surface border border-border rounded-[var(--radius)] text-sm text-text-primary focus:outline-none focus:border-accent"
            >
              {INSTANCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={creating}
        >
          {creating ? 'Creating...' : 'Create Database'}
        </button>
      </form>

      {/* Existing Databases */}
      <div className="mt-6 border-t border-border pt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-bright">Existing Databases</h3>
          <button
            className="flex items-center gap-1 text-xs text-text-dim hover:text-accent font-mono"
            onClick={loadDatabases}
          >
            <RefreshCw className={`w-3 h-3 ${loadingDbs ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
        {loadingDbs ? (
          <div className="flex justify-center py-4">
            <span className="inline-block w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : databases.length === 0 ? (
          <p className="text-sm text-text-dim">No databases found.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {databases.map((db) => (
              <div key={`${db.namespace}/${db.name}`} className="bg-bg border border-border rounded-[var(--radius)] p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Database className="w-4 h-4 text-accent" />
                  <span className="text-sm font-semibold text-text-bright">{db.name}</span>
                </div>
                <div className="text-xs text-text-dim space-y-0.5">
                  <div>Namespace: {db.namespace}</div>
                  <div>Instances: {db.instances}</div>
                  <div>Storage: {db.storage}</div>
                  <div>
                    Status:{' '}
                    <span className={db.status === 'Cluster in healthy state' ? 'text-green' : 'text-yellow'}>
                      {db.status}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
