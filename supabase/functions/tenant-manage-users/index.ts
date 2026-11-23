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

type ManageUsersAction = 'create_user' | 'update_assignment' | 'toggle_active' | 'reset_password';

interface ManageUsersBody {
  action?: ManageUsersAction;
  tenant_id?: string;
  membership_id?: string;
  username?: string;
  display_name?: string;
  password?: string;
  role_id?: string;
  client_id?: string | null;
  courier_id?: string | null;
  branch_ids?: string[];
  is_active?: boolean;
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

    const body = (await req.json()) as ManageUsersBody;
    const action = body.action;
    const tenantId = (body.tenant_id ?? '').trim();

    if (!action || !tenantId) {
      return jsonResponse({error: 'العملية ومعرف الشركة مطلوبان.'}, 400);
    }

    // Verify caller authorization: platform_super_admin OR tenant owner/admin OR users.manage permission
    const {data: platformAdmin} = await admin
      .from('platform_admins')
      .select('role_key, is_active')
      .eq('user_id', user.id)
      .maybeSingle();

    const isPlatformSuperAdmin = Boolean(
      platformAdmin?.is_active && platformAdmin.role_key === 'platform_super_admin',
    );

    const {data: callerMembership} = await admin
      .from('tenant_memberships')
      .select('id, role_key, is_active')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .maybeSingle();

    let callerCanManage = isPlatformSuperAdmin;
    const callerIsOwner = isPlatformSuperAdmin || Boolean(callerMembership?.is_active && callerMembership.role_key === 'company_owner');

    if (!callerCanManage && callerMembership?.is_active) {
      if (callerMembership.role_key === 'company_owner' || callerMembership.role_key === 'company_admin') {
        callerCanManage = true;
      } else {
        const {data: mrRows} = await admin
          .from('membership_roles')
          .select('role_id')
          .eq('tenant_id', tenantId)
          .eq('membership_id', callerMembership.id);
        const roleIds = (mrRows ?? []).map((r: {role_id: string}) => r.role_id);
        if (roleIds.length > 0) {
          const {data: permRow} = await admin
            .from('role_permissions')
            .select('id')
            .eq('tenant_id', tenantId)
            .in('role_id', roleIds)
            .eq('permission_key', 'users.manage')
            .limit(1)
            .maybeSingle();
          callerCanManage = Boolean(permRow);
        }
      }
    }

    if (!callerCanManage) {
      return jsonResponse({error: 'ليس لديك صلاحية إدارة المستخدمين في هذه الشركة.'}, 403);
    }

    const {data: tenantRow} = await admin
      .from('tenants')
      .select('id, slug, status')
      .eq('id', tenantId)
      .maybeSingle();

    if (!tenantRow || tenantRow.status !== 'active') {
      return jsonResponse({error: 'الشركة غير نشطة أو غير موجودة.'}, 400);
    }

