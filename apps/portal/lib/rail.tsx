"use client";

import { usePathname } from "next/navigation";

export function RailLinks({
  items,
  unread,
}: {
  items: { href: string; label: string; match?: string[] }[];
  unread: number;
}) {
  const path = usePathname();
  return (
    <nav className="mt-4 grid grid-cols-2 content-start md:grid-cols-1">
      {items.map((item) => {
        const matches = item.match ?? [item.href];
        const current =
          item.href === "/"
            ? path === "/" || path.startsWith("/c/")
            : matches.some((href) => path === href || path.startsWith(`${href}/`));
        return (
          <a
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={`flex min-h-11 items-center px-3 font-body text-sm ${current ? "text-signal" : "text-ink"}`}
          >
            {item.label}
            {item.href === "/settings" && unread > 0 ? (
              <span className="ml-2 inline-block h-2 w-2 bg-signal" aria-label="unread" />
            ) : null}
          </a>
        );
      })}
    </nav>
  );
}
