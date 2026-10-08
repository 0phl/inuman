import { Outlet } from 'react-router';
import { StageHost } from '@/stage/StageHost';
import { useSettings } from '@/store/settings';
import { AgeGate } from './AgeGate';

export function RootLayout() {
  const ageConfirmed = useSettings((s) => s.ageConfirmed);
  return (
    <>
      <StageHost />
      <div className="relative z-10">{ageConfirmed ? <Outlet /> : <AgeGate />}</div>
    </>
  );
}

export function RouteFallback() {
  return (
    <div className="grid min-h-dvh place-items-center" aria-busy="true">
      <span className="size-10 animate-spin rounded-full border-4 border-narra-600 border-t-brass-400" />
    </div>
  );
}
