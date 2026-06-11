"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTour, TourType } from "@/contexts/TourContext";
import "driver.js/dist/driver.css";

interface StepConfig {
  element: string;
  title: string;
  description: string;
  path: string;
  side?: "top" | "bottom" | "left" | "right";
  redirectPath?: string | ((currentPath: string) => string | null);
}

// ── VENDOR WALKTHROUGH STEPS ───────────────────────────────────────────────
const VENDOR_STEPS: StepConfig[] = [
  {
    element: "#rfps-header",
    title: "RFPs Marketplace",
    description: "Welcome to ProcureLink! This is the main hub for matching RFP project opportunities.",
    path: "/contracts",
    side: "bottom",
  },
  {
    element: "#rfps-stats-filters",
    title: "RFP Stats & Filters",
    description: "Use these stats to filter RFPs by Open, Closed, or your Submitted bids. You can also search by keyword.",
    path: "/contracts",
    side: "bottom",
  },
  {
    element: "#rfps-list",
    title: "RFP Listings",
    description: "Browse open requests here. Check the budget estimate, deadlines, and publishing companies.",
    path: "/contracts",
    side: "top",
  },
  {
    element: "#rfps-first-card-view",
    title: "Review RFP Specifications",
    description: "To read full criteria, download the RFP PDF, or bid, click 'View Details'. Click Next to go to the details page.",
    path: "/contracts",
    side: "left",
    redirectPath: () => {
      const firstCardLink = document.querySelector("#rfps-first-card-view");
      if (firstCardLink) {
        const href = firstCardLink.getAttribute("href");
        return href;
      }
      return "/contracts"; // fallback
    },
  },
  {
    element: "#rfp-details-content",
    title: "RFP Details",
    description: "Review all the requirements, compliance criteria, description, and budget here.",
    path: "/contracts/[id]",
    side: "top",
  },
  {
    element: "#rfp-apply-btn",
    title: "Submit a Proposal",
    description: "Ready to bid? Click 'Submit Proposal' to proceed to the response submission form.",
    path: "/contracts/[id]",
    side: "left",
    redirectPath: (path) => `${path}/apply`,
  },
  {
    element: "#apply-form",
    title: "Bidding Form",
    description: "Enter your proposal description, bid pricing, timeline, and attach supporting files.",
    path: "/contracts/[id]/apply",
    side: "top",
  },
  {
    element: "#apply-submit-btn",
    title: "Submit Proposal",
    description: "Click 'Submit Proposal' to finalize your bid. The procuring company will be notified instantly!",
    path: "/contracts/[id]/apply",
    side: "top",
  },
  {
    element: "#profile-nav-link",
    title: "Walkthrough Complete!",
    description: "You're all set! If you want to see this walkthrough again, click your profile icon in the top right and press the 'Show Tutorial' button.",
    path: "/contracts/[id]/apply",
    side: "bottom",
  },
];

// ── RFP COMPANY WALKTHROUGH STEPS ───────────────────────────────────────────
const RFP_STEPS: StepConfig[] = [
  {
    element: "#bidders-header",
    title: "Bidders Directory",
    description: "Welcome to ProcureLink! Find and connect with qualified vendors in our network.",
    path: "/companies",
    side: "bottom",
  },
  {
    element: "#bidders-search-filter",
    title: "Filter Bidders",
    description: "Search vendors by name, or filter them by industry and location.",
    path: "/companies",
    side: "bottom",
  },
  {
    element: "#bidders-list",
    title: "Vendor Directory",
    description: "Review ratings and specialties. Follow vendors to keep track of their activity.",
    path: "/companies",
    side: "top",
  },
  {
    element: "#nav-link-my-homepage",
    title: "Your Homepage",
    description: "Next, let's head to your Homepage to view posted RFPs and proposals. Click here or click Next to continue.",
    path: "/companies",
    side: "bottom",
    redirectPath: "/my-contracts",
  },
  {
    element: "#my-contracts-header",
    title: "Homepage Control Center",
    description: "This is your Homepage where you monitor and manage all your posted RFPs.",
    path: "/my-contracts",
    side: "bottom",
  },
  {
    element: "#my-contracts-stats",
    title: "Filter by Status",
    description: "Monitor drafts, open RFPs, pending approvals, closed contracts, or archived projects.",
    path: "/my-contracts",
    side: "bottom",
  },
  {
    element: "#my-contracts-list",
    title: "RFP List",
    description: "View draft details, approve pending ones, email details to partners, or download PDFs.",
    path: "/my-contracts",
    side: "top",
  },
  {
    element: "#my-contracts-post-btn",
    title: "Create a Project",
    description: "Click 'Post New RFP' to write a new RFP. Click Next to go to the creation page.",
    path: "/my-contracts",
    side: "left",
    redirectPath: "/rfp",
  },
  {
    element: "#rfp-scratch-card",
    title: "Build From Scratch",
    description: "Answer a questionnaire and let our AI generate a customized RFP document for you.",
    path: "/rfp",
    side: "right",
  },
  {
    element: "#rfp-upload-card",
    title: "Upload & Optimize",
    description: "Upload an existing RFP PDF. The AI will parse it, rate it, and provide optimization tips.",
    path: "/rfp",
    side: "left",
  },
  {
    element: "#profile-nav-link",
    title: "Walkthrough Complete!",
    description: "You're all set! Access this walkthrough anytime from the button in your Profile page.",
    path: "/rfp",
    side: "bottom",
  },
];

