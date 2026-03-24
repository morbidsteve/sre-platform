import { useState } from 'react';
import { X, ExternalLink } from 'lucide-react';
import { Spinner } from '../ui/Spinner';

interface AppFrameProps {
  url: string | null;
  title: string;
  onClose: () => void;
}

export function AppFrame({ url, title, onClose }: AppFrameProps) {
  const [loading, setLoading] = useState(true);

  if (!url) return null;

  // Strip cache-busting params for the external link
  const cleanUrl = url.replace(/[?&]new=\d+/, '');

  return (
    <div className="fixed inset-0 z-[200] flex flex-col" style={{ background: 'var(--bg)' }}>
      {/* Floating controls — small, unobtrusive, top-right */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        <a
          href={cleanUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] text-text-dim
                     bg-card/80 backdrop-blur border border-border hover:border-accent hover:text-accent
                     transition-colors no-underline"
          title="Open in new tab"
        >
          <ExternalLink size={12} />
          <span className="hidden sm:inline">New Tab</span>
        </a>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-8 h-8 rounded-md
                     bg-card/80 backdrop-blur border border-border text-text-dim
                     hover:border-red hover:text-red hover:bg-red/10
                     transition-colors"
          title="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* Loading spinner */}
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
          <Spinner size="lg" />
          <span className="text-text-dim text-[13px]">Loading {title}...</span>
        </div>
      )}

      {/* Full-screen iframe — no top bar */}
      <iframe
        src={url}
        className="w-full h-full border-none"
        style={{ background: 'var(--bg)' }}
        onLoad={() => setLoading(false)}
        title={title}
      />
    </div>
  );
}
