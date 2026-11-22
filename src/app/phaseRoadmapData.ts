import {type OpenDecisionItem, PhaseStatus, type RoadmapPhase} from '@/types/common';

export const ROADMAP_PHASES: readonly RoadmapPhase[] = [
  {
    phaseNumber: 0,
    title: 'تأسيس React/TypeScript والبيئات والاختبارات والهيكل',
    summary: 'تهيئة المرجع الرئيسي، سجل القرارات، هيكل المجلدات، RTL، TypeScript الصارم، وVitest.',
    status: PhaseStatus.APPROVED,
    hasOpenDecisions: false,
  },
  {
    phaseNumber: 1,
    title: 'Multi-Tenant وAuth وRLS والعضويات',
    summary: 'جداول الشركات والعضويات، التحويل الآمن لـ Username إلى Email، وتأسيس الشركة ذريًا.',
    status: PhaseStatus.APPROVED,
    hasOpenDecisions: false,
  },
  {
    phaseNumber: 2,
    title: 'الفروع والجغرافيا والتعريفات والبيانات الافتراضية',
    summary: 'الفروع، محافظات ومناطق مصر، الخدمات، أسباب التعذر، الخزائن، اليوميات، وأنواع القيود.',
    status: PhaseStatus.APPROVED,
    hasOpenDecisions: false,
  },
  {
    phaseNumber: 3,
    title: 'العملاء وقوائم الأسعار ومحرك التسعير وPrice Snapshot',
    summary: 'إدارة العملاء، قوائم الأسعار ونسخها، وحساب السعر خادميًا مع حفظ لقطة السعر.',
    status: PhaseStatus.APPROVED,
    hasOpenDecisions: false,
  },
  {
    phaseNumber: 4,
    title: 'المستخدمون والأدوار والصلاحيات وربط العملاء والمناديب',
    summary: 'فصل نوع الحساب عن الدور والصلاحية ونطاق الفروع، وإدارة المستخدمين والجلسات.',
    status: PhaseStatus.APPROVED,
    hasOpenDecisions: false,
  },
  {
    phaseNumber: 5,
    title: 'المندوبون والعمولات وخطوط السير',
    summary: 'ملفات المناديب، قوائم العمولات، خطوط السير والمحطات، والمركبات والسائقين.',
    status: PhaseStatus.APPROVED,
    hasOpenDecisions: false,
  },
  {
    phaseNumber: 6,
    title: 'الشحنات والباركود ودورة الحياة والتتبع',
    summary: 'إنشاء الشحنة، الباركود غير القابل للتخمين، انتقالات الحالة الخادمية، والتتبع.',
    status: PhaseStatus.APPROVED,
    hasOpenDecisions: false,
  },
  {
    phaseNumber: 7,
    title: 'قوائم الالتقاط والاستلام بالمخزن والنقل بين الفروع',
    summary: 'رأس القائمة، الإضافة بالباركود أو الاختيار المجمع، الاعتماد الذري، واستلام المخزن والنقل بين الفروع.',
    status: PhaseStatus.APPROVED,
    hasOpenDecisions: false,
  },
  {
    phaseNumber: 8,
    title: 'التوصيل وإعادة التوصيل والمرتجعات وبوابة المندوب',
    summary: 'قوائم التوصيل وإعادة التوصيل، التعذر، المرتجعات، التوقيع وإثبات التسليم، وبوابة المندوب.',
    status: PhaseStatus.APPROVED,
    hasOpenDecisions: false,
  },
  {
    phaseNumber: 9,
    title: 'التحصيلات والسداد والعهد والعمولات',
    summary: 'فصل عهدة الشحنات عن النقدية، التحصيل من المندوب، سداد العملاء، وسداد العمولات.',
    status: PhaseStatus.APPROVED,
    hasOpenDecisions: false,
  },
  {
    phaseNumber: 10,
    title: 'الحسابات العامة والأستاذ والقيود والتقارير',
    summary: 'دليل الحسابات، قيود اليومية المتوازنة، كشف الحساب، ميزان المراجعة، والتقارير.',
    status: PhaseStatus.APPROVED,
    hasOpenDecisions: false,
  },
  {
    phaseNumber: 11,
    title: 'بوابة العميل وموقع الشركة العام',
    summary: 'موقع الشركة العام، التسجيل الذاتي والاعتماد التلقائي، لوحة التاجر، طلبات الالتقاط والعناوين، وكشف الحساب.',
    status: PhaseStatus.APPROVED,
    hasOpenDecisions: false,
  },
  {
    phaseNumber: 12,
    title: 'الرسائل والملفات والإشعارات',
    summary: 'محادثات مرتبطة بالشحنات، مرفقات Supabase Storage الخاصة، والإشعارات الفورية وإعدادات الاحتفاظ.',
    status: PhaseStatus.APPROVED,
    hasOpenDecisions: false,
  },
  {
    phaseNumber: 13,
    title: 'Excel والتصدير والطباعة والتقارير',
    summary: 'قوالب استيراد بإصدار وdry-run، تصدير CSV/Excel آمن، طباعة البوالص والملصقات، والتقارير التنفيذية.',
    status: PhaseStatus.APPROVED,
    hasOpenDecisions: false,
  },
  {
    phaseNumber: 14,
    title: 'الخرائط وتحركات المندوبين',
    summary: 'Mapbox GL JS، تتبع مسارات المندوبين خلال المهام، وسجل المواقع.',
    status: PhaseStatus.APPROVED,
    hasOpenDecisions: false,
  },
  {
    phaseNumber: 15,
    title: 'المنصة المركزية والاشتراكات والنطاقات',
    summary: 'إدارة شركات الشحن، الباقات والحدود الخادمية، النطاقات الفرعية والمخصصة، ودخول الدعم المسبب.',
    status: PhaseStatus.APPROVED,
    hasOpenDecisions: false,
  },
  {
    phaseNumber: 16,
    title: 'API Tokens والتكاملات وWebhooks',
    summary: 'رموز API مجزأة بصلاحيات ونطاقات، Webhooks موقعة بـ HMAC-SHA256، بوابة REST خارجية، وسجل التسليم والطلبات.',
    status: PhaseStatus.APPROVED,
    hasOpenDecisions: false,
  },
  {
    phaseNumber: 17,
    title: 'النسخ الاحتياطي والاستعادة والأداء والمراجعة الأمنية والإطلاق',
    summary: 'اختبارات العزل النهائية، خطط RPO/RTO، فهارس الأداء، المراجعة الأمنية الآلية، وجاهزية الإنتاج.',
    status: PhaseStatus.READY_FOR_OWNER_REVIEW,
    hasOpenDecisions: false,
  },
];

