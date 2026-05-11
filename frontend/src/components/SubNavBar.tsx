"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

interface SubNavBarProps {
  currentTab?: "generate" | "contracts" | "responses";
}

export default function SubNavBar({ currentTab = "generate" }: SubNavBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

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
      icon: "📋",
      onClick: () => handleNavigate("generate"),
    },
    {
      id: "contracts",
      label: "My Contracts",
      icon: "📄",
      onClick: () => handleNavigate("contracts"),
    },
    {
      id: "responses",
      label: "Vendor Responses",
      icon: "👥",
      onClick: () => handleNavigate("responses"),
    },
  ];

  return (
    <div className="bg-[var(--surface)] border-b border-[var(--divider)] sticky top-[54px] z-30">
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex items-center gap-2 overflow-x-auto">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={item.onClick}
              className={`flex items-center gap-2 px-4 py-3 whitespace-nowrap font-medium transition-colors border-b-2 ${
                currentTab === item.id
                  ? "border-[var(--primary)] text-[var(--primary)]"
                  : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
