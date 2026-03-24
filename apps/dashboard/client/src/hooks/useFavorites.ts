import { useState, useEffect, useCallback } from 'react';
import { fetchFavorites, saveFavorites } from '../api/user';

export function useFavorites() {
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchFavorites()
      .then((data) => {
        if (!cancelled) setFavorites(data.favorites);
      })
      .catch(() => {
        // no favorites available
      });
    return () => { cancelled = true; };
  }, []);

  const toggleFavorite = useCallback(async (serviceId: string) => {
    const updated = favorites.includes(serviceId)
      ? favorites.filter((f) => f !== serviceId)
      : [...favorites, serviceId];
    setFavorites(updated);
    try {
      await saveFavorites(updated);
    } catch {
      // revert on failure
      setFavorites(favorites);
    }
  }, [favorites]);

  const isFavorite = useCallback(
    (serviceId: string) => favorites.includes(serviceId),
    [favorites],
  );

  return { favorites, toggleFavorite, isFavorite };
}
