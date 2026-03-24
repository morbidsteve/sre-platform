import React, { useState } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Spinner } from '../ui/Spinner';

interface AppFrameProps {
  url: string | null;
  title: string;
  onClose: () => void;
}

export function AppFrame({ url, title, onClose }: AppFrameProps) {
  const [loading, setLoading] = useState(true);

  if (!url) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col"
      style={{ background: 'var(--bg)' }}
    >
      {/* Top bar */}
      <div
        className="flex items-center px-4 gap-3 border-b border-border"
        style={{ background: 'var(--bg-secondary)', height: '45px' }}
      >
        <button
          className="btn text-[13px] whitespace-nowrap"
          onClick={onClose}
        >
          <ArrowLeft size={14} className="inline mr-1" />
          Back
        </button>
        <span className="text-text-dim text-[13px] overflow-hidden text-ellipsis whitespace-nowrap flex-1">
          {title}
        </span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn text-[13px] whitespace-nowrap no-underline flex items-center gap-1"
        >
          <ExternalLink size={12} />
          Open
        </a>
      </div>

      {/* Iframe + loading spinner */}
      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
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
  );
}
