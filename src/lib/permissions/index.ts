import {PermissionScope, UserRoleKey} from '@/types/common';
import type {EffectivePermissionGrant} from '@/types/security';

export interface PermissionCheckContext {
  readonly role: UserRoleKey | string;
  readonly scope: PermissionScope;
  readonly branchId?: string;
}

export function hasEffectivePermission(
  roleKey: string,
  grants: readonly EffectivePermissionGrant[],
  permissionKey: string,
  branchIds: readonly string[] = [],
  targetBranchId?: string | null,
): boolean {
  if (roleKey === UserRoleKey.COMPANY_OWNER) {
    return true;
  }

  const matched = grants.filter((g) => g.permission_key === permissionKey);
  if (matched.length === 0) {
    return false;
  }

  if (
    !targetBranchId ||
    matched.some((g) => g.scope === PermissionScope.TENANT || g.scope === PermissionScope.OWN)
  ) {
    return true;
  }

  return branchIds.includes(targetBranchId);
}

export const PERMISSION_MODULE_LABELS: Record<string, string> = {
  dashboard: 'لوحة التحكم',
  definitions: 'التعريفات الأساسية',
  clients: 'العملاء',
  pricing: 'التسعير وقوائم الأسعار',
  couriers: 'المناديب وخطوط السير',
  shipments: 'الشحنات',
  operations: 'العمليات اليومية',
  finance: 'العمليات المالية',
  accounting: 'الحسابات العامة',
  security: 'الأمان والمستخدمون',
  integrations: 'التكامل وAPI',
};

export const SCOPE_LABELS: Record<PermissionScope, string> = {
  [PermissionScope.TENANT]: 'كل الشركة',
  [PermissionScope.BRANCH]: 'الفروع المسندة فقط',
  [PermissionScope.OWN]: 'سجلاته فقط',
  [PermissionScope.ASSIGNED]: 'المهام المسندة إليه فقط',
};
