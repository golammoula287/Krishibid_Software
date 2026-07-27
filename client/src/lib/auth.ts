import type { AuthResult, Role, UserDto } from '@krishibid/shared';
import { create } from 'zustand';
import { api, setAccessToken } from './api.js';

interface AuthState {
  user: UserDto | null;
  /** True until the initial silent refresh completes, so routes don't flash. */
  initialising: boolean;
  login: (phone: string, password: string) => Promise<void>;
  register: (input: Record<string, unknown>) => Promise<void>;
  demoLogin: (role: Role) => Promise<void>;
  logout: () => Promise<void>;
  /** Attempts to restore a session from the httpOnly refresh cookie. */
  restore: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  initialising: true,

  login: async (phone, password) => {
    const result = await api.post<AuthResult>('/auth/login', { phone, password });
    setAccessToken(result.accessToken);
    set({ user: result.user });
  },

  register: async (input) => {
    const result = await api.post<AuthResult>('/auth/register', input);
    setAccessToken(result.accessToken);
    set({ user: result.user });
  },

  demoLogin: async (role) => {
    const result = await api.post<AuthResult>('/auth/demo', { role });
    setAccessToken(result.accessToken);
    set({ user: result.user });
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      // Clear locally even if the network call failed — the user asked to leave.
      setAccessToken(null);
      set({ user: null });
    }
  },

  /**
   * Runs once on boot. The access token is memory-only, so a page reload always
   * starts unauthenticated; the httpOnly refresh cookie is what silently restores
   * the session without ever exposing a long-lived token to JS.
   */
  restore: async () => {
    try {
      if (await api.refresh()) {
        const user = await api.get<UserDto>('/auth/me');
        set({ user });
      }
    } catch {
      // Not signed in — the normal path for a first-time visitor.
    } finally {
      set({ initialising: false });
    }
  },
}));
