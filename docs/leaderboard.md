# The shared leaderboard

The menu has a leaderboard: players ranked by stars, then by rooms finished. A room counts as finished once a night in it has been won. Until it is set up online, the board shows the players on the computer it is played on (`localBoard` in `src/core/board.js`). Set it up once, as below, and everyone who plays the game, wherever they play, appears on the same board (`sharedBoard`).

The game is a static site on GitHub Pages, so the board lives in a free [Supabase](https://supabase.com) database, which the game reads and writes through Supabase's REST API.

## Setting it up (about ten minutes)

1. **Create a Supabase project.** Sign up at supabase.com, then *New project*. Any name and region will do, and the free plan is enough.
2. **Make the table.** Open the project's *SQL Editor*, paste this in and run it:

   ```sql
   create table public.scores (
     id text primary key check (char_length(id) between 8 and 64),
     name text not null check (char_length(name) between 1 and 16),
     stars int not null default 0 check (stars between 0 and 300),
     finished int not null default 0 check (finished between 0 and 100),
     updated_at timestamptz not null default now()
   );

   alter table public.scores enable row level security;

   create policy "the board is public" on public.scores for select using (true);
   create policy "players add themselves" on public.scores for insert with check (true);
   create policy "players update their line" on public.scores for update using (true) with check (true);
   ```

3. **Copy two values** from *Project Settings → API* (also shown under *Connect*):
   - the **Project URL**, like `https://abcdefghijklmnop.supabase.co`;
   - the **publishable** key, starting `sb_publishable_`. Older projects call it the **anon public** key, a long string starting `eyJ`; either works.

   Do **not** use the secret key (`sb_secret_…`, or `service_role` on older projects): it bypasses all the rules and must never be in a web page.
4. **Turn the board on.** Put the two values in `harness/board-config.js`:

   ```js
   export const BOARD = { url: 'https://abcdefghijklmnop.supabase.co', key: 'sb_publishable_...' };
   ```

   Then commit and push. The publishable key is meant to be public: it is in every visitor's browser, and the table's rules above limit what it can do.

The game's board is set up this way: project `gkltomqhzgnfjuxdzsuw`, in `harness/board-config.js`.

From then on, each player's line goes to the table after every night, and when they first type their name in. The menu's board says "everyone, online". If the table can't be reached, the menu shows this computer's players for the moment and says so.

## What to know

- **It runs on trust.** There are no accounts, so anyone who reads the page's code could write any score into the table. That is fine for a class project. The checks in the table stop nonsense values: at most 300 stars, a name of 16 characters or fewer.
- **Names are what players type.** A player is told apart by a random id kept on their computer, so two people called "Sam" on different computers are two lines. One person on two computers is also two lines.
- **To clear the board,** run `delete from public.scores;` in the SQL Editor.
- **The code:**
  - `src/core/board.js` reads the top ten (`select … order=stars.desc,finished.desc`) and upserts a player's line (`POST …?on_conflict=id` with `Prefer: resolution=merge-duplicates`);
  - `tests/core/players.test.js` checks those requests against a fake `fetch`;
  - `src/core/players.js` keeps each name's stars.
