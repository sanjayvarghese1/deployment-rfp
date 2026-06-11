"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useAuth } from "./AuthContext";

export type TourType = "signup" | "vendor" | "rfp" | null;

interface TourContextType {
  activeTour: TourType;
  currentStepIndex: number;
  startTour: (tour: TourType) => void;
  stopTour: () => void;
  goToStep: (index: number) => void;
}

const TourContext = createContext<TourContextType>({
  activeTour: null,
  currentStepIndex: 0,
  startTour: () => {},
  stopTour: () => {},
  goToStep: () => {},
});

export function TourProvider({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth();
  const [activeTour, setActiveTour] = useState<TourType>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [isInitialized, setIsInitialized] = useState(false);

  // Sync state from localStorage on mount
  useEffect(() => {
    try {
      const storedTour = localStorage.getItem("procurelink_active_tour") as TourType;
      const storedStep = localStorage.getItem("procurelink_tour_step");

      if (storedTour) {
        setActiveTour(storedTour);
        if (storedStep) {
          setCurrentStepIndex(parseInt(storedStep, 10));
        }
      }
    } catch (err) {
      console.warn("Tour state load failed:", err);
    } finally {
      setIsInitialized(true);
    }
  }, []);

  // Sync state to localStorage when it changes
  useEffect(() => {
    if (!isInitialized) return;
    try {
      if (activeTour) {
        localStorage.setItem("procurelink_active_tour", activeTour);
        localStorage.setItem("procurelink_tour_step", currentStepIndex.toString());
      } else {
        localStorage.removeItem("procurelink_active_tour");
        localStorage.removeItem("procurelink_tour_step");
      }
    } catch (err) {
      console.warn("Tour state save failed:", err);
    }
  }, [activeTour, currentStepIndex, isInitialized]);

  // Reset tour on logout
  useEffect(() => {
    if (!user) {
      if (typeof window !== "undefined" && window.location.pathname !== "/signup") {
        stopTour();
      }
    }
  }, [user]);

  // Handle first-time login trigger
  useEffect(() => {
    if (!profile) return;
    try {
      const userKey = `procurelink_tour_seen_${profile.id}`;
      const hasSeenTour = localStorage.getItem(userKey);

      if (hasSeenTour === "true") return;

      // If the account was created more than 15 minutes ago, they are an existing user
      const createdAt = profile.created_at ? new Date(profile.created_at).getTime() : 0;
      const isNewUser = (Date.now() - createdAt) < 15 * 60 * 1000;

      if (isNewUser) {
        const type = profile.user_type;
        if (type === "vendor") {
          startTour("vendor");
        } else if (type === "rfp_company") {
          startTour("rfp");
        }
      }
      localStorage.setItem(userKey, "true");
    } catch (err) {
      console.warn("Auto tour trigger failed:", err);
    }
  }, [profile]);

  const startTour = (tour: TourType) => {
    setActiveTour(tour);
    setCurrentStepIndex(0);
  };

  const stopTour = () => {
    setActiveTour(null);
    setCurrentStepIndex(0);
  };

  const goToStep = (index: number) => {
    setCurrentStepIndex(index);
  };

  return (
    <TourContext.Provider
      value={{
        activeTour,
        currentStepIndex,
        startTour,
        stopTour,
        goToStep,
      }}
    >
      {children}
    </TourContext.Provider>
  );
}

export const useTour = () => useContext(TourContext);
