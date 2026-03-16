import { Search } from 'lucide-react';
import { useEffect, useRef } from 'react';

interface SearchBarProps {
  query: string;
  onChange: (query: string) => void;
}

export function SearchBar({ query, onChange }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        inputRef.current?.blur();
        onChange('');
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onChange]);

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
      <input
        ref={inputRef}
        type="text"
        placeholder="Search apps..."
        value={query}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-56 rounded-lg border border-slate-700 bg-slate-800/50 pl-9 pr-12 text-sm text-slate-200 placeholder-slate-500 outline-none transition-all duration-200 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/25 focus:w-72"
      />
      <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-slate-600 bg-slate-700/50 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
        {"\u2318"}K
      </kbd>
    </div>
  );
}
