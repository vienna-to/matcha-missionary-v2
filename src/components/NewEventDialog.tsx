"use client";

import { useState } from "react";
import { Button, Field, Input, Modal } from "@/components/ui";
import { useStore } from "@/lib/store";

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function NewEventDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { dispatch } = useStore();
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [startTime, setStartTime] = useState("11:00");
  const [endTime, setEndTime] = useState("16:00");
  const [targetRevenue, setTargetRevenue] = useState<string>("");
  const [donationPct, setDonationPct] = useState<string>("");

  const placeholder = `Pop-Up ${date}`;
  const submittable = date.length === 10 && startTime && endTime;

  function reset() {
    setName("");
    setDate(todayLocal());
    setStartTime("11:00");
    setEndTime("16:00");
    setTargetRevenue("");
    setDonationPct("");
  }

  function save() {
    if (!submittable) return;
    const goal = Number(targetRevenue);
    const donate = Number(donationPct);
    dispatch({
      type: "CREATE_EVENT",
      event: {
        name: name.trim() || placeholder,
        date,
        startTime,
        endTime,
        targetRevenue: Number.isFinite(goal) && goal > 0 ? goal : undefined,
        donationPct:
          Number.isFinite(donate) && donate > 0 && donate <= 100 ? donate : undefined,
      },
    });
    reset();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="New event">
      <div className="space-y-3">
        <Field label="Event name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={placeholder}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Revenue goal (optional)">
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              value={targetRevenue}
              onChange={(e) => setTargetRevenue(e.target.value)}
              onWheel={(e) => (e.target as HTMLInputElement).blur()}
              placeholder="e.g. 500"
            />
          </Field>
          <Field label="Start time">
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
          <Field label="End time">
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </Field>
          <Field label="Donation % (optional)" className="col-span-2">
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              max="100"
              step="1"
              value={donationPct}
              onChange={(e) => setDonationPct(e.target.value)}
              onWheel={(e) => (e.target as HTMLInputElement).blur()}
              placeholder="e.g. 10 — for charity events where X% of revenue is donated"
            />
          </Field>
        </div>
        <p className="text-xs text-matcha-900/60">
          Menu is cloned from your current master menu. Edits to the master menu after this
          won&apos;t affect this event.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!submittable}>Create event</Button>
        </div>
      </div>
    </Modal>
  );
}
