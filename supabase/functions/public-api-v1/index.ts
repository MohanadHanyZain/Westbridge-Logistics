// import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.49.1';

// const corsHeaders = {
//   'Access-Control-Allow-Origin': '*',
//   'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
//   'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
// };

// function jsonResponse(body: unknown, status = 200): Response {
//   return new Response(JSON.stringify(body), {
//     status,
//     headers: {
//       ...corsHeaders,
//       'Content-Type': 'application/json; charset=utf-8',
//     },
//   });
// }

// function createServiceRoleClient() {
//   const url = Deno.env.get('SUPABASE_URL');
//   const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
//   if (!url || !serviceRoleKey) {
//     throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
//   }
//   return createClient(url, serviceRoleKey, {
//     auth: {autoRefreshToken: false, persistSession: false},
//   });
// }

// async function sha256Hex(value: string): Promise<string> {
//   const bytes = new TextEncoder().encode(value);
//   const digest = await crypto.subtle.digest('SHA-256', bytes);
//   return Array.from(new Uint8Array(digest))
//     .map((b) => b.toString(16).padStart(2, '0'))
//     .join('');
// }

// async function signWebhookPayload(secret: string, timestampSec: number, rawBody: string): Promise<string> {
//   const keyData = new TextEncoder().encode(secret);
//   const cryptoKey = await crypto.subtle.importKey(
//     'raw',
//     keyData,
//     {name: 'HMAC', hash: 'SHA-256'},
//     false,
//     ['sign'],
//   );
//   const signedPayload = new TextEncoder().encode(`${timestampSec}.${rawBody}`);
//   const signature = await crypto.subtle.sign('HMAC', cryptoKey, signedPayload);
//   return Array.from(new Uint8Array(signature))
//     .map((b) => b.toString(16).padStart(2, '0'))
//     .join('');
// }

// function isSafePublicHttpsUrl(rawUrl: string): boolean {
//   try {
//     const parsed = new URL(rawUrl);
//     if (parsed.protocol !== 'https:') return false;
//     if (parsed.username || parsed.password) return false;
//     const host = parsed.hostname.toLowerCase();
//     if (!host || !host.includes('.')) return false;
//     if (
//       host === 'localhost' ||
//       host === 'metadata.google.internal' ||
//       host.endsWith('.local') ||
//       host.endsWith('.internal') ||
//       host.endsWith('.localhost')
//     ) {
//       return false;
//     }
//     const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
//     if (ipv4) {
//       const o1 = Number(ipv4[1]);
//       const o2 = Number(ipv4[2]);
//       if (
//         o1 === 0 ||
//         o1 === 10 ||
//         o1 === 127 ||
//         (o1 === 169 && o2 === 254) ||
//         (o1 === 172 && o2 >= 16 && o2 <= 31) ||
//         (o1 === 192 && o2 === 168) ||
//         (o1 === 100 && o2 >= 64 && o2 <= 127) ||
//         o1 >= 224
//       ) {
//         return false;
//       }
//     }
//     if (
//       host.startsWith('[') &&
//       (host.includes('::1') || host.startsWith('[fc') || host.startsWith('[fd') || host.startsWith('[fe80'))
//     ) {
//       return false;
//     }
//     return true;
//   } catch {
//     return false;
//   }
// }

// function getClientIp(req: Request): string | null {
//   const forwarded = req.headers.get('x-forwarded-for');
//   if (forwarded) {
//     const first = forwarded.split(',')[0]?.trim();
//     if (first) return first;
//   }
//   return req.headers.get('cf-connecting-ip')?.trim() ?? null;
// }

// function getSubPath(req: Request): string {
//   const url = new URL(req.url);
//   const marker = '/public-api-v1';
//   const idx = url.pathname.indexOf(marker);
//   const raw = idx >= 0 ? url.pathname.slice(idx + marker.length) : url.pathname;
//   return raw === '' ? '/' : raw;
// }

// interface AuthTokenContext {
//   valid: boolean;
//   reason?: string;
//   token_id?: string;
//   tenant_id?: string;
//   account_scope?: 'tenant' | 'client';
//   client_id?: string | null;
//   scopes?: string[];
// }

// Deno.serve(async (req: Request) => {
//   if (req.method === 'OPTIONS') {
//     return new Response('ok', {headers: corsHeaders});
//   }

//   const startedAt = Date.now();
//   const subPath = getSubPath(req);
//   const clientIp = getClientIp(req);
//   const idempotencyKey = req.headers.get('idempotency-key')?.trim() ?? null;
//   const admin = createServiceRoleClient();

