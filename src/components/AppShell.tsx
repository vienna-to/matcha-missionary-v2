"use client";

import { useEffect, useState } from "react";
import {
  Coffee,
  Clipboard,
  BookOpen,
  Calculator,
  BarChart3,
  Plus,
  Settings as SettingsIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useActiveEvent, useStore } from "@/lib/store";
import { formatMoney } from "@/lib/utils";
import { computeEventTotals } from "@/lib/calc";
import { useHelperMode } from "@/lib/helper-mode";
import LiveOrders from "./tabs/LiveOrders";
import BaristaQueue from "./tabs/BaristaQueue";
import MenuManager from "./tabs/MenuManager";
import Finance from "./tabs/Finance";
import EventSummary from "./tabs/EventSummary";
import SettingsTab from "./tabs/SettingsTab";
import NewEventDialog from "./NewEventDialog";
import QuickAddPastEventDialog from "./QuickAddPastEventDialog";

export type TabId = "orders" | "queue" | "menu" | "finance" | "summary" | "settings";

type TabDef = {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** True when a booth helper is allowed to see this tab. */
  helper?: boolean;
};

const TABS: TabDef[] = [
  { id: "orders", label: "Live Orders", icon: Coffee, helper: true },
  { id: "queue", label: "Barista Queue", icon: Clipboard, helper: true },
  { id: "menu", label: "Menu Manager", icon: BookOpen },
  { id: "finance", label: "Finance", icon: Calculator },
  { id: "summary", label: "Event Summary", icon: BarChart3 },
];

