دليل النسخ الاحتياطي والاستعادة وجاهزية الإطلاق (Backup, Restore & Launch Runbook)
1. مستهدفات التعافي المعتمدة (ADR-025)
المكون	المستهدف (RPO)	المستهدف (RTO)	آلية الحماية والاحتفاظ
قاعدة بيانات PostgreSQL	<= 15 دقيقة	<= 60 دقيقة	تفعيل Point-in-Time Recovery (PITR) + نسخ احتياطية يومية مشفرة لمدة 30 يومًا
حاويات التخزين (Storage)	<= 60 دقيقة	<= 120 دقيقة	مزامنة دورية منفصلة لحاويات shipment-attachments, message-attachments, delivery-proof
دوال Edge وإعدادات المنصة	إصدار مقيد بـ Git	<= 15 دقيقة	نشر مُدار لملفات supabase/migrations/ وsupabase/functions/
2. خطة استعادة قاعدة البيانات وحاويات التخزين
تحديد نقطة الاستعادة الآمنة (PITR):
قبل أي استعادة طارئة، يتم أخذ لقطة قراءة للوضع الحالي والتحقق من توقيت آخر سجل سليم في audit.audit_logs وpublic.shipments.
الاستعادة على مشروع معزول أولًا (Staging / Isolated Clone):
استعادة PostgreSQL في بيئة معزولة إلى نقطة الزمن المطلوبة دون المساس بالإنتاج.
تشغيل فحص الجاهزية الخادمي (SELECT public.get_launch_readiness_overview();) وسكربت التحقق النهائي supabase/tests/rls/phase17_final_security_rls_audit.sql للتأكد من:
unprotected_tables_count = 0 (FORCE ROW LEVEL SECURITY فعال على كل جداول public).
سلامة أرصدة الخزائن (cashboxes) وتوازن قيود اليومية (SUM(debit) = SUM(credit)).
استعادة ومطابقة حاويات Storage:
استرجاع كائنات الحاويات الخاصة الثلاث إلى النسخة المطابقة زمنيًا.
مطابقة public.storage_objects_metadata (bucket_name, object_path) للتأكد من عدم وجود مراجع يتيمة أو حاويات مكشوفة للعامة (public = false).
توثيق اختبار الاستعادة الدوري (Restore Drill):
تنفيذ تمرين الاستعادة قبل الإطلاق ثم دوريًا كل شهر، وتسجيل البيئة ووقت البدء والانتهاء وRTO الفعلي وحالة التحقق من Storage وRLS داخل public.backup_restore_drills عبر تبويب النسخ الاحتياطي والإطلاق في المنصة المركزية.
3. قائمة التحقق النهائية قبل الإطلاق (Go-Live Checklist)

تفعيل PITR واحتفاظ 30 يومًا في لوحة تحكم Supabase الإنتاجية.

تطبيق كافة الهجرات 0001 حتى 0018 بالترتيب على قاعدة البيانات وتمرير phase17_final_security_rls_audit.sql.

التأكد في لوحة المنصة المركزية ← تبويب النسخ الاحتياطي والإطلاق من أن عدد الجداول غير المحمية = 0، وعدد أعمدة كلمات المرور في public = 0، وأن token_hash محجوب عن authenticated.

التحقق من ضبط متغيرات البيئة في الإنتاج (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_MAPBOX_ACCESS_TOKEN المقيد بالنطاق، وأسرار Edge Functions في Supabase Secrets فقط).

تسجيل أول اختبار استعادة ناجح (passed) في البيئة المعزولة قبل السماح بأي دخول فعلي لشركات الإنتاج.