import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { useUser } from '../hooks/useUser';
import type { User, TeamInfo } from '../types/api';

interface UserContextValue {
  user: User | null;
  isAdmin: boolean;
  isDeveloper: boolean;
  isIssm: boolean;
  isViewer: boolean;
  loading: boolean;
  teams: TeamInfo[];
  selectedTeam: string;
  setSelectedTeam: (team: string) => void;
}

const TEAM_STORAGE_KEY = 'sre-selected-team';

const UserContext = createContext<UserContextValue>({
  user: null,
  isAdmin: false,
  isDeveloper: false,
  isIssm: false,
  isViewer: true,
  loading: true,
  teams: [],
  selectedTeam: '',
  setSelectedTeam: () => {},
});

function parseTeamsFromGroups(groups: string[], isAdmin: boolean): TeamInfo[] {
  const teams: TeamInfo[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    // Strip common suffixes to extract team name
    const cleaned = group
      .replace(/^\//, '')
      .replace(/-developers$/, '')
      .replace(/-viewers$/, '')
      .replace(/-admins$/, '');

    // Skip generic groups that are not team names
    if (['sre-admins', 'sre-viewers', 'developers', 'viewers', 'issm', 'platform-admins'].includes(group.replace(/^\//, ''))) {
      continue;
    }

    const teamName = cleaned.startsWith('team-') ? cleaned : `team-${cleaned}`;
    if (!seen.has(teamName)) {
      seen.add(teamName);
      teams.push({
        name: teamName,
        displayName: teamName.replace(/^team-/, ''),
      });
    }
  }

  return teams;
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const userState = useUser();
  const { user, isAdmin } = userState;

  const teams = useMemo(() => {
    if (!user?.groups) return [];
    return parseTeamsFromGroups(user.groups, isAdmin);
  }, [user?.groups, isAdmin]);

  const [selectedTeam, setSelectedTeamRaw] = useState<string>(() => {
    try {
      return localStorage.getItem(TEAM_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });

  const setSelectedTeam = useCallback((team: string) => {
    setSelectedTeamRaw(team);
    try {
      localStorage.setItem(TEAM_STORAGE_KEY, team);
    } catch {
      // ignore
    }
  }, []);

  // Default to first team if user has teams and none selected
  useEffect(() => {
    if (!selectedTeam && teams.length > 0 && !isAdmin) {
      setSelectedTeam(teams[0].name);
    }
  }, [teams, selectedTeam, isAdmin, setSelectedTeam]);

  const value = useMemo<UserContextValue>(() => ({
    ...userState,
    teams,
    selectedTeam,
    setSelectedTeam,
  }), [userState, teams, selectedTeam, setSelectedTeam]);

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUserContext(): UserContextValue {
  return useContext(UserContext);
}
