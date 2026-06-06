import type {
  AvailabilityResponse,
  MyReservationsResponse,
  ReservationActionResponse,
  ReservationSlot,
  ReservableRoom,
  SessionResponse
} from "../../shared/types";
import type { ReservationAction } from "../lib/reservationUi";

interface ApiErrorShape {
  message?: string;
}

export interface ReservationApiClient {
  getSession: () => Promise<SessionResponse>;
  login: (userId: string, userPwd: string) => Promise<SessionResponse>;
  logout: () => Promise<SessionResponse>;
  getRooms: () => Promise<ReservableRoom[]>;
  getAvailability: (
    date: string,
    roomIds: number[]
  ) => Promise<AvailabilityResponse>;
  getMyReservations: () => Promise<MyReservationsResponse>;
  submitReservationAction: (
    action: ReservationAction,
    slot: ReservationSlot
  ) => Promise<ReservationActionResponse>;
}

export const localApiClient: ReservationApiClient = {
  getSession() {
    return fetchJson<SessionResponse>("/api/session");
  },
  async login(userId, userPwd) {
    return fetchJson<SessionResponse>("/api/login", {
      method: "POST",
      body: JSON.stringify({ userId, userPwd })
    });
  },
  logout() {
    return fetchJson<SessionResponse>("/api/logout", { method: "POST" });
  },
  async getRooms() {
    const response = await fetchJson<{ rooms: ReservableRoom[] }>("/api/rooms");
    return response.rooms;
  },
  getAvailability(date, roomIds) {
    const params = new URLSearchParams({
      date,
      roomIds: roomIds.join(",")
    });
    return fetchJson<AvailabilityResponse>(`/api/availability?${params}`);
  },
  getMyReservations() {
    return fetchJson<MyReservationsResponse>("/api/my-reservations");
  },
  submitReservationAction(action, slot) {
    const endpoint = action === "reserve" ? "/api/reservations" : "/api/cancellations";
    return fetchJson<ReservationActionResponse>(endpoint, {
      method: "POST",
      body: JSON.stringify({
        roomId: slot.roomId,
        date: slot.date,
        hour: slot.hour,
        ...(slot.reservationId ? { reservationId: slot.reservationId } : {})
      })
    });
  }
};

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const body = (await response.json().catch(() => ({}))) as ApiErrorShape;

  if (!response.ok) {
    throw new Error(body.message ?? "요청이 실패했습니다.");
  }

  return body as T;
}
