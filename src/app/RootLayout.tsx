import { useEffect } from 'react';
import { Outlet } from 'react-router';
import { installAudio } from '@/audio/wire';
import { StageHost } from '@/stage/StageHost';
import { useSettings } from '@/store/settings';
import { AgeGate } from './AgeGate';

export function RootLayout() {
  const ageConfirmed = useSettings((s) => s.ageConfirmed);
  // Sound, music and haptics: unlocked by the first tap (the 18+ gate is usually it).
  useEffect(() => installAudio(), []);
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
