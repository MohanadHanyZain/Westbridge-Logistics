import {Component, type ErrorInfo, type ReactNode} from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

/**
 * Global RTL error boundary.
 * Never displays raw stack traces or SQL messages to end users (Spec §05).
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  public state: AppErrorBoundaryState = {
    hasError: false,
  };

  public static getDerivedStateFromError(): AppErrorBoundaryState {
    return {hasError: true};
  }

  public componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    // Intentionally suppressed from UI rendering; Stage 12+ will route sanitized logs server-side.
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          lang="ar"
          className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12 text-slate-900"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-right shadow-sm">
            <h1 className="text-lg font-semibold text-slate-900">حدث خطأ غير متوقع في العرض</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              يرجى تحديث الصفحة للمتابعة. إذا استمرت المشكلة، تواصل مع مسؤول النظام.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              إعادة تحميل الصفحة
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
