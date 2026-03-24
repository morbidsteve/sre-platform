import { useState, useEffect } from 'react';
import { X, ExternalLink } from 'lucide-react';
import { Spinner } from '../ui/Spinner';

interface AppFrameProps {
  url: string | null;
  title: string;
  onClose: () => void;
}

export function AppFrame({ url, title, onClose }: AppFrameProps) {
  const [loading, setLoading] = useState(true);

  // Reset loading when URL changes
  useEffect(() => { setLoading(true); }, [url]);

  // Escape key closes
  useEffect(() => {
    if (!url) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [url, onClose]);

  if (!url) return null;

  const cleanUrl = url.replace(/[?&]new=\d+/, '');

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'var(--overlay-bg)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Modal dialog — 90% wide, 80% tall, rounded, with title bar */}
      <div
        className="flex flex-col bg-card border border-border rounded-xl overflow-hidden shadow-2xl"
        style={{ width: '90vw', height: '80vh', maxWidth: '1400px', animation: 'confirmIn 0.2s ease-out' }}
      >
        {/* Title bar — always visible */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-bg-secondary shrink-0">
          <span className="text-sm font-medium text-text-primary truncate">{title}</span>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            <a
              href={cleanUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[12px] text-text-dim
                         border border-border hover:border-accent hover:text-accent
                         transition-colors no-underline"
            >
              <ExternalLink size={12} />
              New Tab
            </a>
            <button
              onClick={onClose}
              className="flex items-center justify-center w-7 h-7 rounded
                         text-text-dim hover:text-red hover:bg-red/10
                         transition-colors"
              title="Close (Esc)"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Iframe content */}
        <div className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none bg-bg">
              <Spinner size="lg" />
              <span className="text-text-dim text-[13px]">Loading {title}...</span>
            </div>
          )}
          <iframe
            src={url}
            className="w-full h-full border-none"
            style={{ background: 'var(--bg)' }}
            onLoad={() => setLoading(false)}
            title={title}
          />
        </div>
      </div>
    </div>
  );
}
