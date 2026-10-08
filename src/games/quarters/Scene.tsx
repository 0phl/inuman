import { useEffect, useMemo } from 'react';
import type { View } from '@/core/games/quarters/logic';
import { AimPreview } from '@/physics/AimPreview';
import { DEFAULT_GLASS_POSITION } from '@/physics/throwConfig';
import { ThrowReplay } from '@/physics/ThrowReplay';
import { useThrowReplay } from '@/physics/useThrowReplay';
import { ShotGlass3D } from '@/three/ShotGlass3D';
import { handPosition } from '../beer-pong/layout';
import { CameraProbe } from '../beer-pong/teamKit';
import { useThrowBus } from '../beer-pong/throwBus';
import { GlowDisc } from '../mexico/diceKit';
import { Nameplate } from '../spin-the-bottle/seatKit';
import { ovalSeats, plateWidthFor, type PlateTone } from '../spin-the-bottle/seats';
import type { GameViewProps } from '../types';
import { GLASS } from './layout';

const HAND = handPosition('coin');
/** Everyone sits round the far side of the glass; the shooter's plaque is lit. */
const SEATS = {
  cz: DEFAULT_GLASS_POSITION[2] - 0.05,
  rx: 0.9,
  rz: 0.92,
  span: Math.PI * 0.86,
  centre: -Math.PI / 2,
};
const ARC = SEATS.rx * SEATS.span * 1.05;

/**
 * Quarters: a heavy shot glass on the felt, the coin in the shooter's hand, everyone's name plaque
 * round the far side. The Hud turns a flick (or the "Tumira" hold) into a throw; this scene replays
 * the pre-simulated coin. A made coin stays in the glass until the shooter has picked who drinks.
 */
export default function QuartersScene({ view, players }: GameViewProps<View>) {
  const replay = useThrowReplay();
  const setRunner = useThrowBus((s) => s.setRunner);
  const setAim = useThrowBus((s) => s.setAim);
  const aim = useThrowBus((s) => s.aim);
  const picked = useThrowBus((s) => s.picked);
  const { throwAndReplay, clear } = replay;
  useEffect(() => {
    setRunner({ run: throwAndReplay, clear });
    return () => {
      setRunner(null);
      setAim(null);
    };
  }, [throwAndReplay, clear, setRunner, setAim]);

  const n = view.order.length;
  const seats = useMemo(
    () =>
      ovalSeats(n, {
        cz: SEATS.cz,
        rx: SEATS.rx,
        rz: SEATS.rz,
        span: SEATS.span,
        centre: SEATS.centre,
      }),
    [n],
  );
  const plateW = plateWidthFor(n, ARC, 0.5, 0.28);
  const shooter = view.current;
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?';

  return (
    <group>
      <CameraProbe />
      <ShotGlass3D position={DEFAULT_GLASS_POSITION} />
      <GlowDisc
        color="#f3c977"
        opacity={0.28}
        radius={0.34}
        position={[DEFAULT_GLASS_POSITION[0], 0.002, DEFAULT_GLASS_POSITION[2]]}
      />
      {view.order.map((id, i) => {
        const s = seats[i];
        if (!s) return null;
        const tone: PlateTone = id === picked ? 'picked' : id === shooter ? 'turn' : 'idle';
        return (
          <Nameplate
            key={id}
            name={nameOf(id)}
            tone={tone}
            width={plateW}
            glow={tone === 'picked' ? '#ff7a4d' : null}
            position={[s.x, 0, s.z]}
            rotation-y={-Math.cos(s.phi) * 0.18}
          />
        );
      })}
      <ThrowReplay playback={replay.playback} kind="coin" idle={HAND} />
      <AimPreview aim={aim} targets={GLASS} />
    </group>
  );
}
