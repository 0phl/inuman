# Third-party asset licenses

Every third-party asset used to build the shipped files in `public/assets/` is listed here.
Only CC0 sources are allowed. Downloads are fetched by `assets-src/blender/fetch_assets.py`
into `assets-src/blender/downloads/` (gitignored).

## Environment: dive bar (`public/assets/env/dive-bar/`)

All entries below are from [Poly Haven](https://polyhaven.com) under **CC0 1.0** (public domain,
no attribution required; credited anyway).

| Asset | Type | Used for | Source URL | License | Author(s) |
|---|---|---|---|---|---|
| Warm Bar (`warm_bar`, 1k HDR) | HDRI | `env.hdr` (reflections on mid/high tiers), unmodified | https://polyhaven.com/a/warm_bar | CC0 | Greg Zaal (photography), Jarod Guest (processing) |
| Wood Table Worn (`wood_table_worn`, 1k) | Texture | Table: base colour (graded darker/less saturated), roughness, normal | https://polyhaven.com/a/wood_table_worn | CC0 | Dimitrios Savva (photography), Rico Cilliers (processing) |
| Dirty Tiles (`dirty_tiles`, 2k) | Texture | Floor (baked) | https://polyhaven.com/a/dirty_tiles | CC0 | Matterfield (photography), Jenelle van Heerden (processing) |
| Painted Plaster Wall (`painted_plaster_wall`, 2k) | Texture | Upper walls, ceiling (tinted, baked) | https://polyhaven.com/a/painted_plaster_wall | CC0 | Amal Kumar |
| Wood Plank Wall (`wood_plank_wall`, 2k) | Texture | Wainscot (baked) | https://polyhaven.com/a/wood_plank_wall | CC0 | Dimitrios Savva |
| Wooden Panels (`wooden_panels`, 2k) | Texture | Bar counter front (baked) | https://polyhaven.com/a/wooden_panels | CC0 | Dimitrios Savva |
| Dark Wood (`dark_wood`, 2k) | Texture | Counter top, back-bar shelves (baked) | https://polyhaven.com/a/dark_wood | CC0 | Dario Barresi (baking), Dimitrios Savva (photography), Rico Cilliers (tiling) |
| Dark Wooden Planks (`dark_wooden_planks`, 1k) | Texture | Back-bar cabinet, videoke cabinet (baked) | https://polyhaven.com/a/dark_wooden_planks | CC0 | Amal Kumar |
| Plastic Monobloc Chair 01 (`plastic_monobloc_chair_01`, 1k glTF) | Model | Chairs (tinted, baked) | https://polyhaven.com/a/plastic_monobloc_chair_01 | CC0 | Kuutti Siitonen |
| Plastic Crate 02 (`plastic_crate_02`, 1k glTF) | Model | Beer crates (decimated, baked) | https://polyhaven.com/a/plastic_crate_02 | CC0 | Fabi_G |
| Television 01 (`Television_01`, 1k glTF) | Model | Videoke TV (baked) | https://polyhaven.com/a/Television_01 | CC0 | Gabriel Radić |
| Painted Wooden Stool (`painted_wooden_stool`, 1k glTF) | Model | Stool with ice bucket (baked) | https://polyhaven.com/a/painted_wooden_stool | CC0 | Kirill Sannikov |

Original work (no third-party licence): everything else in the scene is modelled procedurally
in `assets-src/blender/build_dive_bar.py`, including the room, bar counter, back bar, bottles
(generic, no labels or brands), chiller, videoke cabinet and speaker, pendant lamp, and the
"INUMAN" neon sign.

## Audio (`public/assets/audio/`)

Built by `pnpm audio` (`scripts/build-audio.mjs`) from the recipes in `assets-src/audio/recipes.json`.
Sources are fetched by `node assets-src/audio/fetch.mjs` into `assets-src/audio/downloads/` (gitignored);
`--verify` re-checks each source page for its licence. Licence rules for audio: sound effects and
ambience are **CC0 only**; music is **CC0 or CC-BY** (no NC/ND). Every licence below was checked on
its source page. The same list ships in `public/assets/audio/manifest.json` (`credits`, with the ids
each source is used for).

### Music (CC-BY 4.0: attribution required)

| Track | Used for | Source URL | Licence | Author |
|---|---|---|---|---|
| Clear Air | `opm-acoustic` (`music/opm-acoustic.mp3`) | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100626 | CC-BY 4.0 | Kevin MacLeod (incompetech.com) |
| Study And Relax | `lofi-lounge` (`music/lofi-lounge.mp3`) | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1900030 | CC-BY 4.0 | Kevin MacLeod (incompetech.com) |
| Newer Wave | `retro-videoke` (`music/retro-videoke.mp3`) | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN2000024 | CC-BY 4.0 | Kevin MacLeod (incompetech.com) |

Attribution lines to show in the app credits:

- "Clear Air" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/
- "Study And Relax" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/
- "Newer Wave" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/

### Sound effects and ambience (CC0 1.0)

