import React from 'react';
import type { Classification } from '../types';

interface ClassificationBannerProps {
  classification: Classification;
}

const bannerStyles: Record<Classification, string> = {
  UNCLASSIFIED: 'bg-emerald-600 text-white',
  CUI: 'bg-purple-700 text-white',
  CONFIDENTIAL: 'bg-blue-700 text-white',
  SECRET: 'bg-red-700 text-white',
  'TOP SECRET': 'bg-orange-600 text-white',
  'TS//SCI': 'bg-yellow-500 text-black',
};

export function ClassificationBanner({ classification }: ClassificationBannerProps) {
  return (
    <>
      <div
        className={`w-full text-center py-1 text-xs font-bold tracking-[0.2em] uppercase ${bannerStyles[classification]}`}
      >
        {classification}
      </div>
    </>
  );
}

export function ClassificationBannerBottom({ classification }: ClassificationBannerProps) {
  return (
    <div
      className={`fixed bottom-0 left-0 right-0 text-center py-1 text-xs font-bold tracking-[0.2em] uppercase z-50 ${bannerStyles[classification]}`}
    >
      {classification}
    </div>
  );
}
