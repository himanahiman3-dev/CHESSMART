# CHESSMART accounts and online backend

The website remains a **Render Static Site**. Supabase hosts the database, account authentication and server-side game functions; no always-on Render web service is required.

## 1. Create the Supabase project

1. Create a project in Supabase.
2. In Authentication → Providers, make sure the **Email** provider is enabled. The app creates and confirms users through the server Admin API.
3. Copy the Project URL and the public anon/publishable key from Project Settings → API.

## 2. Apply the database migrations

Run these files in the Supabase SQL Editor, in this order:

1. supabase/migrations/202611160001_online_chess.sql
2. supabase/migrations/202611160002_accounts_matchmaking.sql
3. supabase/migrations/202611170001_account_avatars.sql
4. supabase/migrations/202611170002_player_progress_sync.sql
5. supabase/migrations/20261117180000_fix_matchmaking_pgcrypto_search_path.sql

The first migration creates online profiles, games and protected Elo updates. The second adds nickname-account matchmaking, the queue, direct invitations and rate limits for registration/login. The third adds avatar URLs to online profiles and creates the public avatar-storage bucket. The fourth enables protected cloud progress snapshots and version history. The fifth makes the matchmaking function resolve pgcrypto from Supabase's `extensions` schema. Apply all five migrations in order.

## 3. Deploy the Edge Function

From the repository root, with the Supabase CLI linked to this project:

    supabase functions deploy game-action
    supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY

Supabase provides SUPABASE_URL and SUPABASE_ANON_KEY to the Edge Function. The Service Role key stays server-side and must never be put in a VITE_ variable.

## 4. Configure Render Static Site

In Render Dashboard → your Static Site → Environment, add:

- VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
- VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY

Save and rebuild/redeploy the static site. Vite embeds public VITE_ variables at build time, so a redeploy is required after changing them.

## Accounts

Players register with a unique nickname (3–18 lowercase Latin letters, digits or _) and a password of at least 8 characters. They may choose an avatar during registration and change it later from the online account screen. Avatar images are center-cropped, resized to 512×512 WebP and limited to 1 MB after processing. No email is required. The account uses a private synthetic email address only for Supabase Auth, so password recovery is not available yet. Players must keep their password safe.

Online ratings are stored server-side and kept separately for Bullet, Blitz and Rapid. The local Stockfish rating and local puzzle rating are not used for matchmaking.

## Online play features

- Private game rooms and invitations by nickname.
- An incoming-invitations inbox where a challenge can be accepted or declined.
- "Find opponent" matchmaking by time-control category and current online Elo. The allowed rating gap expands while the player waits.
- Server-side validation of every UCI move, clocks with increments, resignation, timeout and draw rules.
- Elo changes are applied atomically by PostgreSQL once per completed rated game.
- The UI polls the Edge Function for game state and invitations; the board and clocks update while the page is open.

## Free-plan notes and limits

Supabase's Free plan includes Postgres, Auth and Edge Functions, but free projects can be paused after about a week of low activity. A paused project must be restored from the Supabase dashboard before accounts and online games work again. Render's Static Site can continue serving the frontend independently.

This is a friend-challenge and queue-based matchmaking foundation. It does not yet include public leaderboards, a full friends list, chat, tournaments, moderation or strong anti-cheat detection. Do not use outside engine assistance in rated games.