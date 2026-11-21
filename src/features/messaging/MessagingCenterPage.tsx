import {useCallback, useEffect, useState, type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {listClients} from '@/features/clients/clientsService';
import {ConversationThreadPanel} from '@/features/messaging/ConversationThreadPanel';
import {
  getTenantMessagingSettings,
  isSafeAppRoute,
  listConversations,
  listMyNotifications,
  markNotificationsRead,
  openOrGetConversation,
  subscribeToMessagingUpdates,
} from '@/features/messaging/messagingService';
import {listShipments} from '@/features/shipments/shipmentsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {useAuth} from '@/lib/auth';
import {formatDateTime} from '@/lib/formatters';
import {AccountSubjectType} from '@/types/common';
import {
  CONVERSATION_ENTITY_LABELS,
  NOTIFICATION_CATEGORY_LABELS,
  type ConversationEntityType,
  type ConversationRecord,
  type NotificationCategory,
  type NotificationRecord,
} from '@/types/messaging';
import type {ClientRecord} from '@/types/pricing';
import type {ShipmentListItem} from '@/types/shipments';
import {Bell, CheckCheck, ExternalLink, MessageSquare, Plus, Search} from 'lucide-react';

interface MessagingCenterPageProps {
  readonly initialTab?: 'messages' | 'notifications';
}

export function MessagingCenterPage({initialTab = 'messages'}: MessagingCenterPageProps) {
  const {tenant, membership, boundClientId} = useTenantWorkspace();
  const {user} = useAuth();

  const isClientAccount = membership.account_subject_type === AccountSubjectType.CLIENT;
  const isCourierAccount = membership.account_subject_type === AccountSubjectType.COURIER;
  const isStaff = !isClientAccount && !isCourierAccount;

  const [activeTab, setActiveTab] = useState<'messages' | 'notifications'>(initialTab);
  const [maxSizeMb, setMaxSizeMb] = useState(5);

  // Conversations State
  const [conversations, setConversations] = useState<readonly ConversationRecord[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState<ConversationEntityType | ''>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingConvs, setLoadingConvs] = useState(true);

  // New Conversation State
  const [showNewForm, setShowNewForm] = useState(false);
  const [newEntityType, setNewEntityType] = useState<ConversationEntityType>('shipment');
  const [newEntityId, setNewEntityId] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [shipments, setShipments] = useState<readonly ShipmentListItem[]>([]);
  const [clients, setClients] = useState<readonly ClientRecord[]>([]);
  const [creatingConv, setCreatingConv] = useState(false);

  // Notifications State
  const [notifications, setNotifications] = useState<readonly NotificationRecord[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<NotificationCategory | ''>('');
  const [loadingNotifs, setLoadingNotifs] = useState(true);
  const [markingRead, setMarkingRead] = useState(false);
  const [feedback, setFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const loadConversations = useCallback(async () => {
    setLoadingConvs(true);
    try {
      const rows = await listConversations(tenant.id, {
        entityType: entityFilter,
        search: searchQuery,
      });
      setConversations(rows);
      setSelectedConvId((prev) => {
        if (prev && rows.some((r) => r.id === prev)) return prev;
        return rows[0]?.id ?? null;
      });
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر تحميل المحادثات.'});
    } finally {
      setLoadingConvs(false);
    }
  }, [tenant.id, entityFilter, searchQuery]);

  const loadNotifications = useCallback(async () => {
    setLoadingNotifs(true);
    try {
      const rows = await listMyNotifications(tenant.id, {
        unreadOnly,
        category: categoryFilter || undefined,
      });
      setNotifications(rows);
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر تحميل الإشعارات.'});
    } finally {
      setLoadingNotifs(false);
    }
  }, [tenant.id, unreadOnly, categoryFilter]);

  useEffect(() => {
    void getTenantMessagingSettings(tenant.id)
      .then((s) => setMaxSizeMb(s.attachment_max_size_mb))
      .catch(() => undefined);
  }, [tenant.id]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    return subscribeToMessagingUpdates(tenant.id, user?.id, {
      onMessageInserted: () => {
        void loadConversations();
      },
      onNotificationChanged: () => {
        void loadNotifications();
      },
    });
  }, [tenant.id, user?.id, loadConversations, loadNotifications]);

  useEffect(() => {
    if (!showNewForm) return;
    void listShipments(tenant.id, {limit: 50})
      .then((rows) => {
        setShipments(rows);
        if (newEntityType === 'shipment' && !newEntityId && rows[0]) {
          setNewEntityId(rows[0].id);
        }
      })
      .catch(() => undefined);

    if (isStaff) {
      void listClients(tenant.id)
        .then((rows) => setClients(rows))
        .catch(() => undefined);
    }
  }, [showNewForm, tenant.id, isStaff, newEntityType, newEntityId]);

  const handleOpenNewConversation = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setCreatingConv(true);
    try {
      const resolvedEntityId =
        newEntityType === 'general'
          ? null
          : newEntityType === 'client' && isClientAccount
            ? boundClientId
            : newEntityId || null;

      if (newEntityType !== 'general' && !resolvedEntityId) {
        setFeedback({type: 'error', text: 'يرجى تحديد السجل المرتبط قبل بدء المحادثة.'});
        setCreatingConv(false);
        return;
      }

      const convId = await openOrGetConversation(
        tenant.id,
        newEntityType,
        resolvedEntityId,
        newSubject.trim() || null,
      );
      setShowNewForm(false);
      setNewSubject('');
      await loadConversations();
      setSelectedConvId(convId);
      setActiveTab('messages');
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر فتح المحادثة.'});
    } finally {
      setCreatingConv(false);
    }
  };

  const handleMarkAllRead = async () => {
    setMarkingRead(true);
    try {
      await markNotificationsRead(tenant.id, null);
      await loadNotifications();
      setFeedback({type: 'success', text: 'تم تحديد جميع الإشعارات كمقروءة.'});
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر تحديث حالة الإشعارات.'});
    } finally {
      setMarkingRead(false);
    }
  };

  const handleMarkSingleRead = async (notifId: string) => {
    try {
      await markNotificationsRead(tenant.id, [notifId]);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notifId ? {...n, is_read: true} : n)),
      );
    } catch {
      // Ignore transient errors
    }
  };

  const selectedConv = conversations.find((c) => c.id === selectedConvId) ?? null;
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">مركز الرسائل والإشعارات</h1>
          <p className="mt-1 text-sm text-slate-600">
            محادثات الشحنات والتجار، مشاركة المرفقات المؤمنة، وتنبيهات الأحداث الفورية.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('messages')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 ${
              activeTab === 'messages'
                ? 'bg-slate-900 text-white'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span>المحادثات ({conversations.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('notifications')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 ${
              activeTab === 'notifications'
                ? 'bg-slate-900 text-white'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Bell className="h-3.5 w-3.5" />
            <span>الإشعارات {unreadCount > 0 ? `· ${unreadCount} غير مقروء` : ''}</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-xl border px-4 py-3 text-xs font-medium ${
            feedback.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {activeTab === 'messages' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px]">
                <Search className="pointer-events-none absolute top-2.5 right-3 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="بحث في عنوان أو آخر رسالة..."
                  aria-label="بحث في المحادثات"
                  className="w-full rounded-lg border border-slate-200 py-1.5 pr-8 pl-3 text-xs"
                />
              </div>

              <select
                value={entityFilter}
                onChange={(e) => setEntityFilter(e.target.value as ConversationEntityType | '')}
                aria-label="تصفية حسب نوع المحادثة"
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
              >
                <option value="">كل المحادثات</option>
                <option value="shipment">محادثات الشحنات</option>
                <option value="client">محادثات التجار</option>
                <option value="pickup_request">طلبات الالتقاط</option>
                {isStaff && <option value="general">تواصل داخلي للفريق</option>}
              </select>
            </div>

            <button
              type="button"
              onClick={() => setShowNewForm((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>محادثة جديدة</span>
            </button>
          </div>

          {showNewForm && (
            <form
              onSubmit={handleOpenNewConversation}
              className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4"
            >
              <div>
                <label htmlFor="new-conv-type" className="block text-xs font-medium text-slate-700">
                  نوع المحادثة
                </label>
                <select
                  id="new-conv-type"
                  value={newEntityType}
                  onChange={(e) => {
                    const next = e.target.value as ConversationEntityType;
                    setNewEntityType(next);
                    setNewEntityId('');
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                >
                  <option value="shipment">حول شحنة محددة</option>
                  {!isCourierAccount && <option value="client">تواصل مع حساب التاجر</option>}
                  {isStaff && <option value="general">محادثة فريق داخلية عامة</option>}
                </select>
              </div>

              {newEntityType === 'shipment' && (
                <div>
                  <label htmlFor="new-conv-entity" className="block text-xs font-medium text-slate-700">
                    اختر الشحنة
                  </label>
                  <select
                    id="new-conv-entity"
                    value={newEntityId}
                    onChange={(e) => setNewEntityId(e.target.value)}
                    required
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                  >
                    <option value="">اختر شحنة...</option>
                    {shipments.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.shipment_number} · {s.recipient_name ?? s.client_name ?? ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {newEntityType === 'client' && isStaff && (
                <div>
                  <label htmlFor="new-conv-client" className="block text-xs font-medium text-slate-700">
                    اختر التاجر
                  </label>
                  <select
                    id="new-conv-client"
                    value={newEntityId}
                    onChange={(e) => setNewEntityId(e.target.value)}
                    required
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                  >
                    <option value="">اختر التاجر...</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className={newEntityType === 'general' ? 'sm:col-span-2' : ''}>
                <label htmlFor="new-conv-subject" className="block text-xs font-medium text-slate-700">
                  موضوع المحادثة (اختياري)
                </label>
                <input
                  id="new-conv-subject"
                  type="text"
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="مثال: استفسار عن موعد التسليم"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>

              <div className="flex items-end gap-2">
                <button
                  type="submit"
                  disabled={creatingConv}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
                >
                  {creatingConv ? 'جاري الفتح...' : 'فتح المحادثة'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewForm(false)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
                >
                  إلغاء
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Conversations Sidebar List */}
            <div className="lg:col-span-4">
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {loadingConvs ? (
                  <p className="p-6 text-center text-xs text-slate-500">جاري تحميل المحادثات...</p>
                ) : conversations.length === 0 ? (
                  <p className="p-6 text-center text-xs text-slate-500">
                    لا توجد محادثات مطابقة حاليًا.
                  </p>
                ) : (
                  conversations.map((conv) => {
                    const active = conv.id === selectedConvId;
                    return (
                      <button
                        key={conv.id}
                        type="button"
                        onClick={() => setSelectedConvId(conv.id)}
                        className={`block w-full p-3.5 text-right transition-colors ${
                          active ? 'bg-slate-900 text-white' : 'hover:bg-slate-50 text-slate-900'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate font-semibold">{conv.subject}</span>
                          <span
                            className={`font-mono-tabular text-[10px] shrink-0 ${
                              active ? 'text-slate-300' : 'text-slate-400'
                            }`}
                          >
                            {CONVERSATION_ENTITY_LABELS[conv.entity_type]}
                          </span>
                        </div>
                        <p
                          className={`mt-1 truncate text-[11px] ${
                            active ? 'text-slate-200' : 'text-slate-500'
                          }`}
                        >
                          {conv.last_message_preview ?? 'لا توجد رسائل بعد'}
                        </p>
                        <p
                          className={`mt-1 font-mono-tabular text-[10px] ${
                            active ? 'text-slate-300' : 'text-slate-400'
                          }`}
                        >
                          {formatDateTime(conv.last_message_at)}
                        </p>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Active Conversation Thread */}
            <div className="lg:col-span-8">
              {selectedConv ? (
                <ConversationThreadPanel
                  key={selectedConv.id}
                  tenantId={tenant.id}
                  conversationId={selectedConv.id}
                  entityType={selectedConv.entity_type}
                  entityId={selectedConv.entity_id}
                  defaultSubject={selectedConv.subject}
                  maxAttachmentSizeMb={maxSizeMb}
                  onMessageSent={() => void loadConversations()}
                />
              ) : (
                <div className="flex min-h-[280px] items-center justify-center rounded-xl border border-slate-200 bg-white p-8 text-xs text-slate-500">
                  اختر محادثة من القائمة الجانبية أو ابدأ محادثة جديدة لعرض الرسائل والمرفقات.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'notifications' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="inline-flex items-center gap-2 font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={(e) => setUnreadOnly(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span>غير المقروءة فقط</span>
              </label>

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as NotificationCategory | '')}
                aria-label="تصفية الإشعارات حسب الفئة"
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
              >
                <option value="">كل الفئات</option>
                {Object.entries(NOTIFICATION_CATEGORY_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              disabled={markingRead || unreadCount === 0}
              onClick={() => void handleMarkAllRead()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              <span>تحديد الكل كمقروء</span>
            </button>
          </div>

          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {loadingNotifs ? (
              <p className="p-8 text-center text-xs text-slate-500">جاري تحميل الإشعارات...</p>
            ) : notifications.length === 0 ? (
              <p className="p-8 text-center text-xs text-slate-500">
                لا توجد إشعارات مطابقة في الوقت الحالي.
              </p>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`flex flex-wrap items-start justify-between gap-4 p-4 text-xs ${
                    n.is_read ? 'bg-white' : 'bg-sky-50/50'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">{n.title}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-500">
                        {NOTIFICATION_CATEGORY_LABELS[n.category]}
                      </span>
                      {!n.is_read && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-sky-700">جديد</span>
                        </>
                      )}
                    </div>
                    <p className="text-slate-700">{n.body}</p>
                    <p className="font-mono-tabular text-[11px] text-slate-400">
                      {formatDateTime(n.created_at)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {!n.is_read && (
                      <button
                        type="button"
                        onClick={() => void handleMarkSingleRead(n.id)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                      >
                        تحديد كمقروء
                      </button>
                    )}
                    {isSafeAppRoute(n.action_path) && (
                      <Link
                        to={n.action_path}
                        onClick={() => {
                          if (!n.is_read) {
                            void handleMarkSingleRead(n.id);
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-slate-800 whitespace-nowrap"
                      >
                        <ExternalLink className="h-3 w-3" />
                        فتح التفاصيل
                      </Link>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}