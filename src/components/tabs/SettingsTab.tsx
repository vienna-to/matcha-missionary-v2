"use client";

import { useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { initialSeed } from "@/lib/seed";
import { Button, Card, Field, Input } from "@/components/ui";
import { formatWorkspaceCode } from "@/lib/id";
import NewEventDialog from "@/components/NewEventDialog";

const SAMPLE_EVENT_ID = "evt_uci_spring";

export default function SettingsTab() {
  const { state, dispatch } = useStore();
  const [newEventOpen, setNewEventOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const sampleEventPresent = state.events.some((e) => e.id === SAMPLE_EVENT_ID);

  function copyCode() {
    const code = formatWorkspaceCode(state.settings.workspaceCode);
    navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function clearSampleData() {
    if (!sampleEventPresent) return;
    if (!confirm("Remove the UCI Spring Pop-Up sample event and its orders? Your menu and ingredients are kept.")) return;
    // Remove the sample event (and its snapshot + orders via reducer logic).
    dispatch({ type: "DELETE_EVENT", id: SAMPLE_EVENT_ID });
  }

  function reloadSampleData() {
    if (sampleEventPresent) return;
    if (!confirm("Reload the UCI Spring Pop-Up sample event (30 orders, sample menu, ingredients)?")) return;
    // The seed includes everything; merge the sample event + its snapshot + orders
    // back into the current state without touching user-created events.
    const seed = initialSeed();
    dispatch({
      type: "REPLACE",
      state: {
        ...state,
        // Replace ingredients/menuItems with seed values only if they look empty
        // (i.e. user wiped them too). Otherwise keep current ones.
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
        <Button size="sm" onClick={() => setNewEventOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> New event
        </Button>
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
          <Input
            type="number"
            min={0}
            max={100}
            step={1}
            value={state.settings.lowMarginThresholdPct}
            onChange={(e) =>
              dispatch({
                type: "UPDATE_SETTINGS",
                patch: { lowMarginThresholdPct: Number(e.target.value) || 0 },
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
        {sampleEventPresent ? (
          <>
            <p className="text-xs text-matcha-900/60">
              The UCI Spring Pop-Up demo event is loaded. Clear it once you&apos;ve created your
              own events. Your menu and ingredients are not removed.
            </p>
            <Button variant="danger" size="sm" onClick={clearSampleData}>
              <Trash2 className="h-3.5 w-3.5" /> Clear sample data
            </Button>
          </>
        ) : (
          <>
            <p className="text-xs text-matcha-900/60">
              Reload the UCI Spring Pop-Up sample event to explore the app or demo it.
            </p>
            <Button variant="outline" size="sm" onClick={reloadSampleData}>
              <RefreshCw className="h-3.5 w-3.5" /> Reload sample data
            </Button>
          </>
        )}
      </Card>

      <NewEventDialog open={newEventOpen} onClose={() => setNewEventOpen(false)} />
    </div>
  );
}
