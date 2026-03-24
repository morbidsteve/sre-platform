import { useState, useEffect, useRef } from 'react';
import { X, ExternalLink } from 'lucide-react';
import { Spinner } from '../ui/Spinner';

interface AppFrameProps {
  url: string | null;
  title: string;
  onClose: () => void;
}

export function AppFrame({ url, title, onClose }: AppFrameProps) {
  const [loading, setLoading] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();

  // Escape key closes
  useEffect(() => {
    if (!url) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [url, onClose]);

  // Auto-hide controls after 3s, show on mouse move near top
  useEffect(() => {
    if (!url) return;
    setShowControls(true);
    hideTimer.current = setTimeout(() => setShowControls(false), 3000);
    return () => clearTimeout(hideTimer.current);
  }, [url]);

  const handleMouseMove = (e: React.MouseEvent) => {
    // Show controls when mouse is in the top 60px
    if (e.clientY < 60) {
      setShowControls(true);
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setShowControls(false), 2000);
    }
  };

  if (!url) return null;

  const cleanUrl = url.replace(/[?&]new=\d+/, '');

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col"
      style={{ background: 'var(--bg)' }}
      onMouseMove={handleMouseMove}
    >
      {/* Controls — auto-hide, appear on hover near top */}
      <div
        className="absolute top-3 right-3 z-10 flex items-center gap-2 transition-opacity duration-300"
        style={{ opacity: showControls ? 1 : 0, pointerEvents: showControls ? 'auto' : 'none' }}
        onMouseEnter={() => { setShowControls(true); clearTimeout(hideTimer.current); }}
        onMouseLeave={() => { hideTimer.current = setTimeout(() => setShowControls(false), 1500); }}
      >
        <a
          href={cleanUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] text-text-dim
                     bg-card/90 backdrop-blur-sm border border-border hover:border-accent hover:text-accent
                     transition-colors no-underline shadow-lg"
          title="Open in new tab"
        >
          <ExternalLink size={12} />
          <span className="hidden sm:inline">New Tab</span>
        </a>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-8 h-8 rounded-md
                     bg-card/90 backdrop-blur-sm border border-border text-text-dim
                     hover:border-red hover:text-red hover:bg-red/10
                     transition-colors shadow-lg"
          title="Close (Esc)"
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

      {/* Full-screen iframe */}
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
