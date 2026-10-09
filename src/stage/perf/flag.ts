// The perf overlay switch: `?perf=1` on any URL turns it on (remembered on this device),
// `?perf=0` turns it off again.

const KEY = 'inuman.perf';

export function perfOverlayEnabled(search: string): boolean {
  const param = new URLSearchParams(search).get('perf');
  try {
    if (param === '1') localStorage.setItem(KEY, '1');
    else if (param === '0') localStorage.removeItem(KEY);
    return localStorage.getItem(KEY) === '1';
  } catch {
    return param === '1';
  }
}
