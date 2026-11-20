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

interface UpdateCredentialsBody {
  tenant_id?: string | null;
  new_username?: string;
  new_password?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {headers: corsHeaders});
  }

  if (req.method !== 'POST') {
    return jsonResponse({error: 'Method not allowed'}, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) {
      return jsonResponse({error: 'غير مصرح.'}, 401);
    }

    const admin = createServiceRoleClient();
    const {
      data: {user},
      error: userError,
    } = await admin.auth.getUser(jwt);

    if (userError || !user) {
      return jsonResponse({error: 'جلسة غير صالحة.'}, 401);
    }

    const body = (await req.json()) as UpdateCredentialsBody;
    const tenantId = body.tenant_id ?? null;
    const newUsername = body.new_username ? body.new_username.trim().toLowerCase() : null;
    const newPassword = body.new_password ?? null;

    if (!newUsername && !newPassword) {
      return jsonResponse({error: 'يرجى تحديد اسم مستخدم جديد أو كلمة مرور جديدة.'}, 400);
    }

    if (newUsername && !/^[a-z0-9._-]{3,32}$/.test(newUsername)) {
      return jsonResponse({error: 'صيغة اسم المستخدم غير صالحة.'}, 400);
    }

    if (newPassword && newPassword.length < 8) {
      return jsonResponse({error: 'يجب ألا تقل كلمة المرور عن 8 أحرف.'}, 400);
    }

    if (newUsername) {
      if (tenantId) {
        const {data: membership} = await admin
          .from('tenant_memberships')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();

        if (!membership) {
          return jsonResponse({error: 'لا تملك عضوية فعالة لهذه الشركة.'}, 403);
        }

        const {error: updateMembershipError} = await admin
          .from('tenant_memberships')
          .update({username: newUsername})
          .eq('id', membership.id);

        if (updateMembershipError) {
          return jsonResponse({error: 'اسم المستخدم مستخدم بالفعل داخل الشركة.'}, 409);
        }

        await admin.rpc('srv_update_auth_identity_username', {
          p_user_id: user.id,
          p_scope: 'tenant',
          p_tenant_id: tenantId,
          p_new_username: newUsername,
        });
      } else {
        const {data: platformAdmin} = await admin
          .from('platform_admins')
          .select('user_id')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();

        if (!platformAdmin) {
          return jsonResponse({error: 'حساب المنصة غير فعال.'}, 403);
        }

        const {error: updateAdminError} = await admin
          .from('platform_admins')
          .update({username: newUsername})
          .eq('user_id', user.id);

        if (updateAdminError) {
          return jsonResponse({error: 'اسم المستخدم مستخدم بالفعل.'}, 409);
        }

        await admin.rpc('srv_update_auth_identity_username', {
          p_user_id: user.id,
          p_scope: 'platform',
          p_tenant_id: null,
          p_new_username: newUsername,
        });
      }
    }

    if (newPassword) {
      const {error: pwError} = await admin.auth.admin.updateUserById(user.id, {
        password: newPassword,
      });

      if (pwError) {
        return jsonResponse({error: 'تعذر تحديث كلمة المرور.'}, 400);
      }

      if (tenantId) {
        await admin
          .from('tenant_memberships')
          .update({must_change_password: false})
          .eq('tenant_id', tenantId)
          .eq('user_id', user.id);

        await admin
          .from('invitations')
          .update({status: 'accepted', accepted_at: new Date().toISOString()})
          .eq('tenant_id', tenantId)
          .eq('user_id', user.id)
          .eq('status', 'pending');
      }
    }

    await admin.rpc('srv_log_session_audit', {
      p_tenant_id: tenantId,
      p_user_id: user.id,
      p_event_type: newPassword ? 'password_changed' : 'credentials_updated',
      p_metadata: {
        updated_username: Boolean(newUsername),
        updated_password: Boolean(newPassword),
      },
    });

    return jsonResponse({success: true});
  } catch {
    return jsonResponse({error: 'تعذر تحديث بيانات الحساب.'}, 500);
  }
});
