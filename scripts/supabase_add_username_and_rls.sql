-- Add a unique username column to profiles
-- Ensure a minimal profiles table exists (common Supabase pattern)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  email text UNIQUE,
  username text UNIQUE,
  role text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text UNIQUE;

-- Optional helper function to check admin role.
-- SECURITY DEFINER avoids recursive RLS when this is used inside `profiles` policies.
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon;

-- Public lookup for login: returns the email for a given username without exposing the full profiles table.
-- It checks stored `profiles.username` first, then falls back to legacy `users.company_name`-derived usernames.
CREATE OR REPLACE FUNCTION public.get_email_by_username(p_username text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized text := lower(trim(p_username));
  result_email text;
BEGIN
  SELECT p.email
    INTO result_email
  FROM public.profiles p
  WHERE lower(trim(p.username)) = normalized
  LIMIT 1;

  IF result_email IS NOT NULL THEN
    RETURN result_email;
  END IF;

  IF to_regclass('public.users') IS NOT NULL THEN
    SELECT u.email
      INTO result_email
    FROM public.users u
    WHERE lower(regexp_replace(lower(trim(COALESCE(u.company_name, ''))), '[^a-z0-9]+', '-', 'g')) = normalized
    LIMIT 1;

    IF result_email IS NOT NULL THEN
      RETURN result_email;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.get_email_by_username(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_by_username(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_email_by_username(text) TO authenticated;

-- Example: enable RLS on contracts and allow admins full access
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins full access on contracts" ON public.contracts;
CREATE POLICY "Admins full access on contracts" ON public.contracts
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Example: profiles policies — users can manage their own profile; admins can manage all
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their profile" ON public.profiles;
CREATE POLICY "Users can view their profile" ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their profile" ON public.profiles;
CREATE POLICY "Users can update their profile" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Admins manage profiles" ON public.profiles;
CREATE POLICY "Admins manage profiles" ON public.profiles
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- REMINDER: Apply policies for any other tables that should be admin-protected

-- Create a case-insensitive unique index on username (ensure uniqueness on lower(username))
DROP INDEX IF EXISTS public.profiles_username_ci_idx;
CREATE UNIQUE INDEX profiles_username_ci_idx ON public.profiles ((lower(username)));

-- Backfill usernames for older profiles that don't have one yet.
-- This derives from company_name first, then email prefix, and appends numeric suffixes if needed.
DO $$
DECLARE
  rec RECORD;
  candidate text;
  base text;
  suffix integer;
  has_legacy_users boolean;
BEGIN
  has_legacy_users := to_regclass('public.users') IS NOT NULL;

  FOR rec IN
    SELECT
      id,
      COALESCE(
        NULLIF(regexp_replace(lower(trim(COALESCE(legacy_company_name, ''))), '[^a-z0-9]+', '-', 'g'), ''),
        NULLIF(split_part(lower(COALESCE(email, legacy_email)), '@', 1), ''),
        'company'
      ) AS base_username
    FROM public.profiles p
    LEFT JOIN LATERAL (
      SELECT u.company_name AS legacy_company_name, u.email AS legacy_email
      FROM public.users u
      WHERE has_legacy_users AND u.id = p.id
      LIMIT 1
    ) legacy ON TRUE
    WHERE username IS NULL OR username = ''
    ORDER BY created_at NULLS LAST, id
  LOOP
    base := rec.base_username;
    candidate := base;
    suffix := 1;

    WHILE EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE lower(p.username) = lower(candidate)
        AND p.id <> rec.id
    ) LOOP
      candidate := base || '-' || suffix::text;
      suffix := suffix + 1;
    END LOOP;

    UPDATE public.profiles
    SET username = candidate
    WHERE id = rec.id;
  END LOOP;
END $$;
