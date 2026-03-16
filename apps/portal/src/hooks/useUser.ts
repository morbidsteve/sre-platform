import { useCallback, useEffect, useState } from 'react';
import type { UserInfo } from '../types';
import { fetchUserInfo } from '../api';

interface UseUserResult {
  user: UserInfo | null;
  loading: boolean;
  isAdmin: boolean;
}

export function useUser(): UseUserResult {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const info = await fetchUserInfo();
    setUser(info);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const isAdmin = user?.groups?.some(
    (g) => g === 'sre-admins' || g === '/sre-admins'
  ) ?? false;

  return { user, loading, isAdmin };
}
