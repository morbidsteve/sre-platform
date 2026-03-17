import { useMemo, useState } from 'react';
import { Boxes, Server, ShieldCheck } from 'lucide-react';
import { ClassificationBanner } from './components/ClassificationBanner';
import { Header } from './components/Header';
import { AppGrid } from './components/AppGrid';
import { QuickActions } from './components/QuickActions';
import { LoadingSkeleton } from './components/LoadingSkeleton';
import { EmptyState } from './components/EmptyState';
import { useUser } from './hooks/useUser';
import { useApps } from './hooks/useApps';

export function App() {
  const { user, loading: userLoading, isAdmin: userIsAdmin } = useUser();
  const { userApps, platformApps, adminApps, isAdmin: appsIsAdmin, loading: appsLoading } = useApps();
  const [searchQuery, setSearchQuery] = useState('');

  const isAdmin = userIsAdmin || appsIsAdmin;
  const loading = userLoading || appsLoading;

  const query = searchQuery.toLowerCase().trim();

  const filteredUserApps = useMemo(
    () => userApps.filter((a) => a.name.toLowerCase().includes(query) || a.description.toLowerCase().includes(query)),
    [userApps, query]
  );

  const filteredPlatformApps = useMemo(
    () => platformApps.filter((a) => a.name.toLowerCase().includes(query) || a.description.toLowerCase().includes(query)),
    [platformApps, query]
  );

  const filteredAdminApps = useMemo(
    () => adminApps.filter((a) => a.name.toLowerCase().includes(query) || a.description.toLowerCase().includes(query)),
    [adminApps, query]
  );

  const totalApps = userApps.length;
  const totalPlatform = platformApps.length + (isAdmin ? adminApps.length : 0);

  const noResults = query && filteredUserApps.length === 0 && filteredPlatformApps.length === 0 && filteredAdminApps.length === 0;

  return (
    <div className="min-h-screen">
      <ClassificationBanner />

      <div className="pt-6">
        <Header user={user} searchQuery={searchQuery} onSearchChange={setSearchQuery} />

        <main className="mx-auto max-w-7xl px-6 py-8">
          {/* Welcome section */}
          {!loading && user && (
            <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-100">
                  Welcome back,{' '}
                  <span className="text-cyan-400">{user.preferredUsername}</span>
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {totalApps} {totalApps === 1 ? 'application' : 'applications'} &middot; {totalPlatform} platform services
                </p>
              </div>
              <QuickActions isAdmin={isAdmin} userGroups={user?.groups ?? []} />
            </div>
          )}

          {/* Loading state */}
          {loading && <LoadingSkeleton />}

          {/* Content */}
          {!loading && (
            <>
              {noResults ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <p className="text-sm text-slate-500">
                    No results for &ldquo;<span className="text-slate-300">{searchQuery}</span>&rdquo;
                  </p>
                  <button
                    onClick={() => setSearchQuery('')}
                    className="mt-3 text-sm text-cyan-400 hover:text-cyan-300"
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                <>
                  {/* User Applications */}
                  {filteredUserApps.length > 0 ? (
                    <AppGrid
                      title="Your Applications"
                      apps={filteredUserApps}
                      icon={<Boxes className="h-4 w-4" />}
                    />
                  ) : (
                    !query && <EmptyState />
                  )}

                  {/* Platform Services */}
                  <AppGrid
                    title="Platform Services"
                    apps={filteredPlatformApps}
                    icon={<Server className="h-4 w-4" />}
                  />

                  {/* Admin Services */}
                  {isAdmin && filteredAdminApps.length > 0 && (
                    <AppGrid
                      title="Identity & Admin"
                      apps={filteredAdminApps}
                      icon={<ShieldCheck className="h-4 w-4" />}
                    />
                  )}
                </>
              )}
            </>
          )}
        </main>

        {/* Footer */}
        <footer className="border-t border-slate-800 py-6 text-center">
          <p className="font-mono text-[11px] text-slate-600">
            SRE Platform &middot; Secure Runtime Environment &middot; v1.0.0
          </p>
        </footer>
      </div>
    </div>
  );
}
