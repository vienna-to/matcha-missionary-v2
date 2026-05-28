"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { initialSeed } from "./seed";
import { reducer, type Action } from "./reducer";
import type { AppState, Event } from "./types";

const STORAGE_KEY = "matcha-missionary:state:v1";
const CHANNEL_NAME = "matcha-missionary";

function loadState(): AppState {
  if (typeof window === "undefined") return initialSeed();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialSeed();
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed.settings || !parsed.menuItems) return initialSeed();
    return parsed;
  } catch {
    return initialSeed();
  }
}

type StoreCtx = {
  state: AppState;
  dispatch: (a: Action) => void;
  activeEvent: Event | undefined;
};

const StoreContext = createContext<StoreCtx | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, baseDispatch] = useReducer(reducer, undefined, loadState);
  const isRemoteRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  // set up channel once
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = ch;
    ch.onmessage = (e) => {
      if (e.data?.type === "state") {
        isRemoteRef.current = true;
        baseDispatch({ type: "REPLACE", state: e.data.state as AppState });
      }
    };
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, []);

  // persist + broadcast on state change
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
    if (isRemoteRef.current) {
      isRemoteRef.current = false;
      return;
    }
    try {
      channelRef.current?.postMessage({ type: "state", state });
    } catch {}
  }, [state]);

  const dispatch = useCallback((a: Action) => baseDispatch(a), []);

  const activeEvent = useMemo(
    () => state.events.find((e) => e.isActive),
    [state.events],
  );

  const value = useMemo<StoreCtx>(() => ({ state, dispatch, activeEvent }), [state, dispatch, activeEvent]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

export function useActiveEvent(): Event | undefined {
  return useStore().activeEvent;
}

export function useDispatch(): (a: Action) => void {
  return useStore().dispatch;
}
