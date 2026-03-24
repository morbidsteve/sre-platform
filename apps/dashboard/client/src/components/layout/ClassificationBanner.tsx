import React from 'react';

interface ClassificationBannerProps {
  position: 'top' | 'bottom';
}

export function ClassificationBanner({ position }: ClassificationBannerProps) {
  const isBottom = position === 'bottom';

  return (
    <div
      className="text-center py-[3px] font-mono text-[10px] font-semibold tracking-[3px] uppercase z-[101]"
      style={{
        background: '#40c057',
        color: '#000',
        ...(isBottom
          ? { position: 'fixed', bottom: 0, left: 0, right: 0 }
          : { position: 'relative' }),
      }}
    >
      UNCLASSIFIED
    </div>
  );
}
