import { useState, useCallback } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { UserProvider, useUserContext } from './context/UserContext';
import { ToastProvider } from './context/ToastContext';
import { ModalProvider } from './context/ModalContext';
import { Layout } from './components/layout/Layout';
import { UserLandingPage } from './components/layout/UserLandingPage';
import { DashboardTab } from './components/dashboard/DashboardTab';
import { ApplicationsTab } from './components/applications/ApplicationsTab';
import { PlatformTab } from './components/platform/PlatformTab';
import { ClusterTab } from './components/cluster/ClusterTab';
import { PipelineTab } from './components/pipeline/PipelineTab';
import { AuditTab } from './components/audit/AuditTab';
import { AdminTab } from './components/admin/AdminTab';
import { AppFrame } from './components/shared/AppFrame';
import { CommandPalette } from './components/shared/CommandPalette';
import { Spinner } from './components/ui/Spinner';

function AppContent() {
  const { user, isAdmin, isDeveloper, loading } = useUserContext();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [appFrame, setAppFrame] = useState<{ url: string; title: string } | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab);
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
        {activeTab === 'dashboard' && (
          <DashboardTab
            user={userObj}
            onSwitchTab={handleTabChange}
            onOpenApp={handleOpenAppFrame}
          />
        )}
        {activeTab === 'applications' && (
          <ApplicationsTab
            user={userObj}
            onOpenApp={handleOpenAppFrame}
          />
        )}
        {activeTab === 'platform' && (
          <PlatformTab
            onOpenApp={handleOpenAppFrame}
          />
        )}
        {activeTab === 'cluster' && (
          <ClusterTab active={activeTab === 'cluster'} />
        )}
        {activeTab === 'pipeline' && (
          <PipelineTab active={activeTab === 'pipeline'} />
        )}
        {activeTab === 'audit' && (
          <AuditTab active={activeTab === 'audit'} />
        )}
        {activeTab === 'admin' && <AdminTab active={activeTab === 'admin'} />}
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
      <UserProvider>
        <ToastProvider>
          <ModalProvider>
            <AppContent />
          </ModalProvider>
        </ToastProvider>
      </UserProvider>
    </ThemeProvider>
  );
}
