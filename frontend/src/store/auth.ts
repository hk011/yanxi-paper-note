import { create } from "zustand";
import { api, clearToken, getToken, setToken, type UserProfile } from "../api/client";

interface AuthState {
  token: string | null;
  userId: number | null;
  username: string | null;
  profile: UserProfile | null;
  avatarVersion: number;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
  hydrate: () => void;
  fetchProfile: () => Promise<UserProfile>;
  setProfile: (profile: UserProfile) => void;
  applyAuthResult: (res: {
    access_token: string;
    user_id: number;
    username: string;
    display_name?: string;
    account_code?: string;
    avatar_url?: string | null;
  }) => void;
}

function profileFromAuth(res: {
  user_id: number;
  username: string;
  display_name?: string;
  account_code?: string;
  avatar_url?: string | null;
}): UserProfile {
  return {
    id: res.user_id,
    username: res.username,
    display_name: res.display_name || res.username,
    account_code: res.account_code || "",
    avatar_url: res.avatar_url ?? null,
    created_at: "",
  };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: getToken(),
  userId: null,
  username: null,
  profile: null,
  avatarVersion: 0,

  hydrate: () => {
    const token = getToken();
    set({ token });
    if (token) {
      void get().fetchProfile().catch(() => {
        /* 无效 token 由业务请求处理 */
      });
    }
  },

  applyAuthResult: (res) => {
    setToken(res.access_token);
    const profile = profileFromAuth(res);
    set({
      token: res.access_token,
      userId: res.user_id,
      username: res.username,
      profile,
      avatarVersion: profile.avatar_url ? Date.now() : 0,
    });
  },

  fetchProfile: async () => {
    const profile = await api.getMe();
    set({
      profile,
      userId: profile.id,
      username: profile.username,
      avatarVersion: profile.avatar_url ? Date.now() : get().avatarVersion,
    });
    return profile;
  },

  setProfile: (profile) => {
    set({
      profile,
      username: profile.username,
      avatarVersion: profile.avatar_url ? Date.now() : get().avatarVersion,
    });
  },

  login: async (username, password) => {
    const res = await api.login(username, password);
    get().applyAuthResult(res);
  },

  register: async (username, password) => {
    const res = await api.register(username, password);
    get().applyAuthResult(res);
  },

  logout: () => {
    clearToken();
    set({
      token: null,
      userId: null,
      username: null,
      profile: null,
      avatarVersion: 0,
    });
  },
}));
