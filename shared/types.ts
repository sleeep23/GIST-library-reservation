export type SlotStatus = "available" | "own" | "occupied" | "unavailable";

export interface ReservableRoom {
  id: number;
  roomNo: number;
  label: string;
  floor: number;
  group: string;
  capacity: number | null;
}

export interface ReservationSlot {
  roomId: number;
  roomNo: number;
  date: string;
  hour: number;
  status: SlotStatus;
  reservationId?: number;
}

export interface RoomAvailability {
  room: ReservableRoom;
  date: string;
  fromHour: number;
  toHour: number;
  slots: ReservationSlot[];
  sourceFetchedAt: string;
  cached: boolean;
}

export interface AvailabilityResponse {
  date: string;
  hours: number[];
  rooms: ReservableRoom[];
  roomAvailability: RoomAvailability[];
  fetchedAt: string;
}

export interface MyReservation {
  reservationId: number;
  roomId: number;
  roomNo: number;
  roomLabel: string;
  floor: number | null;
  group: string;
  date: string;
  hour: number;
  createdAt?: string;
  remark: string;
}

export interface MyReservationsResponse {
  reservations: MyReservation[];
  fetchedAt: string;
}

export interface SessionResponse {
  authenticated: boolean;
  userId?: string;
  tokenExpiresAt?: number;
  reservationWindow: {
    start: string;
    end: string;
  };
}

export interface ReservationActionResponse {
  success: boolean;
  slot: ReservationSlot;
  message: string;
}
