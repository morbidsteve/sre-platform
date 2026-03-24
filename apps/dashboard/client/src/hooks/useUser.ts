import { useState, useEffect } from 'react';
import { fetchUser } from '../api/user';
import type { User } from '../types/api';

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchUser()
      .then((data) => {
        if (!cancelled) {
          setUser(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser({ user: 'anonymous', email: '', groups: [], isAdmin: false, role: 'anonymous' });
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const isAdmin = user?.role === 'admin';
  const isDeveloper = user?.role === 'developer' || isAdmin;
  const isIssm = user?.role === 'issm';
  const isViewer = !isAdmin && !isDeveloper && !isIssm;

  return { user, isAdmin, isDeveloper, isIssm, isViewer, loading };
}
