import {useCallback, useEffect, useState, type FormEvent} from 'react';
import {AttachmentPreviewList, AttachmentUploader} from '@/components/ui/AttachmentUploader';
import {
  listConversationMessages,
  markConversationRead,
  openOrGetConversation,
  sendConversationMessage,
  subscribeToMessagingUpdates,
} from '@/features/messaging/messagingService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {useAuth} from '@/lib/auth';
import {formatDateTime} from '@/lib/formatters';
import {AccountSubjectType} from '@/types/common';
import type {
  AttachmentDraftPayload,
  ConversationEntityType,
  MessageRecord,
  MessageVisibility,
} from '@/types/messaging';
import {Lock, MessageSquare, Send, X} from 'lucide-react';

interface ConversationThreadPanelProps {
  readonly tenantId: string;
  readonly conversationId?: string | null;
  readonly entityType?: ConversationEntityType;
  readonly entityId?: string | null;
  readonly defaultSubject?: string;
  readonly maxAttachmentSizeMb?: number;
  readonly onMessageSent?: () => void;
}

function createDraftKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ConversationThreadPanel({
  tenantId,
  conversationId: propConversationId,
  entityType = 'shipment',
  entityId = null,
  defaultSubject,
  maxAttachmentSizeMb = 5,
  onMessageSent,
}: ConversationThreadPanelProps) {
  const {membership, can} = useTenantWorkspace();
  const {user} = useAuth();

  const isStaffMember =
    membership.account_subject_type === AccountSubjectType.STAFF ||
    membership.account_subject_type === AccountSubjectType.PLATFORM_SUPPORT;
  const canSendInternal = isStaffMember && can('messaging.internal');
  const canSendMessage = can('messaging.send') || isStaffMember || membership.account_subject_type === AccountSubjectType.CLIENT || membership.account_subject_type === AccountSubjectType.COURIER;

  const [resolvedConvId, setResolvedConvId] = useState<string | null>(propConversationId ?? null);
  const [messages, setMessages] = useState<readonly MessageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<MessageVisibility>('external');
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentDraftPayload[]>([]);
  const [draftIdempotencyKey, setDraftIdempotencyKey] = useState<string>(() => createDraftKey());
  const [sending, setSending] = useState(false);

  const ensureAndLoad = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let targetConvId = propConversationId ?? null;
      if (!targetConvId && (entityType === 'general' || entityId)) {
        targetConvId = await openOrGetConversation(
          tenantId,
          entityType,
          entityId,
          defaultSubject ?? null,
        );
      }
      setResolvedConvId(targetConvId);

      if (!targetConvId) {
        setMessages([]);
        return;
      }

      const rows = await listConversationMessages(tenantId, targetConvId);
      setMessages(rows);
      await markConversationRead(tenantId, targetConvId).catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل رسائل المحادثة.');
    } finally {
      setLoading(false);
    }
  }, [tenantId, propConversationId, entityType, entityId, defaultSubject]);

  useEffect(() => {
    void ensureAndLoad();
  }, [ensureAndLoad]);

  useEffect(() => {
    if (!resolvedConvId) return;
    return subscribeToMessagingUpdates(tenantId, user?.id, {
      onMessageInserted: (changedConvId) => {
        if (changedConvId === resolvedConvId) {
          void listConversationMessages(tenantId, resolvedConvId)
            .then((rows) => {
              setMessages(rows);
              return markConversationRead(tenantId, resolvedConvId).catch(() => undefined);
            })
            .catch(() => undefined);
        }
      },
    });
  }, [tenantId, user?.id, resolvedConvId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!resolvedConvId || sending) return;
    if (!body.trim() && pendingAttachments.length === 0) return;

    setError(null);
    setSending(true);
    try {
      await sendConversationMessage(
        tenantId,
        resolvedConvId,
        body.trim(),
        canSendInternal ? visibility : 'external',
        draftIdempotencyKey,
        pendingAttachments,
      );
      setBody('');
      setPendingAttachments([]);
      setDraftIdempotencyKey(createDraftKey());
      const rows = await listConversationMessages(tenantId, resolvedConvId);
      setMessages(rows);
      onMessageSent?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إرسال الرسالة.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-slate-600" />
          <h3 className="text-sm font-semibold text-slate-900">
            {defaultSubject ?? 'سجل المحادثة والتواصل'}
          </h3>
        </div>
        <span className="font-mono-tabular text-[11px] text-slate-500">
          {messages.length} رسالة
        </span>
      </div>

      {error && (
        <div role="alert" className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Messages Timeline */}
      <div className="max-h-[420px] min-h-[220px] space-y-3 overflow-y-auto p-4">
        {loading ? (
          <p className="py-10 text-center text-xs text-slate-500">جاري تحميل المحادثة...</p>
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-500">
            لا توجد رسائل حتى الآن. ابدأ المحادثة من النموذج أدناه.
          </p>
        ) : (
          messages.map((msg) => {
            const isMine = msg.sender_user_id === user?.id;
            const isInternal = msg.visibility === 'internal';
            return (
              <div
                key={msg.id}
                className={`rounded-xl border p-3.5 text-xs ${
                  isInternal
                    ? 'border-amber-200 bg-amber-50/70'
                    : isMine
                      ? 'border-slate-300 bg-slate-50'
                      : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">{msg.sender_display_name}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {msg.sender_subject_type === 'client'
                        ? 'حساب التاجر'
                        : msg.sender_subject_type === 'courier'
                          ? 'المندوب'
                          : 'فريق الشركة'}
                    </span>
                    {isInternal && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 font-semibold text-amber-800">
                          <Lock className="h-3 w-3" />
                          رسالة داخلية للفريق
                        </span>
                      </>
                    )}
                  </div>
                  <span className="font-mono-tabular">{formatDateTime(msg.created_at)}</span>
                </div>

                {msg.body && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{msg.body}</p>}

                {msg.attachments.length > 0 && (
                  <div className="mt-3">
                    <AttachmentPreviewList
                      items={msg.attachments.map((att) => ({
                        id: att.id,
                        storageObject: att,
                      }))}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Composer */}
      {canSendMessage && resolvedConvId && (
        <form onSubmit={handleSubmit} className="space-y-3 border-t border-slate-200 bg-slate-50/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {canSendInternal ? (
              <div className="flex items-center gap-2 text-xs">
                <label htmlFor={`msg-vis-${resolvedConvId}`} className="font-medium text-slate-700">
                  نطاق الرؤية:
                </label>
                <select
                  id={`msg-vis-${resolvedConvId}`}
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as MessageVisibility)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="external">تواصل عام (مرئي للتاجر والمندوب والفريق)</option>
                  <option value="internal">داخلي للفريق فقط (مخفي عن التاجر والمندوب)</option>
                </select>
              </div>
            ) : (
              <span className="text-[11px] text-slate-500">
                الرسائل والمرفقات مرئية لفريق الدعم والعمليات بالشركة.
              </span>
            )}

            <AttachmentUploader
              tenantId={tenantId}
              bucketId="message-attachments"
              entityType="message"
              entityId={resolvedConvId}
              maxSizeMb={maxAttachmentSizeMb}
              label="إرفاق ملف"
              disabled={sending}
              onUploaded={(draft) => {
                setPendingAttachments((prev) => [...prev, draft]);
              }}
            />
          </div>

          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pendingAttachments.map((att, idx) => (
                <div
                  key={`${att.object_path}-${idx}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700"
                >
                  <span className="max-w-[200px] truncate">{att.file_name}</span>
                  <button
                    type="button"
                    aria-label={`إزالة ${att.file_name}`}
                    onClick={() =>
                      setPendingAttachments((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="text-slate-400 hover:text-red-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <textarea
              rows={2}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="اكتب رسالتك هنا..."
              aria-label="نص الرسالة"
              className="min-w-[220px] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-slate-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={sending || (!body.trim() && pendingAttachments.length === 0)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Send className="h-3.5 w-3.5" />
              <span>{sending ? 'جاري الإرسال...' : 'إرسال الرسالة'}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}