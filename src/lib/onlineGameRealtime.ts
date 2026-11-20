export type OnlineRealtimeStatus = "connecting" | "connected" | "disconnected";

export interface OnlineGameRealtimeOptions {
  projectUrl: string;
  publishableKey: string;
  accessToken: string;
  gameId: string;
  onUpdate: (record: Record<string, unknown>) => void;
  onStatus?: (status: OnlineRealtimeStatus) => void;
}

export const ONLINE_GAME_REALTIME_COLUMNS = [
  "id",
  "status",
  "white_id",
  "black_id",
  "white_name",
  "black_name",
  "fen",
  "moves",
  "minutes",
  "increment_seconds",
  "increment_ms",
  "white_ms",
  "black_ms",
  "turn_started_at",
  "rated",
  "rating_type",
  "result",
  "reason",
  "white_rating",
  "black_rating",
] as const;

const HEARTBEAT_INTERVAL_MS = 25_000;
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000] as const;

interface RealtimeFrame {
  joinRef: string | null;
  ref: string | null;
  topic: string;
  event: string;
  payload: Record<string, unknown>;
}

/** Decode a Supabase Realtime v2 JSON frame without trusting its payload. */
export function parseOnlineGameRealtimeFrame(
  raw: string,
  expectedTopic: string
): RealtimeFrame | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== 5) return null;
    const [joinRef, ref, topic, event, payload] = parsed;
    if (topic !== expectedTopic || typeof event !== "string" || !payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    return {
      joinRef: typeof joinRef === "string" ? joinRef : null,
      ref: typeof ref === "string" ? ref : null,
      topic,
      event,
      payload: payload as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

function isGameRecord(value: unknown, gameId: string): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.id === gameId
    && typeof record.status === "string"
    && (record.status === "waiting" || record.status === "active" || record.status === "completed")
    && typeof record.fen === "string"
    && Array.isArray(record.moves)
    && typeof record.white_id === "string"
    && (typeof record.black_id === "string" || record.black_id === null)
    && Number.isFinite(record.white_ms)
    && Number.isFinite(record.black_ms)
    && Number.isFinite(record.increment_ms)
    && typeof record.rated === "boolean";
}

/**
 * Subscribes to the authenticated participant-visible row for one live game.
 * The server remains authoritative: notifications carry the committed row,
 * never a client-generated move or an optimistic board position.
 */
export function subscribeToOnlineGameRealtime(
  options: OnlineGameRealtimeOptions
): () => void {
  const {
    projectUrl,
    publishableKey,
    accessToken,
    gameId,
    onUpdate,
    onStatus,
  } = options;
  let stopped = false;
  let socket: WebSocket | null = null;
  let heartbeatTimer: number | null = null;
  let reconnectTimer: number | null = null;
  let sequence = 0;
  let joinRef: string | null = null;
  let retryIndex = 0;
  const topic = `realtime:online-game:${gameId}`;

  const nextRef = () => String(++sequence);
  const clearHeartbeat = () => {
    if (heartbeatTimer !== null) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };
  const send = (frame: unknown[]) => {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  };

  const connect = () => {
    if (stopped) return;
    onStatus?.("connecting");
    let wsUrl: URL;
    try {
      const base = new URL(projectUrl);
      base.protocol = base.protocol === "http:" ? "ws:" : "wss:";
      base.pathname = "/realtime/v1/websocket";
      base.search = "";
      base.searchParams.set("apikey", publishableKey);
      base.searchParams.set("vsn", "2.0.0");
      wsUrl = base;
    } catch {
      onStatus?.("disconnected");
      return;
    }

    let nextSocket: WebSocket;
    try {
      nextSocket = new WebSocket(wsUrl.toString());
    } catch {
      onStatus?.("disconnected");
      scheduleReconnect();
      return;
    }
    socket = nextSocket;

    nextSocket.onopen = () => {
      if (stopped || socket !== nextSocket) {
        nextSocket.close();
        return;
      }
      joinRef = nextRef();
      const config = {
        config: {
          broadcast: { ack: false, self: false },
          presence: { enabled: false },
          postgres_changes: [{
            event: "UPDATE",
            schema: "public",
            table: "online_games",
            filter: `id=eq.${gameId}`,
            select: [...ONLINE_GAME_REALTIME_COLUMNS],
          }],
          private: false,
        },
        access_token: accessToken,
      };
      send([joinRef, joinRef, topic, "phx_join", config]);
      clearHeartbeat();
      heartbeatTimer = window.setInterval(() => {
        const heartbeatRef = nextRef();
        send([null, heartbeatRef, "phoenix", "heartbeat", {}]);
      }, HEARTBEAT_INTERVAL_MS);
    };

    nextSocket.onmessage = (event: MessageEvent<string>) => {
      if (stopped || socket !== nextSocket || typeof event.data !== "string") return;
      const frame = parseOnlineGameRealtimeFrame(event.data, topic);
      if (!frame) return;

      if (frame.event === "phx_reply" && frame.ref === joinRef) {
        const status = frame.payload.status;
        if (status === "ok") {
          retryIndex = 0;
          onStatus?.("connected");
        } else {
          onStatus?.("disconnected");
          nextSocket.close(4000, "Realtime subscription rejected");
        }
        return;
      }

      if (frame.event === "postgres_changes") {
        const data = frame.payload.data;
        if (!data || typeof data !== "object" || Array.isArray(data)) return;
        const change = data as Record<string, unknown>;
        if (change.schema !== "public" || change.table !== "online_games" || change.type !== "UPDATE") return;
        if (isGameRecord(change.record, gameId)) onUpdate(change.record);
        return;
      }

      if (frame.event === "system") {
        if (frame.payload.status === "error" || frame.payload.status === "timeout") {
          onStatus?.("disconnected");
          nextSocket.close(4000, "Realtime stream unavailable");
        }
        return;
      }

      if (frame.event === "phx_error" || frame.event === "phx_close") {
        nextSocket.close();
      }
    };

    nextSocket.onerror = () => {
      // onclose owns reconnection/backoff so only one retry timer is created.
      try { nextSocket.close(); } catch { /* browser may already have closed it */ }
    };

    nextSocket.onclose = () => {
      if (socket !== nextSocket) return;
      socket = null;
      joinRef = null;
      clearHeartbeat();
      onStatus?.("disconnected");
      scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer !== null) return;
    const index = Math.min(retryIndex, RECONNECT_DELAYS_MS.length - 1);
    const delay = RECONNECT_DELAYS_MS[index];
    retryIndex += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    clearHeartbeat();
    const active = socket;
    socket = null;
    joinRef = null;
    if (active && active.readyState === WebSocket.OPEN) {
      const leaveRef = nextRef();
      try { active.send(JSON.stringify([joinRef, leaveRef, topic, "phx_leave", {}])); } catch { /* best-effort */ }
    }
    try { active?.close(1000, "Game view closed"); } catch { /* already closed */ }
    onStatus?.("disconnected");
  };
}
