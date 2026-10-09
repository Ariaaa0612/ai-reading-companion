"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type NavTab = {
  href: string;
  label: string;
};

const TABS: readonly NavTab[] = [
  { href: "/", label: "今日" },
  { href: "/plan", label: "计划" },
  { href: "/assessment", label: "测评" },
  { href: "/records", label: "打卡" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="底部导航"
      className="fixed bottom-0 left-0 right-0 z-50 mx-auto flex h-16 max-w-[430px] items-stretch justify-around border-t border-border bg-white"
    >
      {TABS.map((tab) => {
        const active = isActive(pathname ?? "/", tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 text-xs transition-colors",
              active ? "text-foreground" : "text-muted-foreground"
            )}
          >
            <span
              className={cn(
                "text-sm leading-none",
                active ? "font-semibold" : "font-medium"
              )}
            >
              {tab.label}
            </span>
            <span
              className={cn(
                "h-1 w-4 rounded-full transition-colors",
                active ? "bg-foreground" : "bg-transparent"
              )}
            />
          </Link>
        );
      })}
    </nav>
  );
}

export default BottomNav;
