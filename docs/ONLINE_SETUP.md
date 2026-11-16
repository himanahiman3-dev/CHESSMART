# Chessmart Online backend

This folder provides the server side for real friend games. The frontend intentionally does not contain a Supabase service-role key.

## Supabase setup

1. Create a Supabase project and enable **Authentication → Providers → Anonymous Sign-ins**.
2. Run supabase/migrations/202611160001_online_chess.sql in the SQL editor.
3. Deploy the Edge Function with: supabase functions deploy game-action
4. Set the function secret: supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY. Supabase already provides SUPABASE_URL and SUPABASE_ANON_KEY to Edge Functions.
5. Set these public build variables in the website host and rebuild:
   - VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   - VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY

Never put SUPABASE_SERVICE_ROLE_KEY in a Vite variable or browser bundle.

## What the server implements

- Anonymous player sessions managed by Supabase Auth.
- Private invite rooms with a seven-character challenge code.
- A second player can join from a copied challenge link.
- Server-side legality checks for every UCI move using chess.js.
- Server timestamps and increment clocks; the browser cannot submit a new FEN.
- Checkmate, stalemate, insufficient material, threefold repetition, resignation and timeout results.
- Separate Bullet, Blitz and Rapid ratings. A PostgreSQL function locks the completed game and both player profiles, updates both ratings in one transaction, and records that the rating has been applied exactly once. The K-factor is 40 for the first 30 games and 32 after that.
- Optimistic position checks prevent two requests from applying moves to the same old board state.

## Scope and fair play

This is the friend-challenge foundation, not a full public matchmaking network yet. It does not provide friend search, ranked queues, tournaments, chat, moderation or strong anti-cheat detection. Do not use external engines during rated games. A server-validated legal move is not proof that a player did not receive outside assistance.

Puzzle ratings and bot ratings stored locally are separate from these online ratings.