| Asset | Used for | Source URL | Licence | Author |
|---|---|---|---|---|
| Opening a bottle of beer.WAV | `ui.gameStart` | https://freesound.org/people/13GPanska_Gorbusinova_Anna/sounds/377991/ | CC0 1.0 | 13GPanska_Gorbusinova_Anna |
| Ping pong impact the table.WAV | `ball.rim` | https://freesound.org/people/14FPanskaBubik_Lukas/sounds/418555/ | CC0 1.0 | 14FPanskaBubik_Lukas |
| Dice (3) slam on felt.wav | `cup.slam` | https://freesound.org/people/2BACH/sounds/185977/ | CC0 1.0 | 2BACH |
| Car horn beep beep two beeps honk honk | `bus.horn` | https://freesound.org/people/AmishRob/sounds/423990/ | CC0 1.0 | AmishRob |
| Wooden clicks.wav | `ui.tap`, `ui.tapPrimary` | https://freesound.org/people/Anzbot/sounds/565027/ | CC0 1.0 | Anzbot |
| Plastic cup | `flip.fail` | https://freesound.org/people/avreference/sounds/707395/ | CC0 1.0 | avreference |
| Whoosh For Whip Zoom | `flip.whoosh`, `throw.whoosh`, `ui.pass`, `wheel.whoosh` | https://freesound.org/people/BennettFilmTeacher/sounds/486234/ | CC0 1.0 | BennettFilmTeacher |
| Dice Cup | `dice.shake`, `dice.throw` | https://freesound.org/people/Breviceps/sounds/466141/ | CC0 1.0 | Breviceps |
| Wine Glass Clinks (5), Heavy | `ambience.bar`, `drink.cheers`, `drink.social` | https://freesound.org/people/CHallSmith/sounds/870720/ | CC0 1.0 | CHallSmith |
| Plastic-Cup.wav | `ball.rim`, `cup.rerack`, `flip.land`, `flip.whoosh` | https://freesound.org/people/chebere1001/sounds/153395/ | CC0 1.0 | chebere1001 |
| Glass ding 2 | `bottle.select` | https://freesound.org/people/Counter-gamer/sounds/404105/ | CC0 1.0 | Counter-gamer |
| Coin on glass 3 | `coin.rim` | https://freesound.org/people/D4XX/sounds/617039/ | CC0 1.0 | D4XX |
| Cup Drop | `cup.rerack`, `flip.land` | https://freesound.org/people/davdud101/sounds/150501/ | CC0 1.0 | davdud101 |
| Pouring water in a glass | `ui.water` | https://freesound.org/people/DenysFontanarosa/sounds/579752/ | CC0 1.0 | DenysFontanarosa |
| Ambience_Bar_No_Music.wav | `ambience.bar` | https://freesound.org/people/Dokuta_Gerovv/sounds/661686/ | CC0 1.0 | Dokuta_Gerovv |
| Coin Dropped:Bounced on Wooden Desk (Longer Sound).mp3 | `coin.bounce` | https://freesound.org/people/dominictreis/sounds/334939/ | CC0 1.0 | dominictreis |
| Fishing Lure Plop Water - Game SFX (2 or 2) | `ball.plop` | https://freesound.org/people/el_boss/sounds/853279/ | CC0 1.0 | el_boss |
| Playing Card Deal Variation 1 | `card.flip` | https://freesound.org/people/el_boss/sounds/571577/ | CC0 1.0 | el_boss |
| Toasting on Glasses | `drink.social` | https://freesound.org/people/elricadavis/sounds/764616/ | CC0 1.0 | elricadavis |
| money5.wav | `coin.bounce` | https://freesound.org/people/florian_reinke/sounds/63524/ | CC0 1.0 | florian_reinke |
| flipping a small coin | `coin.bounce` | https://freesound.org/people/florianreichelt/sounds/447462/ | CC0 1.0 | florianreichelt |
| quick empty wine bottle spin - 1 | `bottle.spin`, `bottle.stop` | https://freesound.org/people/FOSSarts/sounds/762366/ | CC0 1.0 | FOSSarts |
| Cachos y dados.mp3 | `cup.lift`, `dice.throw` | https://freesound.org/people/Frankail/sounds/151165/ | CC0 1.0 | Frankail |
| Empty Beer Bottles Clinking, Clanking.wav | `ambience.bar`, `drink.social` | https://freesound.org/people/Fugeni/sounds/416288/ | CC0 1.0 | Fugeni |
| drinking cup slide | `cup.remove`, `cup.rerack` | https://freesound.org/people/getwecked/sounds/765084/ | CC0 1.0 | getwecked |
| Dropping ping pong ball on table 2 | `ball.bounce` | https://freesound.org/people/giddster/sounds/414461/ | CC0 1.0 | giddster |
| Plastic cup falling on wooden table | `flip.fail` | https://freesound.org/people/grizzlypwn/sounds/347950/ | CC0 1.0 | grizzlypwn |
| Casino Audio (pack) | `bus.crash`, `card.fan`, `card.place`, `card.slide`, `chips.stack`, `dice.grab`, `dice.hitTable`, `dice.hitWall` | https://kenney.nl/assets/casino-audio | CC0 1.0 | Kenney (kenney.nl) |
| Impact Sounds (pack) | `dice.hitWall`, `wheel.stop` | https://kenney.nl/assets/impact-sounds | CC0 1.0 | Kenney (kenney.nl) |
| Music Jingles (pack) | `game.lose`, `game.roundOver`, `game.sting`, `game.win` | https://kenney.nl/assets/music-jingles | CC0 1.0 | Kenney (kenney.nl) |
| RPG Audio (pack) | `cup.lift` | https://kenney.nl/assets/rpg-audio | CC0 1.0 | Kenney (kenney.nl) |
| Pour Beer Into Glass #1 | `pour.beer` | https://freesound.org/people/Kinoton/sounds/347006/ | CC0 1.0 | Kinoton |
| Riffle Card Shuffle | `card.shuffle` | https://freesound.org/people/Kodack/sounds/256508/ | CC0 1.0 | Kodack |
| Button click | `ui.select` | https://freesound.org/people/Kolombooo/sounds/629020/ | CC0 1.0 | Kolombooo |
| plastic cup down.flac | `cup.rerack`, `flip.whoosh` | https://freesound.org/people/kyles/sounds/637753/ | CC0 1.0 | kyles |
| Plastic Ting.wav | `ball.rim` | https://freesound.org/people/LuttoAudio/sounds/170236/ | CC0 1.0 | LuttoAudio |
| Bottles Clinking.aif | `ambience.bar`, `drink.cheers`, `drink.social` | https://freesound.org/people/MegaPenguin13/sounds/118199/ | CC0 1.0 | MegaPenguin13 |
| Opening Beer Bottle 170428_1469.wav | `ui.gameStart` | https://freesound.org/people/megashroom/sounds/390337/ | CC0 1.0 | megashroom |
| Ping pong ball hit | `ball.rim` | https://freesound.org/people/michorvath/sounds/269718/ | CC0 1.0 | michorvath |
| clink glasses.wav | `drink.social` | https://freesound.org/people/Mikes-MultiMedia/sounds/349691/ | CC0 1.0 | Mikes-MultiMedia |
| toy ratchet.wav | `wheel.stop`, `wheel.tick` | https://freesound.org/people/monotraum/sounds/376195/ | CC0 1.0 | monotraum |
| Solo cup clink water splashback.wav | `ball.plop` | https://freesound.org/people/MootMcnoodles/sounds/444410/ | CC0 1.0 | MootMcnoodles |
| rolling dice 1.wav | `dice.hitDie` | https://freesound.org/people/nettimato/sounds/353975/ | CC0 1.0 | nettimato |
| Plastic cup dropping | `cup.rerack` | https://freesound.org/people/oztrum/sounds/401773/ | CC0 1.0 | oztrum |
| First Person Ball Water Drop Splash | `ball.plop` | https://freesound.org/people/qubodup/sounds/867498/ | CC0 1.0 | qubodup |
| Card Deal | `card.flip` | https://freesound.org/people/RealSquink/sounds/787405/ | CC0 1.0 | RealSquink |
| Wine Glass Clink1.m4a | `ambience.bar`, `drink.cheers` | https://freesound.org/people/RoyalRose/sounds/560299/ | CC0 1.0 | RoyalRose |
| Light Switch Click On and Off | `ui.toggleOff`, `ui.toggleOn` | https://freesound.org/people/SomeoneCool15/sounds/423512/ | CC0 1.0 | SomeoneCool15 |
| shot glass slam.aif | `drink.finish` | https://freesound.org/people/soundboy2000/sounds/205880/ | CC0 1.0 | soundboy2000 |
| flipCard.wav | `card.flip` | https://freesound.org/people/Splashdust/sounds/84322/ | CC0 1.0 | Splashdust |
| Glass cup pick up put down on wood table.wav | `drink.finish` | https://freesound.org/people/SpliceSound/sounds/218333/ | CC0 1.0 | SpliceSound |
| soda bottle open | `ui.gameStart` | https://freesound.org/people/supersnd/sounds/350618/ | CC0 1.0 | supersnd |
| Drop Coin into Glass | `coin.ding` | https://freesound.org/people/thedapperdan/sounds/199922/ | CC0 1.0 | thedapperdan |
| Wine Glass clank 1 | `ambience.bar`, `drink.social` | https://freesound.org/people/wasserbjorn/sounds/761135/ | CC0 1.0 | wasserbjorn |
| Swinging axe.mp3 | `dice.throw`, `flip.whoosh`, `throw.whoosh` | https://freesound.org/people/ZHRØ/sounds/514162/ | CC0 1.0 | ZHRØ |

Freesound files are the public HQ preview MP3s of the CC0 originals; Kenney sounds come from the pack zips linked on each pack page.

Original work (no third-party licence; CC0, made for this project): sounds synthesized offline by
`assets-src/audio/synth.mjs`. Fully synthesized: `ui.back`, `ui.sheetOpen`, `ui.sheetClose`, `ui.error`, `ui.success`, `ui.notice`, `ui.reveal`, `drink.give`, `game.correct`, `game.wrong`, `game.tie`, `game.streak`. Partly synthesized: `bottle.spin` (a synthesized spinning-bottle grind convolved with a recorded bottle ring, which is credited above).
