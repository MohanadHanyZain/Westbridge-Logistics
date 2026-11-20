import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function createServiceRoleClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }
  return createClient(url, serviceRoleKey, {
    auth: {autoRefreshToken: false, persistSession: false},
  });
}

function createAnonClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY.');
  }
  return createClient(url, anonKey, {
    auth: {autoRefreshToken: false, persistSession: false},
  });
}

interface LoginRequestBody {
  username?: string;
  password?: string;
  scope?: 'platform' | 'tenant';
  tenant_slug?: string;
}

const GENERIC_AUTH_ERROR = 'اسم المستخدم أو كلمة المرور غير صحيحة.';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {headers: corsHeaders});
  }

  if (req.method !== 'POST') {
    return jsonResponse({error: 'Method not allowed'}, 405);
  }

  try {
    const body = (await req.json()) as LoginRequestBody;
    const username = (body.username ?? '').trim().toLowerCase();
    const password = body.password ?? '';
    const scope = body.scope === 'platform' ? 'platform' : 'tenant';
    const tenantSlug = (body.tenant_slug ?? '').trim().toLowerCase();

    if (!username || !password || (scope === 'tenant' && !tenantSlug)) {
      return jsonResponse({error: GENERIC_AUTH_ERROR}, 401);
    }

    const admin = createServiceRoleClient();
    const anon = createAnonClient();

    let tenantId: string | null = null;
    if (scope === 'tenant') {
      const {data: tenant} = await admin
        .from('tenants')
        .select('id, status')
        .eq('slug', tenantSlug)
        .maybeSingle();

      if (!tenant || tenant.status !== 'active') {
        return jsonResponse({error: GENERIC_AUTH_ERROR}, 401);
      }
      tenantId = tenant.id;
    }

    // Lookup internal auth_email via service_role-only RPC (never exposed to browser)
    const {data: identityRows, error: identityErr} = await admin.rpc(
      'srv_resolve_login_identity',
      {
        p_scope: scope,
        p_tenant_id: tenantId,
        p_username: username,
      },
    );

    const identity = Array.isArray(identityRows) ? identityRows[0] : identityRows;
    if (identityErr || !identity || !identity.is_active) {
      return jsonResponse({error: GENERIC_AUTH_ERROR}, 401);
    }

    // Sign in server-side so auth_email is never revealed prior to authentication
    const {data: authData, error: signInError} = await anon.auth.signInWithPassword({
      email: identity.auth_email,
      password,
    });

    if (signInError || !authData.session) {
      await admin.rpc('srv_log_session_audit', {
        p_tenant_id: tenantId,
        p_user_id: identity.user_id,
        p_event_type: 'login_failed',
        p_metadata: {scope, username},
      });
      return jsonResponse({error: GENERIC_AUTH_ERROR}, 401);
    }

    // Verify membership or platform admin active status
    if (scope === 'tenant' && tenantId) {
      const {data: membership} = await admin
        .from('tenant_memberships')
        .select('id, is_active, role_key, must_change_password')
        .eq('tenant_id', tenantId)
        .eq('user_id', authData.user.id)
        .maybeSingle();

      if (!membership || !membership.is_active) {
        return jsonResponse({error: GENERIC_AUTH_ERROR}, 401);
      }
    } else {
      const {data: platformAdmin} = await admin
        .from('platform_admins')
        .select('user_id, is_active')
        .eq('user_id', authData.user.id)
        .maybeSingle();

      if (!platformAdmin || !platformAdmin.is_active) {
        return jsonResponse({error: GENERIC_AUTH_ERROR}, 401);
      }
    }

    await admin.rpc('srv_log_session_audit', {
      p_tenant_id: tenantId,
      p_user_id: authData.user.id,
      p_event_type: 'login_success',
      p_metadata: {scope, username},
    });

    return jsonResponse({
      session: {
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
        expires_in: authData.session.expires_in,
        token_type: authData.session.token_type,
      },
    });
  } catch {
    return jsonResponse({error: 'تعذر إتمام تسجيل الدخول حاليًا.'}, 500);
  }
});
