import React from 'react';
import { Shield, Moon, Sun, Menu, X, LogOut } from 'lucide-react';
import { useThemeContext } from '../../context/ThemeContext';
import { useUserContext } from '../../context/UserContext';
import { useHealth } from '../../hooks/useHealth';
import { StatusDot } from '../ui/StatusDot';
import { Badge } from '../ui/Badge';

interface HeaderProps {
  onToggleMobileNav: () => void;
  mobileNavOpen: boolean;
  onOpenCommandPalette: () => void;
}

export function Header({ onToggleMobileNav, mobileNavOpen, onOpenCommandPalette }: HeaderProps) {
  const { theme, toggleTheme } = useThemeContext();
  const { user, isAdmin, isDeveloper, loading } = useUserContext();
  const { summary } = useHealth();

  const healthyCount = summary.helmReleasesReady + summary.nodesReady;
  const totalCount = summary.helmReleasesTotal + summary.nodesTotal;
  const allHealthy = healthyCount === totalCount && totalCount > 0;

  const initials = user?.email
    ? user.email.substring(0, 2).toUpperCase()
    : '??';

  const roleName = isAdmin ? 'admin' : isDeveloper ? 'developer' : 'viewer';

  function handleLogout() {
    fetch('/api/logout', { method: 'POST' }).finally(() => {
      window.location.href = '/oauth2/sign_out?rd=' + encodeURIComponent(window.location.origin + '/');
    });
  }

  return (
    <header
      className="bg-bg-secondary border-b border-border px-6 py-3 flex items-center justify-between sticky top-0 z-[100] md:sticky md:top-0 relative"
    >
      {/* Left */}
      <div className="flex items-center gap-3">
        <button
          className="md:hidden bg-transparent border-none text-text-primary text-2xl cursor-pointer p-1 leading-none"
          onClick={onToggleMobileNav}
          aria-label="Toggle navigation"
        >
          {mobileNavOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
        <h1 className="font-mono text-sm font-semibold uppercase tracking-[2px] text-text-bright flex items-center gap-2">
          <Shield size={18} style={{ color: 'var(--accent)' }} />
          SRE Platform
        </h1>
      </div>

      {/* Right */}
      <div className="flex items-center gap-3">
        {/* Health + Ctrl+K */}
        <div className="flex items-center gap-3 text-[13px] text-text-dim">
          <span className="flex items-center gap-1.5">
            <StatusDot color={allHealthy ? 'green' : totalCount === 0 ? 'unknown' : 'red'} />
            <span className="hidden sm:inline">{healthyCount}/{totalCount}</span>
          </span>
          <span
            className="hidden lg:inline font-mono text-[10px] text-text-dim bg-bg px-2 py-0.5 rounded border border-border cursor-pointer tracking-[0.5px] hover:border-accent"
            onClick={onOpenCommandPalette}
          >
            Ctrl+K
          </span>
        </div>

        {/* Theme toggle */}
        <button
          className="bg-transparent border border-border text-text-dim text-base cursor-pointer px-2 py-1 rounded leading-none transition-colors hover:border-accent hover:text-text-primary"
          onClick={toggleTheme}
          title="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        {/* User area */}
        {loading ? null : !user?.email ? (
          <a
            href="/oauth2/start"
            className="font-mono px-3.5 py-1.5 rounded text-[11px] font-medium uppercase tracking-[1px] cursor-pointer border border-border bg-surface text-text-primary transition-all hover:border-accent hover:text-accent no-underline"
          >
            Sign In
          </a>
        ) : (
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold text-white"
              style={{ background: 'var(--accent)' }}
            >
              {initials}
            </div>
            <div className="hidden lg:flex flex-col text-xs">
              <span className="text-text-primary font-medium">{user.email}</span>
              <Badge variant={isAdmin ? 'red' : isDeveloper ? 'accent' : 'dim'}>
                {roleName}
              </Badge>
            </div>
            <button
              className="bg-transparent border border-border text-text-dim cursor-pointer px-2 py-1 rounded text-sm transition-all hover:border-accent hover:text-accent"
              onClick={handleLogout}
              title="Sign Out"
            >
              <LogOut size={14} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
