import type {
  ReservationSlot,
  ReservableRoom,
  RoomAvailability,
  SlotStatus
} from "./types";
import { addDaysYmd } from "./dateUtils";

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
    canAvailableRoomDates?: Array<{
      RES_HOUR?: number;
      FROM_TIME?: number;
      TO_TIME?: number;
      RES_DT?: string;
      RES_YYYYMMDD?: string;
    }>;
  };
}

export const DEFAULT_OPERATING_START_HOUR = 8;
export const DEFAULT_OPERATING_END_HOUR = 23;
export const DEFAULT_AVAILABILITY_HOURS = buildOperatingHours(
  DEFAULT_OPERATING_START_HOUR,
  DEFAULT_OPERATING_END_HOUR
);

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
  const fromHour = normalizeHour(metadata?.FROM_TIME, DEFAULT_OPERATING_START_HOUR);
  const toHour = normalizeHour(metadata?.TO_TIME, DEFAULT_OPERATING_END_HOUR);
  const ownByHour = new Map<number, number>();
  const occupiedHours = new Set<number>();
  const unavailableHours = new Set<number>();
  const explicitlyAvailableHours = new Set<number>();

  for (const item of response.data?.room ?? []) {
    if (typeof item.RES_HOUR === "number" && typeof item.RES_ID === "number") {
      ownByHour.set(normalizeDisplayHour(item.RES_HOUR), item.RES_ID);
    }
  }

  for (const item of response.data?.roomOther ?? []) {
    if (typeof item.RES_HOUR === "number") {
      occupiedHours.add(normalizeDisplayHour(item.RES_HOUR));
    }
  }

  for (const item of response.data?.notAvailableRoomDates ?? []) {
    if (typeof item.RES_HOUR === "number") {
      unavailableHours.add(normalizeDisplayHour(item.RES_HOUR));
    }
  }

  for (const hour of collectExplicitlyAvailableHours(
    response.data?.canAvailableRoomDates ?? [],
    date,
    fromHour
  )) {
    explicitlyAvailableHours.add(hour);
  }

  const slots: ReservationSlot[] = [];
  const hours = sortAvailabilityHours([
    ...buildOperatingHours(fromHour, toHour),
    ...ownByHour.keys(),
    ...occupiedHours,
    ...unavailableHours,
    ...explicitlyAvailableHours
  ]);

  for (const hour of hours) {
    const reservationId = ownByHour.get(hour);
    const slotDate = getReservationDateForOperatingHour(date, hour, fromHour);
    const status = getSlotStatus(hour, {
      reservationId,
      occupiedHours,
      explicitlyAvailableHours,
      unavailableHours,
      defaultUnavailable: isManualRequestOnlyRoom(room)
    });

    slots.push({
      roomId: room.id,
      roomNo: room.roomNo,
      date: slotDate,
      ...(slotDate !== date ? { displayDate: date } : {}),
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
    explicitlyAvailableHours: Set<number>;
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

  if (context.explicitlyAvailableHours.has(hour)) {
    return "available";
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

function collectExplicitlyAvailableHours(
  items: NonNullable<
    NonNullable<LibraryGetRoomResponse["data"]>["canAvailableRoomDates"]
  >,
  date: string,
  fromHour: number
): number[] {
  const hours = new Set<number>();

  for (const item of items) {
    if (typeof item.RES_HOUR === "number") {
      const hour = normalizeDisplayHour(item.RES_HOUR);

      if (isScheduleItemForDate(item, date, hour, fromHour)) {
        hours.add(hour);
      }

      continue;
    }

    if (typeof item.FROM_TIME === "number" && typeof item.TO_TIME === "number") {
      for (const hour of buildOperatingHours(item.FROM_TIME, item.TO_TIME)) {
        if (isScheduleItemForDate(item, date, hour, fromHour)) {
          hours.add(hour);
        }
      }
    }
  }

  return [...hours];
}

function isScheduleItemForDate(
  item: { RES_DT?: string; RES_YYYYMMDD?: string },
  date: string,
  hour: number,
  fromHour: number
): boolean {
  const scheduleDate = normalizeScheduleDate(item.RES_YYYYMMDD ?? item.RES_DT);
  return (
    !scheduleDate ||
    scheduleDate === getReservationDateForOperatingHour(date, hour, fromHour)
  );
}

function normalizeScheduleDate(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  if (/^\d{8}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .format(parsed)
    .replaceAll("-", "");
}

export function getReservationDateForOperatingHour(
  date: string,
  hour: number,
  fromHour: number = DEFAULT_OPERATING_START_HOUR
): string {
  return normalizeDisplayHour(hour) < normalizeDisplayHour(fromHour)
    ? addDaysYmd(date, 1)
    : date;
}

export function buildOperatingHours(fromHour: number, toHour: number): number[] {
  const from = normalizeDisplayHour(fromHour);
  const to = normalizeDisplayHour(toHour);

  if (from <= to) {
    return buildInclusiveHourRange(from, to);
  }

  return [...buildInclusiveHourRange(from, 23), ...buildInclusiveHourRange(0, to)];
}

export function sortAvailabilityHours(hours: number[]): number[] {
  return [...new Set(hours.map(normalizeDisplayHour))].sort(compareOperatingHours);
}

export function compareOperatingHours(a: number, b: number): number {
  return getOperatingHourSortValue(a) - getOperatingHourSortValue(b);
}

export function areConsecutiveOperatingHours(
  previousHour: number,
  currentHour: number
): boolean {
  return normalizeDisplayHour(currentHour) === getNextOperatingHour(previousHour);
}

export function getOperatingHourSortValue(hour: number): number {
  const normalizedHour = normalizeDisplayHour(hour);
  return normalizedHour < DEFAULT_OPERATING_START_HOUR
    ? normalizedHour + 24
    : normalizedHour;
}

export function getNextOperatingHour(hour: number): number {
  return normalizeDisplayHour(hour + 1);
}

export function normalizeDisplayHour(hour: number): number {
  return ((hour % 24) + 24) % 24;
}

function buildInclusiveHourRange(fromHour: number, toHour: number): number[] {
  return Array.from({ length: toHour - fromHour + 1 }, (_, index) => fromHour + index);
}
