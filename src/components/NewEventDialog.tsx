"use client";

import { useState } from "react";
import { Button, Field, Input, Modal, NumberField, Select } from "@/components/ui";
import { useStore } from "@/lib/store";
import { DEFAULT_CUP_OZ, type EventType } from "@/lib/types";

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
  const [eventType, setEventType] = useState<EventType>("standard");
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [startTime, setStartTime] = useState("11:00");
  const [endTime, setEndTime] = useState("16:00");
  const [targetRevenue, setTargetRevenue] = useState<string>("");
  const [donationPct, setDonationPct] = useState<string>("");
  const [cupSizeOz, setCupSizeOz] = useState<number>(DEFAULT_CUP_OZ);
  const [clientName, setClientName] = useState("");
  const [contractPayout, setContractPayout] = useState<number>(0);

  const isContract = eventType === "contract";
  const placeholder = `Pop-Up ${date}`;
  const submittable =
    date.length === 10 &&
    startTime &&
    endTime &&
    cupSizeOz > 0 &&
    (!isContract || (clientName.trim().length > 0 && contractPayout > 0));

  function reset() {
    setEventType("standard");
    setName("");
    setDate(todayLocal());
    setStartTime("11:00");
    setEndTime("16:00");
    setTargetRevenue("");
    setDonationPct("");
    setCupSizeOz(DEFAULT_CUP_OZ);
    setClientName("");
    setContractPayout(0);
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
        targetRevenue:
          !isContract && Number.isFinite(goal) && goal > 0 ? goal : undefined,
        donationPct:
          !isContract && Number.isFinite(donate) && donate > 0 && donate <= 100
            ? donate
            : undefined,
        eventType,
        cupSizeOz,
        clientName: isContract ? clientName.trim() : undefined,
        contractPayout: isContract ? contractPayout : undefined,
      },
    });
    reset();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="New event">
      <div className="space-y-3">
        <Field label="Event type">
          <Select
            value={eventType}
            onChange={(e) => setEventType(e.target.value as EventType)}
          >
            <option value="standard">Standard</option>
            <option value="contract">Contract (fixed payout)</option>
          </Select>
        </Field>
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
          <Field label="Cup size (oz)">
            <NumberField
              min={1}
              step={1}
              value={cupSizeOz}
              commit="change"
              onChange={setCupSizeOz}
            />
          </Field>
          <Field label="Start time">
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
          <Field label="End time">
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </Field>
          {isContract ? (
            <>
              <Field label="Client name" className="col-span-2">
                <Input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="e.g. Acme Corp"
                />
              </Field>
              <Field
                label="Contracted payout ($)"
                className="col-span-2"
                hint="Fixed fee paid regardless of drinks served."
              >
                <NumberField
                  min={0}
                  step={1}
                  value={contractPayout}
                  commit="change"
                  onChange={setContractPayout}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="Revenue goal (optional)" className="col-span-2">
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
            </>
          )}
        </div>
        <p className="text-xs text-matcha-900/60">
          Menu is cloned from your current master menu. Edits to the master menu after this
          won&apos;t affect this event.
          {isContract
            ? " Contract events use a fixed payout — enter cups sold per drink type after the event on Event Summary."
            : ""}
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!submittable}>Create event</Button>
        </div>
      </div>
    </Modal>
  );
}
