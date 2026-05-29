-- ============================================================
-- Migration: Add combo-deal columns to order_items.
--
-- A combo bundles a drink + a pastry at COMBO_PRICE (currently $10).
-- Stored as a single order_item with the *drink*'s id in menu_item_id
-- (so modifiers attach to it) plus the pastry reference + stamped name
-- and cost. priceSnap is the bundle price; costSnap is drink + pastry.
--
-- Event Summary buckets every combo under a synthetic "Combo" row so
-- the underlying drink and pastry don't get double-counted.
--
-- Run once. Safe to re-run.
-- ============================================================

alter table public.order_items
  add column if not exists is_combo                  boolean not null default false,
  add column if not exists combo_pastry_id           text,
  add column if not exists combo_pastry_name_snap    text,
  add column if not exists combo_pastry_cost_snap    numeric;
