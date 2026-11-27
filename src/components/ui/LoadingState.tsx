import type {ReactNode} from 'react';

type LoaderSize = 'sm' | 'md' | 'lg';

const SPINNER_SIZE: Record<LoaderSize, string> = {
  sm: 'h-4 w-4 border-2',
  md: 'h-7 w-7 border-[3px]',
  lg: 'h-10 w-10 border-4',
};

interface BrandSpinnerProps {
  readonly size?: LoaderSize;
  readonly className?: string;
}

/** The single loading mark used across the product: the tenant accent colour on a soft track. */
export function BrandSpinner({size = 'md', className = ''}: BrandSpinnerProps) {
  return <span aria-hidden="true" className={`app-spinner ${SPINNER_SIZE[size]} ${className}`} />;
}

interface LoadingStateProps {
  readonly label?: string;
  readonly size?: LoaderSize;
  readonly className?: string;
  readonly children?: ReactNode;
}

/** Inline loading mark with an optional caption, for cards and table bodies. */
export function LoadingState({label = 'جارٍ التحميل', size = 'md', className = '', children}: LoadingStateProps) {
  return (
    <span role="status" aria-live="polite" className={`flex items-center justify-center gap-2.5 ${className}`}>
      <BrandSpinner size={size} />
      <span className="text-xs font-semibold text-slate-500">{children ?? label}</span>
    </span>
  );
}

/** Full-viewport loading surface used while an account or a portal is being resolved. */
export function PageLoader({label = 'جارٍ التحميل', className = ''}: {readonly label?: string; readonly className?: string}) {
  return (
    <div className={`flex min-h-screen items-center justify-center bg-[#f4f5f7] ${className}`}>
      <div className="flex flex-col items-center gap-4">
        <BrandSpinner size="lg" />
        <p className="text-sm font-semibold text-slate-500">{label}</p>
      </div>
    </div>
  );
}

/** Skeleton-safe loading row for bordered panels. */
export function PanelLoader({label, className = ''}: {readonly label?: string; readonly className?: string}) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-8 ${className}`}>
      <LoadingState label={label} />
    </div>
  );
}
