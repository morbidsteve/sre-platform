import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface DNSSetupProps {
  hostsEntry: string;
}

export function DNSSetup({ hostsEntry }: DNSSetupProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!hostsEntry) return;
    try {
      await navigator.clipboard.writeText(hostsEntry);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const textarea = document.createElement('textarea');
      textarea.value = hostsEntry;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="bg-card border border-border rounded-[var(--radius)] p-4">
      <p className="text-[13px] text-text-dim mb-2">
        Add this to <code className="bg-bg px-1 py-0.5 rounded text-xs font-mono">/etc/hosts</code> to access services by hostname:
      </p>
      <div
        className="relative bg-bg px-3 py-2 rounded-[var(--radius)] cursor-pointer group"
        onClick={handleCopy}
        title="Click to copy"
      >
        <pre className="text-[13px] font-mono text-text-primary whitespace-pre overflow-x-auto pr-8">
          {hostsEntry || 'Loading...'}
        </pre>
        <span className="absolute right-2 top-2 text-text-dim group-hover:text-accent transition-colors">
          {copied ? (
            <Check className="w-4 h-4 text-green" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </span>
      </div>
      {copied && (
        <p className="text-[11px] text-green mt-1">Copied to clipboard!</p>
      )}
    </div>
  );
}
