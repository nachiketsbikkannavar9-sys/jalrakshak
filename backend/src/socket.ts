import { Server } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { config } from "./config.js";

let io: Server | null = null;

export function initIo(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: config.corsOrigin, methods: ["GET", "POST"] },
  });
  io.on("connection", (socket) => {
    socket.on("app:ping", () => socket.emit("app:pong", { at: new Date().toISOString() }));
  });
  return io;
}

export function emit(event: string, payload: unknown): void {
  io?.emit(event, payload);
}

export function getIo(): Server | null {
  return io;
}