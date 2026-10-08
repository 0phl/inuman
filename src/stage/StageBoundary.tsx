import { Component, type ReactNode } from 'react';

interface State {
  failed: boolean;
}

/**
 * If WebGL can't start (blocklisted GPU, no context), the game must stay playable from the HUD alone.
 * Swallows the 3D error and renders nothing; the DOM overlay carries the whole game state.
 */
export class StageBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('[stage] 3D disabled:', error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
