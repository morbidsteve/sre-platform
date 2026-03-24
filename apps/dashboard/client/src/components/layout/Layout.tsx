import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ClassificationBanner } from './ClassificationBanner';
import { Header } from './Header';
import { Navigation } from './Navigation';
import { useUserContext } from '../../context/UserContext';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onOpenCommandPalette: () => void;
}

export function Layout({ children, activeTab, onTabChange, onOpenCommandPalette }: LayoutProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { isAdmin } = useUserContext();
  const prevTab = useRef(activeTab);

  // Show brief refresh indicator on tab change
  useEffect(() => {
    if (prevTab.current !== activeTab) {
      prevTab.current = activeTab;
      setIsRefreshing(true);
      const timer = setTimeout(() => setIsRefreshing(false), 800);
      return () => clearTimeout(timer);
    }
  }, [activeTab]);

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
      <Header
        onToggleMobileNav={() => setMobileNavOpen((v) => !v)}
        mobileNavOpen={mobileNavOpen}
        onOpenCommandPalette={onOpenCommandPalette}
      />
      {isRefreshing && (
        <div className="h-0.5 bg-accent/30 overflow-hidden">
          <div className="h-full bg-accent w-1/3" style={{ animation: 'indeterminate 1.5s ease-in-out infinite' }} />
        </div>
      )}
      <div className="relative">
        <Navigation
          activeTab={activeTab}
          onTabChange={handleTabChange}
          isAdmin={isAdmin}
          mobileOpen={mobileNavOpen}
        />
      </div>
      <main className="max-w-[1200px] mx-auto w-full px-4 md:px-6 py-6 pb-10 flex-1 relative">
        {children}
      </main>
      <ClassificationBanner position="bottom" />
    </div>
  );
}
