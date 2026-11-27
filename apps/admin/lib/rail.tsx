"use client";

import { usePathname } from "next/navigation";

function currentItem(href: string, path: string): boolean {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

export function RailLinks({
  groups,
}: {
  groups: { label?: string; items: { href: string; label: string }[] }[];
}) {
  const path = usePathname();
  return (
    <nav className="grid">
      {groups.map((group) => {
        const links = group.items.map((item) => {
          const current = currentItem(item.href, path);
          return (
            <a
              key={item.href}
              href={item.href}
              aria-current={current ? "page" : undefined}
              className={`console-link${group.label ? " console-link-nested" : ""}${current ? " console-link-current" : ""}`}
            >
              {item.label}
            </a>
          );
        });
        if (!group.label) return <div key="home">{links}</div>;
        const open = group.items.some((item) => currentItem(item.href, path));
        return (
          <details
            key={group.label}
            className="console-fold"
            name="console-nav"
            {...(open ? { open: true } : {})}
          >
            <summary className="console-group">{group.label}</summary>
            {links}
          </details>
        );
      })}
    </nav>
  );
}
