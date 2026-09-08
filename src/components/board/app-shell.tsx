"use client";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { BoardNavItem } from "../../lib/board/navigation";
import { activeNavId, localHref } from "../../lib/board/navigation";
import { BoardLink, SyntheticDisclosure } from "./primitives";

const GROUPS = [ ["workspace", "Workspace"], ["environment", "Environment"], ["assurance", "Assurance"], ["resources", "Resources"], ["administration", "Administration"] ] as const;
export function Sidebar({ items, pathname, onNavigate }: { items: BoardNavItem[]; pathname: string; onNavigate?: () => void }) {
  const active = activeNavId(items, pathname);
  return <div className="bd-sidebar-inner"><BoardLink href="/" className="bd-brand"><span className="bd-brand-mark" aria-hidden="true">C<span /></span><span>Carbon Ledger<small>Environmental intelligence</small></span></BoardLink>
    <nav aria-label="Main navigation">{GROUPS.map(([group, label]) => { const children = items.filter(i => i.group === group); return children.length ? <div className="bd-nav-group" key={group}><p>{label}</p>{children.map(item => <a key={item.id} href={localHref(item.href)} onClick={onNavigate} aria-current={active === item.id ? "page" : undefined}><span className="bd-nav-mark" aria-hidden="true" />{item.label}</a>)}</div> : null; })}</nav>
    <div className="bd-sidebar-footer"><span className="bd-status-dot" /> One connected workspace</div>
  </div>;
}
export function AppShell({ children, nav, pathname, scopeBar, account, synthetic = false }: {
  children: ReactNode; nav: BoardNavItem[]; pathname: string; scopeBar: ReactNode; account: ReactNode; synthetic?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  function close() { dialog.current?.close(); trigger.current?.focus(); }
  useEffect(() => { if (dialog.current?.open) dialog.current.close(); }, [pathname]);
  return <div className="bd-app"><a className="bd-skip" href="#board-main">Skip to content</a><aside className="bd-sidebar"><Sidebar items={nav} pathname={pathname} /></aside>
    <dialog ref={dialog} className="bd-mobile-nav" aria-label="Navigation" onClick={e => { if (e.target === e.currentTarget) close(); }} onClose={() => trigger.current?.focus()}><button className="bd-mobile-close" type="button" onClick={close}>Close navigation</button><Sidebar items={nav} pathname={pathname} onNavigate={close} /></dialog>
    <div className="bd-workspace"><header className="bd-topbar"><button ref={trigger} type="button" className="bd-menu-button" onClick={() => dialog.current?.showModal()} aria-label="Open navigation">☰</button>{scopeBar}<div className="bd-account">{account}</div></header>
      {synthetic && <SyntheticDisclosure />}<main id="board-main" className="bd-main" tabIndex={-1}>{children}</main></div>
  </div>;
}
