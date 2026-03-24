import { apiFetch } from './client';
import type { User, FavoritesResponse } from '../types/api';

export function fetchUser(): Promise<User> {
  return apiFetch<User>('/api/user');
}

export async function logout(): Promise<void> {
  await apiFetch('/api/logout', { method: 'POST' });
  window.location.href = '/oauth2/sign_out';
}

export function fetchFavorites(): Promise<FavoritesResponse> {
  return apiFetch<FavoritesResponse>('/api/favorites');
}

export function saveFavorites(favorites: string[]): Promise<{ ok: boolean; favorites: string[] }> {
  return apiFetch('/api/favorites', {
    method: 'POST',
    body: JSON.stringify({ favorites }),
  });
}
