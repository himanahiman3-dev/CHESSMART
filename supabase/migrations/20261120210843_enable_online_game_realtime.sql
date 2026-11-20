-- Allow authenticated participants to receive committed game updates over Supabase Realtime.
-- The existing participants read games RLS policy still limits visibility to white_id/black_id.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'online_games'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.online_games;
  END IF;
END
$$;
