"use client";

import { useMemo, useState } from "react";
import { Plus, Pencil, Archive, Trash2, AlertTriangle } from "lucide-react";
import {
  Button,
  Card,
  Field,
  Input,
  Modal,
  NumberField,
  Select,
  Textarea,
  Badge,
  Chip,
  EmptyState,
} from "@/components/ui";
import { useStore } from "@/lib/store";
import {
  SIZES,
  SIZE_LABELS,
  type Ingredient,
  type IngredientLine,
  type MenuItem,
  type Size,
  type Unit,
} from "@/lib/types";
import { UNITS_BY_CATEGORY, UNIT_LABELS, unitCategory } from "@/lib/units";
import { defaultItemCost, defaultItemMargin } from "@/lib/calc";
import { formatMoney, formatPct } from "@/lib/utils";

type SubTab = "items" | "ingredients";

export default function MenuManager() {
  const [subtab, setSubtab] = useState<SubTab>("items");
  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="t-display text-xl">Menu</h1>
          <p className="t-caption mt-1 text-sm text-matcha-900/60">
            master menu and ingredients. future events copy a snapshot at creation time.
          </p>
        </div>
        <div className="flex gap-1.5 rounded-xl bg-cream-100 p-1">
          <Chip active={subtab === "items"} onClick={() => setSubtab("items")}>
            <span className="t-display">Items</span>
          </Chip>
          <Chip
            active={subtab === "ingredients"}
            onClick={() => setSubtab("ingredients")}
          >
            <span className="t-display">Ingredients</span>
          </Chip>
        </div>
      </header>
      {subtab === "items" ? <ItemsList /> : <IngredientsList />}
    </div>
  );
}

function ItemsList() {
  const { state, dispatch } = useStore();
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [creating, setCreating] = useState(false);

  const active = state.menuItems.filter((m) => m.active);
  const archived = state.menuItems.filter((m) => !m.active);
  const usedIds = new Set(
    state.orders.flatMap((o) => o.items.map((it) => it.menuItemId)),
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New item
        </Button>
      </div>

      <Section title={`Active (${active.length})`}>
        <div className="space-y-2">
          {active.length === 0 ? (
            <EmptyState
              title="No active items"
              description="Add a menu item to get started."
            />
          ) : (
            active.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                ingredients={state.ingredients}
                lowMarginPct={state.settings.lowMarginThresholdPct}
                onEdit={() => setEditing(item)}
                onArchive={() =>
                  dispatch({
                    type: "UPDATE_MENU_ITEM",
                    id: item.id,
                    patch: { active: false },
                  })
                }
                onDelete={() => {
                  if (usedIds.has(item.id)) {
                    alert("This item is used in existing orders. Archive it instead.");
                    return;
                  }
                  if (confirm(`Delete "${item.name}"?`)) {
                    dispatch({ type: "DELETE_MENU_ITEM", id: item.id });
                  }
                }}
                usedInOrders={usedIds.has(item.id)}
              />
            ))
          )}
        </div>
      </Section>

      {archived.length > 0 ? (
        <Section title={`Archived (${archived.length})`}>
          <div className="space-y-2">
            {archived.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                ingredients={state.ingredients}
                lowMarginPct={state.settings.lowMarginThresholdPct}
                onEdit={() => setEditing(item)}
                onArchive={() =>
                  dispatch({
                    type: "UPDATE_MENU_ITEM",
                    id: item.id,
                    patch: { active: true },
                  })
                }
                onDelete={() => {
                  if (usedIds.has(item.id)) {
                    alert("This item is used in existing orders. Cannot delete.");
                    return;
                  }
                  if (confirm(`Delete "${item.name}" permanently?`)) {
                    dispatch({ type: "DELETE_MENU_ITEM", id: item.id });
                  }
                }}
                usedInOrders={usedIds.has(item.id)}
                isArchived
              />
            ))}
          </div>
        </Section>
      ) : null}

      {editing ? (
        <ItemEditor
          key={editing.id}
          item={editing}
          ingredients={state.ingredients}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            dispatch({ type: "UPDATE_MENU_ITEM", id: editing.id, patch });
            setEditing(null);
          }}
        />
      ) : null}

      {creating ? (
        <ItemEditor
          item={blankItem()}
          ingredients={state.ingredients}
          onClose={() => setCreating(false)}
          onSave={(patch) => {
            // Patch is a Partial<MenuItem>; cast to full create shape
            dispatch({
              type: "ADD_MENU_ITEM",
              item: {
                name: patch.name ?? "Untitled",
                category: patch.category ?? "other",
                price: patch.price ?? 0,
                size: patch.size ?? "other",
                active: patch.active ?? true,
                description: patch.description,
                ingredientLines: patch.ingredientLines ?? [],
                defaultMilkId: patch.defaultMilkId,
                defaultCreamId: patch.defaultCreamId,
                allowedMilkIds: patch.allowedMilkIds ?? [],
                allowedCreamIds: patch.allowedCreamIds ?? [],
              },
            });
            setCreating(false);
          }}
        />
      ) : null}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="t-display mb-2 text-xs text-matcha-900/60">{title}</h2>
      {children}
    </section>
  );
}