// ── SIGNUP WALKTHROUGH STEPS ───────────────────────────────────────────────
const SIGNUP_STEPS: StepConfig[] = [
  {
    element: "#signup-role-container",
    title: "Choose Your Account Type",
    description: "Welcome to ProcureLink! Select **RFP Company** if you want to publish requests, receive proposals, and evaluate vendors. Select **Vendor** if you want to browse open contracts, submit bids, and connect with companies. Click either option to proceed.",
    path: "/signup",
    side: "bottom",
  },
  {
    element: "#signup-details-card",
    title: "Complete Your Profile",
    description: "Fill in your company name, email, credentials, and details to set up your account.",
    path: "/signup",
    side: "top",
  },
  {
    element: "#signup-details-submit",
    title: "Create Account",
    description: "Submit the form to register. When you first log in, your main onboarding walkthrough will start automatically!",
    path: "/signup",
    side: "top",
  },
];

function matchesPath(currentPath: string, stepPath: string): boolean {
  if (stepPath.includes("[id]")) {
    const parts = stepPath.split("/");
    const currParts = currentPath.split("/");
    if (parts.length !== currParts.length) return false;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === "[id]") {
        if (currParts[i] === "new") return false;
        continue;
      }
      if (parts[i] !== currParts[i]) return false;
    }
    return true;
  }
  return currentPath === stepPath;
}

function resolvePath(targetPath: string, currentPath: string): string {
  if (targetPath.includes("[id]")) {
    const currentParts = currentPath.split("/");
    const targetParts = targetPath.split("/");
    const idIndex = targetParts.indexOf("[id]");
    if (idIndex !== -1 && currentParts[idIndex]) {
      targetParts[idIndex] = currentParts[idIndex];
      return targetParts.join("/");
    }
  }
  return targetPath;
}