export default function AppShell() {
  const [tab, setTab] = useState<TabId>("orders");
  const [newEventOpen, setNewEventOpen] = useState(false);
  const [pastEventOpen, setPastEventOpen] = useState(false);
  const activeEvent = useActiveEvent();
  const { state } = useStore();
  const [helperMode] = useHelperMode();

  const visibleTabs = helperMode ? TABS.filter((t) => t.helper) : TABS;

  // If helper mode is enabled and the current tab isn't in the allowed set
  // (e.g. flag was flipped while user was on Finance), snap back to Orders.
  useEffect(() => {
    if (helperMode && !visibleTabs.some((t) => t.id === tab)) {
      setTab("orders");
    }
  }, [helperMode, tab, visibleTabs]);

  const snapshot = activeEvent
    ? state.menuSnapshots.find((s) => s.id === activeEvent.menuSnapshotId)
    : undefined;
  const totals =
    activeEvent && snapshot
      ? computeEventTotals(
          snapshot,
          activeEvent.fixedCosts,
          state.orders.filter((o) => o.eventId === activeEvent.id),
        )
      : null;

  return (
    <div className="min-h-screen bg-cream-50 md:flex">
      {/* Sidebar (tablet+) */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:border-r md:border-cream-200 md:bg-white">
        <div className="px-5 py-5">
          <div className="t-brand text-xl">
            <span className="text-matcha-500">●</span> Matcha Missionary
            {helperMode ? (
              <span className="t-caption ml-2 rounded-full bg-cream-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-matcha-700">
                helper
              </span>
            ) : null}
          </div>
          {activeEvent ? (
            helperMode ? (
              <div className="mt-4 w-full rounded-xl border border-matcha-200 bg-cream-100 p-3">
                <div className="t-display text-[11px] text-matcha-700">Active event</div>
                <div className="t-display mt-0.5 text-sm text-matcha-900">{activeEvent.name}</div>
              </div>
            ) : (
              <button
                onClick={() => setTab("summary")}
                className="mt-4 w-full rounded-xl border border-matcha-200 bg-cream-100 p-3 text-left transition-colors hover:bg-cream-200"
              >
                <div className="t-display text-[11px] text-matcha-700">Active event</div>
                <div className="t-display mt-0.5 text-sm text-matcha-900">{activeEvent.name}</div>
                <div className="t-caption mt-1 flex items-center justify-between text-xs text-matcha-900/70">
                  <span>{totals?.totalOrders ?? 0} orders</span>
                  <span className="tabular-nums">{formatMoney(totals?.revenuePaid ?? 0)}</span>
                </div>
              </button>
            )
          ) : null}
          {helperMode ? null : (
            <>
              <button
                onClick={() => setNewEventOpen(true)}
                className="t-caption mt-2 flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-matcha-300 px-3 py-2 text-xs text-matcha-700 hover:bg-cream-100"
              >
                <Plus className="h-3.5 w-3.5" /> new event
              </button>
              <button
                onClick={() => setPastEventOpen(true)}
                className="t-caption mt-1 flex w-full items-center justify-center gap-1 rounded-xl px-3 py-1.5 text-[11px] text-matcha-900/60 hover:bg-cream-100"
              >
                log past event
              </button>
            </>
          )}
        </div>
        <nav className="flex-1 space-y-1 px-3 py-3">
          {visibleTabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "bg-matcha-500 text-white"
                    : "text-matcha-900 hover:bg-cream-100",
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="t-display text-xs">{t.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="px-3 pb-4">
          <button
            onClick={() => setTab("settings")}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
              tab === "settings"
                ? "bg-matcha-500 text-white"
                : "text-matcha-900 hover:bg-cream-100",
            )}
          >
            <SettingsIcon className="h-4 w-4" />
            <span className="t-display text-xs">Settings</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 pb-20 md:pb-0">
        {/* Mobile top bar */}
        <div className="flex items-center justify-between border-b border-cream-200 bg-white px-4 py-3 md:hidden">
          <div className="t-brand text-base">
            <span className="text-matcha-500">●</span> Matcha Missionary
            {helperMode ? (
              <span className="t-caption ml-2 rounded-full bg-cream-200 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-matcha-700">
                helper
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {helperMode ? null : (
              <button
                onClick={() => setNewEventOpen(true)}
                className="rounded-lg p-1.5 text-matcha-900/70 hover:bg-cream-100"
                aria-label="New event"
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={() => setTab("settings")}
              className="rounded-lg p-1.5 text-matcha-900/70 hover:bg-cream-100"
              aria-label="Settings"
            >
              <SettingsIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Mobile active-event pill */}
        {activeEvent ? (
          helperMode ? (
            <div className="mx-4 mt-3 flex w-[calc(100%-2rem)] items-center gap-2 rounded-xl bg-matcha-50 px-3 py-2 text-xs text-matcha-900 md:hidden">
              <span className="h-2 w-2 rounded-full bg-matcha-500" />
              <span className="t-display">{activeEvent.name}</span>
            </div>
          ) : (
            <button
              onClick={() => setTab("summary")}
              className="mx-4 mt-3 flex w-[calc(100%-2rem)] items-center justify-between rounded-xl bg-matcha-50 px-3 py-2 text-xs text-matcha-900 md:hidden"
            >
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-matcha-500" />
                <span className="t-display">{activeEvent.name}</span>
              </span>
              <span className="t-caption opacity-70">
                {totals?.totalOrders ?? 0} orders · <span className="tabular-nums">{formatMoney(totals?.revenuePaid ?? 0)}</span>
              </span>
            </button>
          )
        ) : null}

        <div className="px-4 py-4 md:px-8 md:py-6">
          {tab === "orders" && <LiveOrders />}
          {tab === "queue" && <BaristaQueue />}
          {tab === "menu" && !helperMode && <MenuManager />}
          {tab === "finance" && !helperMode && <Finance />}
          {tab === "summary" && !helperMode && <EventSummary />}
          {tab === "settings" && <SettingsTab />}
        </div>
      </main>

      <NewEventDialog open={newEventOpen} onClose={() => setNewEventOpen(false)} />
      <QuickAddPastEventDialog
        open={pastEventOpen}
        onClose={() => setPastEventOpen(false)}
        onCreated={() => setTab("summary")}
      />

      {/* Bottom tabs (mobile) */}
      <nav
        className={cn(
          "fixed bottom-0 left-0 right-0 z-30 grid border-t border-cream-200 bg-white md:hidden",
          visibleTabs.length === 2 ? "grid-cols-2" : "grid-cols-5",
        )}
      >
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] transition-colors",
                active ? "text-matcha-600" : "text-matcha-900/60",
              )}
            >
              <Icon className={cn("h-5 w-5", active && "text-matcha-600")} />
              <span className="t-display text-[10px]">{t.label.split(" ")[0]}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
