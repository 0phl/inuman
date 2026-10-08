import { useEffect, useRef, useState } from 'react';

// The qrcode library is only fetched when a QR is actually shown (it's not in the initial bundle).
type QrModule = typeof import('qrcode');
let qrLib: Promise<QrModule> | null = null;
const loadQr = () =>
  (qrLib ??= import('qrcode').then((m) => (m as QrModule & { default?: QrModule }).default ?? m));

// Canvas pixels; CSS scales it down. Narra-black modules on capiz paper scan well on any phone.
const DARK = '#0e0805';
const LIGHT = '#f6ecd9';

interface QrCodeProps {
  text: string;
  label: string;
  className?: string;
}

export function QrCode({ text, label, className = '' }: QrCodeProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    loadQr()
      .then((QR) => {
        const canvas = ref.current;
        if (!alive || !canvas) return;
        return QR.toCanvas(canvas, text, {
          errorCorrectionLevel: 'L',
          margin: 1,
          width: 720,
          color: { dark: DARK, light: LIGHT },
        }).then(() => {
          // qrcode pins an inline px size on the canvas; let the CSS size it to the coaster.
          canvas.style.removeProperty('width');
          canvas.style.removeProperty('height');
        });
      })
      .then(() => alive && setState('ready'))
      .catch(() => alive && setState('error'));
    return () => {
      alive = false;
    };
  }, [text]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      data-testid="share-qr"
      data-state={state}
      className={`block aspect-square h-auto w-full transition-opacity duration-300 ${state === 'ready' ? 'opacity-100' : 'opacity-0'} ${className}`}
    />
  );
}
