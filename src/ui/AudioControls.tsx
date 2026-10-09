import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { MUSIC } from '@/audio/catalog';
import { testSample } from '@/audio/cues';
import { play } from '@/audio/engine';
import { haptic } from '@/audio/haptics';
import { useAudioManifest } from '@/audio/react';
import { SHUFFLE, useSettings, type MusicChoice } from '@/store/settings';
import { Toggle } from './controls';
import { IconNote, IconShuffle, IconSpeaker, IconSpeakerOff } from './icons';
import { Sheet } from './Sheet';
import './audioControls.css';

// ---------------------------------------------------------------- fader

interface FaderProps {
  label: ReactNode;
  help?: ReactNode;
  /** 0..1 */
  value: number;
  onChange(value: number): void;
  /** On release (keyboard or pointer): e.g. play a sample at the new level. */
  onCommit?(value: number): void;
  disabled?: boolean;
  testId?: string;
}

/** A brass mixing-desk fader with a painted scale and a lit percentage readout. */
export function Fader({ label, help, value, onChange, onCommit, disabled, testId }: FaderProps) {
  const { t } = useTranslation();
  const id = useId();
  const pct = Math.round(value * 100);
  return (
    <div className={`flex flex-col gap-1 py-3 ${disabled ? 'opacity-60' : ''}`}>
      <div className="flex items-end justify-between gap-3">
        <label htmlFor={id} className="flex min-w-0 flex-col">
          <span className="font-bold text-capiz-50">{label}</span>
          {help && <span className="text-sm text-capiz-400">{help}</span>}
        </label>
        <output htmlFor={id} className="fader-readout" data-testid={testId && `${testId}-value`}>
          {t('audio.percent', { value: pct })}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        disabled={disabled}
        className="fader"
        style={{ '--fill': `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.currentTarget.value) / 100)}
        onPointerUp={(e) => onCommit?.(Number(e.currentTarget.value) / 100)}
        onKeyUp={(e) => onCommit?.(Number(e.currentTarget.value) / 100)}
        data-testid={testId}
      />
      <div className="fader-scale" aria-hidden />
    </div>
  );
}

// ---------------------------------------------------------------- jukebox

const CODES = ['A1', 'A2', 'A3', 'B1', 'B0'] as const;

function Eq() {
  return (
    <span className="eq" aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}

interface Strip {
  value: MusicChoice | 'off';
  title: string;
  sub: string;
  icon?: ReactNode;
}

/**
 * The track picker, styled as a jukebox's title strips: the three tracks (titles and artists from
 * the audio manifest), "Halo-halo" (shuffle) and Off. Picking a track turns the music on.
 */
export function TrackPicker({ testPrefix = 'music-track' }: { testPrefix?: string }) {
  const { t } = useTranslation();
  const manifest = useAudioManifest();
  const music = useSettings((s) => s.music);
  const track = useSettings((s) => s.musicTrack);
  const sound = useSettings((s) => s.sound);
  const setAudio = useSettings((s) => s.setAudio);
  const current: MusicChoice | 'off' = music ? track : 'off';

  const strips: Strip[] = [
    ...MUSIC.map((m) => {
      const e = manifest?.music[m.id];
      return {
        value: m.id,
        title: e?.title || t(`audio.tracks.${m.id}.title`),
        sub: e?.artist ? t('audio.byArtist', { artist: e.artist }) : t(`audio.tracks.${m.id}.vibe`),
      };
    }),
    {
      value: SHUFFLE,
      title: t('audio.shuffle'),
      sub: t('audio.shuffleHelp'),
      icon: <IconShuffle size={18} />,
    },
    {
      value: 'off',
      title: t('audio.off'),
      sub: t('audio.offHelp'),
      icon: <IconSpeakerOff size={18} />,
    },
  ];

  const choose = (v: MusicChoice | 'off') =>
    setAudio(v === 'off' ? { music: false } : { music: true, musicTrack: v });

  return (
    <div role="radiogroup" aria-label={t('audio.track')} className="jukebox">
      {strips.map((s, i) => {
        const on = s.value === current;
        return (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => choose(s.value)}
            className={`strip ${s.value === 'off' ? 'strip-muted' : ''}`}
            data-testid={`${testPrefix}-${s.value}`}
          >
            <span className="strip-code" aria-hidden>
              {s.icon ?? CODES[i]}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-sign text-[1.02rem] leading-tight">{s.title}</span>
              <span className="truncate text-[0.8rem] font-bold text-narra-600">{s.sub}</span>
            </span>
            {on && s.value !== 'off' && sound && <Eq />}
          </button>
        );
      })}
    </div>
  );
}

/** The master switch. Turning sound back on confirms with a click (the tap itself was silent). */
function setSound(setAudio: (p: { sound: boolean }) => void, sound: boolean): void {
  setAudio({ sound });
  if (sound) play('ui.toggleOn');
}

// ---------------------------------------------------------------- the settings section

/** "Tunog at vibrate": master, effects, music (jukebox), bar ambience, mixing, haptics, test. */
export function SoundSettings() {
  const { t } = useTranslation();
  const s = useSettings();
  const off = !s.sound;
  return (
    <div className="flex flex-col divide-y divide-white/8" data-testid="sound-settings">
      <div className="py-2">
        <Toggle
          checked={s.sound}
          onChange={(sound) => setSound(s.setAudio, sound)}
          label={t('settings.sound')}
          description={t('audio.soundHelp')}
          testId="toggle-sound"
        />
      </div>
      <Fader
        label={t('audio.master')}
        value={s.masterVolume}
        onChange={(masterVolume) => s.setAudio({ masterVolume })}
        onCommit={() => play('ui.select')}
        disabled={off}
        testId="fader-master"
      />
      <Fader
        label={t('audio.sfx')}
        help={t('audio.sfxHelp')}
        value={s.sfxVolume}
        onChange={(sfxVolume) => s.setAudio({ sfxVolume })}
        onCommit={() => play('card.place')}
        disabled={off}
        testId="fader-sfx"
      />

      <div className="flex flex-col gap-2 py-3">
        <Toggle
          checked={s.music}
          onChange={(music) => s.setAudio({ music })}
          label={t('audio.music')}
          description={t('audio.musicHelp')}
          testId="toggle-music"
        />
        <TrackPicker />
      </div>
      <Fader
        label={t('audio.musicVolume')}
        value={s.musicVolume}
        onChange={(musicVolume) => s.setAudio({ musicVolume })}
        disabled={off || !s.music}
        testId="fader-music"
      />

      <div className="py-2">
        <Toggle
          checked={s.ambience}
          onChange={(ambience) => s.setAudio({ ambience })}
          label={t('audio.ambience')}
          description={t('audio.ambienceHelp')}
          testId="toggle-ambience"
        />
      </div>
      {s.ambience && (
        <Fader
          label={t('audio.ambienceVolume')}
          value={s.ambienceVolume}
          onChange={(ambienceVolume) => s.setAudio({ ambienceVolume })}
          disabled={off}
          testId="fader-ambience"
        />
      )}

      <div className="py-2">
        <Toggle
          checked={s.mixWithOthers}
          onChange={(mixWithOthers) => s.setAudio({ mixWithOthers })}
          label={t('audio.mix')}
          description={t('audio.mixHelp')}
          testId="toggle-mix"
        />
      </div>
      <div className="py-2">
        <Toggle
          checked={s.haptics}
          onChange={(haptics) => {
            s.setAudio({ haptics });
            if (haptics) haptic('success');
          }}
          label={t('audio.haptics')}
          description={t('audio.hapticsHelp')}
          testId="toggle-haptics"
        />
      </div>

      <div className="flex items-center gap-3 py-3">
        <p className="min-w-0 flex-1 text-sm text-capiz-400">{t('audio.testHelp')}</p>
        <button
          type="button"
          className="btn btn-wood shrink-0 gap-2 border-brass-600 text-brass-200"
          onClick={testSample}
          disabled={off}
          data-sfx="none"
          data-testid="sound-test"
        >
          <IconSpeaker size={20} />
          {t('audio.test')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Play top bar

const HOLD_MS = 450;

/**
 * The Play screen's speaker: a tap mutes / unmutes everything (effects and music), a long press
 * opens a small sheet with the track picker and the music volume.
 */
export function SpeakerButton() {
  const { t } = useTranslation();
  const sound = useSettings((s) => s.sound);
  const setAudio = useSettings((s) => s.setAudio);
  const [sheet, setSheet] = useState(false);
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  const longPressed = useRef(false);

  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  useEffect(() => cancel, []);

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={sound}
        aria-label={t('audio.speaker')}
        title={t('audio.speakerHint')}
        className="icon-btn speaker-btn"
        data-holding={holding}
        data-testid="speaker"
        onPointerDown={() => {
          longPressed.current = false;
          setHolding(true);
          timer.current = window.setTimeout(() => {
            longPressed.current = true;
            setHolding(false);
            timer.current = null;
            haptic('select');
            setSheet(true);
          }, HOLD_MS);
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          setSound(setAudio, !sound);
        }}
        data-sfx={sound ? 'toggle' : 'none'}
      >
        {sound ? <IconSpeaker /> : <IconSpeakerOff className="text-sili-500" />}
      </button>
      <QuickSoundSheet open={sheet} onClose={() => setSheet(false)} />
    </>
  );
}

/** Sound on/off, the jukebox and the music volume, without leaving the game. */
export function QuickSoundSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const s = useSettings();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <IconNote size={20} />
          {t('audio.quickTitle')}
        </span>
      }
      testId="sound-sheet"
    >
      <div className="flex flex-col gap-1">
        <Toggle
          checked={s.sound}
          onChange={(sound) => setSound(s.setAudio, sound)}
          label={t('settings.sound')}
          testId="quick-sound"
        />
        <div className="pt-2">
          <TrackPicker testPrefix="quick-track" />
        </div>
        <Fader
          label={t('audio.musicVolume')}
          value={s.musicVolume}
          onChange={(musicVolume) => s.setAudio({ musicVolume })}
          disabled={!s.sound || !s.music}
          testId="quick-music-volume"
        />
        <button
          type="button"
          className="btn btn-ghost text-capiz-300 underline"
          onClick={() => navigate('/settings')}
        >
          {t('audio.moreSettings')}
        </button>
      </div>
    </Sheet>
  );
}
