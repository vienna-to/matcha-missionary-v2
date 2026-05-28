"use client";

import { useState, useTransition } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { initialSeed } from "@/lib/seed";
import { Button, Card, Field, Input, NumberField } from "@/components/ui";
import { formatWorkspaceCode } from "@/lib/id";
import NewEventDialog from "@/components/NewEventDialog";
import QuickAddPastEventDialog from "@/components/QuickAddPastEventDialog";
import { getClient } from "@/lib/supabase/client";
import {
  clearSampleEventFromSupabase,
  loadSampleDataIntoSupabase,
} from "@/lib/supabase/seed-supabase";

const SAMPLE_EVENT_ID = "evt_uci_spring";
const SAMPLE_EVENT_NAME = "UCI Spring Pop-Up";

export default function SettingsTab() {
  const { state, dispatch, backend, workspaceId } = useStore();
  const [newEventOpen, setNewEventOpen] = useState(false);
  const [pastEventOpen, setPastEventOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [, startClearTransition] = useTransition();

  const isSupabase = backend === "supabase";
  const sampleEventPresent = isSupabase
    ? state.events.some((e) => e.name === SAMPLE_EVENT_NAME)
    : state.events.some((e) => e.id === SAMPLE_EVENT_ID);

  function copyCode() {
    const code = formatWorkspaceCode(state.settings.workspaceCode);
    navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function clearSampleDataLocal() {
    if (!sampleEventPresent) return;
    if (!confirm("Remove the UCI Spring Pop-Up sample event and its orders? Your menu and ingredients are kept.")) return;
    startClearTransition(() => {
      dispatch({ type: "DELETE_EVENT", id: SAMPLE_EVENT_ID });
    });
  }

  function reloadSampleDataLocal() {
    if (sampleEventPresent) return;
    if (!confirm("Reload the UCI Spring Pop-Up sample event (30 orders, sample menu, ingredients)?")) return;
    startClearTransition(() => {
      const seed = initialSeed();
      dispatch({
        type: "REPLACE",
        state: {
          ...state,
          ingredients: state.ingredients.length === 0 ? seed.ingredients : state.ingredients,
          menuItems: state.menuItems.length === 0 ? seed.menuItems : state.menuItems,
          menuSnapshots: [
            ...state.menuSnapshots.filter((s) => s.id !== "snap_uci_spring"),
            ...seed.menuSnapshots,
          ],
          events: [...state.events.filter((e) => e.id !== SAMPLE_EVENT_ID), ...seed.events],
          orders: [...state.orders.filter((o) => o.eventId !== SAMPLE_EVENT_ID), ...seed.orders],
        },
      });
    });
  }

  async function loadSampleDataSupabase() {
    const supabase = getClient();
    if (!supabase || !workspaceId) return;
    if (!confirm("Load the UCI Spring Pop-Up sample event (9 menu items, 21 ingredients, 30 orders) into Supabase?")) return;
    setSeedBusy(true);
    setSeedError(null);
    try {
      await loadSampleDataIntoSupabase(supabase, workspaceId);
      // Realtime subscriptions will populate local state automatically — no
      // dispatch needed here.
    } catch (e: unknown) {
      setSeedError((e as Error).message ?? "load failed");
    } finally {
      setSeedBusy(false);
    }
  }

  async function clearSampleDataSupabase() {
    const supabase = getClient();
    if (!supabase || !workspaceId) return;
    if (!confirm("Delete the UCI Spring Pop-Up event and all its orders? Master menu/ingredients are kept.")) return;
    setSeedBusy(true);
    setSeedError(null);
    try {
      await clearSampleEventFromSupabase(supabase, workspaceId);
    } catch (e: unknown) {
      setSeedError((e as Error).message ?? "delete failed");
    } finally {
      setSeedBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="t-display text-xl">Settings</h1>
        <p className="t-caption mt-1 text-sm text-matcha-900/60">
          workspace pairing, thresholds, and sample data.
        </p>
      </header>

      <Card className="space-y-4">
        <h2 className="t-display text-sm">Events</h2>
        <p className="text-xs text-matcha-900/60">
          Create a new event each pop-up day. The current master menu is cloned into the
          new event as a frozen snapshot.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setNewEventOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New event
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPastEventOpen(true)}>
            Log past event
          </Button>
        </div>
        <p className="t-caption text-[11px] text-matcha-900/50">
          past event = quick-add for an event that already happened. enter quantities sold
          and the app derives revenue/cost/margin from current ingredient prices.
        </p>
      </Card>

      <Card className="space-y-4">
        <h2 className="t-display text-sm">Workspace code</h2>
        <p className="text-xs text-matcha-900/60">
          Share this with a second device to sync (in the localStorage adapter, syncs across
          tabs on this device). Save it somewhere — if all devices lose it, the data is
          unrecoverable.
        </p>
        <div className="flex items-center gap-2">
          <code className="rounded-lg bg-cream-100 px-3 py-2 text-sm font-mono">
            {formatWorkspaceCode(state.settings.workspaceCode)}
          </code>
          <Button variant="outline" size="sm" onClick={copyCode}>
            {copied ? "Copied!" : "Copy"}
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="t-display text-sm">Display & alerts</h2>
        <Field label="Low-margin warning threshold (%)" hint="Items below this fully-loaded margin show a warning icon.">
          <NumberField
            min={0}
            max={100}
            step={1}
            value={state.settings.lowMarginThresholdPct}
            onChange={(n) =>
              dispatch({
                type: "UPDATE_SETTINGS",
                patch: { lowMarginThresholdPct: n },
              })
            }
            className="max-w-32"
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={state.settings.baristaPingEnabled}
            onChange={(e) =>
              dispatch({
                type: "UPDATE_SETTINGS",
                patch: { baristaPingEnabled: e.target.checked },
              })
            }
            className="h-4 w-4 accent-matcha-500"
          />
          Play a subtle ping in the Barista Queue when a new order arrives
        </label>
        {state.settings.audioUnlocked ? (
          <p className="text-xs text-matcha-700">✓ Audio enabled on this device</p>
        ) : (
          <p className="text-xs text-matcha-900/60">
            Audio is locked. Open the Barista Queue and tap &ldquo;Enable&rdquo; once per device.
          </p>
        )}
      </Card>

      <Card className="space-y-4">
        <h2 className="t-display text-sm">Sample data</h2>
        {isSupabase ? (
          sampleEventPresent ? (
            <>
              <p className="t-caption text-xs text-matcha-900/60">
                the uci spring pop-up demo event is loaded in supabase. delete it once
                you&apos;ve created your own events.
              </p>
              <Button variant="danger" size="sm" onClick={clearSampleDataSupabase} disabled={seedBusy}>
                <Trash2 className="h-3.5 w-3.5" /> {seedBusy ? "deleting…" : "Clear sample event"}
              </Button>
            </>
          ) : (
            <>
              <p className="t-caption text-xs text-matcha-900/60">
                load the uci spring pop-up sample event into supabase (9 menu items, 21
                ingredients, 30 orders). uses fresh uuids so it&apos;s safe to run alongside
                your real data.
              </p>
              <Button variant="outline" size="sm" onClick={loadSampleDataSupabase} disabled={seedBusy}>
                <RefreshCw className="h-3.5 w-3.5" /> {seedBusy ? "loading…" : "Load sample data into Supabase"}
              </Button>
            </>
          )
        ) : sampleEventPresent ? (
          <>
            <p className="t-caption text-xs text-matcha-900/60">
              the uci spring pop-up demo event is loaded. clear it once you&apos;ve created
              your own events. your menu and ingredients are not removed.
            </p>
            <Button variant="danger" size="sm" onClick={clearSampleDataLocal}>
              <Trash2 className="h-3.5 w-3.5" /> Clear sample data
            </Button>
          </>
        ) : (
          <>
            <p className="t-caption text-xs text-matcha-900/60">
              reload the uci spring pop-up sample event to explore the app or demo it.
            </p>
            <Button variant="outline" size="sm" onClick={reloadSampleDataLocal}>
              <RefreshCw className="h-3.5 w-3.5" /> Reload sample data
            </Button>
          </>
        )}
        {seedError ? (
          <div className="t-caption rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {seedError}
          </div>
        ) : null}
      </Card>

      <NewEventDialog open={newEventOpen} onClose={() => setNewEventOpen(false)} />
      <QuickAddPastEventDialog
        open={pastEventOpen}
        onClose={() => setPastEventOpen(false)}
      />
    </div>
  );
}
