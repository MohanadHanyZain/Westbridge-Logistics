سجل التغييرات (CHANGELOG)
[المرحلة 17] - 2026-11-22
المضاف
اعتماد القرار ADR-025 (سياسة النسخ الاحتياطي والاستعادة RPO <= 15m / RTO <= 60m DB و<= 120m Storage، اختبارات الاستعادة الدورية في بيئة معزولة، فهارس الأداء المركبة، وبوابة التحقق الأمني قبل الإطلاق).
إنشاء Migration supabase/migrations/0018_phase17_backup_performance_security_launch.sql:
إضافة فهارس أداء مركبة على جداول shipments, shipment_status_events, journal_entries, notifications, وaudit.audit_logs.
إنشاء جدولي public.backup_policies وpublic.backup_restore_drills المحميين بـ FORCE ROW LEVEL SECURITY ومقيدين بمسؤولي المنصة المركزية مع سجل تدقيق في audit.audit_logs.
دوال خادمية ذرية: get_launch_readiness_overview (تُجري تدقيقًا حيًا على كتالوج PostgreSQL للتحقق من تغطية FORCE RLS وحجب token_hash وغياب أعمدة كلمات المرور وعدد الفهارس)، update_backup_policy, وrecord_backup_restore_drill.
إنشاء اختبار العزل والتدقيق الأمني النهائي supabase/tests/rls/phase17_final_security_rls_audit.sql.
إضافة وثائق المرجع النهائية docs/architecture/SECURITY_MODEL.md وdocs/architecture/BACKUP_RESTORE_LAUNCH_RUNBOOK.md وتحديث SYSTEM_OVERVIEW.md.
إضافة وحدة وتبويب النسخ الاحتياطي والأمان والإطلاق (LaunchReadinessPanel + launchService.ts) داخل لوحة المنصة المركزية (PlatformTenantsPage) مع اختبارات src/tests/phase17.test.tsx.
[المرحلة 16] - 2026-11-22
المضاف
اعتماد القرار ADR-024 (رموز API المجزأة بـ SHA-256 مع عرض السر مرة واحدة وتقييد الباقة والنطاق، ونقاط Webhooks العامة بتوقيع HMAC-SHA256 وحماية العناوين الداخلية، وبوابة REST الخارجية public-api-v1).
إنشاء Migration supabase/migrations/0017_phase16_api_tokens_webhooks.sql:
إضافة صلاحيات api_tokens.read, api_tokens.revoke, وwebhooks.manage وتحديث الصلاحيات الافتراضية للمالك والأدمن وصاحب حساب التاجر.
جداول api_tokens, webhook_endpoints, webhook_deliveries, api_request_logs, والجدول المعزول app_private.webhook_secrets المحمية بـ FORCE ROW LEVEL SECURITY والقيود المركبة.
مشغل trg_shipment_status_event_webhook لجدولة إشعارات shipment.created وshipment.status_changed تلقائيًا في طابور webhook_deliveries مع التحقق من عناوين HTTPS العامة.
دوال خادمية ذرية: get_integrations_overview, create_api_token, revoke_api_token, upsert_webhook_endpoint, rotate_webhook_secret, delete_webhook_endpoint, trigger_test_webhook_event, ودوال التكامل الخادمية المحمية لـ service_role: srv_authenticate_api_token, srv_api_create_shipment, srv_record_api_request_log, srv_claim_pending_webhook_deliveries, وsrv_complete_webhook_delivery.
إنشاء اختبار العزل والتحقق supabase/tests/rls/phase16_api_tokens_webhooks_isolation.sql.
إنشاء دالة Edge Function supabase/functions/public-api-v1/index.ts لإنشاء واستعراض الشحنات والتتبع وإرسال Webhooks الموقعة.
إضافة شاشة رموز API والتكاملات وWebhooks (ApiIntegrationsPage) لإدارة الشركة وبوابة التاجر مع اختبارات src/tests/phase16.test.tsx.
[المرحلة 15] - 2026-11-22
المضاف
اعتماد القرار ADR-023 (باقات الاشتراكات وحدود السعة الخادمية، النطاقات الفرعية والمخصصة بتوثيق DNS TXT، وجلسات دخول الدعم الفني المؤقتة والمسببة والمراقبة).
إنشاء Migration supabase/migrations/0016_phase15_platform_subscriptions_domains.sql:
جداول subscription_plans (مع البذر القياسي لباقات STARTER, GROWTH, ENTERPRISE), tenant_subscriptions, وtenant_domains المحمية بـ FORCE ROW LEVEL SECURITY ومفاتيح التفرد.
توسيع جدول platform_support_access لدعم أنماط الدخول (read_only, diagnostic_assist) وتوقيت آخر دخول last_entered_at.
التزويد التلقائي لكل شركة جديدة بباقة STARTER تجريبية ونطاق فرعي رئيسي موثق ({slug}.shipflow.app) عبر المشغّل trg_tenants_phase15_defaults.
فرض حدود السعة خادميًا عبر app_private.assert_tenant_quota ومشغلات BEFORE INSERT على الفروع والعضويات والمناديب وشحنات الشهر.
دوال خادمية ذرية: list_subscription_plans, upsert_subscription_plan, assign_tenant_subscription, list_platform_tenants_directory, get_tenant_subscription_overview, list_tenant_domains, upsert_tenant_domain, verify_tenant_domain, delete_tenant_domain, resolve_tenant_by_domain, request_platform_support_access, revoke_platform_support_access, list_platform_support_sessions, وget_platform_tenant_support_snapshot.
إنشاء اختبار العزل والتحقق supabase/tests/rls/phase15_platform_subscriptions_isolation.sql.
ترقية لوحة المنصة المركزية (PlatformTenantsPage) لتشمل تبويبات الشركات والاشتراكات، الباقات والحدود، النطاقات المخصصة والفرعية، ودخول الدعم المسبب مع لوحة التشخيص المقيدة، وعرض تفاصيل الباقة والحدود والنطاقات وسجل زيارات الدعم لإدارة الشركة في TenantSettingsPage مع اختبارات src/tests/phase15.test.tsx.
[المرحلة 14] - 2026-11-21
المضاف
اعتماد القرار ADR-022 (تتبع مواقع المندوبين الميداني أثناء المهام النشطة فقط بموافقة المندوب مع حفظ الدقة والمصدر، احتفاظ افتراضي 90 يومًا، وتكامل mapbox-gl بترتيب الإحداثيات [lng, lat] عبر VITE_MAPBOX_ACCESS_TOKEN).
إنشاء Migration supabase/migrations/0015_phase14_maps_courier_locations.sql:
إضافة صلاحيتي couriers.locations_read وcouriers.locations_record وتوسيع tenant_settings بحقول location_retention_days, gps_ping_interval_seconds, وrequire_gps_on_delivery مع حقول الإحداثيات الاختيارية على الفروع والشحنات.
إنشاء جدولي courier_devices وcourier_location_events المحميين بـ FORCE ROW LEVEL SECURITY ومفاتيح أجنبية مركبة وعزل تام للمندوب ومنع التجار من الاطلاع على المسارات.
دوال خادمية ذرية: record_courier_location_event, get_live_couriers_positions, list_courier_movements_timeline, get_tenant_maps_settings, وupdate_tenant_maps_settings.
إنشاء اختبار العزل والتحقق supabase/tests/rls/phase14_maps_locations_isolation.sql.
تطوير لوحة خريطة تحركات المندوبين والمراقبة الحية (CourierMovementsPage + CourierMapCanvas)، إضافة التتبع الميداني ورفع الموقع الفوري (GPS) وإرفاق الإحداثيات الاختياري في بوابة المندوب (CourierPortalPage) وDeliveryExecutionModal، وإضافة إعدادات سياسة المواقع في TenantSettingsPage مع اختبارات src/tests/phase14.test.tsx.
[المرحلة 13] - 2026-11-21
المضاف
اعتماد القرار ADR-021 (قوالب الاستيراد ذات الإصدار SHIPMENTS_V1 مع فحص dry_run خادمي، تعقيم التصدير ضد حقن الصيغ CSV Formula Injection، و6 نماذج طباعة للبوالص والملصقات).
إنشاء Migration supabase/migrations/0014_phase13_import_export_reports_print.sql:
جداول import_templates, import_jobs, import_job_rows, وexport_jobs المحمية بـ FORCE ROW LEVEL SECURITY ومفاتيح أجنبية مركبة ومنع تكرار الدفعات عبر batch_idempotency_key.
دوال خادمية ذرية: get_shipment_import_templates, run_shipment_import_batch (فحص واعتماد ذري via create_shipment), list_import_jobs, get_import_job_detail, record_export_job, وget_executive_operations_report.
إنشاء ملف القالب المرجعي supabase/templates/import/shipments_import_template_v1.csv واختبار العزل supabase/tests/rls/phase13_import_export_reports_isolation.sql.
إضافة شاشات ومكونات المرحلة الثالثة عشرة: استيراد الشحنات من Excel/CSV (ShipmentsImportPage), مركز التقارير التنفيذية والتحليلات (ExecutiveReportsPage), نافذة طباعة البوالص والملصقات متعددة النماذج (WaybillPrintModal)، وأدوات التصدير الآمن (exportUtils.ts)، مع الدمج في ShipmentsListPage وTenantOverviewPage وTenantAdminShellPage واختبارات src/tests/phase13.test.tsx.
[المرحلة 12] - 2026-11-21
المضاف
اعتماد القرار ADR-020 (حاويات التخزين الخاصة والروابط الموقعة قصيرة العمر 300s، حد المرفقات الافتراضي 5MB للأنواع الآمنة، احتفاظ 365 يومًا، وإشعارات فورية مع طابور تسليم).
إنشاء Migration supabase/migrations/0013_phase12_messaging_attachments_notifications.sql:
جداول conversations, conversation_participants, messages (غير قابلة للتعديل مع منع التكرار عبر idempotency_key), storage_objects_metadata, message_attachments, shipment_attachments, notifications, وnotification_deliveries المحمية بـ FORCE ROW LEVEL SECURITY.
إعداد حاويات Supabase Storage الخاصة (shipment-attachments, message-attachments, delivery-proof) مع سياسات عزل صارمة حسب tenant_id.
دوال خادمية ذرية: open_or_get_conversation, send_conversation_message, mark_conversation_read, register_shipment_attachment, delete_shipment_attachment, mark_notifications_read, get_tenant_messaging_settings, وupdate_tenant_messaging_settings.
مشغّل إشعارات تلقائي عند تغير حالة الشحنة (trg_shipment_status_event_notify) لإخطار التاجر والمندوب فورًا.
إنشاء اختبار العزل والتحقق supabase/tests/rls/phase12_messaging_attachments_isolation.sql.
إضافة شاشات ومكونات المرحلة الثانية عشرة: مركز الرسائل والإشعارات (MessagingCenterPage), لوحة محادثة الشحنة (ConversationThreadPanel), رافع المرفقات الخاصة (AttachmentUploader), إعدادات الرسائل والاحتفاظ والتنبيهات (TenantSettingsPage)، مع دمج تبويبي المستندات والرسائل في ShipmentDetailPage والتواصل وإرفاق الصور في CourierPortalPage وجرس الإشعارات الحي في TenantAdminShellPage، واختبارات src/tests/phase12.test.tsx.
[المرحلة 11] - 2026-11-20
المضاف
إنشاء Migration supabase/migrations/0012_phase11_client_portal_public_storefront.sql:
معالجة فحص الصلاحية app_private.user_has_permission لحسابات العملاء ذات النطاق own عند تمرير فرع المنشأ في create_shipment.
تشديد سياسات القراءة RLS على جداول clients وclient_addresses وclient_contacts وclient_contract_terms وprice_exemptions وshipment_price_snapshots وjournal_entries لعزل حساب العميل المرتبط تمامًا عن باقي التجار.
توسيع tenant_settings ببيانات الموقع العام (public_tagline, public_support_phone, public_support_email).
جدول طلبات الالتقاط client_pickup_requests (REQ-XXXXXX) المحمي بـ FORCE ROW LEVEL SECURITY ومفاتيح أجنبية مركبة.
دوال الموقع العام والتسجيل الذاتي لـ anon: get_public_tenant_storefront وsubmit_client_registration_request (مع دعم الاعتماد التلقائي auto_approve_clients) وإعدادات الإدارة get_tenant_registration_settings / update_tenant_registration_settings.
دوال بوابة التاجر الذاتية: save_my_client_address وdelete_my_client_address وcreate_client_pickup_request وcancel_client_pickup_request وupdate_pickup_request_status وget_client_portal_summary وget_client_account_statement.
إنشاء اختبار العزل والتحقق supabase/tests/rls/phase11_client_portal_isolation.sql.
ترقية الموقع العام للشركة (TenantPublicPage) بعرض الخدمات والتغطية الجغرافية ونموذج التسجيل الذاتي التفاعلي، وإضافة لوحة إعدادات الموقع العام والاعتماد التلقائي في ClientsListPage.
إطلاق بوابة العميل / التاجر (ClientPortalDashboardPage, ClientPortalPickupPage, ClientPortalFinancePage) وتوجيه حسابات client تلقائيًا إليها مع قائمة جانبية مخصصة وإضافات العناوين المحفوظة وبوليصة الطباعة وعرض طلبات الالتقاط الواردة في PickupListsPage، مع اختبارات src/tests/phase11.test.tsx.
[المرحلة 10] - 2026-11-20
المضاف
اعتماد القرار ADR-019 (الأساس المحاسبي النقدي Cash Basis للاعتراف بالإيرادات والمصروفات عند التحصيل والسداد الفعلي بالخزائن، مع إقفال دوري للفترات).
إنشاء Migration supabase/migrations/0011_phase10_general_ledger_journal_entries.sql:
جدول قيود اليومية العامة journal_entries وبنودها journal_entry_lines مع FORCE ROW LEVEL SECURITY والتحقق الذري من توازن القيد (SUM(debit) = SUM(credit)).
تسلسل الترقيم التلقائي لـ JENT-XXXXXX.
دوال خادمية ذرية: create_manual_journal_entry, approve_journal_entry (مع تطبيق حوكمة الاعتماد الثنائي ADR-018 Four-Eyes)، وget_trial_balance لحساب ميزان المراجعة والأستاذ العام.
إنشاء اختبار العزل والتحقق المحاسبي supabase/tests/rls/phase10_general_ledger_isolation.sql.
إضافة قسم الحسابات العامة والتقارير وشاشات: قيود اليومية العامة (JournalEntriesPage) وميزان المراجعة والأستاذ (TrialBalancePage)، مع اختبارات src/tests/phase10.test.tsx.
[المرحلة 9] - 2026-11-19
المضاف
اعتماد القرار ADR-018 (الاعتماد الثنائي Four-Eyes مع استثناء المالك الافتراضي للشركات الصغيرة وحد المبلغ المرتفع high_value_approval_threshold الذي يتطلب اعتماد المالك أو الأدمن).
إنشاء Migration supabase/migrations/0010_phase9_collections_settlements_cashboxes.sql:
توسيع tenant_settings بحقول حوكمة الاعتماد (enforce_four_eyes, allow_owner_self_approve, high_value_approval_threshold)، وربط shipments بمستندات التحصيل والتسوية وصرف العمولات.
تحديث تسلسلات الترقيم التلقائية لـ COL-XXXXXX وCST-XXXXXX وCMP-XXXXXX وCTR-XXXXXX وCTX-XXXXXX وRCV-XXXXXX وPAY-XXXXXX.
جداول مالية محمية بـ FORCE ROW LEVEL SECURITY: cashbox_transactions (دفتر حركات غير قابل للتعديل أو الحذف بمشغل قاعدة البيانات)، courier_collection_vouchers وبنودها، client_settlements وبنودها، courier_commission_payouts وبنودها، cashbox_transfers، وcashbox_vouchers.
دوال خادمية ذرية محمية بـ app_private.user_is_staff_with_permission وapp_private.assert_finance_approval_policy: إدارة السياسة المالية، حساب أرصدة الخزائن اللحظي، التحصيل من المندوبين (COL)، تسوية العملاء (CST) مع خصم المرتجعات (ADR-016)، صرف عمولات المندوبين (CMP) مع المنع الصارم لصرف عمولة COD قبل توريد النقدية (ADR-012)، والتحويلات بين الخزائن وسندات القبض والصرف والإيداع المقدم.
إنشاء اختبار العزل المالي والرقابة supabase/tests/rls/phase9_finance_settlements_isolation.sql.
إضافة قسم المالية والخزائن وشاشات: إدارة الخزائن والحركات (FinanceCashboxesPage)، التحصيل النقدي من المناديب (CourierCollectionsPage)، وتفعيل تسويات العملاء (ClientSettlementsPage مع نافذة الطباعة) وتسويات وعمولات المندوبين (CourierSettlementsPage)، مع اختبارات src/tests/phase9.test.tsx.
[المرحلة 8] - 2026-11-19
المضاف
اعتماد القرارين ADR-016 (رسوم وتحمل المرتجعات: no_charge على الراسل، sender_partial_fee، وrecipient_paid_fee كعهدة تحصيل على المندوب مع عمولة 0 للمرتجع) وADR-017 (الحد الأقصى لمحاولات التوصيل max_delivery_attempts الافتراضي 3 في tenant_settings والتحويل التلقائي للمرتجع ومنع إعادة الجدولة إلا باستثناء الإدارة).
إنشاء Migration supabase/migrations/0009_phase8_delivery_returns_courier_portal.sql:
توسيع tenant_settings (max_delivery_attempts, retry_extra_fee, require_pod_on_delivery) وshipments (حقول تحمل المرتجع، التحصيل عند الباب، عمولة المندوب المستحقة، وإثبات التسليم الرقمي POD).
تحديث تسلسلات الترقيم لتشمل DLV-XXXXXX وRDL-XXXXXX وRTH-XXXXXX وRTD-XXXXXX وRTN-XXXXXX.
جداول delivery_lists, delivery_list_items, return_manifests, وreturn_manifest_items مع FORCE ROW LEVEL SECURITY وصلاحية المندوب المرتبط عبر app_private.user_get_bound_courier_id.
دوال خادمية ذرية: update_tenant_delivery_policy, create_delivery_list, add_shipments_to_delivery_list (مع فحص سقف المحاولات والاستثناء الإداري)، remove_shipment_from_delivery_list, approve_delivery_list, record_delivery_execution (حساب عمولة ADR-012 + POD + ADR-016 + ADR-017)، create_return_manifest, add_shipments_to_return_manifest, remove_shipment_from_return_manifest, approve_return_manifest, وlist_courier_my_tasks.
إنشاء اختبار العزل وسير العمل supabase/tests/rls/phase8_delivery_returns_isolation.sql.
إضافة شاشات المرحلة الثامنة: قوائم التوصيل وقوائم إعادة التوصيل (DeliveryListsPage), قوائم المرتجعات ثلاثية المراحل (ReturnsWorkflowPage), بوابة المندوب (CourierPortalPage), ونافذة تسجيل النتائج الميدانية والتوقيع/OTP (DeliveryExecutionModal) مع ربطها مباشرة في جدول الشحنات قيد التوصيل وإعادة التوصيل، واختبارات src/tests/phase8.test.tsx.
[المرحلة 7] - 2026-11-19
المضاف
اعتماد القرار ADR-015 (مصافحة النقل بين الفروع على خطوتين دون نقل عهدة current_branch_id قبل اعتماد الاستلام بالمخزن المستقبِل، وحصر فك التعليق الإداري في company_owner / company_admin / operations_manager مع سبب تدقيقي إلزامي).
إنشاء Migration supabase/migrations/0008_phase7_pickup_warehouse_transfers.sql:
تحديث تسلسلات الترقيم التلقائية app_private.next_document_number لتوليد أكواد PKP-XXXXXX وWRH-XXXXXX وTRF-XXXXXX لجميع الشركات.
جداول pickup_lists, pickup_list_items, warehouse_manifests, وwarehouse_manifest_items مع FORCE ROW LEVEL SECURITY ومفاتيح أجنبية مركبة (tenant_id, ...) وصلاحية قراءة آمنة للفرع المستقبِل على قوائم النقل الواردة.
دوال خادمية ذرية (SECURITY DEFINER): create_pickup_list, add_shipments_to_pickup_list, remove_shipment_from_pickup_list, approve_pickup_list, create_warehouse_manifest, add_shipments_to_warehouse_manifest, remove_shipment_from_warehouse_manifest, approve_warehouse_manifest, admin_release_stuck_transfer_or_manifest, وlist_branch_inbound_transfer_shipments.
إنشاء اختبار العزل ومصافحة النقل بين الفروع supabase/tests/rls/phase7_operations_isolation.sql.
إضافة قسم العمليات اليومية في القائمة الجانبية لشاشات: قوائم الالتقاط (PickupListsPage)، قوائم الاستلام بالمخزن (WarehouseIntakePage مع تعديل الوزن بالمخزن ADR-010 ونماذج الطباعة الخمسة وشريط الشحنات الواردة من النقل)، والنقل بين الفروع (BranchTransfersPage مع تبويب الوارد قيد الانتظار وإجراء «فك تعليق إداري»)، مع اختبارات src/tests/phase7.test.tsx.
[المرحلة 6] - 2026-11-19
المضاف
اعتماد القرارين ADR-013 (الأثر المالي لأنواع الدفع: COD, PREPAID, POSTPAID, CASH_PAID) وADR-014 (معالجة التسليم الجزئي PDP على نفس الشحنة، وعهدة طرد الاستبدال الإلزامية PTP).
إنشاء Migration supabase/migrations/0007_phase6_shipments_barcode_lifecycle.sql:
جداول shipments, shipment_parties, shipment_packages, shipment_dimensions, shipment_status_events (غير قابلة للتعديل), shipment_relations, shipment_tracking_tokens, shipment_notes, وshipment_reference_numbers مع ربط shipment_price_snapshots.shipment_id ومنع التعديل المباشر على shipments خارج دوال الخادم.
دوال خادمية ذرية: app_private.next_document_number (تسلسل رقمي SHP-0000001), public.create_shipment (مع باركود غير قابل للتخمين ولقطة سعر فورية)، public.transition_shipment_status (دورة الحياة الكاملة وPDP/PTP)، public.reprice_shipment_weight_or_override (ADR-010)، وpublic.track_public_shipment (استعلام تتبع عام منزوع البيانات الشخصية لـ anon).
إنشاء اختبار العزل والتحقق supabase/tests/rls/phase6_shipments_isolation.sql.
إضافة قسم الشحنات في القائمة الجانبية لشاشات: قائمة الشحنات، إنشاء شحنة (مع الحقل الشرطي لقيمة الرصيد لـ COD/PREPAID والتعبئة التلقائية للعميل وحساب السعر الحي من الخادم)، الشحنات بالمخزون، قيد التوصيل، انتظار إعادة التوصيل، المرتجعات والمتعثرة، الباركود والتتبع، صفحة تفاصيل الشحنة بالمؤشرات والمراحل والتبويبات الخمسة، وصفحة التتبع العام /c/:companySlug/track/:token، مع اختبارات src/tests/phase6.test.tsx.
[المرحلة 5] - 2026-11-18
المضاف
اعتماد القرار ADR-012 (استحقاق عمولة المندوب عند التسليم مفصولة عن النقدية، وأولوية القواعد: المنطقة المحددة ← المحافظة كاملة ← افتراضي ملف المندوب).
إنشاء Migration supabase/migrations/0006_phase5_couriers_commissions_routes.sql:
جداول vehicles، drivers، courier_routes (مع خط السير العام المحمي GENERAL)، courier_route_stops، courier_commission_lists (مع القائمة الافتراضية المحمية 0)، courier_commission_rules، وcouriers.
ربط public.account_subjects.courier_id بـ public.couriers(tenant_id, id) عبر مفتاح أجنبي مركب، وتحديث دوال إدارة المستخدمين (srv_provision_tenant_user, srv_update_tenant_user_assignment, list_tenant_users_directory) والوظيفة السحابية tenant-manage-users لربط حسابات المناديب.
إضافة دالة احتساب العمولة الخادمية public.calculate_courier_commission وفق التدرج الثلاثي المعتمد في ADR-012.
إنشاء اختبار العزل والعمولات supabase/tests/rls/phase5_couriers_isolation.sql.
إضافة قسم مندوبو التوصيل في القائمة الجانبية لشاشات: قائمة المندوبين، إنشاء مندوب، قوائم عمولات المندوبين (مع الحاسبة الخادمية)، خطوط سير المندوبين والسيارات والسائقين، قيد التسوية مع المندوبين، وتحركات مندوب الشحن، مع اختبارات src/tests/phase5.test.tsx.
[المرحلة 4] - 2026-11-18
المضاف
إنشاء Migration supabase/migrations/0005_phase4_rbac_users_scopes.sql:
فصل طبيعة الحساب (account_subject_type) عن الدور الوظيفي (roles) والصلاحية (permissions, role_permissions) ونطاق الفروع (membership_branches) والكيان المرتبط (account_subjects مع مفاتيح أجنبية مركبة للعملاء والفروع وجاهزية ربط المندوب في المرحلة 5).
بذر 27 صلاحية معيارية عبر 11 وحدة، و12 دورًا افتراضيًا لكل شركة مع حماية دور company_owner على مستوى المشغلات وقاعدة البيانات.
دوال خادمية آمنة: app_private.user_has_permission، public.get_my_tenant_permissions، public.list_tenant_users_directory، public.list_tenant_session_audit، ودوال service_role ذرية (srv_provision_tenant_user, srv_update_tenant_user_assignment, srv_set_tenant_user_status, srv_mark_tenant_user_password_reset).
إنشاء Edge Function مستقلة supabase/functions/tenant-manage-users/index.ts لإنشاء المستخدمين وتعديل أدوارهم وفروعهم وإعادة تعيين كلمات المرور وتعطيل/تفعيل الحسابات دون تخزين أي كلمة مرور في جداول التطبيق.
إنشاء اختبار عزل الصلاحيات والنطاقات supabase/tests/rls/phase4_rbac_isolation.sql.
إضافة قسم الأمان في القائمة الجانبية لشاشات: المستخدمون (UsersManagementPage)، الأدوار والصلاحيات (RolesPermissionsPage)، وسجل الدخول والجلسات (SessionAuditPage)، مع اختبارات src/tests/phase4.test.tsx.
[المرحلة 3] - 2026-11-18
المضاف
اعتماد القرارات ADR-007..ADR-011 في docs/decisions/DECISION_LOG.md وتحديث حالة OQ-01..OQ-05 في docs/decisions/OPEN_QUESTIONS.md.
إعادة تنظيم قسم العملاء في القائمة الجانبية ليشمل الأقسام الخمسة: قائمة العملاء، إنشاء عميل، الحسابات المسجلة، قوائم أسعار الشحن، وقيد التسوية مع العملاء (ClientSettlementsPage).
إنشاء Migration supabase/migrations/0004_phase3_clients_pricing_engine.sql:
جداول client_price_lists (بما في ذلك القائمة الافتراضية المحمية 0)، price_list_versions، pickup_price_rules، delivery_price_rules، price_surcharges، clients، price_exemptions، client_contacts، client_addresses، client_contract_terms، client_registration_requests، وshipment_price_snapshots غير القابلة للتعديل.
دوال خادمية ذرية: public.clone_price_list، public.clone_client_record، وpublic.calculate_shipment_price (تطبيق الوزن الحجمي، التدرج الهرمي 4 مستويات، الضريبة على الرسوم فقط، ومعادلة شامل/غير شامل مصاريف الشحن).
تفعيل FORCE ROW LEVEL SECURITY وبذر القوائم والضرائب الافتراضية للشركات الحالية والجديدة.
إنشاء اختبار عزل البيانات ومحرك التسعير supabase/tests/rls/phase3_clients_pricing_isolation.sql.
إضافة شاشات العملاء وقوائم الأسعار ومصفوفة الالتقاط/التسليم وحاسبة التسعير الخادمية في الواجهة، مع اختبارات src/tests/phase3.test.tsx.
[المرحلة 2] - 2026-11-18
المضاف
إنشاء Migration supabase/migrations/0003_phase2_definitions_geography_defaults.sql:
جداول الجغرافيا (countries, governorates, cities, regions)، الفروع (branches, branch_service_areas)، شجرة الحسابات المبدئية (chart_of_accounts)، الخدمات وأنواع الطلبات (shipment_types, shipping_services, shipping_service_types)، أسباب التعذر والإرجاع (delivery_exception_reasons)، أنواع الحركات (movement_types)، اليوميات المساعدة (auxiliary_journals)، أنواع القيود (journal_entry_types)، الخزائن وأمنائها (cashboxes, cashbox_custodians)، وطرق الدفع وتسلسل الترقيم.
تفعيل FORCE ROW LEVEL SECURITY ومفاتيح أجنبية مركبة (tenant_id, ...) على جميع الجداول.
دالة app_private.seed_tenant_phase2_defaults القابلة لإعادة التكرار (idempotent) مع تحديث app_private.onboard_tenant وترحيل الشركات الموجودة مسبقًا.
إنشاء اختبار عزل البيانات supabase/tests/rls/phase2_definitions_isolation.sql.
ترقية بوابة الشركة (/c/:companySlug/app) إلى لوحة إدارة جانبية RTL شاملة لمسارات الفروع والجغرافيا والخدمات والأسباب والخزائن والحركات واليوميات والحسابات، مع اختبارات src/tests/phase2.test.tsx.
[المرحلة 1] - 2026-11-18
المضاف
إنشاء Migration supabase/migrations/0001_phase1_multitenant_auth_rls.sql:
تأسيس مخططات app_private وaudit وجداول tenants, tenant_settings, tenant_onboarding, profiles, platform_admins, platform_support_access, tenant_memberships, invitations, app_private.auth_identities, audit.audit_logs, audit.user_sessions_audit.
تفعيل وإلزام FORCE ROW LEVEL SECURITY على جميع الجداول المكشوفة دون استخدام user_metadata للتفويض.
دوال app_private.bootstrap_platform_super_admin وapp_private.onboard_tenant الذرية القابلة لإعادة المحاولة (idempotency_key).
إنشاء Edge Functions خادمية (supabase/functions/):
auth-resolve-login: مصادقة Username + Password دون كشف البريد الإلكتروني أو السماح بتعداد المستخدمين.
platform-onboard-tenant: تأسيس شركة جديدة وإرسال دعوة التفعيل للمالك.
auth-update-credentials: تحديث آمن لـ username وكلمة المرور.
إنشاء اختبار عزل الشركات supabase/tests/rls/phase1_tenant_isolation.sql.
ربط الواجهة الأمامية بعميل @supabase/supabase-js العام وتطبيق مسارات /platform, /platform/login, /c/:companySlug, /c/:companySlug/login, /c/:companySlug/app, /auth/set-password.
[المرحلة 0] - 2026-11-18
المضاف
تأسيس هيكل المشروع الكامل، التوثيق المرجعي، RTL، TypeScript الصارم، وبيئة الاختبار Vitest.