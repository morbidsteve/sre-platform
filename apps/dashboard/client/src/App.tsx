import { useState, useCallback, useEffect, useRef } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { UserProvider, useUserContext } from './context/UserContext';
import { ToastProvider } from './context/ToastContext';
import { ModalProvider } from './context/ModalContext';
import { DataProvider } from './context/DataContext';
import { ConfigProvider } from './context/ConfigContext';
import { Layout } from './components/layout/Layout';
import { UserLandingPage } from './components/layout/UserLandingPage';
import { OverviewTab } from './components/overview/OverviewTab';
import { DeployTab } from './components/deploy/DeployTab';
import { ApplicationsTab } from './components/applications/ApplicationsTab';
import { SecurityTab } from './components/security/SecurityTab';
import { OperationsTab } from './components/operations/OperationsTab';
import { ComplianceTab } from './components/compliance/ComplianceTab';
import { AdminTab } from './components/admin/AdminTab';
import { AppFrame } from './components/shared/AppFrame';
import { CommandPalette } from './components/shared/CommandPalette';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { Spinner } from './components/ui/Spinner';

const VALID_TABS = ['overview', 'deploy', 'applications', 'security', 'operations', 'compliance', 'admin'];

function getInitialTab(): string {
  const hash = window.location.hash.slice(1);
  return VALID_TABS.includes(hash) ? hash : 'overview';
}

function AppContent() {
  const { user, isAdmin, isDeveloper, loading } = useUserContext();
  const [activeTab, setActiveTab] = useState(getInitialTab);
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set([getInitialTab()]));
  const [appFrame, setAppFrame] = useState<{ url: string; title: string } | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const prevTabRef = useRef(activeTab);

  // Track visited tabs
  useEffect(() => {
    setVisitedTabs(prev => {
      if (prev.has(activeTab)) return prev;
      return new Set(prev).add(activeTab);
    });
  }, [activeTab]);

  // Update hash when tab changes
  useEffect(() => {
    window.location.hash = activeTab;
    prevTabRef.current = activeTab;
  }, [activeTab]);

  // Listen for hash changes (browser back/forward)
  useEffect(() => {
    const handler = () => {
      const hash = window.location.hash.slice(1);
      if (VALID_TABS.includes(hash)) {
        setActiveTab(hash);
      }
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab);
    setAppFrame(null);
  }, []);

  const handleOpenAppFrame = useCallback((url: string, title: string) => {
    setAppFrame({ url, title });
  }, []);

  const handleCloseAppFrame = useCallback(() => {
    setAppFrame(null);
  }, []);

  const handleOpenCommandPalette = useCallback(() => {
    setCommandPaletteOpen(true);
  }, []);

  const handleCloseCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false);
  }, []);

  // Global Ctrl+K listener to open command palette
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    }
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg">
        <Spinner size="lg" />
      </div>
    );
  }

  // Non-admin, non-developer users get the clean app launcher
  const isOperator = isAdmin || isDeveloper;

  if (!isOperator && user) {
    return (
      <>
        <UserLandingPage />
        {appFrame && (
          <AppFrame
            url={appFrame.url}
            title={appFrame.title}
            onClose={handleCloseAppFrame}
          />
        )}
      </>
    );
  }

  const userObj = {
    user: user?.email?.split('@')[0] || 'anonymous',
    email: user?.email || '',
    role: isAdmin ? 'admin' : isDeveloper ? 'developer' : 'viewer',
    isAdmin,
  };

  return (
    <>
      <Layout activeTab={activeTab} onTabChange={handleTabChange} onOpenCommandPalette={handleOpenCommandPalette}>
        {visitedTabs.has('overview') && (
          <div style={{ display: activeTab === 'overview' ? 'block' : 'none' }} className={activeTab === 'overview' ? 'tab-enter' : ''}>
            <ErrorBoundary>
              <OverviewTab
                user={userObj}
                onSwitchTab={handleTabChange}
                onOpenApp={handleOpenAppFrame}
              />
            </ErrorBoundary>
          </div>
        )}
        {visitedTabs.has('deploy') && (
          <div style={{ display: activeTab === 'deploy' ? 'block' : 'none' }} className={activeTab === 'deploy' ? 'tab-enter' : ''}>
            <ErrorBoundary>
              <DeployTab
                user={userObj}
                onOpenApp={handleOpenAppFrame}
              />
            </ErrorBoundary>
          </div>
        )}
        {visitedTabs.has('applications') && (
          <div style={{ display: activeTab === 'applications' ? 'block' : 'none' }} className={activeTab === 'applications' ? 'tab-enter' : ''}>
            <ErrorBoundary>
              <ApplicationsTab
                user={userObj}
                onOpenApp={handleOpenAppFrame}
                onSwitchTab={handleTabChange}
              />
            </ErrorBoundary>
          </div>
        )}
        {visitedTabs.has('security') && (
          <div style={{ display: activeTab === 'security' ? 'block' : 'none' }} className={activeTab === 'security' ? 'tab-enter' : ''}>
            <ErrorBoundary>
              <SecurityTab active={activeTab === 'security'} />
            </ErrorBoundary>
          </div>
        )}
        {visitedTabs.has('operations') && (
          <div style={{ display: activeTab === 'operations' ? 'block' : 'none' }} className={activeTab === 'operations' ? 'tab-enter' : ''}>
            <ErrorBoundary>
              <OperationsTab
                active={activeTab === 'operations'}
                onOpenApp={handleOpenAppFrame}
              />
            </ErrorBoundary>
          </div>
        )}
        {visitedTabs.has('compliance') && (
          <div style={{ display: activeTab === 'compliance' ? 'block' : 'none' }} className={activeTab === 'compliance' ? 'tab-enter' : ''}>
            <ErrorBoundary>
              <ComplianceTab active={activeTab === 'compliance'} />
            </ErrorBoundary>
          </div>
        )}
        {visitedTabs.has('admin') && (
          <div style={{ display: activeTab === 'admin' ? 'block' : 'none' }} className={activeTab === 'admin' ? 'tab-enter' : ''}>
            <ErrorBoundary>
              <AdminTab active={activeTab === 'admin'} />
            </ErrorBoundary>
          </div>
        )}
      </Layout>

      {appFrame && (
        <AppFrame
          url={appFrame.url}
          title={appFrame.title}
          onClose={handleCloseAppFrame}
        />
      )}

      <CommandPalette
        open={commandPaletteOpen}
        onClose={handleCloseCommandPalette}
        onTabChange={handleTabChange}
        onOpenApp={handleOpenAppFrame}
      />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ConfigProvider>
        <UserProvider>
          <ToastProvider>
            <ModalProvider>
              <DataProvider>
                <AppContent />
              </DataProvider>
            </ModalProvider>
          </ToastProvider>
        </UserProvider>
      </ConfigProvider>
    </ThemeProvider>
  );
}
