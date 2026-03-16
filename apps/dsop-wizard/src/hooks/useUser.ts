import { useState, useEffect } from 'react';
import type { User } from '../types';

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // In production, this would read from SSO / auth headers
    // For now, provide a realistic default
    const timer = setTimeout(() => {
      setUser({
        name: 'Platform Operator',
        email: 'operator@sso.example.com',
        groups: ['sre-admins', 'platform-operators'],
      });
      setLoading(false);
    }, 300);

    return () => clearTimeout(timer);
  }, []);

  return { user, loading };
}
