import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import { fetchComponentDependencies } from '../../api/admin';
import type { ComponentDependency } from '../../types/api';

interface DependencyMapProps {
  active: boolean;
}

export function DependencyMap({ active }: DependencyMapProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [components, setComponents] = useState<ComponentDependency[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    if (!active) return;
    try {
      const data = await fetchComponentDependencies();
      setComponents(data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const expandAll = () => {
    setExpanded(new Set(components.map((c) => c.name)));
  };

  const collapseAll = () => {
    setExpanded(new Set());
  };

  const criticalityVariant = (c: string): 'red' | 'yellow' | 'accent' | 'dim' => {
    if (c === 'critical') return 'red';
    if (c === 'high') return 'yellow';
    if (c === 'medium') return 'accent';
    return 'dim';
  };

  return (
    <div>
      <button
        className="w-full flex items-center justify-between py-3 px-1 text-left"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-2">
          {collapsed ? <ChevronRight className="w-4 h-4 text-text-dim" /> : <ChevronDown className="w-4 h-4 text-text-dim" />}
          <h3 className="text-sm font-semibold text-text-primary">Component Dependencies</h3>
          <span className="text-xs text-text-dim">{components.length} components</span>
        </div>
      </button>

      {!collapsed && (
        <div className="mt-2">
          {loading ? (
            <div className="flex justify-center py-16"><Spinner size="lg" /></div>
          ) : (
            <>
              <div className="flex justify-end items-center mb-4">
                <div className="flex gap-2">
                  <button className="text-xs text-accent hover:underline cursor-pointer" onClick={expandAll}>Expand All</button>
                  <button className="text-xs text-text-dim hover:underline cursor-pointer" onClick={collapseAll}>Collapse All</button>
                </div>
              </div>

              <p className="text-xs text-text-dim mb-4">
                Shows platform component dependencies and blast radius. Click a component to see details.
              </p>

              <div className="space-y-1">
                {components.map((comp) => {
                  const isExpanded = expanded.has(comp.name);
                  return (
                    <div key={comp.name} className="card-base overflow-hidden">
                      {/* Component header */}
                      <button
                        className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer hover:bg-surface/50 transition-colors"
                        onClick={() => toggleExpand(comp.name)}
                      >
                        <span className="text-xs text-text-dim font-mono w-4">
                          {isExpanded ? '-' : '+'}
                        </span>
                        <span className="text-sm font-semibold text-text-bright flex-1">{comp.name}</span>
                        <Badge variant={criticalityVariant(comp.criticality)}>
                          {comp.criticality}
                        </Badge>
                        <span className="text-xs text-text-dim font-mono">{comp.namespace}</span>
                      </button>

                      {/* Expanded details */}
                      {isExpanded && (
                        <div className="px-4 pb-4 border-t border-border pt-3">
                          {/* Impact */}
                          <div className="mb-3">
                            <div className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-1">
                              Impact if Down
                            </div>
                            <p className="text-sm text-text-primary pl-4" style={{ borderLeft: '2px solid var(--red)' }}>
                              {comp.impact}
                            </p>
                          </div>

                          {/* Depends on */}
                          <div className="mb-3">
                            <div className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-1">
                              Depends On
                            </div>
                            {comp.dependsOn.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5 pl-4">
                                {comp.dependsOn.map((dep) => (
                                  <span
                                    key={dep}
                                    className="text-xs px-2 py-0.5 rounded bg-surface border border-border text-text-primary cursor-pointer hover:border-accent"
                                    onClick={() => {
                                      setExpanded((prev) => new Set([...prev, dep]));
                                      const el = document.getElementById('dep-' + dep.replace(/[^a-zA-Z0-9]/g, ''));
                                      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    }}
                                  >
                                    {dep}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs text-text-dim pl-4">None (root dependency)</span>
                            )}
                          </div>

                          {/* Depended on by */}
                          <div>
                            <div className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-1">
                              Depended On By
                            </div>
                            {comp.dependedOnBy.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5 pl-4">
                                {comp.dependedOnBy.map((dep) => (
                                  <span
                                    key={dep}
                                    className="text-xs px-2 py-0.5 rounded bg-surface border border-border text-text-dim"
                                  >
                                    {dep}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs text-text-dim pl-4">None (leaf component)</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
