/**
 * Core shared domain types for Phase 0 foundation.
 * No business tables or unapproved financial rules are implemented here.
 */

export type TenantId = string;
export type BranchId = string;
export type UserId = string;
export type TimestampUtc = string;

/** Numeric amounts should use decimal/string precision from PostgreSQL numeric; never float math on ledger. */
export type MoneyAmount = number;

export enum AccountSubjectType {
  STAFF = 'staff',
  CLIENT = 'client',
  COURIER = 'courier',
  PLATFORM_SUPPORT = 'platform_support',
}

export enum UserRoleKey {
  PLATFORM_SUPER_ADMIN = 'platform_super_admin',
  PLATFORM_SUPPORT = 'platform_support',
  COMPANY_OWNER = 'company_owner',
  COMPANY_ADMIN = 'company_admin',
  BRANCH_MANAGER = 'branch_manager',
  ACCOUNTANT = 'accountant',
  CASHIER = 'cashier',
  OPERATIONS_MANAGER = 'operations_manager',
  DATA_ENTRY = 'data_entry',
  CUSTOMER_SUPPORT = 'customer_support',
  WAREHOUSE_OPERATOR = 'warehouse_operator',
  DELIVERY_AGENT = 'delivery_agent',
  CLIENT_OWNER = 'client_owner',
  CLIENT_STAFF = 'client_staff',
}

export enum PermissionScope {
  TENANT = 'tenant',
  BRANCH = 'branch',
  OWN = 'own',
  ASSIGNED = 'assigned',
}

export enum PhaseStatus {
  IN_PROGRESS = 'in_progress',
  READY_FOR_OWNER_REVIEW = 'ready_for_owner_review',
  APPROVED = 'approved',
  PENDING = 'pending',
  BLOCKED_BY_OPEN_QUESTION = 'blocked_by_open_question',
}

export interface RoadmapPhase {
  readonly phaseNumber: number;
  readonly title: string;
  readonly summary: string;
  readonly status: PhaseStatus;
  readonly hasOpenDecisions: boolean;
}

export interface OpenDecisionItem {
  readonly id: string;
  readonly title: string;
  readonly blockingPhase: string;
  readonly summary: string;
}
