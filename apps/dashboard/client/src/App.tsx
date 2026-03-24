import { useState, useCallback } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { UserProvider, useUserContext } from './context/UserContext';
import { ToastProvider } from './context/ToastContext';
import { ModalProvider } from './context/ModalContext';
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
import { Spinner } from './components/ui/Spinner';

function AppContent() {
  const { user, isAdmin, isDeveloper, loading } = useUserContext();
  const [activeTab, setActiveTab] = useState('overview');
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
        {activeTab === 'overview' && (
          <OverviewTab
            user={userObj}
            onSwitchTab={handleTabChange}
            onOpenApp={handleOpenAppFrame}
          />
        )}
        {activeTab === 'deploy' && (
          <DeployTab
            user={userObj}
            onOpenApp={handleOpenAppFrame}
          />
        )}
        {activeTab === 'applications' && (
          <ApplicationsTab
            user={userObj}
            onOpenApp={handleOpenAppFrame}
            onSwitchTab={handleTabChange}
          />
        )}
        {activeTab === 'security' && (
          <SecurityTab active={activeTab === 'security'} />
        )}
        {activeTab === 'operations' && (
          <OperationsTab
            active={activeTab === 'operations'}
            onOpenApp={handleOpenAppFrame}
          />
        )}
        {activeTab === 'compliance' && (
          <ComplianceTab active={activeTab === 'compliance'} />
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
