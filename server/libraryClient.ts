import {
  compareOperatingHours,
  parseRoomAvailability,
  sortAvailabilityHours
} from "../shared/availability";
import {
  addDaysYmd,
  monthStartYmd,
  nextMonthStartYmd,
  todayYmd
} from "../shared/dateUtils";
import { reservableRooms, roomById } from "../shared/rooms";
import type { LibraryGetRoomResponse } from "../shared/availability";
import type {
  AvailabilityResponse,
  MyReservation,
  MyReservationsResponse,
  ReservationActionResponse,
  ReservationSlot,
  RoomAvailability,
  SessionResponse
} from "../shared/types";

const API_BASE_URL = "https://library.gist.ac.kr:8443";
const CACHE_TTL_MS = 60_000;
const CONCURRENCY_LIMIT = 3;
const REQUEST_TIMEOUT_MS = 15_000;

interface LibrarySession {
  userId: string;
  accessToken: string;
  tokenExpiresAt?: number;
}

interface CacheEntry {
  expiresAt: number;
  value: RoomAvailability;
}

let session: LibrarySession | null = null;
const availabilityCache = new Map<string, CacheEntry>();

export function getSession(): SessionResponse {
  const start = todayYmd();
  return {
    authenticated: Boolean(session),
    userId: session?.userId,
    tokenExpiresAt: session?.tokenExpiresAt,
    reservationWindow: {
      start,
      end: addDaysYmd(start, 29)
    }
  };
}

export function logout(): void {
  session = null;
  availabilityCache.clear();
}

export async function login(userId: string, userPwd: string): Promise<SessionResponse> {
  const payload = { userId, userPwd };
  const response = await postLibraryJson<LibraryLoginResponse>("/hello/login", payload);

  if (response.status !== 200 || response.data?.success === false) {
    throw new LibraryApiError("로그인에 실패했습니다.", response.status, response);
  }

  const token = response.data?.token ?? response.data;
  const accessToken = token?.accessToken;

  if (!accessToken) {
    throw new LibraryApiError("로그인 응답에서 accessToken을 찾지 못했습니다.", 502, response);
  }

  session = {
    userId,
    accessToken,
    tokenExpiresAt: token?.expire
  };
  availabilityCache.clear();

  return getSession();
}

export async function getAvailability(
  date: string,
  roomIds: number[] = reservableRooms.map((room) => room.id)
): Promise<AvailabilityResponse> {
  assertAuthenticated();

  const uniqueRoomIds = [...new Set(roomIds)];
  const roomTasks = uniqueRoomIds
    .map((roomId) => roomById.get(roomId))
    .filter((room): room is NonNullable<typeof room> => Boolean(room))
    .map((room) => () => getRoomAvailability(date, room.id));

  const roomAvailability = await runWithConcurrency(roomTasks, CONCURRENCY_LIMIT);
  const hourSet = new Set<number>();

  for (const availability of roomAvailability) {
    for (const slot of availability.slots) {
      hourSet.add(slot.hour);
    }
  }

  return {
    date,
    hours: sortAvailabilityHours([...hourSet]),
    rooms: roomAvailability.map((item) => item.room),
    roomAvailability,
    fetchedAt: new Date().toISOString()
  };
}

export async function getMyReservations(): Promise<MyReservationsResponse> {
  const activeSession = assertAuthenticated();
  const window = getSession().reservationWindow;
  const response = await postLibraryJson<LibraryGetMyReservationResponse>(
    "/work/getMyReservation",
    {
      END_DT: window.end,
      ROOM_ID: 108,
      START_DT: window.start
    },
    activeSession.accessToken
  );

  const reservations = (response.data ?? [])
    .filter((item) => item.CANCEL_YN !== "Y")
    .map(normalizeMyReservation)
    .sort((a, b) => {
      if (a.date !== b.date) {
        return a.date.localeCompare(b.date);
      }

      if (a.hour !== b.hour) {
        return compareOperatingHours(a.hour, b.hour);
      }

      return a.roomNo - b.roomNo;
    });

  return {
    reservations,
    fetchedAt: new Date().toISOString()
  };
}

export async function makeReservation(
  roomId: number,
  date: string,
  hour: number
): Promise<ReservationActionResponse> {
  const activeSession = assertAuthenticated();
  const room = requireRoom(roomId);

  await postLibraryJson(
    "/work/makeFacilityreservation",
    {
      ADMIN_YN: "N",
      CREATE_ID: activeSession.userId,
      REMARK: "",
      RES_HOUR: hour,
      RES_YYYYMMDD: date,
      ROOM_ID: roomId
    },
    activeSession.accessToken
  );

  invalidateAvailability(date, roomId);
  const refreshed = await getRoomAvailability(date, roomId, { force: true });
  const slot = requireSlot(refreshed, hour);

  if (slot.status !== "own") {
    return {
      success: false,
      slot,
      message: `${room.roomNo}호 ${hour}시 예약을 확인하지 못했습니다.`
    };
  }

  return {
    success: true,
    slot,
    message: `${room.roomNo}호 ${hour}시 예약이 확인되었습니다.`
  };
}

