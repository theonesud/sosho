import { type ReactNode, useEffect, useRef, useState } from "react";
import { cssVars } from "../css-vars";
import { CommandPalette } from "./command-palette";
import { Icon } from "./icon";
import type { IconName } from "./icon-paths";

interface NavItem {
  readonly label: string;
  readonly href: string;
  readonly icon: IconName;
}

const navItems: readonly NavItem[] = [
  { label: "Workflows", href: "#workflows", icon: "workflow" },
  { label: "Editor", href: "#canvas", icon: "editor" },
  { label: "Run view", href: "#run-view", icon: "run" },
  { label: "Inbox", href: "#inbox", icon: "inbox" },
  { label: "Triggers", href: "#triggers", icon: "clock" },
  { label: "Versions", href: "#navigation", icon: "versions" },
];

interface AppShellProps {
  readonly children: ReactNode;
}

const LOCK_MS = 1200;

function useActiveHref(): readonly [string | null, (href: string) => void] {
  const [active, setActive] = useState<string | null>(null);
  const locked = useRef(false);

  useEffect(() => {
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const href = `#${entry.target.id}`;
          if (entry.isIntersecting) visible.add(href);
          else visible.delete(href);
        }
        const first = navItems.find((item) => visible.has(item.href));
        if (first && !locked.current) setActive(first.href);
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    for (const item of navItems) {
      const section = document.querySelector(item.href);
      if (section) observer.observe(section);
    }
    const unlock = () => {
      locked.current = false;
    };
    window.addEventListener("scrollend", unlock);
    return () => {
      observer.disconnect();
      window.removeEventListener("scrollend", unlock);
    };
  }, []);

  function choose(href: string) {
    locked.current = true;
    setActive(href);
    setTimeout(() => {
      locked.current = false;
    }, LOCK_MS);
  }

  return [active, choose];
}

export function AppShell({ children }: AppShellProps) {
  const [active, setActive] = useActiveHref();
  const list = useRef<HTMLUListElement>(null);
  const [offset, setOffset] = useState<number | null>(null);

  useEffect(() => {
    const link = active ? list.current?.querySelector<HTMLElement>(`a[href="${active}"]`) : null;
    setOffset(link ? link.offsetTop : null);
  }, [active]);

  const indicatorStyle = cssVars({ "--nav-y": `${offset ?? 0}px` });

  return (
    <div className="shell">
      <aside className="shell-sidebar">
        <a className="brand" href="#top">
          <span className="brand-mark" aria-hidden="true" />
          Sosho
        </a>
        <nav aria-label="Screens">
          <ul className="nav-list" ref={list}>
            <li
              className="nav-indicator"
              aria-hidden="true"
              data-visible={offset === null ? undefined : ""}
              style={indicatorStyle}
            />
            {navItems.map((item) => (
              <li key={item.href}>
                <a
                  className="nav-link"
                  href={item.href}
                  aria-current={active === item.href ? "true" : undefined}
                  onClick={() => setActive(item.href)}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="shell-main">
        <header className="shell-topbar">
          <CommandPalette />
          <span className="engine-status">Engine connected</span>
        </header>
        <main id="top" className="shell-content">
          {children}
        </main>
      </div>
    </div>
  );
}
