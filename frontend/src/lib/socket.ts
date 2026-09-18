import { io, type Socket } from "socket.io-client";
import { API_BASE } from "./api";

export const socket: Socket = io(API_BASE, { transports: ["websocket", "polling"] });

type Listener = (payload: unknown) => void;
const subs = new Map<string, Set<Listener>>();

export function subscribe<T = unknown>(event: string, cb: (payload: T) => void): () => void {
  let set = subs.get(event);
  if (!set) {
    set = new Set();
    subs.set(event, set);
    socket.on(event, (p: unknown) => subs.get(event)?.forEach((l) => l(p)));
  }
  const listeners = set;
  listeners.add(cb as Listener);
  return () => {
    listeners.delete(cb as Listener);
  };
}

export const socketStatus = () => socket.connected;