function ItemRow({
  item,
  ingredients,
  lowMarginPct,
  onEdit,
  onArchive,
  onDelete,
  usedInOrders,
  isArchived,
}: {
  item: MenuItem;
  ingredients: Ingredient[];
  lowMarginPct: number;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
  usedInOrders: boolean;
  isArchived?: boolean;
}) {
  const cost = defaultItemCost(item, ingredients);
  const margin = defaultItemMargin(item, ingredients);
  const lowMargin =
    margin !== null && margin < lowMarginPct / 100;

  return (
    <Card className={isArchived ? "opacity-70" : undefined}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="t-display text-sm">{item.name}</div>
            <Badge variant="neutral">{SIZE_LABELS[item.size]}</Badge>
            {lowMargin ? (
              <Badge variant="warning">
                <AlertTriangle className="mr-1 h-3 w-3" /> Low margin
              </Badge>
            ) : null}
          </div>
          {item.description ? (
            <div className="t-caption mt-1 text-xs text-matcha-900/60">{item.description}</div>
          ) : null}
        </div>
        <div className="flex items-center gap-6 text-right">
          <Stat label="Price" value={formatMoney(item.price)} />
          <Stat label="Cost" value={formatMoney(cost)} />
          <Stat label="Margin" value={formatPct(margin)} />
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="outline" onClick={onArchive} title={isArchived ? "Unarchive" : "Archive"}>
            <Archive className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onDelete}
            disabled={usedInOrders}
            title={usedInOrders ? "Used in orders — archive instead" : "Delete"}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="t-display text-[10px] text-matcha-900/50">{label}</div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}

function blankItem(): MenuItem {
  return {
    id: "new",
    name: "",
    category: "other",
    price: 0,
    size: "16oz",
    active: true,
    description: "",
    ingredientLines: [],
    defaultMilkId: undefined,
    defaultCreamId: undefined,
    allowedMilkIds: [],
    allowedCreamIds: [],
    createdAt: "",
    updatedAt: "",
  };
}

