"use client";

import { StoreProvider } from "@/lib/store";
import AppShell from "./AppShell";

export default function AppRoot() {
  return (
    <StoreProvider>
      <AppShell />
    </StoreProvider>
  );
}