    if (action === 'create_user') {
      const username = (body.username ?? '').trim().toLowerCase();
      const displayName = (body.display_name ?? '').trim();
      const password = body.password ?? '';
      const roleId = (body.role_id ?? '').trim();
      const clientId = body.client_id ? body.client_id.trim() : null;
      const courierId = body.courier_id ? body.courier_id.trim() : null;
      const branchIds = Array.isArray(body.branch_ids) ? body.branch_ids : [];

      if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
        return jsonResponse({error: 'اسم المستخدم يجب أن يكون بالإنجليزية (3-32 حرفًا).'}, 400);
      }
      if (displayName.length < 2) {
        return jsonResponse({error: 'الاسم الظاهر للمستخدم مطلوب.'}, 400);
      }
      if (password.length < 8) {
        return jsonResponse({error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.'}, 400);
      }
      if (!roleId) {
        return jsonResponse({error: 'اختيار الدور الوظيفي مطلوب.'}, 400);
      }

      const {data: roleRow} = await admin
        .from('roles')
        .select('id, code, default_subject_type, is_active')
        .eq('id', roleId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (!roleRow || !roleRow.is_active) {
        return jsonResponse({error: 'الدور الوظيفي المحدد غير صالح أو موقوف.'}, 400);
      }

      if (roleRow.code === 'company_owner') {
        return jsonResponse({error: 'لا يمكن إنشاء مالك شركة إضافي من هذه الشاشة.'}, 403);
      }

      if (roleRow.code === 'company_admin' && !callerIsOwner) {
        return jsonResponse({error: 'إنشاء مدير نظام (أدمن) متاح لمالك الشركة فقط.'}, 403);
      }

      if (roleRow.default_subject_type === 'client' && !clientId) {
        return jsonResponse({error: 'يجب اختيار سجل العميل المرتبط عند إنشاء مستخدم عميل.'}, 400);
      }

      if (roleRow.default_subject_type === 'courier' && !courierId) {
        return jsonResponse({error: 'يجب اختيار ملف المندوب المرتبط عند إنشاء مستخدم مندوب.'}, 400);
      }

      const {data: dupMember} = await admin
        .from('tenant_memberships')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('username', username)
        .maybeSingle();

      if (dupMember) {
        return jsonResponse({error: 'اسم المستخدم مستخدم بالفعل داخل هذه الشركة.'}, 409);
      }

      const internalEmail = `${username}.${tenantRow.slug}.${crypto.randomUUID().slice(0, 8)}@internal.shipflow.local`;
      const {data: createdAuth, error: createAuthError} = await admin.auth.admin.createUser({
        email: internalEmail,
        password,
        email_confirm: true,
      });

      if (createAuthError || !createdAuth.user) {
        return jsonResponse({error: 'تعذر إنشاء حساب المصادقة للمستخدم.'}, 400);
      }

      const newUserId = createdAuth.user.id;

      const {data: membershipId, error: rpcError} = await admin.rpc('srv_provision_tenant_user', {
        p_tenant_id: tenantId,
        p_actor_user_id: user.id,
        p_new_user_id: newUserId,
        p_username: username,
        p_display_name: displayName,
        p_auth_email: internalEmail,
        p_role_id: roleId,
        p_client_id: clientId,
        p_branch_ids: branchIds,
        p_courier_id: courierId,
      });

      if (rpcError) {
        await admin.auth.admin.deleteUser(newUserId);
        return jsonResponse({error: rpcError.message || 'تعذر ربط المستخدم في قاعدة بيانات الشركة.'}, 400);
      }

      return jsonResponse({success: true, membership_id: membershipId}, 201);
    }

    if (action === 'update_assignment') {
      const membershipId = (body.membership_id ?? '').trim();
      const displayName = (body.display_name ?? '').trim();
      const roleId = (body.role_id ?? '').trim();
      const clientId = body.client_id ? body.client_id.trim() : null;
      const courierId = body.courier_id ? body.courier_id.trim() : null;
      const branchIds = Array.isArray(body.branch_ids) ? body.branch_ids : [];

      if (!membershipId || displayName.length < 2 || !roleId) {
        return jsonResponse({error: 'بيانات التحديث غير مكتملة.'}, 400);
      }

      const {data: targetRole} = await admin
        .from('roles')
        .select('id, code, default_subject_type')
        .eq('id', roleId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (!targetRole) {
        return jsonResponse({error: 'الدور غير موجود.'}, 400);
      }

      if (targetRole.code === 'company_owner' && !callerIsOwner) {
        return jsonResponse({error: 'تعيين دور مالك الشركة متاح للمالك فقط.'}, 403);
      }

      if (targetRole.default_subject_type === 'client' && !clientId) {
        return jsonResponse({error: 'يجب اختيار العميل المرتبط لدور العميل.'}, 400);
      }

      if (targetRole.default_subject_type === 'courier' && !courierId) {
        return jsonResponse({error: 'يجب اختيار المندوب المرتبط لدور المندوب.'}, 400);
      }

      const {error: rpcError} = await admin.rpc('srv_update_tenant_user_assignment', {
        p_tenant_id: tenantId,
        p_actor_user_id: user.id,
        p_membership_id: membershipId,
        p_display_name: displayName,
        p_role_id: roleId,
        p_client_id: clientId,
        p_branch_ids: branchIds,
        p_courier_id: courierId,
      });

      if (rpcError) {
        return jsonResponse({error: rpcError.message || 'تعذر تحديث صلاحيات المستخدم.'}, 400);
      }

      return jsonResponse({success: true});
    }

    if (action === 'toggle_active') {
      const membershipId = (body.membership_id ?? '').trim();
      const isActive = Boolean(body.is_active);
      if (!membershipId) {
        return jsonResponse({error: 'معرف العضوية مطلوب.'}, 400);
      }

      const {data: statusResult, error: rpcError} = await admin.rpc('srv_set_tenant_user_status', {
        p_tenant_id: tenantId,
        p_actor_user_id: user.id,
        p_membership_id: membershipId,
        p_is_active: isActive,
      });

      if (rpcError) {
        return jsonResponse({error: rpcError.message || 'تعذر تحديث حالة المستخدم.'}, 400);
      }

      const row = Array.isArray(statusResult) ? statusResult[0] : statusResult;
      if (row?.target_user_id && Number(row.other_active_tenants_count ?? 0) === 0) {
        await admin.auth.admin.updateUserById(row.target_user_id, {
          ban_duration: isActive ? 'none' : '876000h',
        });
      }

      return jsonResponse({success: true});
    }

    if (action === 'reset_password') {
      const membershipId = (body.membership_id ?? '').trim();
      const newPassword = body.password ?? '';
      if (!membershipId || newPassword.length < 8) {
        return jsonResponse({error: 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.'}, 400);
      }

      const {data: targetMembership} = await admin
        .from('tenant_memberships')
        .select('role_key')
        .eq('id', membershipId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (targetMembership?.role_key === 'company_owner' && !callerIsOwner) {
        return jsonResponse({error: 'إعادة تعيين كلمة مرور مالك الشركة متاح للمالك فقط.'}, 403);
      }

      const {data: targetUserId, error: markErr} = await admin.rpc('srv_mark_tenant_user_password_reset', {
        p_tenant_id: tenantId,
        p_actor_user_id: user.id,
        p_membership_id: membershipId,
      });

      if (markErr || !targetUserId) {
        return jsonResponse({error: 'تعذر العثور على المستخدم.'}, 400);
      }

      const {error: pwErr} = await admin.auth.admin.updateUserById(String(targetUserId), {
        password: newPassword,
      });

      if (pwErr) {
        return jsonResponse({error: 'تعذر تحديث كلمة المرور في نظام المصادقة.'}, 400);
      }

      return jsonResponse({success: true});
    }

    return jsonResponse({error: 'عملية غير مدعومة.'}, 400);
  } catch (error) {
    console.error('tenant-manage-users failed:', error);
    return jsonResponse({error: 'حدث خطأ داخلي أثناء إدارة المستخدمين.'}, 500);
  }
});
