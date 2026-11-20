import {getSupabaseClient} from '@/lib/supabase/client';
import type {JournalEntryRecord, TrialBalanceRow} from '@/types/accounting';

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }
  return client;
}

export async function listJournalEntries(tenantId: string): Promise<readonly JournalEntryRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('journal_entries')
    .select(
      'id, tenant_id, entry_code, entry_date, journal_id, entry_type_id, branch_id, reference_type, reference_id, reference_code, description, total_debit, total_credit, status, notes, approved_at, approved_by, created_at, created_by',
    )
    .eq('tenant_id', tenantId)
    .order('created_at', {ascending: false})
    .limit(150);

  if (error) throw new Error('تعذر تحميل قيود اليومية العامة.');
  return (data ?? []) as JournalEntryRecord[];
}

export async function createManualJournalEntry(
  tenantId: string,
  payload: {
    readonly branch_id: string;
    readonly journal_id?: string;
    readonly entry_type_id?: string;
    readonly entry_date?: string;
    readonly description: string;
    readonly notes?: string;
    readonly lines: readonly {
      readonly account_id: string;
      readonly branch_id?: string;
      readonly debit: number;
      readonly credit: number;
      readonly description?: string;
    }[];
  },
): Promise<{readonly id: string; readonly entry_code: string; readonly total_amount: number}> {
  const client = requireClient();
  const {data, error} = await client.rpc('create_manual_journal_entry', {
    p_tenant_id: tenantId,
    p_payload: payload,
  });
  if (error) throw new Error(error.message || 'تعذر إنشاء قيد اليومية اليدوي.');
  return data as {id: string; entry_code: string; total_amount: number};
}

export async function approveJournalEntry(tenantId: string, entryId: string): Promise<void> {
  const client = requireClient();
  const {error} = await client.rpc('approve_journal_entry', {
    p_tenant_id: tenantId,
    p_entry_id: entryId,
  });
  if (error) throw new Error(error.message || 'تعذر اعتماد قيد اليومية.');
}

export async function getTrialBalance(
  tenantId: string,
  branchId?: string | null,
): Promise<readonly TrialBalanceRow[]> {
  const client = requireClient();
  const {data, error} = await client.rpc('get_trial_balance', {
    p_tenant_id: tenantId,
    p_branch_id: branchId ?? null,
  });
  if (error) throw new Error(error.message || 'تعذر حساب ميزان المراجعة.');
  return (Array.isArray(data) ? data : []) as TrialBalanceRow[];
}
