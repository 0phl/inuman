import { useCallback, type RefCallback } from 'react';
import { useFx } from '@/store/fx';

/**
 * Attach to a game HUD's turn indicator: drink toasts then stack just below it instead of
 * covering it. Re-measures when the indicator or any ancestor up to the play screen resizes
 * (e.g. the water reminder pushing the HUD down).
 */
export function useToastAnchor<T extends HTMLElement>(): RefCallback<T> {
  const setAnchor = useFx((s) => s.setAnchor);
  return useCallback(
    (el: T | null) => {
      if (!el) return;
      const measure = () => setAnchor(Math.round(el.getBoundingClientRect().bottom));
      measure();
      const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
      const stop = el.closest('[data-testid="play"]');
      for (let n: Element | null = el; n; n = n.parentElement) {
        ro?.observe(n);
        if (n === stop) break;
      }
      window.addEventListener('resize', measure);
      return () => {
        ro?.disconnect();
        window.removeEventListener('resize', measure);
        setAnchor(null);
      };
    },
    [setAnchor],
  );
}
