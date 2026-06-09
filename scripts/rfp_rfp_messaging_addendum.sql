-- ============================================================
-- RFP-to-RFP Messaging Addendum
-- Run this AFTER messaging_channels_migration.sql
-- Adds support for RFP Companies to request to connect with
-- other RFP Companies before messaging them.
-- ============================================================

-- 1. Channels between two RFP Companies
CREATE TABLE IF NOT EXISTS public.rfp_rfp_channels (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'active',  -- 'active' | 'closed'
  expires_at     timestamptz,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),
  UNIQUE (initiator_id, target_id)
);

-- Ensure updated_at is kept fresh (reuse set_updated_at if it exists)
DROP TRIGGER IF EXISTS trg_rfp_rfp_channels_updated_at ON public.rfp_rfp_channels;
CREATE TRIGGER trg_rfp_rfp_channels_updated_at
  BEFORE UPDATE ON public.rfp_rfp_channels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Connection requests between RFP Companies
CREATE TABLE IF NOT EXISTS public.rfp_rfp_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  note           text,
  created_at     timestamptz DEFAULT now(),
  UNIQUE (requester_id, target_id)
);

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE public.rfp_rfp_channels ENABLE ROW LEVEL SECURITY;

-- Allow both initiator and target to view and manage their channels
DROP POLICY IF EXISTS "rfp_rfp_channel_view" ON public.rfp_rfp_channels;
DROP POLICY IF EXISTS "rfp_rfp_channel_manage" ON public.rfp_rfp_channels;
DROP POLICY IF EXISTS "rfp_rfp_channel_target_update" ON public.rfp_rfp_channels;
DROP POLICY IF EXISTS "rfp_rfp_channels_all" ON public.rfp_rfp_channels;

CREATE POLICY "rfp_rfp_channels_all" ON public.rfp_rfp_channels
  FOR ALL
  USING (initiator_id = auth.uid() OR target_id = auth.uid())
  WITH CHECK (initiator_id = auth.uid() OR target_id = auth.uid());

ALTER TABLE public.rfp_rfp_requests ENABLE ROW LEVEL SECURITY;

-- Requester can create and view their own requests
DROP POLICY IF EXISTS "rfp_rfp_request_requester" ON public.rfp_rfp_requests;
CREATE POLICY "rfp_rfp_request_requester" ON public.rfp_rfp_requests
  FOR ALL
  USING (requester_id = auth.uid())
  WITH CHECK (requester_id = auth.uid());

-- Target can view and update (approve/reject) requests sent to them
DROP POLICY IF EXISTS "rfp_rfp_request_target_view" ON public.rfp_rfp_requests;
CREATE POLICY "rfp_rfp_request_target_view" ON public.rfp_rfp_requests
  FOR SELECT
  USING (target_id = auth.uid());

DROP POLICY IF EXISTS "rfp_rfp_request_target_update" ON public.rfp_rfp_requests;
CREATE POLICY "rfp_rfp_request_target_update" ON public.rfp_rfp_requests
  FOR UPDATE
  USING (target_id = auth.uid())
  WITH CHECK (target_id = auth.uid());
