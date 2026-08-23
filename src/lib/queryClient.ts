import { QueryClient } from '@tanstack/react-query'

// Külön modulban, hogy a kijelentkezés (AuthContext) is elérje és üríthesse
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 1000 * 60 * 60 * 24, retry: 1, refetchOnWindowFocus: false },
  },
})
