-- ============================================================
-- Messaging Channels Migration
-- Run this in your Supabase SQL Editor.
-- ============================================================

-- 1. message_channels — one row per RFP-Company <-> Vendor pair
CREATE TABLE IF NOT EXISTS public.message_channels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfp_company_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  vendor_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'active',   -- 'active' | 'closed'
  expires_at      timestamptz,                       -- NULL = no expiry
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (rfp_company_id, vendor_id)
);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_message_channels_updated_at ON public.message_channels;
CREATE TRIGGER trg_message_channels_updated_at
  BEFORE UPDATE ON public.message_channels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. message_requests — vendor-initiated contact requests
CREATE TABLE IF NOT EXISTS public.message_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  rfp_company_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
  note            text,                              -- optional message from vendor
  created_at      timestamptz DEFAULT now(),
  UNIQUE (vendor_id, rfp_company_id)
);

-- 3. Add channel_id foreign key to messages (links each message to a channel)
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS channel_id uuid REFERENCES public.message_channels(id) ON DELETE SET NULL;

-- ============================================================
-- Row Level Security
-- ============================================================

-- message_channels RLS
ALTER TABLE public.message_channels ENABLE ROW LEVEL SECURITY;

-- RFP Company can see and manage their own channels
DROP POLICY IF EXISTS "rfp_company_manage_channels" ON public.message_channels;
CREATE POLICY "rfp_company_manage_channels" ON public.message_channels
  FOR ALL
  USING (rfp_company_id = auth.uid())
  WITH CHECK (rfp_company_id = auth.uid());

-- Vendors can only view channels they are part of
DROP POLICY IF EXISTS "vendor_view_own_channels" ON public.message_channels;
CREATE POLICY "vendor_view_own_channels" ON public.message_channels
  FOR SELECT
  USING (vendor_id = auth.uid());

-- message_requests RLS
ALTER TABLE public.message_requests ENABLE ROW LEVEL SECURITY;

-- Vendors can create and view their own requests
DROP POLICY IF EXISTS "vendor_manage_own_requests" ON public.message_requests;
CREATE POLICY "vendor_manage_own_requests" ON public.message_requests
  FOR ALL
  USING (vendor_id = auth.uid())
  WITH CHECK (vendor_id = auth.uid());

-- RFP Companies can see and update requests sent to them
DROP POLICY IF EXISTS "rfp_company_view_requests" ON public.message_requests;
CREATE POLICY "rfp_company_view_requests" ON public.message_requests
  FOR SELECT
  USING (rfp_company_id = auth.uid());

DROP POLICY IF EXISTS "rfp_company_update_requests" ON public.message_requests;
CREATE POLICY "rfp_company_update_requests" ON public.message_requests
  FOR UPDATE
  USING (rfp_company_id = auth.uid())
  WITH CHECK (rfp_company_id = auth.uid());

-- messages: vendors can only insert into active, non-expired channels they belong to
-- (Drop old permissive policy if it exists, then recreate)
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_insert_messages" ON public.messages;
DROP POLICY IF EXISTS "vendor_insert_messages" ON public.messages;

CREATE POLICY "vendor_insert_messages" ON public.messages
  FOR INSERT
  WITH CHECK (
    sender_id = auth.uid() AND (
      -- RFP Company: always allowed
      EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND user_type = 'rfp_company'
      )
      OR
      -- Vendor: only if active, non-expired channel exists
      EXISTS (
        SELECT 1 FROM public.message_channels mc
        WHERE mc.id = channel_id
          AND mc.vendor_id = auth.uid()
          AND mc.status = 'active'
          AND (mc.expires_at IS NULL OR mc.expires_at > now())
      )
    )
  );

-- Everyone can read messages in channels they belong to
DROP POLICY IF EXISTS "read_own_messages" ON public.messages;
CREATE POLICY "read_own_messages" ON public.messages
  FOR SELECT
  USING (sender_id = auth.uid() OR receiver_id = auth.uid());
