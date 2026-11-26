import React from 'react';
import {AlertTriangle, RotateCcw} from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  scopeLabel?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'An unexpected interface error occurred.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(`[ErrorBoundary:${this.props.scopeLabel ?? 'app'}]`, error, info.componentStack);
  }

  private handleRecover = () => {
    this.setState({hasError: false, errorMessage: ''});
    this.props.onReset?.();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="min-h-[260px] rounded-2xl border border-red-500/40 bg-[#111922] p-6 flex flex-col items-center justify-center text-center space-y-4 text-[#E6EDF3]"
        >
          <div className="w-11 h-11 rounded-full bg-red-500/15 border border-red-500/40 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
          <div className="space-y-1 max-w-md">
            <h2 className="text-base font-semibold text-[#F8FAFC]">
              {this.props.scopeLabel ? `${this.props.scopeLabel} hit a hiccup` : 'Something hit a hiccup'}
            </h2>
            <p className="text-xs text-[#94A3B8] leading-relaxed">{this.state.errorMessage}</p>
          </div>
          <button
            type="button"
            onClick={this.handleRecover}
            className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[52px] rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restore View</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
