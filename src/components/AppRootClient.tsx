"use client";

import dynamic from "next/dynamic";

// Loaded client-side because the entire app relies on localStorage + BroadcastChannel.
const AppRoot = dynamic(() => import("@/components/AppRoot"), { ssr: false });

export default function AppRootClient() {
  return <AppRoot />;
}
