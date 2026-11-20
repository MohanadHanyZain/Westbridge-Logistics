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

function maskEmail(email: string): string {
  const [localPart, domain] = email.split('@');
  if (!localPart || !domain) {
    return '***';
  }
  const visible = localPart.slice(0, Math.min(2, localPart.length));
  return `${visible}***@${domain}`;
}

interface OnboardTenantBody {
  idempotency_key?: string;
  code?: string;
  slug?: string;
  name?: string;
  owner_email?: string;
  owner_username?: string;
  owner_display_name?: string;
  redirect_to?: string;
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

    // Verify caller is an active platform_super_admin
    const {data: callerAdmin} = await admin
      .from('platform_admins')
      .select('role_key, is_active')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!callerAdmin || !callerAdmin.is_active || callerAdmin.role_key !== 'platform_super_admin') {
      return jsonResponse({error: 'هذه العملية متاحة فقط لمدير المنصة الرئيسي.'}, 403);
    }

    const body = (await req.json()) as OnboardTenantBody;
    const idempotencyKey = (body.idempotency_key ?? '').trim();
    const code = (body.code ?? '').trim().toUpperCase();
    const slug = (body.slug ?? '').trim().toLowerCase();
    const name = (body.name ?? '').trim();
    const ownerEmail = (body.owner_email ?? '').trim().toLowerCase();
    const ownerUsername = (body.owner_username ?? 'admin').trim().toLowerCase();
    const ownerDisplayName = (body.owner_display_name ?? '').trim();

    if (!idempotencyKey || !code || !slug || !name || !ownerEmail || !ownerDisplayName) {
      return jsonResponse({error: 'جميع حقول تأسيس الشركة ومالكها مطلوبة.'}, 400);
    }

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return jsonResponse({error: 'صيغة المعرّف النصي (slug) غير صالحة.'}, 400);
    }

    if (!/^[a-z0-9._-]{3,32}$/.test(ownerUsername)) {
      return jsonResponse({error: 'صيغة اسم المستخدم للمالك غير صالحة.'}, 400);
    }

    // Check idempotency early before sending an auth invite
    const {data: existingOnboarding} = await admin
      .from('tenant_onboarding')
      .select('tenant_id')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (existingOnboarding) {
      return jsonResponse({
        tenant_id: existingOnboarding.tenant_id,
        already_existed: true,
      });
    }

    // Invite owner via Supabase Auth (never use hardcoded passwords)
    const {data: inviteData, error: inviteError} = await admin.auth.admin.inviteUserByEmail(
      ownerEmail,
      {
        redirectTo: body.redirect_to,
      },
    );

    let ownerUserId = inviteData?.user?.id ?? null;

    if (inviteError) {
      // If user already exists in auth.users, look them up safely instead of failing onboarding
      const {data: existingList} = await admin.auth.admin.listUsers({page: 1, perPage: 1000});
      const found = existingList?.users.find((u) => (u.email ?? '').toLowerCase() === ownerEmail);
      if (!found) {
        return jsonResponse({error: 'تعذر إرسال دعوة التفعيل لبريد المالك.'}, 400);
      }
      ownerUserId = found.id;
    }

    if (!ownerUserId) {
      return jsonResponse({error: 'تعذر إنشاء حساب المالك.'}, 500);
    }

    const {data: onboardResult, error: onboardError} = await admin.rpc('srv_onboard_tenant', {
      p_idempotency_key: idempotencyKey,
      p_actor_user_id: user.id,
      p_code: code,
      p_slug: slug,
      p_name: name,
      p_owner_user_id: ownerUserId,
      p_owner_username: ownerUsername,
      p_owner_display_name: ownerDisplayName,
      p_owner_email: ownerEmail,
      p_owner_email_masked: maskEmail(ownerEmail),
    });

    if (onboardError) {
      return jsonResponse({error: 'تعذر تأسيس الشركة في قاعدة البيانات.'}, 400);
    }

    const row = Array.isArray(onboardResult) ? onboardResult[0] : onboardResult;
    return jsonResponse(
      {
        tenant_id: row?.tenant_id,
        membership_id: row?.membership_id,
        already_existed: Boolean(row?.already_existed),
      },
      201,
    );
  } catch {
    return jsonResponse({error: 'حدث خطأ داخلي أثناء تأسيس الشركة.'}, 500);
  }
});
