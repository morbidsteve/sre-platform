import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search } from 'lucide-react';
import { useUserContext } from '../../context/UserContext';

interface CommandItem {
  category: string;
  label: string;
  description?: string;
  icon?: string;
  badge?: string;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const { isAdmin } = useUserContext();

  const commands = useMemo<CommandItem[]>(() => {
    const navItems: CommandItem[] = [
      { category: 'Navigation', label: 'Dashboard', icon: '\uD83C\uDFE0', description: 'Platform overview', action: () => onTabChange('dashboard') },
      { category: 'Navigation', label: 'Applications', icon: '\uD83D\uDCE6', description: 'Deployed applications', action: () => onTabChange('applications') },
      { category: 'Navigation', label: 'Platform Services', icon: '\uD83D\uDCC8', description: 'Monitoring, logging, security', action: () => onTabChange('platform') },
      { category: 'Navigation', label: 'Cluster', icon: '\uD83D\uDDA5\uFE0F', description: 'Nodes, pods, events', action: () => onTabChange('cluster') },
      { category: 'Navigation', label: 'Pipeline', icon: '\uD83D\uDEE1\uFE0F', description: 'DSOP security pipeline', action: () => onTabChange('pipeline') },
      { category: 'Navigation', label: 'Audit Log', icon: '\uD83D\uDCC4', description: 'Security audit events', action: () => onTabChange('audit') },
    ];

    if (isAdmin) {
      navItems.push({ category: 'Navigation', label: 'Admin', icon: '\uD83D\uDC65', description: 'User management', action: () => onTabChange('admin') });
    }

    const actionItems: CommandItem[] = [
      { category: 'Actions', label: 'Toggle Theme', icon: '\uD83C\uDF19', description: 'Switch dark/light mode', action: () => { document.documentElement.getAttribute('data-theme') === 'dark' ? document.documentElement.setAttribute('data-theme', 'light') : document.documentElement.setAttribute('data-theme', 'dark'); } },
    ];

    const serviceItems: CommandItem[] = [
      { category: 'Platform Services', label: 'Grafana', icon: '\uD83D\uDCCA', description: 'Metrics & dashboards', badge: 'Monitoring', action: () => { if (onOpenApp) onOpenApp('https://grafana.apps.sre.example.com', 'Grafana'); } },
      { category: 'Platform Services', label: 'Harbor', icon: '\uD83D\uDEA2', description: 'Container registry', badge: 'Registry', action: () => { if (onOpenApp) onOpenApp('https://harbor.apps.sre.example.com', 'Harbor'); } },
      { category: 'Platform Services', label: 'Keycloak', icon: '\uD83D\uDD10', description: 'Identity & SSO', badge: 'Auth', action: () => { if (onOpenApp) onOpenApp('https://keycloak.apps.sre.example.com', 'Keycloak'); } },
      { category: 'Platform Services', label: 'NeuVector', icon: '\uD83D\uDEE1\uFE0F', description: 'Runtime security', badge: 'Security', action: () => { if (onOpenApp) onOpenApp('https://neuvector.apps.sre.example.com', 'NeuVector'); } },
    ];

    return [...navItems, ...actionItems, ...serviceItems];
  }, [isAdmin, onTabChange, onOpenApp]);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands.slice(0, 20);
    return commands.filter(
      (cmd) =>
        fuzzyMatch(cmd.label, query) ||
        fuzzyMatch(cmd.description || '', query) ||
        fuzzyMatch(cmd.category, query)
    );
  }, [query, commands]);

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const item of filtered) {
      const existing = map.get(item.category);
      if (existing) {
        existing.push(item);
      } else {
        map.set(item.category, [item]);
      }
    }
    return map;
  }, [filtered]);

  // Flat list for keyboard nav
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

  // Reset index on filter change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Keyboard handlers
  useEffect(() => {
    if (!open) return;

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, flatItems.length - 1));
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (flatItems[selectedIndex]) {
          executeItem(flatItems[selectedIndex]);
        }
      }
    }

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose, flatItems, selectedIndex, executeItem]);

  // Scroll selected item into view
  useEffect(() => {
    if (!resultsRef.current) return;
    const selected = resultsRef.current.querySelector('[data-selected="true"]');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!open) return null;

  let flatIdx = 0;

  return (
    <div
      className="fixed inset-0 z-[1000] flex justify-center pt-[10vh]"
      style={{
        background: 'var(--overlay-bg)',
        backdropFilter: 'blur(6px)',
        animation: 'cmdFadeIn 0.15s ease-out',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-card border border-border rounded-xl w-[680px] max-w-[92vw] max-h-[70vh] flex flex-col overflow-hidden self-start"
        style={{
          boxShadow: '0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)',
          animation: 'cmdSlideUp 0.2s ease-out',
        }}
      >
        {/* Search input */}
        <div className="px-[18px] py-[14px] border-b border-border flex items-center gap-2.5">
          <Search size={16} className="text-text-dim flex-shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent border-none text-text-primary font-mono text-[15px] outline-none placeholder:text-text-dim"
            placeholder="Type a command, search services, users, docs..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="text-[11px] px-1.5 py-0.5 bg-bg border border-border rounded text-text-dim">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={resultsRef} className="overflow-y-auto flex-1 p-2" style={{ scrollBehavior: 'smooth' }}>
          {flatItems.length === 0 ? (
            <div className="py-8 px-5 text-center text-text-dim">
              <span className="text-[28px] mb-2 block">{'\uD83D\uDD0D'}</span>
              <span className="text-[13px]">No results found</span>
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
                      className={`px-3 py-2 cursor-pointer flex items-center gap-2.5 text-sm rounded-md transition-colors duration-100 ${
                        isSelected
                          ? 'bg-accent text-white'
                          : 'hover:bg-surface'
                      }`}
                      onClick={() => executeItem(item)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <span className="text-base w-6 text-center flex-shrink-0">
                        {item.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="block whitespace-nowrap overflow-hidden text-ellipsis">
                          {item.label}
                        </span>
                        {item.description && (
                          <span
                            className={`block text-[11px] whitespace-nowrap overflow-hidden text-ellipsis mt-px ${
                              isSelected ? 'text-white/65' : 'text-text-dim'
                            }`}
                          >
                            {item.description}
                          </span>
                        )}
                      </div>
                      {item.badge && (
                        <span
                          className={`text-[10px] px-1.5 py-px rounded flex-shrink-0 ${
                            isSelected
                              ? 'bg-white/20 text-white/80'
                              : 'bg-surface text-text-dim'
                          }`}
                        >
                          {item.badge}
                        </span>
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
          <span>
            <kbd className="font-mono text-[10px] px-[5px] py-px bg-bg border border-border rounded">&uarr;</kbd>{' '}
            <kbd className="font-mono text-[10px] px-[5px] py-px bg-bg border border-border rounded">&darr;</kbd>{' '}
            navigate
          </span>
          <span className="opacity-30">|</span>
          <span>
            <kbd className="font-mono text-[10px] px-[5px] py-px bg-bg border border-border rounded">Enter</kbd>{' '}
            select
          </span>
          <span className="opacity-30">|</span>
          <span>
            <kbd className="font-mono text-[10px] px-[5px] py-px bg-bg border border-border rounded">Esc</kbd>{' '}
            close
          </span>
          <span className="opacity-30">|</span>
          <span>{flatItems.length} results</span>
        </div>
      </div>
    </div>
  );
}
