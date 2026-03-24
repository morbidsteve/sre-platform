import { createContext, useContext } from 'react';
import { useUser } from '../hooks/useUser';
import type { User } from '../types/api';

interface UserContextValue {
  user: User | null;
  isAdmin: boolean;
  isDeveloper: boolean;
  isIssm: boolean;
  isViewer: boolean;
  loading: boolean;
}

const UserContext = createContext<UserContextValue>({
  user: null,
  isAdmin: false,
  isDeveloper: false,
  isIssm: false,
  isViewer: true,
  loading: true,
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const value = useUser();
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUserContext(): UserContextValue {
  return useContext(UserContext);
}