function ItemEditor({
  item,
  ingredients,
  onClose,
  onSave,
}: {
  item: MenuItem;
  ingredients: Ingredient[];
  onClose: () => void;
  onSave: (patch: Partial<MenuItem>) => void;
}) {
  const [draft, setDraft] = useState<MenuItem>(item);
  const milks = ingredients.filter((i) => i.pool === "milk");
  const creams = ingredients.filter((i) => i.pool === "cream");
  const nonPool = ingredients.filter((i) => !i.pool);

  function patch<K extends keyof MenuItem>(key: K, value: MenuItem[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setLine(idx: number, line: IngredientLine) {
    setDraft((d) => ({
      ...d,
      ingredientLines: d.ingredientLines.map((l, i) => (i === idx ? line : l)),
    }));
  }
  function removeLine(idx: number) {
    setDraft((d) => ({
      ...d,
      ingredientLines: d.ingredientLines.filter((_, i) => i !== idx),
    }));
  }
  function addLine() {
    const first = nonPool[0];
    if (!first) return;
    const defaultUnit = UNITS_BY_CATEGORY[unitCategory(first.unit)][0];
    setDraft((d) => ({
      ...d,
      ingredientLines: [
        ...d.ingredientLines,
        { ingredientId: first.id, amount: 1, unit: defaultUnit },
      ],
    }));
  }

  const cost = defaultItemCost(draft, ingredients);
  const margin = defaultItemMargin(draft, ingredients);

  return (
    <Modal open onClose={onClose} title={item.id === "new" ? "New menu item" : "Edit menu item"}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" className="col-span-2">
            <Input value={draft.name} onChange={(e) => patch("name", e.target.value)} />
          </Field>
          <Field label="Size">
            <Select value={draft.size} onChange={(e) => patch("size", e.target.value as Size)}>
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {SIZE_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Price ($)">
            <NumberField
              step="0.01"
              min={0}
              value={draft.price}
              onChange={(n) => patch("price", n)}
            />
          </Field>
          <Field label="Description" className="col-span-2">
            <Textarea
              rows={2}
              value={draft.description ?? ""}
              onChange={(e) => patch("description", e.target.value)}
            />
          </Field>
        </div>

        <div className="rounded-xl border border-cream-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold">Ingredient lines</h4>
            <Button size="sm" variant="outline" onClick={addLine}>
              <Plus className="h-3.5 w-3.5" /> Add line
            </Button>
          </div>
          {draft.ingredientLines.length === 0 ? (
            <p className="text-xs text-matcha-900/60">No ingredients yet.</p>
          ) : (
            <div className="space-y-2">
              {draft.ingredientLines.map((line, idx) => (
                <LineRow
                  key={idx}
                  line={line}
                  ingredients={nonPool}
                  onChange={(l) => setLine(idx, l)}
                  onRemove={() => removeLine(idx)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-cream-200 p-3">
          <h4 className="text-sm font-semibold">Milk & cream</h4>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Field label="Uses milk?">
              <label className="flex h-10 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(draft.defaultMilkId) || draft.allowedMilkIds.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      const first = milks[0];
                      if (first) {
                        patch("defaultMilkId", first.id);
                        patch("allowedMilkIds", milks.map((m) => m.id));
                      }
                    } else {
                      patch("defaultMilkId", undefined);
                      patch("allowedMilkIds", []);
                    }
                  }}
                  className="h-4 w-4 accent-matcha-500"
                />
                Yes
              </label>
            </Field>
            <Field label="Default milk">
              <Select
                value={draft.defaultMilkId ?? ""}
                disabled={!draft.allowedMilkIds.length}
                onChange={(e) => patch("defaultMilkId", e.target.value || undefined)}
              >
                <option value="">—</option>
                {milks.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </Select>
            </Field>
          </div>
          {draft.allowedMilkIds.length > 0 ? (
            <div className="mt-3">
              <div className="mb-1 text-xs font-medium text-matcha-900/70">Allowed milks</div>
              <div className="flex flex-wrap gap-1.5">
                {milks.map((m) => {
                  const on = draft.allowedMilkIds.includes(m.id);
                  return (
                    <Chip
                      key={m.id}
                      active={on}
                      onClick={() =>
                        patch(
                          "allowedMilkIds",
                          on
                            ? draft.allowedMilkIds.filter((id) => id !== m.id)
                            : [...draft.allowedMilkIds, m.id],
                        )
                      }
                    >
                      {m.name}
                    </Chip>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Uses cream?">
              <label className="flex h-10 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(draft.defaultCreamId) || draft.allowedCreamIds.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      const first = creams[0];
                      if (first) {
                        patch("defaultCreamId", first.id);
                        patch("allowedCreamIds", creams.map((m) => m.id));
                      }
                    } else {
                      patch("defaultCreamId", undefined);
                      patch("allowedCreamIds", []);
                    }
                  }}
                  className="h-4 w-4 accent-matcha-500"
                />
                Yes
              </label>
            </Field>
            <Field label="Default cream">
              <Select
                value={draft.defaultCreamId ?? ""}
                disabled={!draft.allowedCreamIds.length}
                onChange={(e) => patch("defaultCreamId", e.target.value || undefined)}
              >
                <option value="">—</option>
                {creams.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </Select>
            </Field>
          </div>
          {draft.allowedCreamIds.length > 0 ? (
            <div className="mt-3">
              <div className="mb-1 text-xs font-medium text-matcha-900/70">Allowed creams</div>
              <div className="flex flex-wrap gap-1.5">
                {creams.map((m) => {
                  const on = draft.allowedCreamIds.includes(m.id);
                  return (
                    <Chip
                      key={m.id}
                      active={on}
                      onClick={() =>
                        patch(
                          "allowedCreamIds",
                          on
                            ? draft.allowedCreamIds.filter((id) => id !== m.id)
                            : [...draft.allowedCreamIds, m.id],
                        )
                      }
                    >
                      {m.name}
                    </Chip>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-3 gap-3 rounded-xl bg-cream-100 p-3">
          <Stat label="Price" value={formatMoney(draft.price)} />
          <Stat label="Derived cost" value={formatMoney(cost)} />
          <Stat label="Margin" value={formatPct(margin)} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(draft)} disabled={!draft.name.trim()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function LineRow({
  line,
  ingredients,
  onChange,
  onRemove,
}: {
  line: IngredientLine;
  ingredients: Ingredient[];
  onChange: (l: IngredientLine) => void;
  onRemove: () => void;
}) {
  const ing = ingredients.find((i) => i.id === line.ingredientId);
  const category = ing ? unitCategory(ing.unit) : "mass";
  const validUnits = UNITS_BY_CATEGORY[category];

  return (
    <div className="grid grid-cols-[1fr_70px_80px_auto] items-center gap-2">
      <Select
        value={line.ingredientId}
        onChange={(e) => {
          const newId = e.target.value;
          const newIng = ingredients.find((i) => i.id === newId);
          if (!newIng) return;
          const newCategory = unitCategory(newIng.unit);
          const newUnit =
            unitCategory(line.unit) === newCategory
              ? line.unit
              : UNITS_BY_CATEGORY[newCategory][0];
          onChange({ ingredientId: newId, amount: line.amount, unit: newUnit as Unit });
        }}
      >
        {ingredients.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </Select>
      <NumberField
        step="0.1"
        min={0}
        value={line.amount}
        onChange={(n) => onChange({ ...line, amount: n })}
      />
      <Select
        value={line.unit}
        onChange={(e) => onChange({ ...line, unit: e.target.value as Unit })}
      >
        {validUnits.map((u) => (
          <option key={u} value={u}>
            {UNIT_LABELS[u]}
          </option>
        ))}
      </Select>
      <Button size="sm" variant="ghost" onClick={onRemove}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function IngredientsList() {
  const { state, dispatch } = useStore();
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New ingredient
        </Button>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="t-display text-left text-xs text-matcha-900/60">
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Package $</th>
                <th className="py-2 pr-3">Package amount</th>
                <th className="py-2 pr-3">Unit</th>
                <th className="py-2 pr-3 text-right">$/unit</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.ingredients.map((ing) => (
                <IngredientRow
                  key={ing.id}
                  ing={ing}
                  onChange={(patch) =>
                    dispatch({ type: "UPDATE_INGREDIENT", id: ing.id, patch })
                  }
                  onDelete={() => {
                    const used = state.menuItems.some((m) =>
                      m.ingredientLines.some((l) => l.ingredientId === ing.id),
                    );
                    if (used) {
                      alert("Used by a menu item — remove from items first.");
                      return;
                    }
                    if (confirm(`Delete ingredient "${ing.name}"?`)) {
                      dispatch({ type: "DELETE_INGREDIENT", id: ing.id });
                    }
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {creating ? (
        <Modal open onClose={() => setCreating(false)} title="New ingredient">
          <NewIngredientForm
            onCancel={() => setCreating(false)}
            onCreate={(ing) => {
              dispatch({ type: "ADD_INGREDIENT", ing });
              setCreating(false);
            }}
          />
        </Modal>
      ) : null}
    </div>
  );
}

function IngredientRow({
  ing,
  onChange,
  onDelete,
}: {
  ing: Ingredient;
  onChange: (patch: Partial<Ingredient>) => void;
  onDelete: () => void;
}) {
  const perUnit =
    ing.packageAmount > 0 ? ing.packagePrice / ing.packageAmount : 0;
  return (
    <tr className="border-t border-cream-100">
      <td className="py-1.5 pr-3">
        <Input
          className="h-8"
          value={ing.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </td>
      <td className="py-1.5 pr-3">
        <NumberField
          className="h-8"
          step="0.01"
          min={0}
          value={ing.packagePrice}
          onChange={(n) => onChange({ packagePrice: n })}
        />
      </td>
      <td className="py-1.5 pr-3">
        <NumberField
          className="h-8"
          step="0.01"
          min={0}
          value={ing.packageAmount}
          onChange={(n) => onChange({ packageAmount: n })}
        />
      </td>
      <td className="py-1.5 pr-3">
        <Select
          className="h-8"
          value={ing.unit}
          onChange={(e) => onChange({ unit: e.target.value as Unit })}
        >
          {Object.entries(UNIT_LABELS).map(([u, lab]) => (
            <option key={u} value={u}>
              {lab}
            </option>
          ))}
        </Select>
      </td>
      <td className="py-1.5 pr-3 text-right font-mono text-xs text-matcha-900/70 tabular-nums">
        ${perUnit.toFixed(4)}
      </td>
      <td className="py-1.5">
        <Button size="sm" variant="ghost" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
}

function NewIngredientForm({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (
    ing: Omit<Ingredient, "id" | "createdAt" | "updatedAt">,
  ) => void;
}) {
  const [name, setName] = useState("");
  const [packagePrice, setPackagePrice] = useState(0);
  const [packageAmount, setPackageAmount] = useState(0);
  const [unit, setUnit] = useState<Unit>("g");
  return (
    <div className="space-y-3">
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Package $">
          <NumberField
            step="0.01"
            min={0}
            value={packagePrice}
            onChange={setPackagePrice}
          />
        </Field>
        <Field label="Amount">
          <NumberField
            step="0.01"
            min={0}
            value={packageAmount}
            onChange={setPackageAmount}
          />
        </Field>
        <Field label="Unit">
          <Select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            {Object.entries(UNIT_LABELS).map(([u, lab]) => (
              <option key={u} value={u}>
                {lab}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={() =>
            onCreate({
              name: name.trim(),
              pool: null,
              packagePrice,
              packageAmount,
              unit,
            })
          }
          disabled={!name.trim() || packageAmount <= 0}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
