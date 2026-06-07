import type {
  MyReservation,
  ReservationSlot,
  ReservableRoom,
  SlotStatus
} from "../../shared/types";
import { normalizeDisplayHour } from "../../shared/availability";

export interface ConfirmationState {
  action: ReservationAction;
  slot: ReservationSlot;
}

export interface AvailabilityLoadingState {
  date: string;
  roomCount: number;
}

export type ActiveView = "availability" | "my";
export type MyReservationsView = "list" | "calendar";
export type ReservationAction = "reserve" | "cancel";

export const statusLabels: Record<SlotStatus, string> = {
  available: "예약 가능",
  own: "내 예약",
  occupied: "타인 예약",
  unavailable: "예약 불가"
};

export const floorLabels: Record<string, string> = {
  all: "전체 층"
};

export function eachDate(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = parseYmd(start);
  const last = parseYmd(end);

  while (cursor <= last) {
    dates.push(formatYmd(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

export function parseYmd(value: string): Date {
  return new Date(
    Date.UTC(
      Number(value.slice(0, 4)),
      Number(value.slice(4, 6)) - 1,
      Number(value.slice(6, 8))
    )
  );
}

export function formatYmd(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function formatDate(value: string): string {
  return `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}`;
}

export function formatMonthDay(value: string): string {
  return `${Number(value.slice(4, 6))}/${Number(value.slice(6, 8))}`;
}

export function formatWeekday(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    weekday: "short",
    timeZone: "Asia/Seoul"
  }).format(parseYmd(value));
}

export function formatDateRange(start: string, end: string): string {
  return `${formatDate(start)} - ${formatDate(end)}`;
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function hourLabel(hour: number): string {
  return `${String(normalizeDisplayHour(hour)).padStart(2, "0")}:00`;
}

export function slotKey(roomId: number, hour: number): string {
  return `${roomId}:${hour}`;
}

export function placeholderSlot(
  room: ReservableRoom,
  date: string,
  hour: number
): ReservationSlot {
  return {
    roomId: room.id,
    roomNo: room.roomNo,
    date,
    hour,
    status: "unavailable"
  };
}

export function myReservationToSlot(reservation: MyReservation): ReservationSlot {
  return {
    roomId: reservation.roomId,
    roomNo: reservation.roomNo,
    date: reservation.date,
    hour: reservation.hour,
    status: "own",
    reservationId: reservation.reservationId
  };
}

export function shortGroup(room: ReservableRoom): string {
  if (room.group.includes("Carrel")) {
    return room.group.replace("-sized", "");
  }

  if (room.group.includes("Group Study")) {
    return room.capacity ? `${room.capacity}인` : "그룹";
  }

  return room.group;
}

export function formatCreatedAt(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul"
  }).format(new Date(value));
}

export function getErrorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : "요청 중 오류가 발생했습니다.";
}
