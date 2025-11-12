"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { useCurrentUser } from "@/features/auth/hooks/use-current-user";

type UseCollaborationOptions = {
  playgroundId: string | undefined;
};

type ContentChangePayload = {
  fileId: string;
  content: string;
  peerId?: string;
  filePath?: string;
  ts?: number;
};

// Extend WebSocket type to include our custom properties
declare global {
  interface WebSocket {
    _socketId?: string;
  }
}

type Client = {
  socketId: string;
  username: string;
};

export function useCollaboration({ playgroundId }: UseCollaborationOptions) {
  const [socketId, setSocketId] = useState<string>('');
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [peerJoined, setPeerJoined] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const socketIdRef = useRef('');

  const contentChangeHandlers = useRef<Set<(p: ContentChangePayload) => void>>(new Set());
  const savedHandlers = useRef<Set<(p: ContentChangePayload) => void>>(new Set());
  const fileOpHandlers = useRef<Set<(payload: any) => void>>(new Set());
  const joinedRef = useRef(false);
  const outboxRef = useRef<any[]>([]);
  const reconnectAttemptsRef = useRef(0);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debounceTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const lastSentContentRef = useRef<Record<string, string>>({});
  const leavingRef = useRef(false);

  // ---- Debug metrics (opt-in) ----
  const debugEnabledRef = useRef<boolean>(false);
  const metricsRef = useRef({
    tOpen: 0,
    tJoinSent: 0,
    tJoined: 0,
    tSync: 0,
    msgCount: 0,
    changeCount: 0,
    savedCount: 0,
    fileOpCount: 0,
    lastSummary: 0,
    lastSummaryMsgs: 0,
    lastSummaryBytesIn: 0,
    bytesIn: 0,
    bytesOut: 0,
    msgSeq: 0,
    reconnects: 0,
    latencies: [] as number[],
  });
  const summaryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  function refreshDebugFlag() {
    try { debugEnabledRef.current = (localStorage.getItem('COLLAB_DEBUG') === '1'); } catch { debugEnabledRef.current = false; }
  }
  function dlog(...args: any[]) {
    if (!debugEnabledRef.current) return;
    // eslint-disable-next-line no-console
    console.log('[collab]', ...args);
  }
  useEffect(() => {
    refreshDebugFlag();
    // Expose a quick toggle in dev tools
    (window as any).debugCollab = (on?: boolean) => {
      try { localStorage.setItem('COLLAB_DEBUG', on ? '1' : '0'); } catch {}
      refreshDebugFlag();
      dlog('debugCollab set to', debugEnabledRef.current);
    };
    return () => { try { delete (window as any).debugCollab; } catch {} };
  }, []);

  const user = useCurrentUser();

  const sendRaw = useCallback((msg: any) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      if (msg && typeof msg === "object") {
        if (!msg.payload) msg.payload = {};
        if (msg.payload && msg.payload.ts == null) msg.payload.ts = Date.now();
      }
    } catch {}
    try {
      const str = JSON.stringify(msg);
      metricsRef.current.bytesOut += typeof str === 'string' ? str.length : 0;
      ws.send(str);
    } catch {
      // fallback
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const send = useCallback((msg: any) => {
    const ws = wsRef.current;
    // Always allow join to go through immediately
    if (msg?.action === "join") {
      return sendRaw(msg);
    }
    // If socket is not ready or not joined, queue the message
    if (!ws || ws.readyState !== WebSocket.OPEN || !joinedRef.current) {
      outboxRef.current.push(msg);
      return;
    }
    // Route via sendRaw to ensure timestamp is applied
    sendRaw(msg);
  }, [sendRaw]);

  const join = useCallback(
    (roomId?: string) => {
      const id = roomId || playgroundId;
      if (!id) return;
      metricsRef.current.tJoinSent = Date.now();
      sendRaw({ action: "join", payload: { roomId: id, username: user?.name || user?.email || "user" } });
    },
    [playgroundId, sendRaw, user?.name, user?.email]
  );

  const leave = useCallback(() => {
    try {
      sendRaw({ action: "leave", payload: { roomId: playgroundId } });
    } catch {}
    try {
      wsRef.current?.close();
    } catch {}
    joinedRef.current = false;
    outboxRef.current = [];
    setClients([]);
    leavingRef.current = true;
  }, [playgroundId, sendRaw]);

  const connect = useCallback(() => {
    const base = process.env.NODE_ENV === "production" ? window.location.origin : "http://localhost:3000";
    const wsUrl = base.replace(/^http/, "ws") + "/ws";
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    
    // Generate a unique client ID if not provided by the server
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    ws.addEventListener("open", () => {
      // Use server-provided socket ID or fall back to our generated one
      const newSocketId = (ws as any)._socketId || clientId;
      setSocketId(newSocketId);
      socketIdRef.current = newSocketId;
      (ws as any)._socketId = newSocketId; // Store it on the socket for reference
      setConnected(true);
      reconnectAttemptsRef.current = 0;
      leavingRef.current = false; // new clean connection
      metricsRef.current.tOpen = Date.now();
      // start heartbeat
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        try { sendRaw({ action: "ping" }); } catch {}
      }, 25000);
      // start periodic summary if debug enabled
      if (summaryTimerRef.current) { clearInterval(summaryTimerRef.current); summaryTimerRef.current = null; }
      if (debugEnabledRef.current) {
        metricsRef.current.lastSummary = Date.now();
        summaryTimerRef.current = setInterval(() => {
          const lats = metricsRef.current.latencies.slice();
          const avg = lats.length ? (lats.reduce((a,b)=>a+b,0)/lats.length) : 0;
          const p95 = lats.length ? lats.sort((a,b)=>a-b)[Math.floor(0.95*(lats.length-1))] : 0;
          const now = Date.now();
          const elapsedMs = Math.max(1, now - metricsRef.current.lastSummary);
          const msgsDelta = metricsRef.current.msgCount - metricsRef.current.lastSummaryMsgs;
          const bytesDelta = metricsRef.current.bytesIn - metricsRef.current.lastSummaryBytesIn;
          const msgsPerSec = msgsDelta * 1000 / elapsedMs;
          const bytesPerSec = bytesDelta * 1000 / elapsedMs;
          const kbps = Math.round((bytesPerSec * 8) / 1000);
          console.log('[collab]', JSON.stringify({ summary: {
            msgs: metricsRef.current.msgCount,
            change: metricsRef.current.changeCount,
            saved: metricsRef.current.savedCount,
            fileOp: metricsRef.current.fileOpCount,
            avgLatency: Math.round(avg),
            p95Latency: Math.round(p95),
            reconnects: metricsRef.current.reconnects,
            bytesIn: metricsRef.current.bytesIn,
            bytesOut: metricsRef.current.bytesOut,
            windowMs: elapsedMs,
            msgsPerSec: Number(msgsPerSec.toFixed(2)),
            bytesPerSec: Math.round(bytesPerSec),
            kbps,
          }}));
          metricsRef.current.lastSummary = now;
          metricsRef.current.lastSummaryMsgs = metricsRef.current.msgCount;
          metricsRef.current.lastSummaryBytesIn = metricsRef.current.bytesIn;
        }, 30000);
      }
      join(playgroundId);
    });

    const onMessage = (event: MessageEvent) => {
      try {
        const raw = event.data || "{}";
        const { action, payload } = JSON.parse(raw);
        const now = Date.now();
        metricsRef.current.msgCount += 1;
        const bytes = typeof raw === 'string' ? raw.length : 0;
        metricsRef.current.bytesIn += bytes;
        const ts = payload?.ts as number | undefined;
        const latencyMs = ts ? Math.max(0, now - ts) : undefined;
        if (latencyMs != null) {
          const arr = metricsRef.current.latencies;
          arr.push(latencyMs);
          if (arr.length > 200) arr.splice(0, arr.length - 200);
          if (debugEnabledRef.current) {
            const seq = ++metricsRef.current.msgSeq;
            const fileId = payload?.fileId as string | undefined;
            const size = typeof payload?.content === 'string' ? payload.content.length : 0;
            const sentTs = ts || 0;
            const recvTs = now;
            const out = { type: action, latencyMs, bytes, size, seq, sentTs, recvTs, transport: 'raw-ws' } as any;
            if (fileId) out.fileId = fileId;
            console.log('[collab]', JSON.stringify(out));
          }
        }

        if (action === "joined") {
          if (payload?.socketId) setPeerJoined(payload.socketId);
          if (Array.isArray(payload?.clients)) {
            setClients(payload.clients);
          }
        } else if (action === "joined-self") {
          // Explicit confirmation for the joining client; mark joined and flush queue
          metricsRef.current.tJoined = now;
          if (metricsRef.current.tOpen && metricsRef.current.tJoinSent) {
            const openToJoin = metricsRef.current.tJoinSent - metricsRef.current.tOpen;
            const joinToJoined = metricsRef.current.tJoined - metricsRef.current.tJoinSent;
            if (debugEnabledRef.current) console.log('[collab]', JSON.stringify({ event: 'join-latency', openToJoin, joinToJoined }));
          }
          if (Array.isArray(payload?.clients)) {
            setClients(payload.clients);
          }
          if (!joinedRef.current) {
            joinedRef.current = true;
            const ws = wsRef.current;
            while (ws && ws.readyState === WebSocket.OPEN && outboxRef.current.length) {
              const m = outboxRef.current.shift();
              try { sendRaw(m); } catch {}
            }
          }
        } else if (action === "sync-files") {
          metricsRef.current.tSync = now;
          if (metricsRef.current.tJoined) {
            const joinedToSync = metricsRef.current.tSync - metricsRef.current.tJoined;
            if (debugEnabledRef.current) console.log('[collab]', JSON.stringify({ event: 'sync-latency', joinedToSync }));
          }
          // When syncing files, emit content-change per file to existing handlers
          const files = payload?.files || {};
          const tsSync = payload?.ts as number | undefined;
          Object.keys(files).forEach((fid) => {
            // Mark these as coming from initial sync so callers can treat them differently
            contentChangeHandlers.current.forEach((h) => h({ fileId: fid, content: files[fid], ts: tsSync, peerId: '__sync__' }));
          });
          // Mark as joined and flush queued messages
          if (!joinedRef.current) {
            joinedRef.current = true;
            const ws = wsRef.current;
            while (ws && ws.readyState === WebSocket.OPEN && outboxRef.current.length) {
              const m = outboxRef.current.shift();
              sendRaw(m);
            }
          }
        } else if (action === "content-change") {
          metricsRef.current.changeCount += 1;
          const { fileId, content } = payload || {};
          const tsPayload = payload?.ts as number | undefined;
          
          console.log('[collab] Processing content-change:', { 
            fileId, 
            contentLength: content?.length || 0,
            ts: tsPayload,
            handlerCount: contentChangeHandlers.current.size
          });
          
          if (!fileId) {
            console.error('[collab] Received content-change with no fileId');
            return;
          }
          
          try {
            // Convert to array to safely get index
            const handlers = Array.from(contentChangeHandlers.current);
            for (let i = 0; i < handlers.length; i++) {
              const handler = handlers[i];
              try {
                console.log(`[collab] Dispatching to handler ${i + 1}/${handlers.length}`);
                handler({ 
                  fileId, 
                  content: content || '', 
                  ts: tsPayload,
                  peerId: payload?.peerId
                });
              } catch (e) {
                console.error(`[collab] Error in content-change handler ${i + 1}:`, e);
              }
            }
          } catch (e) {
            console.error('[collab] Error in content-change dispatch:', e);
          }
        } else if (action === "saved") {
          console.log('[collab] Dispatching saved event to', savedHandlers.current.size, 'handlers');
          metricsRef.current.savedCount += 1;
          const { fileId, content } = payload || {};
          const tsPayload = payload?.ts as number | undefined;
          savedHandlers.current.forEach((h) => h({ fileId, content, ts: tsPayload }));
        } else if (action === "file-op") {
          fileOpHandlers.current.forEach((h) => h(payload));
        } else if (action === "pong" || action === "ping") {
          // ignore
        } else if (action === "disconnected") {
          // Remove disconnected client from presence list
          const id = payload?.socketId;
          if (id) setClients(prev => prev.filter(c => c.socketId !== id));
        }
      } catch (_) {}
    };

    ws.addEventListener("message", onMessage);
    ws.addEventListener("close", () => {
      setConnected(false);
      joinedRef.current = false;
      setClients([]);
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
      if (summaryTimerRef.current) { clearInterval(summaryTimerRef.current); summaryTimerRef.current = null; }
      // reconnect with backoff
      if (!leavingRef.current) {
        metricsRef.current.reconnects += 1;
        const delay = Math.min(5000, 500 * Math.pow(2, reconnectAttemptsRef.current++));
        setTimeout(() => {
          if (playgroundId) connect();
        }, delay);
      }
    });
    ws.addEventListener("error", () => {
      setConnected(false);
      try { ws.close(); } catch {}
    });
  }, [join, playgroundId, sendRaw]);

  useEffect(() => {
    if (!playgroundId) return;
    setClients([]);
    connect();
    const handlePageHide = () => leave();
    const handleBeforeUnload = () => leave();
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      try { leave(); } catch {}
      const ws = wsRef.current;
      if (ws) {
        ws.close();
      }
      wsRef.current = null;
      joinedRef.current = false;
      outboxRef.current = [];
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [playgroundId, connect]);

  const broadcastContentChange = useCallback(
    (payload: ContentChangePayload) => {
      if (!playgroundId || !payload.fileId) {
        console.log('[collab] broadcastContentChange: Missing playgroundId or fileId', { playgroundId, fileId: payload?.fileId });
        return;
      }
      
      const key = payload.fileId;
      const timestamp = Date.now();
      
      // Clear any pending debounce for this file
      if (debounceTimersRef.current[key]) {
        clearTimeout(debounceTimersRef.current[key]);
      }
      
      // Get debounce delay (0ms in debug mode, 30ms otherwise)
      const delay = (() : number => {
        try { 
          return (localStorage.getItem('COLLAB_DEBUG') === '1') ? 0 : 30; 
        } catch { 
          return 30; 
        }
      })();
      
      // Dedupe identical payloads to reduce network traffic
      try {
        const last = lastSentContentRef.current[key];
        if (last === (payload.content || '')) {
          console.log('[collab] broadcastContentChange: Skipping duplicate content for', key);
          return;
        }
      } catch (e) {
        console.error('[collab] Error checking for duplicate content:', e);
      }
      
      // Set up the debounced send
      debounceTimersRef.current[key] = setTimeout(() => {
        try {
          const msg = { 
            action: "content-change", 
            payload: { 
              roomId: playgroundId, 
              fileId: payload.fileId, 
              content: payload.content, 
              filePath: payload.filePath,
              ts: timestamp // Include timestamp for ordering
            } 
          };
          
          console.log('[collab] Broadcasting content change:', { 
            fileId: payload.fileId, 
            contentLength: (payload.content || '').length,
            ts: timestamp
          });
          
          if (!joinedRef.current) {
            outboxRef.current.push(msg);
            console.log('[collab] Added to outbox (not connected)');
          } else {
            send(msg);
          }
          
          // Update last sent content
          try { 
            lastSentContentRef.current[key] = payload.content || ''; 
          } catch (e) {
            console.error('[collab] Error updating last sent content:', e);
          }
          
        } catch (e) {
          console.error('[collab] Error in broadcastContentChange:', e);
        }
      }, delay);
    },
    [playgroundId, send]
  );

  const broadcastSaved = useCallback(
    (payload: ContentChangePayload) => {
      if (!playgroundId || !payload.fileId) {
        console.log('[collab] broadcastSaved: Missing playgroundId or fileId', { playgroundId, fileId: payload?.fileId });
        return;
      }
      
      const timestamp = Date.now();
      const msg = { 
        action: "saved", 
        payload: { 
          roomId: playgroundId, 
          fileId: payload.fileId, 
          content: payload.content,
          ts: timestamp,
          filePath: payload.filePath
        } 
      };
      
      console.log('[collab] Broadcasting saved:', { 
        fileId: payload.fileId, 
        contentLength: (payload.content || '').length,
        ts: timestamp 
      });
      
      if (!joinedRef.current) {
        outboxRef.current.push(msg);
        console.log('[collab] Added saved to outbox (not connected)');
      } else {
        send(msg);
      }
    },
    [playgroundId, send]
  );

  const broadcastFileOp = useCallback(
    (payload: any) => {
      if (!playgroundId) return;
      const msg = { action: "file-op", payload: { roomId: playgroundId, ...payload } };
      if (!joinedRef.current) {
        outboxRef.current.push(msg);
      } else {
        send(msg);
      }
    },
    [playgroundId, send]
  );

  const requestFile = useCallback((fileId: string) => {
    if (!playgroundId || !fileId) return;
    const msg = { action: "request-file", payload: { roomId: playgroundId, fileId } };
    if (!joinedRef.current) {
      outboxRef.current.push(msg);
    } else {
      send(msg);
    }
  }, [playgroundId, send]);

  const onRemoteContentChange = useCallback((handler: (p: ContentChangePayload) => void) => {
    contentChangeHandlers.current.add(handler);
    return () => { contentChangeHandlers.current.delete(handler); };
  }, []);

  const onRemoteFileOp = useCallback((handler: (payload: any) => void) => {
    fileOpHandlers.current.add(handler);
    return () => { fileOpHandlers.current.delete(handler); };
  }, []);

  const onRemoteSaved = useCallback((handler: (p: ContentChangePayload) => void) => {
    savedHandlers.current.add(handler);
    return () => { savedHandlers.current.delete(handler); };
  }, []);

  // Provide a stable reference to socketId that won't change between renders
  const getSocketId = useCallback(() => socketIdRef.current, []);

  return {
    connected,
    clients,
    socketId: socketIdRef.current, // Always use the ref value to avoid hydration issues
    getSocketId,
    join,
    leave,
    broadcastContentChange,
    broadcastSaved,
    broadcastFileOp,
    onRemoteContentChange,
    onRemoteSaved,
    onRemoteFileOp,
    requestFile,
  };
}