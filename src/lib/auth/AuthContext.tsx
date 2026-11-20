import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {Session, User} from '@supabase/supabase-js';
import {getSupabaseClient} from '@/lib/supabase/client';
import {
  fetchAuthenticatedContext,
  loginWithUsername,
  signOutCurrentUser,
  type UsernameLoginParams,
} from '@/lib/auth/authService';
import type {
  PlatformAdminRecord,
  ProfileRecord,
  TenantMembershipRecord,
} from '@/types/tenant';

export interface AuthContextValue {
  readonly session: Session | null;
  readonly user: User | null;
  readonly profile: ProfileRecord | null;
  readonly platformAdmin: PlatformAdminRecord | null;
  readonly memberships: readonly TenantMembershipRecord[];
  readonly loading: boolean;
  readonly isConfigured: boolean;
  readonly signIn: (params: UsernameLoginParams) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly refreshContext: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({children}: {children: ReactNode}) {
  const client = useMemo(() => getSupabaseClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [platformAdmin, setPlatformAdmin] = useState<PlatformAdminRecord | null>(null);
  const [memberships, setMemberships] = useState<readonly TenantMembershipRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(client));

  const loadContextForUser = useCallback(async (userId: string) => {
    try {
      const ctx = await fetchAuthenticatedContext(userId);
      setProfile(ctx.profile);
      setPlatformAdmin(ctx.platformAdmin);
      setMemberships(ctx.memberships);
    } catch {
      setProfile(null);
      setPlatformAdmin(null);
      setMemberships([]);
    }
  }, []);

  const refreshContext = useCallback(async () => {
    if (!client) {
      return;
    }
    const {data} = await client.auth.getSession();
    setSession(data.session ?? null);
    if (data.session?.user?.id) {
      await loadContextForUser(data.session.user.id);
    } else {
      setProfile(null);
      setPlatformAdmin(null);
      setMemberships([]);
    }
  }, [client, loadContextForUser]);

  useEffect(() => {
    if (!client) {
      setLoading(false);
      return;
    }

    let mounted = true;

    client.auth.getSession().then(async ({data}) => {
      if (!mounted) {
        return;
      }
      setSession(data.session ?? null);
      if (data.session?.user?.id) {
        await loadContextForUser(data.session.user.id);
      }
      if (mounted) {
        setLoading(false);
      }
    });

    const {data: subscriptionData} = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) {
        return;
      }
      setSession(nextSession);
      if (nextSession?.user?.id) {
        void loadContextForUser(nextSession.user.id);
      } else {
        setProfile(null);
        setPlatformAdmin(null);
        setMemberships([]);
      }
    });

    return () => {
      mounted = false;
      subscriptionData.subscription.unsubscribe();
    };
  }, [client, loadContextForUser]);

  const signIn = useCallback(
    async (params: UsernameLoginParams) => {
      const nextSession = await loginWithUsername(params);
      setSession(nextSession);
      await loadContextForUser(nextSession.user.id);
    },
    [loadContextForUser],
  );

  const signOut = useCallback(async () => {
    await signOutCurrentUser();
    setSession(null);
    setProfile(null);
    setPlatformAdmin(null);
    setMemberships([]);
  }, []);

  const value: AuthContextValue = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      platformAdmin,
      memberships,
      loading,
      isConfigured: Boolean(client),
      signIn,
      signOut,
      refreshContext,
    }),
    [session, profile, platformAdmin, memberships, loading, client, signIn, signOut, refreshContext],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return ctx;
}