export interface ApprovedDecisionSummary {
  readonly code: string;
  readonly title: string;
  readonly decision: string;
}

export const APPROVED_DECISIONS: readonly ApprovedDecisionSummary[] = [
  {
    code: 'ADR-001',
    title: 'اسم المنصة التجاري وإدارة الهوية مركزيًا',
    decision: 'استخدام الاسم المؤقت ShipFlow مركزيًا في ملف إعدادات واحد دون توزيعه كنص ثابت.',
  },
  {
    code: 'ADR-002',
    title: 'مسار البنية التحتية (Supabase BaaS)',
    decision: 'اعتماد Supabase خارجي (PostgreSQL + Auth + RLS + Storage + Edge Functions) ومنع وضع أي أسرار في React.',
  },
  {
    code: 'ADR-003',
    title: 'سياسة تأسيس الشركات والبيانات الافتراضية',
    decision: 'حساب مالك/أدمن واحد فقط بدعوة آمنة + البيانات المرجعية الافتراضية، وحصر الحسابات التجريبية في Seed التطوير.',
  },
  {
    code: 'ADR-004',
    title: 'الدخول باستخدام Username مرتبط بـ Email',
    decision: 'تحويل Username الفريد إلى البريد الداخلي عبر إجراء خادمي آمن يمنع تعداد المستخدمين وكشف البريد.',
  },
  {
    code: 'ADR-007',
    title: 'معامل الوزن الحجمي والتقريب',
    decision: '(الطول × العرض × الارتفاع) ÷ 5000 افتراضيًا وتقريب الوزن المفوتر CEIL(1 كجم) مع قابلية الضبط لكل قائمة.',
  },
  {
    code: 'ADR-008',
    title: 'هيكل التسعير (الالتقاط × التسليم)',
    decision: 'ربط قواعد التسليم بقاعدة الالتقاط مع تدرج هرمي (Fallback) من المنطقة المحددة إلى المحافظة كاملة.',
  },
  {
    code: 'ADR-009',
    title: 'نطاق الضريبة وطريقة احتسابها',
    decision: 'ملف ضريبة لكل عميل (بدون ضريبة افتراضيًا / مضافة / مشمولة) وتُطبق على رسوم الشحن فقط لا على الـ COD.',
  },
  {
    code: 'ADR-010',
    title: 'تعديل الوزن وإصدارات Snapshot وoverride_price',
    decision: 'إعادة التسعير بالمخزن تنشئ إصدار Price Snapshot جديدًا مع Audit Log؛ وoverride_price بصلاحية إدارية وسبب إلزامي.',
  },
  {
    code: 'ADR-011',
    title: 'معنى «شامل مصاريف الشحن»',
    decision: 'شامل: يخصم الشحن من مبلغ المستلم لصافي التاجر؛ غير شامل: يضاف الشحن على المستلم فوق مستحق التاجر.',
  },
  {
    code: 'ADR-012',
    title: 'استحقاق عمولة المندوب وأولوية قواعدها',
    decision: 'تستحق العمولة عند التسليم (مفصولة عن النقدية)، وتُطبق بأولوية: المنطقة المحددة ← المحافظة كاملة ← افتراضي المندوب.',
  },
  {
    code: 'ADR-013',
    title: 'الأثر المالي لأنواع الدفع (COD / PREPAID / POSTPAID / CASH_PAID)',
    decision: 'COD يحصل المندوب بعهدة؛ PREPAID يخصم من الرصيد المسبق (ويظهر حقل الرصيد لهما فقط)؛ POSTPAID آجل؛ CASH_PAID سداد نقدي فوري.',
  },
  {
    code: 'ADR-014',
    title: 'معالجة التسليم الجزئي (PDP) والاستبدال (PTP)',
    decision: 'PDP يعدل الكمية والمبلغ على نفس الشحنة مع عهدة مرتجع جزئي؛ وPTP يربط طرد الاستبدال المرتجع بعهدة إلزامية في shipment_relations.',
  },
  {
    code: 'ADR-015',
    title: 'النقل بين الفروع واعتماد حركات العمليات اليومية',
    decision: 'مصافحة خطوتين (MOV-003 صادر ← in_transit_branch ثم اعتماد استلام فرع الوجهة ينقل current_branch_id إلى in_warehouse)؛ الاعتماد بنطاق الفروع وفك التعليق للإدارة مع سبب إلزامي.',
  },
  {
    code: 'ADR-016',
    title: 'رسوم الإرجاع والجهة التي تتحملها وأثرها المالي',
    decision: 'يتحمل الراسل رسوم الإرجاع في المرتجع العادي أو الجزئي؛ وعند تحصيل رسوم من المستلم تُسجل عهدة على المندوب ولا تُحتسب عمولة تسليم على المرتجع افتراضيًا.',
  },
  {
    code: 'ADR-017',
    title: 'الحد الأقصى لمحاولات التوصيل ورسومها',
    decision: 'افتراضيًا 3 محاولات قابلة للضبط في إعدادات الشركة مع تحويل إجباري إلى return_to_sender عند بلوغ الحد، والمحاولات داخل الحد مشمولة دون رسوم إضافية.',
  },
  {
    code: 'ADR-018',
    title: 'الفصل بين منشئ المستند ومعتمده وحدود الاعتماد (Four-Eyes)',
    decision: 'منع الاعتماد الذاتي للمستندات المالية لجميع الموظفين (enforce_four_eyes=true) مع مرونة قابلة للضبط لمالك الشركة فقط، وحد اعتماد أعلى (high_value_approval_threshold) قابل للضبط لكل شركة.',
  },
  {
    code: 'ADR-019',
    title: 'الأساس المحاسبي المعتمد وتوقيت الاعتراف بالإيراد',
    decision: 'اعتماد الأساس النقدي (Cash Basis) للاعتراف بالإيرادات والمصروفات عند التحصيل والسداد الفعلي بالخزائن، مع إقفال دوري للفترات.',
  },
  {
    code: 'ADR-020',
    title: 'تخزين المرفقات والرسائل في حاويات خاصة',
    decision: 'حاويات Supabase Storage خاصة لكل شركة (shipments/messages/delivery-proof) بروابط موقعة قصيرة الأجل، وحجب الرسائل الداخلية عن التاجر والمندوب.',
  },
  {
    code: 'ADR-021',
    title: 'الاستيراد المجمع المرقّم وحماية CSV والطباعة متعددة القوالب',
    decision: 'قالب SHIPMENTS_V1 بفحص Dry-Run خادمي واعتماد ذري Idempotent، وتحييد CSV Formula Injection في كل التصدير، و6 قوالب طباعة بوالص/ملصقات غير مغيّرة للحالة.',
  },
  {
    code: 'ADR-022',
    title: 'الخرائط وتتبع مواقع المندوبين الميداني (GPS)',
    decision: 'تسجيل إحداثيات المندوب أثناء المهام النشطة فقط بموافقته مع الدقة والمصدر، واحتفاظ افتراضي 90 يومًا (7–365) عبر مكتبة Mapbox GL JS (mapbox-gl) بترتيب [lng, lat] ورمز عام VITE_MAPBOX_ACCESS_TOKEN.',
  },
  {
    code: 'ADR-023',
    title: 'المنصة المركزية والباقات والحدود والنطاقات ودخول الدعم المراقب',
    decision: 'فرض حدود السعة خادميًا عبر الباقات (STARTER/GROWTH/ENTERPRISE) والاستثناءات، نطاق فرعي تلقائي ونطاق مخصص بتحدي DNS TXT، وحصر دخول الدعم التشخيصي في جلسات مؤقتة مسببة وموثقة.',
  },
  {
    code: 'ADR-024',
    title: 'رموز API والتكاملات الخارجية وWebhooks الموقعة',
    decision: 'حفظ تجزئة SHA-256 لرموز sf_live_* وعرض السر مرة واحدة، تقييدها بـ allow_api_access ونطاق التاجر/الشركة، وتوقيع Webhooks بـ HMAC-SHA256 مع التحقق من عناوين HTTPS العامة ومنع العناوين الداخلية.',
  },
  {
    code: 'ADR-025',
    title: 'النسخ الاحتياطي والاستعادة والأداء والمراجعة الأمنية والإطلاق',
    decision: 'تفعيل PITR بمستهدف RPO <= 15 دقيقة واحتفاظ 30 يومًا، وRTO <= 60 دقيقة لقاعدة البيانات و<= 120 دقيقة لحاويات Storage، مع اختبارات Restore دورية، فهارس أداء مركبة، ومراجعة كتالوج PostgreSQL آليًا للتأكد من FORCE RLS بنسبة 100%.',
  },
];

