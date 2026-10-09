# Inuman 🍺

**3D drinking games for the barkada.** One phone, passed around the table. Thirteen games in a
semi-realistic dive bar, in Filipino (Taglish) or English. Installable, and it works offline once
loaded.

> 18+ only. Hinay-hinay lang: there's a non-alcoholic mode, a per-turn sip cap, water reminders,
> and walang magda-drive nang lasing.

---

## The games

|          | Game                     | How it plays                                                                     |
| -------- | ------------------------ | -------------------------------------------------------------------------------- |
| 🃏 Cards | **Higher or Lower**      | Guess whether the next card is higher or lower.                                  |
|          | **King's Cup**           | Draw a card, follow its rule (editable), and don't pull the last King.           |
|          | **Ride the Bus**         | Guess four cards in a row, survive the pyramid, or ride the bus.                 |
| 🎲 Dice  | **Mexico**               | Roll two dice under the cup; the lowest score drinks.                            |
|          | **Liar's Dice**          | Bid on hidden dice and call out the liar (private peeks, pass-the-phone covers). |
|          | **Ship, Captain & Crew** | Roll a 6-5-4, then score with your crew.                                         |
| 🎯 Skill | **Beer Pong**            | Flick to throw. Real physics, re-racks, and an aim-assist rule.                  |
|          | **Flip Cup**             | Drink, then flick your cup over. Fastest team wins.                              |
|          | **Quarters**             | Bounce a coin into the shot glass.                                               |
| 🎉 Party | **Spin the Bottle**      | Flick the bottle; whoever it points at is up.                                    |
|          | **Truth or Dare**        | Spin the wheel. Chicken out and you drink.                                       |
|          | **Never Have I Ever**    | Drink if you've done it. No lying!                                               |
|          | **Most Likely To**       | Point, or vote in secret, for whoever fits the card.                             |

## Features

