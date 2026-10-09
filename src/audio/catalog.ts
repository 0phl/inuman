// The sound contract shared by the asset pipeline (which sources a file per id) and the audio
// engine (which plays ids). Every id is played by name; files live in
// public/assets/audio/sfx/<id>[_<n>].mp3 and are listed in public/assets/audio/manifest.json.
// An id with no file falls back to a synthesized recipe in the engine, or stays silent.

export type Bus = 'ui' | 'sfx' | 'music' | 'ambience';

export interface SoundSpec {
  bus: Bus;
  /** What the file should sound like — the sourcing brief. */
  desc: string;
  /** Distinct takes to rotate through so repeats don't sound robotic. */
  variants: number;
  loop?: boolean;
}

export const SOUNDS = {
  // ── UI ──────────────────────────────────────────────────────────────────────────────
  'ui.tap': { bus: 'ui', desc: 'Soft, short wooden/plastic button click', variants: 3 },
  'ui.tapPrimary': { bus: 'ui', desc: 'Fuller confirm click for big primary buttons', variants: 2 },
  'ui.select': { bus: 'ui', desc: 'Tiny tick for selecting a chip, swatch or option', variants: 2 },
  'ui.toggleOn': { bus: 'ui', desc: 'Switch flicked on (slightly higher pitch)', variants: 1 },
  'ui.toggleOff': { bus: 'ui', desc: 'Switch flicked off (slightly lower pitch)', variants: 1 },
  'ui.back': { bus: 'ui', desc: 'Soft reverse swish for back/close navigation', variants: 1 },
  'ui.sheetOpen': {
    bus: 'ui',
    desc: 'Light upward swoosh as a bottom sheet slides up',
    variants: 1,
  },
  'ui.sheetClose': { bus: 'ui', desc: 'Light downward swoosh as a sheet closes', variants: 1 },
  'ui.error': { bus: 'ui', desc: 'Gentle dull thud / low buzz for an invalid action', variants: 1 },
  'ui.success': { bus: 'ui', desc: 'Short positive chime (saved, imported, done)', variants: 1 },
  'ui.notice': { bus: 'ui', desc: 'Gentle bell for a game notice toast', variants: 2 },
  'ui.pass': { bus: 'ui', desc: 'Quick whoosh: pass the phone to the next player', variants: 2 },
  'ui.reveal': { bus: 'ui', desc: 'Soft shimmer when a private cover is tapped open', variants: 1 },
  'ui.water': {
    bus: 'ui',
    desc: 'Water drops / pour into a glass (water-break reminder)',
    variants: 1,
  },
  'ui.gameStart': {
    bus: 'sfx',
    desc: 'Bottle cap popping off (psst + cap tink) to start a game',
    variants: 2,
  },

  // ── Drinks & results ────────────────────────────────────────────────────────────────
  'drink.cheers': {
    bus: 'sfx',
    desc: 'Glasses/bottles clinking together for a drink toast',
    variants: 3,
  },
  'drink.social': {
    bus: 'sfx',
    desc: 'Several glasses clinking at once (everyone drinks)',
    variants: 2,
  },
  'drink.finish': { bus: 'sfx', desc: 'Empty glass set down hard on a wooden table', variants: 2 },
  'drink.give': {
    bus: 'sfx',
    desc: 'Bright pluck/coin-like blip for handing sips out',
    variants: 1,
  },
  'game.correct': { bus: 'sfx', desc: 'Positive ding for a correct guess', variants: 2 },
  'game.wrong': { bus: 'sfx', desc: 'Playful "sablay" buzz/thud for a wrong guess', variants: 2 },
  'game.tie': { bus: 'sfx', desc: 'Two-note neutral blip for a tie', variants: 1 },
  'game.streak': { bus: 'sfx', desc: 'Rising chime for a streak or safe pass', variants: 1 },
  'game.roundOver': { bus: 'sfx', desc: 'Short jingle that closes a round', variants: 1 },
  'game.win': { bus: 'sfx', desc: 'Upbeat winner jingle (sax/steel-drum/brass feel)', variants: 1 },
  'game.lose': { bus: 'sfx', desc: 'Comic losing jingle (sad trombone feel)', variants: 1 },
  'game.sting': {
    bus: 'sfx',
    desc: "Dramatic reveal sting (Liar's Dice call, secret vote reveal)",
    variants: 1,
  },

  // ── Cards ───────────────────────────────────────────────────────────────────────────
  'card.slide': { bus: 'sfx', desc: 'Card sliding off a deck / across felt', variants: 4 },
  'card.flip': { bus: 'sfx', desc: 'Card snapped over face-up', variants: 3 },
  'card.place': { bus: 'sfx', desc: 'Card landing flat on felt', variants: 3 },
  'card.shuffle': { bus: 'sfx', desc: 'Riffle shuffle of a deck', variants: 1 },
  'card.fan': { bus: 'sfx', desc: 'Cards fanned / spread out in a ring', variants: 1 },

  // ── Dice ────────────────────────────────────────────────────────────────────────────
  'dice.grab': { bus: 'sfx', desc: 'Picking dice up off the table', variants: 1 },
  'dice.shake': {
    bus: 'sfx',
    desc: 'Dice rattling in a leather cup (short, loopable)',
    variants: 2,
  },
  'dice.throw': { bus: 'sfx', desc: 'Dice released from the hand/cup', variants: 2 },
  'dice.hitTable': {
    bus: 'sfx',
    desc: 'One die knocking on a wooden/felt tray (per impact)',
    variants: 4,
  },
  'dice.hitDie': { bus: 'sfx', desc: 'Die clicking against another die', variants: 3 },
  'dice.hitWall': { bus: 'sfx', desc: 'Die knocking a wooden tray wall', variants: 2 },
  'cup.slam': {
    bus: 'sfx',
    desc: 'Leather dice cup slammed upside down on the table',
    variants: 2,
  },
  'cup.lift': { bus: 'sfx', desc: 'Leather dice cup lifted off the table', variants: 1 },

  // ── Bottle & wheel ──────────────────────────────────────────────────────────────────
  'bottle.spin': {
    bus: 'sfx',
    desc: 'Glass bottle spinning on wood (loop; pitch follows speed)',
    variants: 1,
    loop: true,
  },
  'bottle.stop': {
    bus: 'sfx',
    desc: 'Glass bottle rocking to a stop with a soft knock',
    variants: 1,
  },
  'bottle.select': { bus: 'sfx', desc: 'Bright ding when the bottle picks someone', variants: 1 },
  'wheel.tick': { bus: 'sfx', desc: 'Prize-wheel flapper ticking past a peg', variants: 2 },
  'wheel.whoosh': { bus: 'sfx', desc: 'Wheel given a hard spin', variants: 1 },
  'wheel.stop': { bus: 'sfx', desc: 'Wheel thunking to rest', variants: 1 },

  // ── Beer pong, quarters, flip cup ───────────────────────────────────────────────────
  'throw.whoosh': { bus: 'sfx', desc: 'Light whoosh of a ball/coin being thrown', variants: 2 },
  'ball.bounce': { bus: 'sfx', desc: 'Ping-pong ball bounce on a wooden table', variants: 3 },
  'ball.rim': { bus: 'sfx', desc: 'Ping-pong ball tapping a plastic cup rim', variants: 2 },
  'ball.plop': {
    bus: 'sfx',
    desc: 'Ping-pong ball dropping into beer (plop + splash)',
    variants: 2,
  },
  'cup.remove': { bus: 'sfx', desc: 'Plastic party cup lifted/slid off the table', variants: 2 },
  'cup.rerack': { bus: 'sfx', desc: 'Several plastic cups shuffled into a new rack', variants: 1 },
  'coin.bounce': { bus: 'sfx', desc: 'Coin slapping the table and bouncing', variants: 3 },
  'coin.rim': { bus: 'sfx', desc: 'Coin clipping a shot glass rim', variants: 2 },
  'coin.ding': { bus: 'sfx', desc: 'Coin dropping into a glass (clink + rattle)', variants: 2 },
  'flip.whoosh': { bus: 'sfx', desc: 'Plastic cup flicked into a flip', variants: 2 },
  'flip.land': { bus: 'sfx', desc: 'Plastic cup landing upside down (clean clack)', variants: 2 },
  'flip.fail': { bus: 'sfx', desc: 'Plastic cup tipping over / wobbling back', variants: 2 },
  'pour.beer': { bus: 'sfx', desc: "Beer poured into a cup (King's Cup pour)", variants: 1 },
  'chips.stack': { bus: 'sfx', desc: 'Bottle caps / tokens stacking (vote tallies)', variants: 3 },
  'bus.horn': {
    bus: 'sfx',
    desc: 'Jeepney-style two-tone horn: beep-beep (Ride the Bus)',
    variants: 1,
  },
  'bus.crash': { bus: 'sfx', desc: 'Cards scattering when the bus run fails', variants: 1 },

  // ── Ambience ────────────────────────────────────────────────────────────────────────
  'ambience.bar': {
    bus: 'ambience',
    desc: 'Low bar room tone: murmur, distant clinks (loop)',
    variants: 1,
    loop: true,
  },
} as const satisfies Record<string, SoundSpec>;

export type SoundId = keyof typeof SOUNDS;

export interface MusicTrack {
  id: string;
  /** The brief the asset pipeline sources against. */
  vibe: string;
}

export const MUSIC: readonly MusicTrack[] = [
  { id: 'opm-acoustic', vibe: 'Chill OPM-style acoustic guitar; warm, laid-back night-out feel' },
  { id: 'lofi-lounge', vibe: 'Lo-fi / jazzy bar-lounge beat that stays in the background' },
  { id: 'retro-videoke', vibe: 'Playful 80s/90s synth-pop instrumental, videoke-bar energy' },
];

export type MusicId = (typeof MUSIC)[number]['id'];
