import { useEffect, useId, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { isBannedStatus } from "../lib/accountStatus";
import { PendingApprovalsProvider } from "../context/PendingApprovalsContext";
import { usePendingApprovalsCount } from "../hooks/usePendingApprovalsCount";
import PageTransition from "./PageTransition";
import { StudyDeckBrand } from "./StudyDeckLogo";

type MenuItem = {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  to?: string;
  soon?: boolean;
  badge?: number;
  separated?: boolean;
  onSelect?: () => void;
};

function menuGroups(items: MenuItem[]) {
  const groups: { label?: string; items: MenuItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (!last || last.label !== item.group) groups.push({ label: item.group, items: [item] });
    else last.items.push(item);
  }
  return groups;
}

function pathIn(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function TopbarMenu({
  label,
  mark,
  items,
  active,
  align = "start",
}: {
  label: string;
  mark?: string;
  items: MenuItem[];
  active: boolean;
  align?: "start" | "end";
}) {
  const location = useLocation();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);
  const badge = items.reduce((sum, item) => sum + (item.badge ?? 0), 0);

  function openMenu() {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    setOpen(true);
  }

  function closeSoon() {
    if (pinned.current) return;
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 160);
  }

  function closeNow() {
    pinned.current = false;
    setOpen(false);
  }

  useEffect(() => {
    pinned.current = false;
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) closeNow();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeNow();
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={`topbar-menu${align === "end" ? " topbar-menu--end" : ""}${open ? " is-open" : ""}`}
      onMouseEnter={openMenu}
      onMouseLeave={closeSoon}
    >
      <button
        type="button"
        className={`topbar-tab topbar-menu-trigger${mark ? " topbar-menu-trigger--account" : ""}${active ? " topbar-tab--active" : ""}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => {
          pinned.current = true;
          setOpen(true);
        }}
      >
        {mark ? <span className="topbar-avatar" aria-hidden>{mark}</span> : null}
        <span>{label}</span>
        {badge > 0 ? (
          <span className="topbar-admin-badge" title={`${badge} pending`}>
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
        <span className="topbar-menu-caret" aria-hidden />
      </button>
      {open ? (
        <div className="topbar-menu-panel" id={menuId} role="menu">
          {menuGroups(items).map((group) => (
            <div key={group.label ?? "ungrouped"} className="topbar-menu-group">
              {group.label ? <p className="topbar-menu-group-label">{group.label}</p> : null}
              {group.items.map((item) => {
            const body = (
              <>
                <span className="topbar-menu-item-copy">
                  <span className="topbar-menu-item-label">{item.label}</span>
                  {item.hint ? <span className="topbar-menu-item-hint">{item.hint}</span> : null}
                </span>
                {item.soon ? <span className="topbar-menu-soon">Soon</span> : null}
                {item.badge ? (
                  <span className="topbar-admin-badge" title={`${item.badge} pending`}>
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                ) : null}
              </>
            );
            const className = `topbar-menu-item${item.separated ? " topbar-menu-item--separated" : ""}${
              item.to && (location.pathname === item.to || location.pathname.startsWith(`${item.to}/`))
                ? " is-active"
                : ""
            }`;
            if (item.to) {
              return (
                <NavLink
                  key={item.id}
                  to={item.to}
                  role="menuitem"
                  state={{ from: location.pathname }}
                  className={className}
                  onClick={closeNow}
                >
                  {body}
                </NavLink>
              );
            }
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={className}
                onClick={() => {
                  closeNow();
                  item.onSelect?.();
                }}
              >
                {body}
              </button>
            );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function AppLayout() {
  const { user, isAdmin, signOutUser, accountStatus } = useAuth();
  const banned = isBannedStatus(accountStatus);
  const navigate = useNavigate();
  const location = useLocation();
  const pendingApprovals = usePendingApprovalsCount(Boolean(isAdmin && user), user?.id);

  async function handleSignOut() {
    await signOutUser();
    navigate("/", { replace: true });
  }

  return (
    <div className="layout layout--app">
      <header className="topbar">
        <Link to={banned ? "/account/moderation" : "/home"} className="brand">
          <StudyDeckBrand
            layout="inline"
            logoClassName="brand-icon"
            wordmarkClassName="brand-wordmark studydeck-wordmark"
          />
        </Link>
        <nav className="topbar-tabs" aria-label="StudyDeck">
          {user && !banned ? (
            <>
              <NavLink
                to="/home"
                end
                state={{ from: location.pathname }}
                className={({ isActive }) =>
                  `topbar-tab${isActive ? " topbar-tab--active" : ""}`
                }
              >
                Home
              </NavLink>
              <TopbarMenu
                label="Practice"
                active={pathIn(location.pathname, [
                  "/my-tests",
                  "/community",
                  "/my-banks",
                  "/exams",
                  "/quiz",
                  "/results",
                ])}
                items={[
                  {
                    id: "tests",
                    group: "StudyDeck",
                    label: "Tests",
                    hint: "Exams published by StudyDeck",
                    to: "/my-tests",
                  },
                  {
                    id: "community",
                    group: "Community",
                    label: "Community",
                    hint: "Practice a test someone uploaded",
                    to: "/community",
                    soon: !isAdmin,
                  },
                  {
                    id: "workshop",
                    group: "Community",
                    label: "Workshop",
                    hint: "Upload a test and earn if it helps",
                    to: "/my-banks",
                    soon: !isAdmin,
                  },
                ]}
              />
            </>
          ) : null}
        </nav>
        {user ? (
          <TopbarMenu
            label="Account"
            mark={(user.email?.[0] ?? "A").toUpperCase()}
            align="end"
            active={pathIn(location.pathname, ["/profile", "/admin", "/account"])}
            items={[
              { id: "profile", group: "You", label: "Profile", hint: "Name and account", to: "/profile" },
              ...(isAdmin
                ? [
                    {
                      id: "admin",
                      group: "You",
                      label: "Admin",
                      hint: pendingApprovals > 0 ? "Approval requests waiting" : "Approvals and users",
                      to: "/admin",
                      badge: pendingApprovals,
                    } satisfies MenuItem,
                  ]
                : []),
              {
                id: "signout",
                label: "Sign out",
                separated: true,
                onSelect: () => void handleSignOut(),
              },
            ]}
          />
        ) : null}
      </header>
      <PendingApprovalsProvider count={pendingApprovals}>
        <PageTransition tone="subtle">
          <Outlet />
        </PageTransition>
      </PendingApprovalsProvider>
    </div>
  );
}
