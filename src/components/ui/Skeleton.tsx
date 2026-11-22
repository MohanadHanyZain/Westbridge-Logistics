import type {CSSProperties} from 'react';

interface SkeletonProps {
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function Skeleton({className = '', style}: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      style={style}
      className={`block animate-pulse rounded-lg bg-slate-200/80 ${className}`}
    />
  );
}
