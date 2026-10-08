import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Rendered instead of the children once they throw (e.g. a GLB that failed to load offline). */
  fallback: ReactNode;
  label: string;
}

/** Error boundary inside the Canvas: a failed download degrades to something drawn locally. */
export class EnvFallback extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn(`[stage] ${this.props.label} unavailable, using the fallback:`, error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
