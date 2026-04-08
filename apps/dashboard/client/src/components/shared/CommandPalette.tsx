import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search } from 'lucide-react';
import { useUserContext } from '../../context/UserContext';
import { useThemeContext } from '../../context/ThemeContext';
import { useConfig, serviceUrl } from '../../context/ConfigContext';
import { fetchApps } from '../../api/apps';
import { fetchServiceStatus } from '../../api/health';
import { fetchPipelineRuns } from '../../api/pipeline';
import { fetchPods } from '../../api/cluster';
import { fetchUsers, fetchGroups, fetchTenants } from '../../api/admin';
import type { App, PipelineRun, ServiceStatus, AdminUser, AdminGroup, Tenant } from '../../types/api';

interface CommandItem {
  category: string;
  label: string;
  description?: string;
  icon: string;
  badge?: string;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onTabChange: (tab: string) => void;
  onOpenApp?: (url: string, title: string) => void;
}

function fuzzyMatch(text: string, query: string): boolean {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function CommandPalette({ open, onClose, onTabChange, onOpenApp }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [liveResults, setLiveResults] = useState<CommandItem[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isAdmin, isDeveloper, isIssm, user } = useUserContext();
  const { toggleTheme, theme } = useThemeContext();
  const config = useConfig();

  // Prefix shortcuts for live data queries
  const PREFIX_HELP: Record<string, string> = {
    '#': 'Search deployed applications',
    '@': 'Search platform services',
    '/': 'Search pods',
    '>': 'Search pipeline runs',
    '!': 'Run an action (restart, repull, scale...)',
    '$': 'Search tenants / namespaces',
    ':': 'Search users & groups',
    '?': 'Run health checks',
  };

  const activePrefix = query.length > 0 && Object.keys(PREFIX_HELP).includes(query[0]) ? query[0] : null;
  const searchTerm = activePrefix ? query.slice(1).trim() : query;

  // Live data fetcher
  useEffect(() => {
    if (!open || !activePrefix) {
      setLiveResults([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLiveLoading(true);

    debounceRef.current = setTimeout(async () => {
      try {
        let items: CommandItem[] = [];

        if (activePrefix === '#') {
          // Deployed applications
          const resp = await fetchApps();
          const apps = resp.apps || [];
          items = apps
            .filter((a: App) => !searchTerm || fuzzyMatch(`${a.name} ${a.namespace} ${a.team} ${a.image}`, searchTerm))
            .slice(0, 20)
            .map((a: App) => ({
              category: 'Applications',
              label: a.name,
              description: `${a.namespace} \u00b7 ${a.image}:${a.tag}`,
              icon: a.ready ? '\u{1f7e2}' : '\u{1f534}',
              badge: a.team,
              action: () => { onTabChange('applications'); onClose(); },
            }));
        } else if (activePrefix === '@') {
          // Platform services
          try {
            const services = await fetchServiceStatus();
            items = (services || [])
              .filter((s: ServiceStatus) => !searchTerm || fuzzyMatch(`${s.name} ${s.namespace}`, searchTerm))
              .slice(0, 15)
              .map((s: ServiceStatus) => ({
                category: 'Services',
                label: s.name,
                description: s.url || s.namespace || '',
                icon: s.healthy ? '\u{1f7e2}' : '\u{1f534}',
                badge: s.healthy ? 'healthy' : 'unhealthy',
                action: () => {
                  if (s.url) { window.open(s.url, '_blank'); onClose(); }
                  else { onTabChange('operations'); onClose(); }
                },
              }));
          } catch {
            items = [];
          }
        } else if (activePrefix === '/') {
          // Pods
          const pods = await fetchPods(undefined, searchTerm || undefined);
          items = (pods || [])
            .slice(0, 20)
            .map((p) => ({
              category: 'Pods',
              label: p.name,
              description: `${p.namespace} \u00b7 ${p.status}${p.restarts > 0 ? ` \u00b7 ${p.restarts} restarts` : ''}`,
              icon: p.status === 'Running' ? '\u{1f7e2}' : p.status === 'Pending' ? '\u{1f7e1}' : '\u{1f534}',
              badge: p.node,
              action: () => { onTabChange('operations'); onClose(); },
            }));
        } else if (activePrefix === '>') {
          // Pipeline runs
          const resp = await fetchPipelineRuns({ search: searchTerm || undefined, limit: 15 });
          items = (resp.runs || []).map((r: PipelineRun) => ({
            category: 'Pipeline Runs',
            label: r.app_name,
            description: `${r.status} \u00b7 ${r.team} \u00b7 ${new Date(r.created_at).toLocaleDateString()}`,
            icon: r.status === 'deployed' ? '\u{1f7e2}' : r.status === 'failed' ? '\u{1f534}' : r.status === 'scanning' ? '\u{1f535}' : '\u{1f7e1}',
            badge: r.status,
            action: () => { onTabChange('security'); onClose(); },
          }));
        } else if (activePrefix === '$') {
          // Tenants
          try {
            const tenants = await fetchTenants();
            items = (tenants || [])
              .filter((t: Tenant) => !searchTerm || fuzzyMatch(`${t.name} ${t.team} ${t.status}`, searchTerm))
              .slice(0, 20)
              .map((t: Tenant) => ({
                category: 'Tenants',
                label: t.name,
                description: `Team: ${t.team || 'default'} \u00b7 ${t.status}`,
                icon: '\u{1f4e6}',
                badge: t.status,
                action: () => { onTabChange('admin'); onClose(); },
              }));
          } catch { items = []; }
        } else if (activePrefix === ':') {
          // Users & groups (admin only)
          if (isAdmin) {
            try {
              const [usersResp, groupsResp] = await Promise.all([fetchUsers(), fetchGroups()]);
              const userItems = (usersResp || [])
                .filter((u: AdminUser) => !searchTerm || fuzzyMatch(`${u.username} ${u.email} ${(u.groups || []).join(' ')}`, searchTerm))
                .slice(0, 10)
                .map((u: AdminUser) => ({
                  category: 'Users',
                  label: u.username,
                  description: u.email || '',
                  icon: '\u{1f464}',
                  badge: (u.groups || []).join(', ') || 'No groups',
                  action: () => { onTabChange('admin'); onClose(); },
                }));
              const groupItems = (groupsResp || [])
                .filter((g: AdminGroup) => !searchTerm || fuzzyMatch(g.name, searchTerm))
                .slice(0, 10)
                .map((g: AdminGroup) => ({
                  category: 'Groups',
                  label: g.name,
                  description: 'Group',
                  icon: '\u{1f465}',
                  action: () => { onTabChange('admin'); onClose(); },
                }));
              items = [...userItems, ...groupItems];
            } catch { items = []; }
          }
        } else if (activePrefix === '?') {
          // Health checks - return a single action item
          items = [{
            category: 'Health',
            label: 'Run Platform Health Checks',
            description: 'Check all 12 platform health indicators',
            icon: '\u{1f3e5}',
            action: () => { onTabChange('operations'); onClose(); },
          }];
        } else if (activePrefix === '!') {
          // Actions
          items = [
            { category: 'Actions', label: 'Restart Deployment', description: 'Restart all pods for a deployment', icon: '\u{1f504}', action: () => { onTabChange('operations'); onClose(); } },
            { category: 'Actions', label: 'Force Re-pull Image', description: 'Clear image cache and pull fresh from Harbor', icon: '\u{1f4e5}', action: () => { onTabChange('applications'); onClose(); } },
            { category: 'Actions', label: 'Scale Deployment', description: 'Change replica count', icon: '\u{1f4c8}', action: () => { onTabChange('operations'); onClose(); } },
            { category: 'Actions', label: 'Rotate Secrets', description: 'Rotate Harbor/Keycloak/Cosign credentials', icon: '\u{1f511}', action: () => { onTabChange('admin'); onClose(); } },
            { category: 'Actions', label: 'Run RBAC Audit', description: 'Audit cluster RBAC bindings', icon: '\u{1f50d}', action: () => { onTabChange('admin'); onClose(); } },
            { category: 'Actions', label: 'Generate Compliance Report', description: 'Run live NIST 800-53 compliance check', icon: '\u{1f4cb}', action: () => { onTabChange('compliance'); onClose(); } },
            { category: 'Actions', label: 'Create Tenant', description: 'Onboard a new team namespace', icon: '\u2795', action: () => { onTabChange('admin'); onClose(); } },
            { category: 'Actions', label: 'Cancel Pipeline Run', description: 'Stop a running pipeline', icon: '\u26d4', action: () => { onTabChange('security'); onClose(); } },
          ].filter(a => !searchTerm || fuzzyMatch(`${a.label} ${a.description}`, searchTerm));
        }

        setLiveResults(items);
      } catch {
        setLiveResults([]);
      } finally {
        setLiveLoading(false);
      }
    }, 200); // 200ms debounce

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [open, query, activePrefix, searchTerm, isAdmin, onTabChange, onClose, onOpenApp]);

  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    // ── Navigation ──────────────────────────────────────────
    items.push(
      { category: 'Navigation', label: 'Overview', icon: '🏠', description: 'Health summary, alerts, recent activity', shortcut: 'G O', action: () => onTabChange('overview') },
      { category: 'Navigation', label: 'Deploy', icon: '🚀', description: 'Deploy applications to the platform', shortcut: 'G D', action: () => onTabChange('deploy') },
      { category: 'Navigation', label: 'Applications', icon: '📦', description: 'View running applications', shortcut: 'G A', action: () => onTabChange('applications') },
      { category: 'Navigation', label: 'Security', icon: '🛡️', description: 'Pipeline runs, ISSM reviews, security posture', shortcut: 'G S', action: () => onTabChange('security') },
      { category: 'Navigation', label: 'Operations', icon: '📊', description: 'Platform services, cluster, nodes, pods', shortcut: 'G P', action: () => onTabChange('operations') },
      { category: 'Navigation', label: 'Compliance', icon: '📋', description: 'NIST 800-53 controls, audit trail, ATO', shortcut: 'G C', action: () => onTabChange('compliance') },
    );

    if (isAdmin) {
      items.push(
        { category: 'Navigation', label: 'Admin', icon: '⚙️', description: 'Manage users, groups, credentials', shortcut: 'G M', action: () => onTabChange('admin') },
      );
    }

    // ── Quick Deploy Actions ────────────────────────────────
    if (isAdmin || isDeveloper) {
      items.push(
        { category: 'Deploy', label: 'Open DSOP Wizard', icon: '🔐', description: 'Full security pipeline deployment', badge: 'Recommended', action: () => { window.open(serviceUrl(config, 'dsop'), '_blank'); onClose(); } },
        { category: 'Deploy', label: 'Quick Deploy', icon: '⚡', description: 'Deploy pre-built sample apps', action: () => onTabChange('deploy') },
        { category: 'Deploy', label: 'Deploy Helm Chart', icon: '📦', description: 'Deploy from Helm chart repository', action: () => onTabChange('deploy') },
        { category: 'Deploy', label: 'Create Database', icon: '🗄️', description: 'Provision PostgreSQL via CNPG', action: () => onTabChange('deploy') },
      );
    }

    // ── ISSM / Security Actions ─────────────────────────────
    if (isAdmin || isIssm) {
      items.push(
        { category: 'Security', label: 'Review Queue', icon: '📝', description: 'Pipeline runs awaiting ISSM review', badge: 'ISSM', action: () => onTabChange('security') },
        { category: 'Security', label: 'Approve/Reject Runs', icon: '✅', description: 'Review and approve pipeline deployments', badge: 'ISSM', action: () => onTabChange('security') },
      );
    }

    items.push(
      { category: 'Security', label: 'Security Posture', icon: '🛡️', description: 'View gate pass/fail rates, vulnerabilities', action: () => onTabChange('security') },
      { category: 'Security', label: 'Pipeline Runs', icon: '🔄', description: 'All pipeline execution history', action: () => onTabChange('security') },
    );

    // ── Operations Actions ──────────────────────────────────
    items.push(
      { category: 'Operations', label: 'View Nodes', icon: '🖥️', description: 'Cluster node health and resource usage', action: () => onTabChange('operations') },
      { category: 'Operations', label: 'View Pods', icon: '📦', description: 'All running pods across namespaces', action: () => onTabChange('operations') },
      { category: 'Operations', label: 'View Events', icon: '📣', description: 'Kubernetes cluster events', action: () => onTabChange('operations') },
      { category: 'Operations', label: 'Platform Services', icon: '🌐', description: 'Service health status and access', action: () => onTabChange('operations') },
    );

    if (isAdmin || isDeveloper) {
      items.push(
        { category: 'Operations', label: 'Scale Deployment', icon: '📈', description: 'Change replica count for a deployment', action: () => onTabChange('operations') },
        { category: 'Operations', label: 'Restart Deployment', icon: '🔄', description: 'Rolling restart a deployment', action: () => onTabChange('operations') },
      );
    }

    // ── Compliance Actions ──────────────────────────────────
    items.push(
      { category: 'Compliance', label: 'NIST 800-53 Controls', icon: '📋', description: 'View control family implementation status', action: () => onTabChange('compliance') },
      { category: 'Compliance', label: 'Audit Trail', icon: '📜', description: 'View all audit events and changes', action: () => onTabChange('compliance') },
      { category: 'Compliance', label: 'Evidence Collection', icon: '📁', description: 'ATO evidence sources and dashboards', action: () => onTabChange('compliance') },
    );

    // ── Admin Actions ───────────────────────────────────────
    if (isAdmin) {
      items.push(
        { category: 'Admin', label: 'Manage Users', icon: '👥', description: 'Create, edit, disable user accounts', action: () => onTabChange('admin') },
        { category: 'Admin', label: 'View Credentials', icon: '🔑', description: 'SSO and break-glass credentials', action: () => onTabChange('admin') },
        { category: 'Admin', label: 'Manage Groups', icon: '🏷️', description: 'Keycloak group management', action: () => onTabChange('admin') },
      );
    }

    // ── Platform Services ───────────────────────────────────
    const services = [
      { label: 'Grafana', icon: '📊', description: 'Metrics dashboards & log explorer', badge: 'Monitoring', url: serviceUrl(config, 'grafana') },
      { label: 'Prometheus', icon: '🔥', description: 'Metrics & alerting', badge: 'Monitoring', url: serviceUrl(config, 'prometheus') },
      { label: 'Harbor', icon: '🚢', description: 'Container registry & vulnerability scanning', badge: 'Registry', url: serviceUrl(config, 'harbor') },
      { label: 'Keycloak', icon: '🔐', description: 'Identity provider & SSO management', badge: 'Auth', url: serviceUrl(config, 'keycloak') },
      { label: 'NeuVector', icon: '🛡️', description: 'Runtime security & network monitoring', badge: 'Security', url: serviceUrl(config, 'neuvector') },
      { label: 'Loki', icon: '📝', description: 'Log aggregation & querying', badge: 'Logging', url: `${serviceUrl(config, 'grafana')}/explore` },
    ];

    for (const svc of services) {
      items.push({
        category: 'Platform Services',
        label: `Open ${svc.label}`,
        icon: svc.icon,
        description: svc.description,
        badge: svc.badge,
        action: () => { window.open(svc.url, '_blank'); onClose(); },
      });
    }

    // ── Preferences ─────────────────────────────────────────
    items.push(
      { category: 'Preferences', label: theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode', icon: theme === 'dark' ? '☀️' : '🌙', description: 'Toggle dark/light theme', shortcut: 'T', action: () => { toggleTheme(); } },
    );

    // ── Help ────────────────────────────────────────────────
    items.push(
      { category: 'Help', label: 'Keyboard Shortcuts', icon: '⌨️', description: 'Ctrl+K to open this palette, G+key for navigation', action: () => {} },
    );

    return items;
  }, [isAdmin, isDeveloper, isIssm, user, onTabChange, onOpenApp, toggleTheme, theme, config]);

  const filtered = useMemo(() => {
    if (activePrefix) {
      // When using a prefix, only show live results
      return liveResults;
    }
    if (!query.trim()) return commands;
    // Without prefix, search static commands
    const staticFiltered = commands.filter(cmd =>
      fuzzyMatch(cmd.label, query) || fuzzyMatch(cmd.description || '', query) ||
      fuzzyMatch(cmd.category, query) || fuzzyMatch(cmd.badge || '', query)
    );
    return staticFiltered;
  }, [query, commands, activePrefix, liveResults]);

  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const item of filtered) {
      const existing = map.get(item.category);
      if (existing) existing.push(item);
      else map.set(item.category, [item]);
    }
    return map;
  }, [filtered]);

  const flatItems = useMemo(() => {
    const items: CommandItem[] = [];
    grouped.forEach((group) => items.push(...group));
    return items;
  }, [grouped]);

  const executeItem = useCallback(
    (item: CommandItem) => {
      item.action();
      onClose();
      setQuery('');
      setSelectedIndex(0);
    },
    [onClose]
  );

  useEffect(() => { setSelectedIndex(0); }, [query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Keyboard nav when open
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, flatItems.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter') { e.preventDefault(); if (flatItems[selectedIndex]) executeItem(flatItems[selectedIndex]); }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose, flatItems, selectedIndex, executeItem]);

  useEffect(() => {
    if (!resultsRef.current) return;
    const selected = resultsRef.current.querySelector('[data-selected="true"]');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!open) return null;

  let flatIdx = 0;

  return (
    <div
      className="fixed inset-0 z-[1000] flex justify-center pt-[10vh]"
      style={{ background: 'var(--overlay-bg)', backdropFilter: 'blur(6px)', animation: 'cmdFadeIn 0.15s ease-out' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-card border border-border rounded-xl w-[680px] max-w-[92vw] max-h-[70vh] flex flex-col overflow-hidden self-start"
        style={{ boxShadow: '0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)', animation: 'cmdSlideUp 0.2s ease-out' }}
      >
        {/* Search */}
        <div className="px-[18px] py-[14px] border-b border-border flex items-center gap-2.5">
          <Search size={16} className="text-text-dim flex-shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent border-none text-text-primary font-mono text-[15px] outline-none placeholder:text-text-dim"
            placeholder="Search commands, services, actions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="text-[11px] px-1.5 py-0.5 bg-bg border border-border rounded text-text-dim">ESC</kbd>
        </div>

        {/* Prefix hints */}
        {!query && (
          <div className="px-4 py-2 border-b border-border flex flex-wrap gap-2">
            {Object.entries(PREFIX_HELP).map(([prefix, desc]) => (
              <button
                key={prefix}
                className="text-[10px] font-mono px-2 py-1 rounded bg-surface border border-border text-text-dim hover:text-accent hover:border-accent transition-colors"
                onClick={() => { setQuery(prefix); inputRef.current?.focus(); }}
              >
                <span className="text-accent font-bold">{prefix}</span> {desc}
              </button>
            ))}
          </div>
        )}

        {/* Active prefix indicator */}
        {activePrefix && (
          <div className="px-4 py-1.5 text-[10px] text-accent bg-accent/5 border-b border-border">
            {PREFIX_HELP[activePrefix]} {searchTerm ? `\u00b7 "${searchTerm}"` : '\u00b7 type to search'}
          </div>
        )}

        {/* User context badge */}
        <div className="px-4 py-1.5 border-b border-border text-[11px] text-text-dim flex items-center gap-2">
          <span>Logged in as <strong className="text-text-primary">{user?.email || 'anonymous'}</strong></span>
          <span className="font-mono text-[9px] px-1.5 py-px rounded uppercase tracking-wide" style={{
            background: isAdmin ? 'rgba(239,68,68,0.15)' : isDeveloper ? 'rgba(59,130,246,0.15)' : 'rgba(148,163,184,0.15)',
            color: isAdmin ? 'var(--red)' : isDeveloper ? 'var(--accent)' : 'var(--text-dim)',
          }}>
            {isAdmin ? 'admin' : isDeveloper ? 'developer' : isIssm ? 'issm' : 'viewer'}
          </span>
        </div>

        {/* Results */}
        <div ref={resultsRef} className="overflow-y-auto flex-1 p-2" style={{ scrollBehavior: 'smooth' }}>
          {liveLoading && (
            <div className="px-4 py-3 text-xs text-text-dim animate-pulse">Searching...</div>
          )}
          {flatItems.length === 0 && !liveLoading ? (
            <div className="py-8 px-5 text-center text-text-dim">
              <span className="text-[28px] mb-2 block">🔍</span>
              <span className="text-[13px]">No results for &ldquo;{query}&rdquo;</span>
            </div>
          ) : (
            Array.from(grouped.entries()).map(([category, items]) => (
              <div key={category}>
                <div className="px-2.5 pt-1.5 pb-0.5 font-mono text-[10px] text-text-dim uppercase tracking-[1.5px] flex items-center gap-1.5 mt-2.5 first:mt-0">
                  {category}
                </div>
                {items.map((item) => {
                  const idx = flatIdx++;
                  const isSelected = idx === selectedIndex;
                  return (
                    <div
                      key={`${category}-${item.label}`}
                      data-selected={isSelected}
                      className={`px-3 py-2 cursor-pointer flex items-center gap-2.5 text-sm rounded-md transition-colors duration-100 ${isSelected ? 'bg-accent text-white' : 'hover:bg-surface'}`}
                      onClick={() => executeItem(item)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <span className="text-base w-6 text-center flex-shrink-0">{item.icon}</span>
                      <div className="flex-1 min-w-0">
                        <span className="block whitespace-nowrap overflow-hidden text-ellipsis">{item.label}</span>
                        {item.description && (
                          <span className={`block text-[11px] whitespace-nowrap overflow-hidden text-ellipsis mt-px ${isSelected ? 'text-white/65' : 'text-text-dim'}`}>
                            {item.description}
                          </span>
                        )}
                      </div>
                      {item.badge && (
                        <span className={`text-[10px] px-1.5 py-px rounded flex-shrink-0 ${isSelected ? 'bg-white/20 text-white/80' : 'bg-surface text-text-dim'}`}>
                          {item.badge}
                        </span>
                      )}
                      {item.shortcut && (
                        <kbd className={`font-mono text-[10px] px-1 py-px rounded flex-shrink-0 ${isSelected ? 'bg-white/15 text-white/70' : 'bg-bg border border-border text-text-muted'}`}>
                          {item.shortcut}
                        </kbd>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-3.5 py-2 border-t border-border flex items-center gap-3 text-[11px] text-text-dim">
          <span><kbd className="font-mono text-[10px] px-[5px] py-px bg-bg border border-border rounded">↑</kbd> <kbd className="font-mono text-[10px] px-[5px] py-px bg-bg border border-border rounded">↓</kbd> navigate</span>
          <span className="opacity-30">|</span>
          <span><kbd className="font-mono text-[10px] px-[5px] py-px bg-bg border border-border rounded">Enter</kbd> select</span>
          <span className="opacity-30">|</span>
          <span><kbd className="font-mono text-[10px] px-[5px] py-px bg-bg border border-border rounded">Esc</kbd> close</span>
          <span className="opacity-30">|</span>
          <span className="text-text-dim">Use # @ / &gt; ! $ : ? for quick access</span>
          <span className="ml-auto">{flatItems.length} results</span>
        </div>
      </div>
    </div>
  );
}
