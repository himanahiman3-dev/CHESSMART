-- The hosted Supabase project installs pgcrypto in the extensions schema.
-- Older matchmaking functions used an unqualified gen_random_bytes() call while
-- their SECURITY DEFINER search_path excluded extensions, causing live pairing to fail.
alter function public.match_online_player(uuid, text, integer, integer, boolean)
  set search_path = extensions, public, pg_temp;