export async function cancelReservation(
  roomId: number,
  date: string,
  hour: number,
  reservationId: number
): Promise<ReservationActionResponse> {
  const activeSession = assertAuthenticated();
  const room = requireRoom(roomId);

  await postLibraryJson(
    "/work/cancelFacilityreservation",
    {
      RES_HOUR: hour,
      RES_ID: reservationId,
      RES_YYYYMMDD: date,
      ROOM_ID: roomId
    },
    activeSession.accessToken
  );

  invalidateAvailability(date, roomId);
  const refreshed = await getRoomAvailability(date, roomId, { force: true });
  const slot = requireSlot(refreshed, hour);

  if (slot.status === "own") {
    return {
      success: false,
      slot,
      message: `${room.roomNo}호 ${hour}시 취소를 확인하지 못했습니다.`
    };
  }

  return {
    success: true,
    slot,
    message: `${room.roomNo}호 ${hour}시 예약 취소가 확인되었습니다.`
  };
}

async function getRoomAvailability(
  date: string,
  roomId: number,
  options: { force?: boolean } = {}
): Promise<RoomAvailability> {
  const activeSession = assertAuthenticated();
  const room = requireRoom(roomId);
  const key = cacheKey(date, roomId);
  const cached = availabilityCache.get(key);

  if (!options.force && cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, cached: true };
  }

  const response = await postLibraryJson<LibraryGetRoomResponse>(
    "/work/getRoom",
    {
      END_DT_YYYYMMDD: nextMonthStartYmd(date),
      RES_YYYYMMDD: date,
      ROOM_ID: roomId,
      START_DT_YYYYMMDD: monthStartYmd(date)
    },
    activeSession.accessToken
  );

  const parsed = parseRoomAvailability({
    room,
    date,
    response,
    fetchedAt: new Date().toISOString(),
    cached: false
  });

  availabilityCache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value: parsed
  });

  return parsed;
}

async function postLibraryJson<T>(
  path: string,
  payload: unknown,
  accessToken?: string
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "*/*",
    "Content-Type": "application/json",
    Origin: "https://library.gist.ac.kr",
    Referer: "https://library.gist.ac.kr/"
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      throw new LibraryApiError("도서관 API 요청이 실패했습니다.", response.status, body);
    }

    return body as T;
  } catch (error) {
    if (error instanceof LibraryApiError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new LibraryApiError("도서관 API 응답 시간이 초과되었습니다.", 504);
    }

    throw new LibraryApiError("도서관 API에 연결하지 못했습니다.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

function assertAuthenticated(): LibrarySession {
  if (!session) {
    throw new LibraryApiError("로그인이 필요합니다.", 401);
  }

  return session;
}

function requireRoom(roomId: number) {
  const room = roomById.get(roomId);
  if (!room) {
    throw new LibraryApiError(`알 수 없는 호실입니다: ${roomId}`, 400);
  }

  return room;
}

function normalizeMyReservation(item: LibraryMyReservationItem): MyReservation {
  const room = roomById.get(item.ROOM_ID);
  return {
    reservationId: item.RES_ID ?? item.id,
    roomId: item.ROOM_ID,
    roomNo: room?.roomNo ?? item.ROOM_ID,
    roomLabel: room?.label ?? `Room ${item.ROOM_ID}`,
    floor: room?.floor ?? null,
    group: room?.group ?? "Unknown",
    date: item.RES_YYYYMMDD,
    hour: item.RES_HOUR,
    createdAt: item.CREATE_DT,
    remark: item.REMARK ?? ""
  };
}

function requireSlot(availability: RoomAvailability, hour: number): ReservationSlot {
  const slot = availability.slots.find((item) => item.hour === hour);
  if (!slot) {
    throw new LibraryApiError(`조회된 운영시간에 ${hour}시가 없습니다.`, 502);
  }

  return slot;
}

function invalidateAvailability(date: string, roomId: number): void {
  availabilityCache.delete(cacheKey(date, roomId));
}

function cacheKey(date: string, roomId: number): string {
  return `${date}:${roomId}`;
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<T[]> {
  const results: T[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await tasks[currentIndex]();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, () => worker())
  );

  return results;
}

export class LibraryApiError extends Error {
  constructor(
    message: string,
    public status = 500,
    public details?: unknown
  ) {
    super(message);
  }
}

interface LibraryLoginResponse {
  status: number;
  message: string;
  data?: {
    success?: boolean;
    accessToken?: string;
    refreshToken?: string;
    expire?: number;
    token?: {
      accessToken?: string;
      refreshToken?: string;
      expire?: number;
      type?: string;
    };
  };
}

interface LibraryGetMyReservationResponse {
  status: number;
  message: string;
  data?: LibraryMyReservationItem[];
}

interface LibraryMyReservationItem {
  CREATE_DT?: string;
  CANCEL_RESID?: number | null;
  RES_YYYYMMDD: string;
  ROOM_ID: number;
  ADMIN_YN?: string;
  USER_ID?: string;
  CANCEL_YN?: string;
  RES_ID: number;
  id: number;
  CREATE_ID?: string;
  REMARK?: string;
  RES_HOUR: number;
}
