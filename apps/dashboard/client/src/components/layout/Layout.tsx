import React, { useState, useCallback } from 'react';
import { ClassificationBanner } from './ClassificationBanner';
import { Header } from './Header';
import { Navigation } from './Navigation';
import { AlertBanner } from '../shared/AlertBanner';
import { useUserContext } from '../../context/UserContext';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onOpenCommandPalette: () => void;
}

export function Layout({ children, activeTab, onTabChange, onOpenCommandPalette }: LayoutProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { isAdmin } = useUserContext();

  const handleTabChange = useCallback(
    (tab: string) => {
      onTabChange(tab);
      setMobileNavOpen(false);
    },
    [onTabChange]
  );

  return (
    <div className="min-h-screen flex flex-col">
      <ClassificationBanner position="top" />
      <AlertBanner />
      <Header
        onToggleMobileNav={() => setMobileNavOpen((v) => !v)}
        mobileNavOpen={mobileNavOpen}
        onOpenCommandPalette={onOpenCommandPalette}
      />
      <div className="relative">
        <Navigation
          activeTab={activeTab}
          onTabChange={handleTabChange}
          isAdmin={isAdmin}
          mobileOpen={mobileNavOpen}
        />
      </div>
      <main className="max-w-[1200px] mx-auto w-full px-6 py-6 pb-10 flex-1 relative">
        {children}
      </main>
      <ClassificationBanner position="bottom" />
    </div>
  );
}