export default function TourManager() {
  const { activeTour, currentStepIndex, goToStep, stopTour } = useTour();
  const pathname = usePathname();
  const router = useRouter();
  const driverInstanceRef = useRef<any>(null);
  const isRedirectingRef = useRef<boolean>(false);
  const lastPathnameRef = useRef<string | null>(null);

  // 1. Initialize Driver.js on activeTour or page path change
  useEffect(() => {
    if (!activeTour) {
      if (driverInstanceRef.current) {
        driverInstanceRef.current.destroy();
        driverInstanceRef.current = null;
      }
      lastPathnameRef.current = null;
      return;
    }

    const currentSteps =
      activeTour === "vendor" ? VENDOR_STEPS : activeTour === "rfp" ? RFP_STEPS : SIGNUP_STEPS;

    // Check if the current pathname is part of the active tour
    const isPathInTour = currentSteps.some(step => matchesPath(pathname, step.path));
    const wasPathInTour = lastPathnameRef.current
      ? currentSteps.some(step => matchesPath(lastPathnameRef.current!, step.path))
      : false;

    if (wasPathInTour && !isPathInTour) {
      stopTour();
      lastPathnameRef.current = pathname;
      return;
    }
    lastPathnameRef.current = pathname;

    // Filter steps valid on the current page
    const pageStepsWithIndex = currentSteps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => matchesPath(pathname, step.path));

    if (pageStepsWithIndex.length === 0) {
      // If we are not on the correct page for the currentStepIndex, redirect
      const targetStep = currentSteps[currentStepIndex];
      if (targetStep && !matchesPath(pathname, targetStep.path)) {
        const targetPath =
          typeof targetStep.redirectPath === "function"
            ? targetStep.redirectPath(pathname)
            : typeof targetStep.redirectPath === "string"
            ? targetStep.redirectPath
            : targetStep.path;

        if (targetPath) {
          const resolvedPath = resolvePath(targetPath, pathname);
          isRedirectingRef.current = true;
          router.push(resolvedPath);
        }
      }
      return;
    }

    // Find the item in pageStepsWithIndex that matches currentStepIndex
    let activePageIndex = pageStepsWithIndex.findIndex(item => item.index === currentStepIndex);

    // If currentStepIndex is not found on this page, reset it to the first available step index on this page
    if (activePageIndex === -1) {
      activePageIndex = 0;
      goToStep(pageStepsWithIndex[0].index);
    }

    const initDriver = async () => {
      const { driver } = await import("driver.js");

      // Build driver steps for this page
      const driverSteps = pageStepsWithIndex.map(({ step, index }, arrayIndex) => {
        const isLastPageStep = arrayIndex === pageStepsWithIndex.length - 1;
        const isFirstPageStep = arrayIndex === 0;

        // Custom config for signup step 0 (choose role)
        const isSignupRoleStep = activeTour === "signup" && index === 0;

        return {
          element: step.element === "body" || step.element === "html"
            ? step.element
            : () => {
                const el = document.querySelector(step.element);
                return el || document.body;
              },
          popover: {
            title: step.title,
            description: step.description,
            side: step.side || "bottom",
            align: "start" as const,
            showButtons: isSignupRoleStep ? ["close" as const] : undefined, // hide prev/next buttons on role selection
            onNextClick: (element: any, stepObj: any, { driver }: any) => {
              if (isLastPageStep) {
                const nextGlobalIndex = index + 1;
                const nextStep = currentSteps[nextGlobalIndex];
                if (nextStep) {
                  goToStep(nextGlobalIndex);
                  const targetPath =
                    typeof step.redirectPath === "function"
                      ? step.redirectPath(pathname)
                      : typeof step.redirectPath === "string"
                      ? step.redirectPath
                      : nextStep.path;
                  if (targetPath) {
                    const resolvedPath = resolvePath(targetPath, pathname);
                    isRedirectingRef.current = true;
                    router.push(resolvedPath);
                  }
                } else {
                  // End of tour
                  stopTour();
                  driver.destroy();
                }
              } else {
                // Next step on the same page
                const nextItem = pageStepsWithIndex[arrayIndex + 1];
                goToStep(nextItem.index);
                driver.moveNext();
              }
            },
            onPrevClick: (element: any, stepObj: any, { driver }: any) => {
              if (isFirstPageStep) {
                const prevGlobalIndex = index - 1;
                const prevStep = currentSteps[prevGlobalIndex];
                if (prevStep) {
                  goToStep(prevGlobalIndex);
                  const resolvedPath = resolvePath(prevStep.path, pathname);
                  isRedirectingRef.current = true;
                  router.push(resolvedPath);
                }
              } else {
                const prevItem = pageStepsWithIndex[arrayIndex - 1];
                goToStep(prevItem.index);
                driver.movePrevious();
              }
            },
          },
        };
      });

      if (driverInstanceRef.current) {
        driverInstanceRef.current.destroy();
      }

      isRedirectingRef.current = false;

      driverInstanceRef.current = driver({
        showProgress: true,
        steps: driverSteps,
        onDestroyed: () => {
          if (!isRedirectingRef.current) {
            stopTour();
          }
        },
      });

      driverInstanceRef.current.drive(activePageIndex);
    };

    void initDriver();

    return () => {
      // Clean up when page changes or tour changes
      if (driverInstanceRef.current) {
        driverInstanceRef.current.destroy();
      }
    };
  }, [activeTour, pathname, router]); // Excluded currentStepIndex to prevent rebuilds on step changes

  // 2. Synchronize active index when step index changes on the same page
  useEffect(() => {
    if (!activeTour || !driverInstanceRef.current) return;

    const currentSteps =
      activeTour === "vendor" ? VENDOR_STEPS : activeTour === "rfp" ? RFP_STEPS : SIGNUP_STEPS;

    const pageStepsWithIndex = currentSteps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => matchesPath(pathname, step.path));

    const activePageIndex = pageStepsWithIndex.findIndex(item => item.index === currentStepIndex);
    if (activePageIndex !== -1 && driverInstanceRef.current.getActiveIndex() !== activePageIndex) {
      driverInstanceRef.current.drive(activePageIndex);
    }
  }, [currentStepIndex, activeTour, pathname]);

  return null;
}


