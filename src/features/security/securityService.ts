import {getSupabaseClient} from '@/lib/supabase/client';
import type {PermissionScope} from '@/types/common';
import type {
  MyTenantPermissionsBundle,
  PermissionCatalogRecord,
  RolePermissionRecord,
  RoleRecord,
  SessionAuditRecord,
  TenantUserDirectoryItem,
} from '@/types/security';

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }
  return client;
}

export async function getMyTenantPermissions(tenantId: string): Promise<MyTenantPermissionsBundle> {
  const client = requireClient();
  const {data, error} = await client.rpc('get_my_tenant_permissions', {
    p_tenant_id: tenantId,
  });
  if (error || !data) {
    return {client_id: null, branch_ids: [], permissions: []};
  }
  return data as MyTenantPermissionsBundle;
}

export async function listPermissionsCatalog(): Promise<readonly PermissionCatalogRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('permissions')
    .select('key, module, label_ar, description_ar, default_scope, is_sensitive')
    .order('module')
    .order('key');
  if (error) throw new Error('تعذر تحميل دليل الصلاحيات.');
  return (data ?? []) as PermissionCatalogRecord[];
}

export async function listTenantRoles(tenantId: string): Promise<readonly RoleRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('roles')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('is_system', {ascending: false})
    .order('created_at');
  if (error) throw new Error('تعذر تحميل قائمة الأدوار.');
  return (data ?? []) as RoleRecord[];
}

export async function createCustomRole(
  tenantId: string,
  input: {
    readonly code: string;
    readonly name: string;
    readonly description: string | null;
    readonly default_subject_type: 'staff' | 'client' | 'courier';
    readonly default_scope: PermissionScope;
  },
): Promise<string> {
  const client = requireClient();
  const cleanCode = input.code.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const {data, error} = await client
    .from('roles')
    .insert({
      tenant_id: tenantId,
      code: cleanCode,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      default_subject_type: input.default_subject_type,
      default_scope: input.default_scope,
      is_system: false,
      is_active: true,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error('تعذر إنشاء الدور المخصص. تأكد من عدم تكرار الكود.');
  return data.id as string;
}

export async function listRolePermissions(
  tenantId: string,
  roleId: string,
): Promise<readonly RolePermissionRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('role_permissions')
    .select('id, tenant_id, role_id, permission_key, scope')
    .eq('tenant_id', tenantId)
    .eq('role_id', roleId);
  if (error) throw new Error('تعذر تحميل صلاحيات الدور.');
  return (data ?? []) as RolePermissionRecord[];
}

export async function saveRolePermissions(
  tenantId: string,
  roleId: string,
  grants: readonly {readonly permission_key: string; readonly scope: PermissionScope}[],
): Promise<void> {
  const client = requireClient();

  const {error: delErr} = await client
    .from('role_permissions')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('role_id', roleId);

  if (delErr) throw new Error('تعذر تحديث صلاحيات الدور (ربما الدور محمي من التعديل).');

  if (grants.length > 0) {
    const rows = grants.map((g) => ({
      tenant_id: tenantId,
      role_id: roleId,
      permission_key: g.permission_key,
      scope: g.scope,
    }));
    const {error: insErr} = await client.from('role_permissions').insert(rows);
    if (insErr) throw new Error('تعذر حفظ مصفوفة الصلاحيات.');
  }
}

export async function listTenantUsersDirectory(tenantId: string): Promise<readonly TenantUserDirectoryItem[]> {
  const client = requireClient();
  const {data, error} = await client.rpc('list_tenant_users_directory', {
    p_tenant_id: tenantId,
  });
  if (error) throw new Error('تعذر تحميل دليل المستخدمين.');
  return (data ?? []) as TenantUserDirectoryItem[];
}

export async function createTenantUser(input: {
  readonly tenantId: string;
  readonly username: string;
  readonly displayName: string;
  readonly password: string;
  readonly roleId: string;
  readonly clientId?: string | null;
  readonly courierId?: string | null;
  readonly branchIds?: readonly string[];
}): Promise<string> {
  const client = requireClient();
  const {data, error} = await client.functions.invoke<{
    success?: boolean;
    membership_id?: string;
    error?: string;
  }>('tenant-manage-users', {
    body: {
      action: 'create_user',
      tenant_id: input.tenantId,
      username: input.username.trim().toLowerCase(),
      display_name: input.displayName.trim(),
      password: input.password,
      role_id: input.roleId,
      client_id: input.clientId ?? null,
      courier_id: input.courierId ?? null,
      branch_ids: input.branchIds ?? [],
    },
  });

  if (error || !data?.success || !data.membership_id) {
    throw new Error(data?.error ?? 'تعذر إنشاء المستخدم.');
  }
  return data.membership_id;
}

export async function updateTenantUserAssignment(input: {
  readonly tenantId: string;
  readonly membershipId: string;
  readonly displayName: string;
  readonly roleId: string;
  readonly clientId?: string | null;
  readonly courierId?: string | null;
  readonly branchIds?: readonly string[];
}): Promise<void> {
  const client = requireClient();
  const {data, error} = await client.functions.invoke<{success?: boolean; error?: string}>(
    'tenant-manage-users',
    {
      body: {
        action: 'update_assignment',
        tenant_id: input.tenantId,
        membership_id: input.membershipId,
        display_name: input.displayName.trim(),
        role_id: input.roleId,
        client_id: input.clientId ?? null,
        courier_id: input.courierId ?? null,
        branch_ids: input.branchIds ?? [],
      },
    },
  );

  if (error || !data?.success) {
    throw new Error(data?.error ?? 'تعذر تحديث صلاحيات المستخدم.');
  }
}

export async function toggleTenantUserActive(
  tenantId: string,
  membershipId: string,
  isActive: boolean,
): Promise<void> {
  const client = requireClient();
  const {data, error} = await client.functions.invoke<{success?: boolean; error?: string}>(
    'tenant-manage-users',
    {
      body: {
        action: 'toggle_active',
        tenant_id: tenantId,
        membership_id: membershipId,
        is_active: isActive,
      },
    },
  );
  if (error || !data?.success) {
    throw new Error(data?.error ?? 'تعذر تحديث حالة المستخدم.');
  }
}

export async function resetTenantUserPassword(
  tenantId: string,
  membershipId: string,
  password: string,
): Promise<void> {
  const client = requireClient();
  const {data, error} = await client.functions.invoke<{success?: boolean; error?: string}>(
    'tenant-manage-users',
    {
      body: {
        action: 'reset_password',
        tenant_id: tenantId,
        membership_id: membershipId,
        password,
      },
    },
  );
  if (error || !data?.success) {
    throw new Error(data?.error ?? 'تعذر إعادة تعيين كلمة المرور.');
  }
}

export async function listTenantSessionAudit(
  tenantId: string,
  limit = 50,
): Promise<readonly SessionAuditRecord[]> {
  const client = requireClient();
  const {data, error} = await client.rpc('list_tenant_session_audit', {
    p_tenant_id: tenantId,
    p_limit: limit,
  });
  if (error) throw new Error('تعذر تحميل سجل الدخول والجلسات.');
  return (data ?? []) as SessionAuditRecord[];
}
