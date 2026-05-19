"use client";

import { useRouter, usePathname } from "next/navigation";

interface SubNavBarProps {
  currentTab?: "generate" | "contracts" | "responses";
}

export default function SubNavBar({ currentTab = "generate" }: SubNavBarProps) {
  const router = useRouter();
  const pathname = usePathname();

  const handleNavigate = (tab: "generate" | "contracts" | "responses") => {
    if (pathname === "/rfp/intake") {
      // If already on intake page, just switch tabs
      const tabMap = {
        generate: "generate",
        contracts: "blank",
        responses: "responses",
      };
      router.push(`/rfp/intake?tab=${tabMap[tab]}`);
    } else {
      // Navigate to the specific route
      const routeMap = {
        generate: "/rfp/intake?tab=generate",
        contracts: "/my-contracts",
        responses: "/vendor-responses",
      };
      router.push(routeMap[tab]);
    }
  };

  const navItems = [
    {
      id: "generate",
      label: "Generate RFP",
      onClick: () => handleNavigate("generate"),
    },
    {
      id: "contracts",
      label: "My Contracts",
      onClick: () => handleNavigate("contracts"),
    },
    {
      id: "responses",
      label: "Vendor Responses",
      onClick: () => handleNavigate("responses"),
    },
  ];

  return (
    <div
      className="sticky top-[54px] z-30"
      style={{
        background: "rgba(239, 236, 227, 0.96)",
        backdropFilter: "blur(18px) saturate(1.3)",
        WebkitBackdropFilter: "blur(18px) saturate(1.3)",
        borderBottom: "1px solid #D4D1C8",
      }}
    >
      <div className="mx-auto max-w-4xl px-4">
        <div className="flex items-center gap-1 overflow-x-auto py-1.5">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={item.onClick}
              className={`relative flex items-center px-3.5 py-2 whitespace-nowrap text-[13px] font-medium transition-colors duration-200 ${
                currentTab === item.id
                  ? "text-[var(--foreground)]"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              <span>{item.label}</span>
              {currentTab === item.id ? (
                <span
                  className="absolute inset-x-3 bottom-0 h-px"
                  style={{ background: "var(--primary)" }}
                />
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

