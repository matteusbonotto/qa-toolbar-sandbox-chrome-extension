import { useSyncExternalStore } from "react";

const readHashPath = () => {
  const raw = window.location.hash.replace(/^#/, "").split(/[?#]/, 1)[0] || "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
};

const subscribe = (listener: () => void) => {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
};

export const useHashPath = () => useSyncExternalStore(subscribe, readHashPath, () => "/");
