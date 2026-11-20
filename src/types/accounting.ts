import type {FinanceDocumentStatus} from '@/types/finance';

export interface JournalEntryLineRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly entry_id: string;
  readonly account_id: string;
  readonly branch_id: string | null;
  readonly debit: number;
  readonly credit: number;
  readonly description: string | null;
  readonly created_at: string;
}

export interface JournalEntryRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly entry_code: string;
  readonly entry_date: string;
  readonly journal_id: string | null;
  readonly entry_type_id: string | null;
  readonly branch_id: string | null;
  readonly reference_type: string | null;
  readonly reference_id: string | null;
  readonly reference_code: string | null;
  readonly description: string;
  readonly total_debit: number;
  readonly total_credit: number;
  readonly status: FinanceDocumentStatus;
  readonly notes: string | null;
  readonly approved_at: string | null;
  readonly approved_by: string | null;
  readonly created_at: string;
  readonly created_by: string | null;
  readonly lines?: readonly JournalEntryLineRecord[];
}

export interface TrialBalanceRow {
  readonly account_id: string;
  readonly account_code: string;
  readonly account_name: string;
  readonly account_type: string;
  readonly is_group: boolean;
  readonly total_debit: number;
  readonly total_credit: number;
  readonly net_balance: number;
}
