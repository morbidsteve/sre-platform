import { Shield } from 'lucide-react';
import { SearchBar } from './SearchBar';
import { UserMenu } from './UserMenu';
import type { UserInfo } from '../types';

interface HeaderProps {
  user: UserInfo | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function Header({ user, searchQuery, onSearchChange }: HeaderProps) {
  return (
    <header className="sticky top-6 z-40 border-b border-slate-700/50 bg-navy-900/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10 border border-cyan-500/20">
            <Shield className="h-5 w-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-100 tracking-tight">
              SRE PLATFORM
            </h1>
            <p className="text-[11px] font-mono text-slate-500 tracking-wider uppercase">
              Secure Runtime Environment
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <SearchBar query={searchQuery} onChange={onSearchChange} />
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
