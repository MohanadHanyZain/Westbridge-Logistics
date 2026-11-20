import {createContext, useContext} from 'react';
import type {TenantMembershipRecord, TenantRecord} from '@/types/tenant';

export interface TenantWorkspaceContextValue {
  readonly tenant: TenantRecord;
  readonly membership: TenantMembershipRecord;
  readonly isAdmin: boolean;
  readonly branchIds: readonly string[];
  readonly boundClientId: string | null;
  readonly boundCourierId?: string | null;
  readonly can: (permissionKey: string, branchId?: string | null) => boolean;
}

const TenantWorkspaceContext = createContext<TenantWorkspaceContextValue | null>(null);

export const TenantWorkspaceProvider = TenantWorkspaceContext.Provider;

export function useTenantWorkspace(): TenantWorkspaceContextValue {
  const ctx = useContext(TenantWorkspaceContext);
  if (!ctx) {
    throw new Error('useTenantWorkspace must be used inside TenantWorkspaceProvider');
  }
  return ctx;
}
