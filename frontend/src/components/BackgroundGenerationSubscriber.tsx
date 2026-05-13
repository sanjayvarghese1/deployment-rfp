"use client";

import { useEffect } from "react";
import { subscribeBackgroundGeneration, getBackgroundGenerationSnapshot } from "@/lib/rfp/background";

export default function BackgroundGenerationSubscriber() {
  useEffect(() => {
    // subscribe with a no-op listener to keep the background generation
    // machinery alive across route changes
    const unsubscribe = subscribeBackgroundGeneration(() => {
      // no-op; keeping the listener ensures the store stays initialized
    });

    // also read snapshot once to ensure localStorage rehydration happens
    try {
      void getBackgroundGenerationSnapshot();
    } catch {
      // ignore
    }

    return () => unsubscribe();
  }, []);

  return null;
}