//   // Internal/authenticated webhook delivery dispatch endpoint
//   if (req.method === 'POST' && subPath === '/webhooks/dispatch') {
//     try {
//       const authHeader = req.headers.get('Authorization') ?? '';
//       const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
//       if (!jwt) {
//         return jsonResponse({error: 'غير مصرح.'}, 401);
//       }

//       const body = (await req.json().catch(() => ({}))) as {
//         tenant_id?: string;
//         endpoint_id?: string;
//         limit?: number;
//       };

//       const {data: userData, error: userErr} = await admin.auth.getUser(jwt);
//       if (userErr || !userData.user) {
//         return jsonResponse({error: 'جلسة المستخدم غير صالحة.'}, 401);
//       }

//       if (!body.tenant_id) {
//         return jsonResponse({error: 'tenant_id مطلوب لتشغيل إرسال Webhooks.'}, 400);
//       }

//       const {data: membership} = await admin
//         .from('tenant_memberships')
//         .select('id, is_active')
//         .eq('tenant_id', body.tenant_id)
//         .eq('user_id', userData.user.id)
//         .eq('is_active', true)
//         .maybeSingle();

//       if (!membership) {
//         return jsonResponse({error: 'غير مصرح بتشغيل إرسال Webhooks لهذه الشركة.'}, 403);
//       }

//       const {data: deliveries, error: claimErr} = await admin.rpc('srv_claim_pending_webhook_deliveries', {
//         p_tenant_id: body.tenant_id,
//         p_endpoint_id: body.endpoint_id ?? null,
//         p_limit: Math.min(Math.max(Number(body.limit ?? 10), 1), 25),
//       });

//       if (claimErr) {
//         return jsonResponse({error: claimErr.message}, 400);
//       }

//       const items = (Array.isArray(deliveries) ? deliveries : []) as Array<{
//         delivery_id: string;
//         target_url: string;
//         signing_secret: string;
//         event_type: string;
//         idempotency_key: string;
//         request_payload: Record<string, unknown>;
//       }>;

//       const results: Array<{delivery_id: string; success: boolean; status: number | null}> = [];

//       for (const item of items) {
//         if (!isSafePublicHttpsUrl(item.target_url)) {
//           await admin.rpc('srv_complete_webhook_delivery', {
//             p_delivery_id: item.delivery_id,
//             p_success: false,
//             p_response_status: 400,
//             p_response_excerpt: 'Blocked non-public or non-HTTPS target URL',
//           });
//           results.push({delivery_id: item.delivery_id, success: false, status: 400});
//           continue;
//         }

//         const rawPayload = JSON.stringify(item.request_payload ?? {});
//         const timestampSec = Math.floor(Date.now() / 1000);
//         const signature = await signWebhookPayload(item.signing_secret, timestampSec, rawPayload);

//         let status: number | null = null;
//         let excerpt = '';
//         let ok = false;

//         try {
//           const resp = await fetch(item.target_url, {
//             method: 'POST',
//             redirect: 'error',
//             signal: AbortSignal.timeout(8000),
//             headers: {
//               'Content-Type': 'application/json; charset=utf-8',
//               'User-Agent': 'ShipFlow-Webhooks/1.0',
//               'X-ShipFlow-Event': item.event_type,
//               'X-ShipFlow-Delivery': item.delivery_id,
//               'X-ShipFlow-Idempotency-Key': item.idempotency_key,
//               'X-ShipFlow-Signature': `t=${timestampSec},v1=${signature}`,
//             },
//             body: rawPayload,
//           });
//           status = resp.status;
//           ok = resp.ok;
//           excerpt = (await resp.text()).slice(0, 400);
//         } catch (fetchErr) {
//           excerpt = fetchErr instanceof Error ? fetchErr.message.slice(0, 400) : 'Network dispatch failure';
//         }

//         await admin.rpc('srv_complete_webhook_delivery', {
//           p_delivery_id: item.delivery_id,
//           p_success: ok,
//           p_response_status: status,
//           p_response_excerpt: excerpt,
//         });
//         results.push({delivery_id: item.delivery_id, success: ok, status});
//       }

//       return jsonResponse({
//         processed_count: results.length,
//         results,
//       });
//     } catch (err) {
//       return jsonResponse(
//         {error: err instanceof Error ? err.message : 'تعذر تشغيل طابور Webhooks.'},
//         500,
//       );
//     }
//   }

//   // External Public REST API endpoints authenticated via `Bearer sf_live_*`
//   const authHeader = req.headers.get('Authorization') ?? '';
//   const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
//   if (!bearerToken.startsWith('sf_live_')) {
//     return jsonResponse({error: 'مطلوب رمز API صالح بصيغة Bearer sf_live_...'}, 401);
//   }

