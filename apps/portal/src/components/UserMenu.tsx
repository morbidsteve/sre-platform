import { ChevronDown, LogOut, User, Users } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import type { UserInfo } from '../types';

interface UserMenuProps {
  user: UserInfo | null;
}

export function UserMenu({ user }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!user) return null;

  const initials = user.preferredUsername
    .split(/[-_.]/)
    .map((s) => s[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-300 transition-all duration-200 hover:border-slate-600 hover:bg-slate-800"
      >
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-500/20 text-[10px] font-bold text-indigo-400">
          {initials}
        </div>
        <span className="hidden sm:inline">{user.preferredUsername}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-slate-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-slate-700 bg-slate-800 shadow-2xl shadow-black/50">
          <div className="border-b border-slate-700 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/20 text-sm font-bold text-indigo-400">
                {initials}
              </div>
              <div>
                <p className="text-sm font-medium text-slate-200">{user.preferredUsername}</p>
                {user.email && (
                  <p className="text-xs text-slate-500">{user.email}</p>
                )}
              </div>
            </div>
          </div>

          {user.groups.length > 0 && (
            <div className="border-b border-slate-700 p-3">
              <div className="flex items-center gap-2 px-1 pb-2">
                <Users className="h-3.5 w-3.5 text-slate-500" />
                <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Groups</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {user.groups.map((g) => (
                  <span key={g} className="rounded-md bg-slate-700/50 px-2 py-0.5 text-[11px] font-mono text-slate-400">
                    {g.replace(/^\//, '')}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="p-2">
            <a
              href="/oauth2/sign_out"
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-400 transition-colors hover:bg-slate-700/50 hover:text-slate-200"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// Suppress unused import warning — User icon reserved for future use
void User;
