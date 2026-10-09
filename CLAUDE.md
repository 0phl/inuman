# Inuman — 3D drinking games (pass-and-play PWA, Taglish-first)

Approved plan: `~/.claude/plans/glimmering-prancing-token.md`. Commands: `pnpm dev | build | test | lint | typecheck | e2e`.

## Architecture rules
- `src/core/` is **pure TypeScript** (ESLint-enforced): no React/three/DOM/storage, no `Date`, no `Math.random`.
  All randomness comes from `ctx.rng` (seeded, stored in session state). A future room server imports core unchanged.
- A game = `src/core/games/<id>/logic.ts` exporting a `GameLogic<State, Action, Rules>` (see `src/core/engine/types.ts`)
  plus `logic.test.ts`. Register it in `src/core/games/registry.ts`. Pattern to copy: `higher-lower/logic.ts`.
  - `rulesSchema`: zod object; **every field** has `.default()` and `.meta({ label: 'rules.<game>.<field>' })`.
    The rules editor UI is generated from `z.toJSONSchema(rulesSchema, { io: 'input' })`.
  - `actionSchema`: zod discriminated union on `type`. `validate()` returns an i18n error key or null;
    actor `'host'` is the trusted local device, a PlayerId is a remote seat (check turn ownership).
  - `reduce()` returns `{ state, effects }`. Games emit drinks in **base sips** via `{ type: 'drink', ... }`;
    never apply intensity in a game — `src/core/engine/drink.ts#resolveDrink` does multiplier/cap/tagay/non-alcoholic.
    `kind: 'give'` means the `to` players *hand out* those sips (shown, not logged as drunk); a player picked to
    drink (Kings Cup "Ikaw", Quarters pick) gets a plain `'drink'`.
  - `project(state, viewer)` must strip hidden info (deck order, other players' dice). The UI renders only views.
  - State must be JSON-serializable (no Map/Set/class instances).
- `src/core/engine/session.ts` wraps every game (`startSession`, `sessionReducer`).
- Physics (Rapier) only in `src/stage`, `src/three`, `src/physics`, game `Scene.tsx`. Chance outcomes come from the
  reducer's RNG first; physics only animates them. Skill-game physics results are dispatched as actions.

## i18n
- Locales: `taglish` (default) and `en`; `fallbackLng: { taglish: ['en'] }`; `<html lang="fil">` for Taglish.
- Namespaces: `src/i18n/locales/<locale>/common.json` (UI) and `games.json` (rules labels, effect reasons,
  card meanings). Default NS `common`, `fallbackNS: 'games'`, so core keys like `hl.reason.wrong` resolve directly.
- Data strings that start with `i18n:` are translation keys (e.g. default Kings Cup meanings); anything else is
  user-written literal text. Resolve with the `tx()` helper in the UI.
- Taglish = natural Filipino barkada code-switching (e.g. "Tagay mo na!", "Sino natalo?"), not formal Tagalog
  and not machine-translated slang. Keep English loanwords where Filipinos actually use them.

## Content
- Built-in prompt packs: `src/core/content/packs/<locale>/<game>.json`, validated by `PromptPackSchema`.
  Spice 0 family-friendly, 1 light teasing, 2 crushes/dating/exes, 3 "SPG (18+)": adults-only sexy prompts (opt-in;
  suggestive, never graphic; dares with another player always say "if they're okay with it"; nothing involving
  minors, nudity or posting outside the room). Placeholders: `{player}`, `{random}`, `{left}`, `{right}`.

## Product constraints
- Players are names only — no avatars. Responsible-drinking defaults: finish/chug off, per-turn cap, water reminders,
  non-alcoholic mode and per-player flags, 18+ gate.
- Mobile-first (budget Android): one persistent `<Canvas>`, `frameloop="demand"` unless physics is awake,
  DPR clamped per quality tier, no OrbitControls during play.
