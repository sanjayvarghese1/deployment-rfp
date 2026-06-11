"use client";

import RfpChatbot from "@/components/RfpChatbot";

interface RfpTabProps {
  onSaved?: () => void;
}

export default function RfpTab({ onSaved }: RfpTabProps) {
  return <RfpChatbot onSaved={onSaved || (() => {})} mode="scratch" />;
}