- **Pass-and-play.** Players are names only: add, rename, reorder, sit someone out. Private turns
  (Liar's Dice, Mexico) hide behind a "pass the phone" cover.
- **A 3D bar.** One persistent WebGL stage with a baked Blender dive bar, physics dice and throws,
  and three graphics levels: High is the default, with Mid and Low for phones that lag.
- **Filipino and English.** The UI and every built-in prompt come in both languages and switch
  instantly.
- **Customizable.**
  - House rules for every game, with a form generated from each game's rules schema.
  - Drink intensity: multiplier, sips or _tagay_, per-turn cap, finish/chug allowed or not.
  - Look: card backs, felt color, dice finish and cup color.
  - Your own prompt packs: create, edit, share by link or QR, or import a file.
- **500+ built-in prompts** for Truth or Dare, Never Have I Ever and Most Likely To. Four spice
  levels go from _Pang-pamilya_ to **SPG (18+)**, which is opt-in.
- **Sound and haptics.** CC0 sound effects timed to the physics (dice knocks, a real bottle spin,
  ball plops), three background music tracks, and vibration on Android plus a tick on iOS.
- **PWA.** Install it to the home screen (there's an in-app prompt) and play offline.

---

## Getting started

Requirements: **Node 24** and **pnpm 11**.

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

### Scripts

| Command                                        | What it does                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                     | Vite dev server (`--host` is on, so phones on your Wi-Fi can open it)                               |
| `pnpm build`                                   | Typecheck and production build into `dist/` (with the service worker)                               |
| `pnpm preview`                                 | Serve the production build                                                                          |
| `pnpm typecheck` / `pnpm lint` / `pnpm format` | TypeScript, ESLint, Prettier                                                                        |
| `pnpm test`                                    | Unit tests (Vitest + fast-check)                                                                    |
| `pnpm e2e`                                     | Playwright end-to-end tests (Pixel 7 and iPhone 14 emulation; builds first)                         |
| `pnpm dice:check`                              | Rapier dice fairness check: 10k dice, remap mismatches, cocked-die retries                          |
| `pnpm throw:check`                             | Beer Pong and Quarters throw physics: make rates per aim-assist level, determinism, pre-sim timing  |
| `pnpm assets`                                  | Optimize the 3D models (meshopt geometry, WebP textures) and enforce the size budgets               |
| `pnpm audio`                                   | Rebuild the sound effects and music from `assets-src/audio/recipes.json` (`--check` validates only) |

### Playing on phones

Any static host works (Vercel, Netlify, GitHub Pages…): deploy `dist/` and open the **https** link.
Installing and offline play need https. Over plain `http://<your-ip>` on Wi-Fi the game still
runs, but it can't be installed.

- **Android (Chrome):** use the in-app _I-install_ button, or menu ⋮ → _Install app_.
- **iPhone (Safari):** Share → _Add to Home Screen_. The in-app button shows these steps.

### Performance bench

Open **`/bench`** on a phone to run all 13 scenes for a few seconds each. It reports frame times,
draw calls, device info and a "Copy results" button. Add **`?perf=1`** to any URL for a live FPS
overlay during real play, and `?perf=0` to turn it off.

---

## How it's built

**Stack:** React 19, TypeScript, Vite 8, Tailwind 4, three.js with react-three-fiber and drei,
Rapier physics, zustand, zod, i18next, vite-plugin-pwa, Vitest and Playwright.

```
src/
  core/       Pure TypeScript game engine: no React, DOM, three, Date or Math.random (ESLint-enforced)
    engine/     session reducer, seeded RNG, drink resolution (multiplier, caps, tagay, non-alcoholic)
    games/<id>/ one reducer per game: rules schema, actions, setup/validate/reduce/project
    content/    prompt-pack schemas and the built-in bilingual packs
    share/      share-link codec (#s=1.<base64url(deflate)>)
  games/<id>/ each game's 3D Scene and HUD (React)
  stage/      the single persistent <Canvas>: quality tiers, scene warm-up, the dive bar
  three/      shared 3D props: cards, dice, cups, bottle, coin
  physics/    Rapier pre-simulations (in a Web Worker) and their replays
  audio/      sound engine, music player, haptics, the sound catalog
  app/        routes: Home, Players, Games, Lobby, Play, Settings, Packs, Bench
  ui/  store/ i18n/
assets-src/   Blender sources, the audio pipeline, LICENSES.md
scripts/      asset/audio builds, physics checks, headless Blender runner
e2e/          Playwright specs
```

Some design choices worth knowing:

- **The core is pure and multiplayer-ready.** Every game is a serializable reducer
  (`GameLogic`), with its seeded RNG state stored in the session. `project(state, viewer)` strips
  hidden info, so a future room server could run `src/core` unchanged.
- **Outcome first, animation second.** The reducer rolls the dice. The physics pre-simulates a
  believable throw, and the mesh is rotated so the rolled face lands up. Fairness is exactly
  uniform and tested.
- **Skill games are physics-authoritative.** A flick becomes an impulse, Rapier simulates it in a
  worker, and the result is dispatched as an action.
- **Drinks are emitted in base sips.** One function applies the intensity settings, so no game
  handles drink amounts itself.
- **One Canvas, on demand.** `frameloop="demand"` keeps it idle unless something moves. Shaders
  and textures are warmed in the lobby, and the quality tier changes without remounting.

Adding a game, writing prompts and the Taglish style guide are covered in
[`CLAUDE.md`](./CLAUDE.md).

### Prompts and spice levels

Built-in packs live in `src/core/content/packs/<game>.json`, one pack per game. Each prompt's
`text` is in Filipino (Taglish), `alt.en` holds the English, and the app shows the one that
matches its language.

| Spice | Label                          | Content                                           |
| ----- | ------------------------------ | ------------------------------------------------- |
| 0     | Pang-pamilya / Family-friendly | Anyone can play                                   |
| 1     | Medyo maanghang / Mild         | Light teasing                                     |
| 2     | Maanghang / Spicy              | Crushes, dating, exes, drunk stories              |
| 3     | **SPG (18+)**                  | Adults-only, suggestive but never graphic; opt-in |

Dares that involve another player always say _"kung game siya / if they're okay with it."_ The
Taglish was written for a real barkada, so proofreading by native speakers is welcome.

---

## Assets and credits

- **3D:** the dive bar was modeled and light-baked in Blender (`assets-src/blender/`), from CC0
  sources.
- **Sound effects:** CC0 only, from Kenney, Freesound and synthesis.
- **Music:** Kevin MacLeod (incompetech.com), licensed under CC BY 4.0, and credited in the app's
  Settings: "Clear Air", "Study And Relax" and "Newer Wave".

The full per-file list (source, author, license) is in
[`assets-src/LICENSES.md`](./assets-src/LICENSES.md).

## Development notes

- **WSL users:** pnpm's `node_modules` uses symlinks that Windows can't follow. Open the folder in
  VS Code with _WSL: Reopen Folder in WSL_, or TypeScript will report missing types like
  `vite/client`.
- **E2E tests start on Low graphics** (software WebGL), with the install banner closed, via
  `playwright.config.ts`. `e2e/defaults.spec.ts` checks the real first-run defaults.
- **Commit style:** one commit per feature or milestone. Run `pnpm typecheck && pnpm lint &&
pnpm test` before pushing.

## License

No license has been chosen for the code yet, so all rights are reserved by default. Third-party
assets keep their own licenses; see `assets-src/LICENSES.md`.