//   let requiredScope: string | null = null;
//   if (req.method === 'GET' && subPath.startsWith('/shipments')) {
//     requiredScope = 'shipments:read';
//   } else if (req.method === 'POST' && subPath === '/shipments') {
//     requiredScope = 'shipments:write';
//   } else if (req.method === 'GET' && subPath.startsWith('/track/')) {
//     requiredScope = 'tracking:read';
//   }

//   if (!requiredScope) {
//     return jsonResponse({error: 'المسار المطلوب غير مدعوم في واجهة API v1.'}, 404);
//   }

//   try {
//     const tokenHash = await sha256Hex(bearerToken);
//     const {data: authRes, error: authErr} = await admin.rpc('srv_authenticate_api_token', {
//       p_token_hash: tokenHash,
//       p_required_scope: requiredScope,
//       p_client_ip: clientIp,
//     });

//     if (authErr || !authRes) {
//       return jsonResponse({error: 'تعذر التحقق من رمز API.'}, 500);
//     }

//     const tokenCtx = authRes as AuthTokenContext;
//     if (!tokenCtx.valid || !tokenCtx.tenant_id || !tokenCtx.token_id) {
//       const code = tokenCtx.reason === 'insufficient_scope' || tokenCtx.reason === 'ip_not_allowed' ? 403 : 401;
//       return jsonResponse({error: 'رفض المصادقة البرمجية.', reason: tokenCtx.reason ?? 'unauthorized'}, code);
//     }

//     const recordLog = async (statusCode: number) => {
//       await admin.rpc('srv_record_api_request_log', {
//         p_tenant_id: tokenCtx.tenant_id,
//         p_token_id: tokenCtx.token_id,
//         p_method: req.method,
//         p_path: subPath,
//         p_status_code: statusCode,
//         p_ip_address: clientIp,
//         p_idempotency_key: idempotencyKey,
//         p_duration_ms: Date.now() - startedAt,
//       });
//     };

//     // GET /shipments
//     if (req.method === 'GET' && subPath === '/shipments') {
//       const url = new URL(req.url);
//       const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '25'), 1), 100);
//       let query = admin
//         .from('shipments')
//         .select(
//           'id, shipment_number, barcode_token, external_reference, operational_status, payment_term_code, total_shipping_fee, recipient_collect_amount, client_net_payout, created_at',
//         )
//         .eq('tenant_id', tokenCtx.tenant_id)
//         .order('created_at', {ascending: false})
//         .limit(limit);

//       if (tokenCtx.account_scope === 'client' && tokenCtx.client_id) {
//         query = query.eq('client_id', tokenCtx.client_id);
//       }

//       const {data, error} = await query;
//       if (error) {
//         await recordLog(400);
//         return jsonResponse({error: error.message}, 400);
//       }

//       await recordLog(200);
//       return jsonResponse({shipments: data ?? []});
//     }

//     // POST /shipments
//     if (req.method === 'POST' && subPath === '/shipments') {
//       const payload = (await req.json().catch(() => null)) as Record<string, unknown> | null;
//       if (!payload) {
//         await recordLog(400);
//         return jsonResponse({error: 'حمولة JSON غير صالحة.'}, 400);
//       }

//       const {data, error} = await admin.rpc('srv_api_create_shipment', {
//         p_token_id: tokenCtx.token_id,
//         p_idempotency_key: idempotencyKey,
//         p_payload: payload,
//       });

//       if (error) {
//         await recordLog(400);
//         return jsonResponse({error: error.message}, 400);
//       }

//       await recordLog(201);
//       return jsonResponse({shipment: data}, 201);
//     }

//     // GET /track/:token
//     if (req.method === 'GET' && subPath.startsWith('/track/')) {
//       const trackingToken = decodeURIComponent(subPath.slice('/track/'.length)).trim();
//       if (!trackingToken) {
//         await recordLog(400);
//         return jsonResponse({error: 'رمز التتبع مطلوب.'}, 400);
//       }

//       const {data, error} = await admin.rpc('track_public_shipment', {
//         p_tracking_token: trackingToken,
//       });

//       if (error || !data) {
//         await recordLog(404);
//         return jsonResponse({error: 'الشحنة غير موجودة أو رمز التتبع غير صالح.'}, 404);
//       }

//       await recordLog(200);
//       return jsonResponse({tracking: data});
//     }

//     await recordLog(404);
//     return jsonResponse({error: 'Not found'}, 404);
//   } catch (err) {
//     return jsonResponse(
//       {error: err instanceof Error ? err.message : 'خطأ غير متوقع في واجهة API.'},
//       500,
//     );
//   }
// });
