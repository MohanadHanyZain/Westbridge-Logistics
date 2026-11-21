import {useRef, useState, type ChangeEvent} from 'react';
import {
  formatFileSize,
  getSignedAttachmentUrl,
  uploadPrivateAttachment,
  validateAttachmentFile,
} from '@/features/messaging/messagingService';
import type {
  AttachmentDraftPayload,
  PrivateStorageBucketId,
  StorageObjectMetadataRecord,
} from '@/types/messaging';
import {Download, FileText, Image as ImageIcon, Paperclip, Trash2, Upload} from 'lucide-react';

interface AttachmentUploaderProps {
  readonly tenantId: string;
  readonly bucketId: PrivateStorageBucketId;
  readonly entityType: 'shipment' | 'message' | 'delivery_proof' | 'pickup_request';
  readonly entityId: string;
  readonly maxSizeMb?: number;
  readonly label?: string;
  readonly disabled?: boolean;
  readonly onUploaded: (draft: AttachmentDraftPayload) => Promise<void> | void;
}

export function AttachmentUploader({
  tenantId,
  bucketId,
  entityType,
  entityId,
  maxSizeMb = 5,
  label = 'إرفاق ملف أو صورة (JPEG, PNG, WEBP, PDF)',
  disabled = false,
  onUploaded,
}: AttachmentUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError(null);
    const check = validateAttachmentFile(file, maxSizeMb);
    if (!check.valid) {
      setError(check.error ?? 'الملف المحدد غير صالح.');
      return;
    }

    setUploading(true);
    try {
      const uploaded = await uploadPrivateAttachment(
        tenantId,
        bucketId,
        entityType,
        entityId,
        file,
        maxSizeMb,
      );
      await onUploaded(uploaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر رفع الملف.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
          onChange={(e) => void handleFileChange(e)}
          disabled={disabled || uploading}
          aria-label={label}
          className="hidden"
        />
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0"
        >
          {uploading ? <Upload className="h-3.5 w-3.5 animate-pulse" /> : <Paperclip className="h-3.5 w-3.5" />}
          <span>{uploading ? 'جاري الرفع المشفر...' : label}</span>
        </button>
        <span className="font-mono-tabular text-[11px] text-slate-500">
          الحد الأقصى {maxSizeMb} MB
        </span>
      </div>

      {error && (
        <p role="alert" className="text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

interface AttachmentPreviewListProps {
  readonly items: readonly {
    readonly id: string;
    readonly storageObject: StorageObjectMetadataRecord;
    readonly subtitle?: string;
    readonly canDelete?: boolean;
  }[];
  readonly onDelete?: (id: string) => Promise<void> | void;
}

export function AttachmentPreviewList({items, onDelete}: AttachmentPreviewListProps) {
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [signedError, setSignedError] = useState<string | null>(null);

  const handleOpenSigned = async (id: string, obj: StorageObjectMetadataRecord) => {
    setSignedError(null);
    setOpeningId(id);
    try {
      const signedUrl = await getSignedAttachmentUrl(obj.bucket_id, obj.object_path);
      const anchor = document.createElement('a');
      anchor.href = signedUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.click();
    } catch (err) {
      setSignedError(err instanceof Error ? err.message : 'تعذر فتح الرابط المؤقت.');
    } finally {
      setOpeningId(null);
    }
  };

  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      {signedError && (
        <p role="alert" className="text-xs text-red-700">
          {signedError}
        </p>
      )}
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/70">
        {items.map((item) => {
          const obj = item.storageObject;
          const isPdf = obj.mime_type === 'application/pdf';
          return (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                {isPdf ? (
                  <FileText className="h-4 w-4 shrink-0 text-amber-700" />
                ) : (
                  <ImageIcon className="h-4 w-4 shrink-0 text-sky-700" />
                )}
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{obj.file_name}</p>
                  <p className="font-mono-tabular text-[11px] text-slate-500">
                    {formatFileSize(obj.size_bytes)}
                    {obj.visibility === 'internal' ? ' · داخلي للفريق فقط' : ' · مرئي'}
                    {item.subtitle ? ` · ${item.subtitle}` : ''}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  disabled={openingId === item.id}
                  onClick={() => void handleOpenSigned(item.id, obj)}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60 whitespace-nowrap"
                >
                  <Download className="h-3 w-3" />
                  {openingId === item.id ? 'تجهيز...' : 'عرض / تنزيل مؤقت'}
                </button>
                {item.canDelete && onDelete && (
                  <button
                    type="button"
                    aria-label={`حذف ${obj.file_name}`}
                    onClick={() => void onDelete(item.id)}
                    className="inline-flex items-center rounded border border-red-200 bg-white p-1 text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}