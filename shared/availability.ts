import type {
  ReservationSlot,
  ReservableRoom,
  RoomAvailability,
  SlotStatus
} from "./types";

export interface LibraryGetRoomResponse {
  status: number;
  message: string;
  data?: {
    normalRoomGroupDates?: Array<{
      FROM_TIME?: number;
      TO_TIME?: number;
      ROOM_ID?: number;
      ROOM_NO?: number;
    }>;
    room?: Array<{
      RES_ID?: number;
      RES_HOUR?: number;
    }>;
    roomOther?: Array<{
      RES_HOUR?: number;
    }>;
    notAvailableRoomDates?: Array<{
      RES_HOUR?: number;
    }>;
    canAvailableRoomDates?: unknown[];
  };
}

interface ParseInput {
  room: ReservableRoom;
  date: string;
  response: LibraryGetRoomResponse;
  fetchedAt: string;
  cached: boolean;
}

export function parseRoomAvailability({
  room,
  date,
  response,
  fetchedAt,
  cached
}: ParseInput): RoomAvailability {
  const metadata = response.data?.normalRoomGroupDates?.[0];
  const fromHour = normalizeHour(metadata?.FROM_TIME, 8);
  const toHour = normalizeHour(metadata?.TO_TIME, 23);
  const ownByHour = new Map<number, number>();
  const occupiedHours = new Set<number>();
  const unavailableHours = new Set<number>();

  for (const item of response.data?.room ?? []) {
    if (typeof item.RES_HOUR === "number" && typeof item.RES_ID === "number") {
      ownByHour.set(item.RES_HOUR, item.RES_ID);
    }
  }

  for (const item of response.data?.roomOther ?? []) {
    if (typeof item.RES_HOUR === "number") {
      occupiedHours.add(item.RES_HOUR);
    }
  }

  for (const item of response.data?.notAvailableRoomDates ?? []) {
    if (typeof item.RES_HOUR === "number") {
      unavailableHours.add(item.RES_HOUR);
    }
  }

  const slots: ReservationSlot[] = [];

  for (let hour = fromHour; hour <= toHour; hour += 1) {
    const reservationId = ownByHour.get(hour);
    const status = getSlotStatus(hour, {
      reservationId,
      occupiedHours,
      unavailableHours,
      defaultUnavailable: isManualRequestOnlyRoom(room)
    });

    slots.push({
      roomId: room.id,
      roomNo: room.roomNo,
      date,
      hour,
      status,
      ...(reservationId ? { reservationId } : {})
    });
  }

  return {
    room,
    date,
    fromHour,
    toHour,
    slots,
    sourceFetchedAt: fetchedAt,
    cached
  };
}

function getSlotStatus(
  hour: number,
  context: {
    reservationId?: number;
    occupiedHours: Set<number>;
    unavailableHours: Set<number>;
    defaultUnavailable: boolean;
  }
): SlotStatus {
  if (context.reservationId) {
    return "own";
  }

  if (context.occupiedHours.has(hour)) {
    return "occupied";
  }

  if (context.unavailableHours.has(hour)) {
    return "unavailable";
  }

  if (context.defaultUnavailable) {
    return "unavailable";
  }

  return "available";
}

function isManualRequestOnlyRoom(room: ReservableRoom): boolean {
  return room.id === 108 || room.id === 110;
}

function normalizeHour(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}
