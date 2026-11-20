import type {ReactNode} from 'react';
import {Search} from 'lucide-react';

interface FilterBarProps {
  readonly searchValue: string;
  readonly onSearchChange: (value: string) => void;
  readonly searchPlaceholder?: string;
  readonly statusFilter?: 'all' | 'active' | 'inactive';
  readonly onStatusFilterChange?: (status: 'all' | 'active' | 'inactive') => void;
  readonly extraControls?: ReactNode;
  readonly primaryAction?: ReactNode;
}

export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'ابحث بالكود أو الاسم...',
  statusFilter,
  onStatusFilterChange,
  extraControls,
  primaryAction,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 right-3 h-4 w-4 text-slate-400" />
          <input
            type="search"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="w-64 rounded-lg border border-slate-200 bg-white py-2 pr-9 pl-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
          />
        </div>

        {statusFilter && onStatusFilterChange && (
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="تصفية الحالة">
            {(['all', 'active', 'inactive'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => onStatusFilterChange(st)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  statusFilter === st
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st === 'all' ? 'الكل' : st === 'active' ? 'فعال' : 'غير فعال'}
              </button>
            ))}
          </div>
        )}

        {extraControls}
      </div>

      {primaryAction && <div className="shrink-0">{primaryAction}</div>}
    </div>
  );
}