export const OPEN_QUESTIONS_LIST: readonly OpenDecisionItem[] = [
  {
    id: 'OQ-01',
    title: 'معامل الوزن الحجمي ووحدته وسياسة التقريب',
    blockingPhase: 'المرحلة 3',
    summary: 'تحديد المعامل (مثل 5000 سم³/كجم) وطريقة تقريب الوزن المفوتر.',
  },
  {
    id: 'OQ-02',
    title: 'التسعير حسب الوجهة أم منطقتي الالتقاط والتسليم',
    blockingPhase: 'المرحلة 3',
    summary: 'اعتماد التسعير بزوج (منطقة التقاط × منطقة تسليم) أو بالوجهة فقط.',
  },
  {
    id: 'OQ-03',
    title: 'نطاق الضريبة وطريقة احتسابها',
    blockingPhase: 'المرحلة 3 و10',
    summary: 'هل الضريبة شاملة أم مضافة، وعلى أي بنود تطبق.',
  },
  {
    id: 'OQ-04',
    title: 'تعديل الوزن بعد الاستلام وصلاحيات override_price',
    blockingPhase: 'المرحلة 3 و7',
    summary: 'ضوابط إعادة احتساب السعر بعد الاستلام بالمخزن ومن يملك صلاحية التعديل اليدوي.',
  },
  {
    id: 'OQ-05',
    title: 'معنى «شامل مصاريف الشحن»',
    blockingPhase: 'المرحلة 3 و6 و9',
    summary: 'المعادلة الدقيقة بين مبلغ التحصيل وأجر الشحن وصافي مستحق التاجر.',
  },
  {
    id: 'OQ-06',
    title: 'الأثر المالي لكل نوع دفع',
    blockingPhase: 'المرحلة 6 و9 و10',
    summary: 'واجبة التحصيل، prepaid، آجلة - بريد، ومسدد نقدًا.',
  },
  {
    id: 'OQ-07',
    title: 'معالجة PDP وPTP والاستبدال',
    blockingPhase: 'المرحلة 6 و8 و9',
    summary: 'تعديل كمية الشحنة أم إنشاء شحنة فرعية، ودورة الاستبدال ذهابًا وإيابًا.',
  },
  {
    id: 'OQ-08',
    title: 'رسوم الإرجاع والجهة التي تتحملها',
    blockingPhase: 'المرحلة 8 و9',
    summary: 'توزيع رسوم الإرجاع بين الراسل والمستلم وأثرها على العهدة والتسوية.',
  },
  {
    id: 'OQ-09',
    title: 'عدد محاولات التوصيل ورسومها',
    blockingPhase: 'المرحلة 8',
    summary: 'الحد الأقصى للمحاولات قبل الإرجاع الإجباري ورسوم المحاولات الإضافية.',
  },
  {
    id: 'OQ-10',
    title: 'النقل بين الفروع واعتماد حركاته',
    blockingPhase: 'المرحلة 7 و8',
    summary: 'مسؤولية الاعتماد ونقل العهدة المخزنية بين فرع المنشأ والوجهة.',
  },
  {
    id: 'OQ-11',
    title: 'الفصل بين منشئ المستند ومعتمده وحدود الاعتماد',
    blockingPhase: 'المرحلة 9 و10',
    summary: 'منع الاعتماد الذاتي للسندات المالية وحدود المبالغ المعتمدة.',
  },
  {
    id: 'OQ-12',
    title: 'الأساس المحاسبي وتوقيت الإقفال',
    blockingPhase: 'المرحلة 10',
    summary: 'الاستحقاق مقابل النقدي وسياسة إقفال الفترات المالية.',
  },
  {
    id: 'OQ-13',
    title: 'استحقاق عمولات المندوبين وأولوية قواعدها',
    blockingPhase: 'المرحلة 5 و9',
    summary: 'توقيت الاستحقاق وترتيب الأولوية عند تداخل القواعد.',
  },
];
