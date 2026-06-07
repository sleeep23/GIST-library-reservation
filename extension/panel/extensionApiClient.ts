import {
  compareOperatingHours,
  type LibraryGetRoomResponse,
  parseRoomAvailability,
  sortAvailabilityHours
} from "../../shared/availability";
import {
  addDaysYmd,
  isPastReservationHour,
  monthStartYmd,
  nextMonthStartYmd,
  todayYmd
} from "../../shared/dateUtils";
import { roomById } from "../../shared/rooms";
import type {
  AvailabilityResponse,
  MyReservation,
  MyReservationsResponse,
  ReservationActionResponse,
  ReservationSlot,
  RoomAvailability
} from "../../shared/types";

const API_BASE_URL = "https://library.gist.ac.kr:8443";
const PROBE_ROOM_ID = 220;
const CACHE_TTL_MS = 60_000;
const CONCURRENCY_LIMIT = 3;
export const DAILY_RESERVATION_LIMIT_HOURS = 4;
export const MONTHLY_RESERVATION_LIMIT_HOURS = 80;
const REQUEST_TIMEOUT_MS = 15_000;

export interface AvailabilityProbeResult {
  availability: RoomAvailability;
  authSource: AuthSource;
  date: string;
  roomId: number;
}

export type AuthSource = "storage-token" | "site-cookie";

export interface ExtensionAvailabilityResult {
  availability: AvailabilityResponse;
  authSource: AuthSource;
}

export interface ExtensionMyReservationsResult {
  authSource: AuthSource;
  myReservations: MyReservationsResponse;
}

export type ExtensionReservationAction = "reserve" | "cancel";

export interface ExtensionReservationActionResult {
  action: ExtensionReservationAction;
  authSource: AuthSource;
  response: ReservationActionResponse;
}

export interface ReservationQuotaStatus {
  canReserve: boolean;
  dailyHours: number;
  dailyRemainingHours: number;
  monthlyHours: number;
  monthlyRemainingHours: number;
  reason?: string;
}

interface TokenCandidate {
  source: "localStorage" | "sessionStorage";
  key: string;
  token: string;
}

interface UserIdCandidate {
  source: "accessToken" | "localStorage" | "sessionStorage";
  key: string;
  userId: string;
}

interface AuthContext {
  authSource: AuthSource;
  accessToken?: string;
  userId?: string;
}

interface CacheEntry {
  expiresAt: number;
  value: RoomAvailability;
}

const availabilityCache = new Map<string, CacheEntry>();

export async function runReadOnlyAvailabilityProbe(
  date: string = todayYmd(),
  roomId: number = PROBE_ROOM_ID
): Promise<AvailabilityProbeResult> {
  const { availability, authSource } = await getExtensionAvailability(date, [roomId], {
    force: true
  });
  const roomAvailability = availability.roomAvailability[0];

  if (!roomAvailability) {
    throw new Error(`알 수 없는 호실입니다: ${roomId}`);
  }

  return {
    availability: roomAvailability,
    authSource,
    date,
    roomId
  };
}

export async function getExtensionAvailability(
  date: string,
  roomIds: number[],
  options: { force?: boolean } = {}
): Promise<ExtensionAvailabilityResult> {
  const authContext = getAuthContext();
  const uniqueRoomIds = [...new Set(roomIds)];
  const roomTasks = uniqueRoomIds
    .map((roomId) => roomById.get(roomId))
    .filter((room): room is NonNullable<typeof room> => Boolean(room))
    .map((room) => () => getRoomAvailability(date, room.id, authContext, options));

  const roomAvailability = await runWithConcurrency(roomTasks, CONCURRENCY_LIMIT);
  const hourSet = new Set<number>();

  for (const availability of roomAvailability) {
    for (const slot of availability.slots) {
      hourSet.add(slot.hour);
    }
  }

  return {
    availability: {
      date,
      hours: sortAvailabilityHours([...hourSet]),
      rooms: roomAvailability.map((item) => item.room),
      roomAvailability,
      fetchedAt: new Date().toISOString()
    },
    authSource: authContext.authSource
  };
}

export async function getExtensionMyReservations(
  startDate: string = todayYmd(),
  endDate: string = addDaysYmd(startDate, 29)
): Promise<ExtensionMyReservationsResult> {
  const authContext = getAuthContext();
  const myReservations = await getMyReservations(authContext, startDate, endDate);

  return {
    authSource: authContext.authSource,
    myReservations
  };
}

export async function submitExtensionReservationAction(
  action: ExtensionReservationAction,
  slot: ReservationSlot
): Promise<ExtensionReservationActionResult> {
  const authContext = getAuthContext();

  if (action === "reserve") {
    await assertReservationQuota(slot.date, authContext);
  }

  if (isPastReservationHour(slot.date, slot.hour)) {
    throw new Error("지난 시간대는 예약하거나 취소할 수 없습니다.");
  }

  const response =
    action === "reserve"
      ? await makeExtensionReservation(slot, authContext)
      : await cancelExtensionReservation(slot, authContext);

  return {
    action,
    authSource: authContext.authSource,
    response
  };
}

export function clearExtensionAvailabilityCache(): void {
  availabilityCache.clear();
}

export function findLibraryTokenCandidate(
  localStorageRef: Storage = window.localStorage,
  sessionStorageRef: Storage = window.sessionStorage
): TokenCandidate | null {
  return (
    findTokenCandidateInStorage(localStorageRef, "localStorage") ??
    findTokenCandidateInStorage(sessionStorageRef, "sessionStorage")
  );
}

export function findLibraryUserIdCandidate(
  accessToken?: string,
  localStorageRef: Storage = window.localStorage,
  sessionStorageRef: Storage = window.sessionStorage
): UserIdCandidate | null {
  if (accessToken) {
    const tokenPayload = decodeJwtPayload(accessToken);
    const userId = tokenPayload ? findUserIdInValue(tokenPayload) : null;

    if (userId) {
      return { source: "accessToken", key: "jwt.payload", userId };
    }
  }

  return (
    findUserIdCandidateInStorage(localStorageRef, "localStorage") ??
    findUserIdCandidateInStorage(sessionStorageRef, "sessionStorage")
  );
}

async function getRoomAvailability(
  date: string,
  roomId: number,
  authContext: AuthContext,
  options: { force?: boolean }
): Promise<RoomAvailability> {
  const room = roomById.get(roomId);

  if (!room) {
    throw new Error(`알 수 없는 호실입니다: ${roomId}`);
  }

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
    authContext.accessToken
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

async function makeExtensionReservation(
  slot: ReservationSlot,
  authContext: AuthContext
): Promise<ReservationActionResponse> {
  const room = requireRoom(slot.roomId);
  const userId = authContext.userId;

  if (!userId) {
    throw new Error("예약 요청에 필요한 사용자 ID를 찾지 못했습니다.");
  }

  await postLibraryJson(
    "/work/makeFacilityreservation",
    {
      ADMIN_YN: "N",
      CREATE_ID: userId,
      REMARK: "",
      RES_HOUR: slot.hour,
      RES_YYYYMMDD: slot.date,
      ROOM_ID: slot.roomId
    },
    authContext.accessToken
  );

  invalidateAvailability(slot.date, slot.roomId);
  const refreshed = await getRoomAvailability(slot.date, slot.roomId, authContext, {
    force: true
  });
  const refreshedSlot = requireSlot(refreshed, slot.hour);

  if (refreshedSlot.status !== "own") {
    return {
      success: false,
      slot: refreshedSlot,
      message: `${room.roomNo}호 ${slot.hour}시 예약을 확인하지 못했습니다.`
    };
  }

  return {
    success: true,
    slot: refreshedSlot,
    message: `${room.roomNo}호 ${slot.hour}시 예약이 확인되었습니다.`
  };
}

export function getReservationQuotaStatus(
  reservations: MyReservation[],
  targetDate: string
): ReservationQuotaStatus {
  const dailyHours = reservations.filter(
    (reservation) => reservation.date === targetDate
  ).length;
  const monthlyHours = reservations.length;
  const dailyRemainingHours = Math.max(0, DAILY_RESERVATION_LIMIT_HOURS - dailyHours);
  const monthlyRemainingHours = Math.max(
    0,
    MONTHLY_RESERVATION_LIMIT_HOURS - monthlyHours
  );

  if (dailyHours >= DAILY_RESERVATION_LIMIT_HOURS) {
    return {
      canReserve: false,
      dailyHours,
      dailyRemainingHours,
      monthlyHours,
      monthlyRemainingHours,
      reason: `하루 최대 ${DAILY_RESERVATION_LIMIT_HOURS}시간까지만 예약할 수 있습니다.`
    };
  }

  if (monthlyHours >= MONTHLY_RESERVATION_LIMIT_HOURS) {
    return {
      canReserve: false,
      dailyHours,
      dailyRemainingHours,
      monthlyHours,
      monthlyRemainingHours,
      reason: `1달 최대 ${MONTHLY_RESERVATION_LIMIT_HOURS}시간까지만 예약할 수 있습니다.`
    };
  }

  return {
    canReserve: true,
    dailyHours,
    dailyRemainingHours,
    monthlyHours,
    monthlyRemainingHours
  };
}

async function assertReservationQuota(
  targetDate: string,
  authContext: AuthContext
): Promise<void> {
  const startDate = todayYmd();
  const endDate = addDaysYmd(startDate, 29);
  const response = await getMyReservations(authContext, startDate, endDate);
  const quota = getReservationQuotaStatus(response.reservations, targetDate);

  if (!quota.canReserve) {
    throw new Error(quota.reason ?? "예약 가능 시간을 초과했습니다.");
  }
}

async function cancelExtensionReservation(
  slot: ReservationSlot,
  authContext: AuthContext
): Promise<ReservationActionResponse> {
  const room = requireRoom(slot.roomId);

  if (!slot.reservationId) {
    throw new Error("취소 요청에 필요한 예약 ID를 찾지 못했습니다.");
  }

  await postLibraryJson(
    "/work/cancelFacilityreservation",
    {
      RES_HOUR: slot.hour,
      RES_ID: slot.reservationId,
      RES_YYYYMMDD: slot.date,
      ROOM_ID: slot.roomId
    },
    authContext.accessToken
  );

  invalidateAvailability(slot.date, slot.roomId);
  const refreshed = await getRoomAvailability(slot.date, slot.roomId, authContext, {
    force: true
  });
  const refreshedSlot = requireSlot(refreshed, slot.hour);

  if (refreshedSlot.status === "own") {
    return {
      success: false,
      slot: refreshedSlot,
      message: `${room.roomNo}호 ${slot.hour}시 취소를 확인하지 못했습니다.`
    };
  }

  return {
    success: true,
    slot: refreshedSlot,
    message: `${room.roomNo}호 ${slot.hour}시 예약 취소가 확인되었습니다.`
  };
}

async function postLibraryJson<T>(
  path: string,
  payload: unknown,
  accessToken?: string
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
      },
      body: JSON.stringify(payload),
      credentials: "include",
      signal: controller.signal
    });
    const body = await readResponseBody(response);

    if (!response.ok) {
      throw new Error(
        getLibraryErrorMessage(body) ??
          `도서관 API 요청이 실패했습니다. (${response.status})`
      );
    }

    return body as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("도서관 API 응답 시간이 초과되었습니다.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function getMyReservations(
  authContext: AuthContext,
  startDate: string,
  endDate: string
): Promise<MyReservationsResponse> {
  const response = await postLibraryJson<LibraryGetMyReservationResponse>(
    "/work/getMyReservation",
    {
      END_DT: endDate,
      ROOM_ID: 108,
      START_DT: startDate
    },
    authContext.accessToken
  );

  return {
    reservations: normalizeMyReservations(response.data ?? []),
    fetchedAt: new Date().toISOString()
  };
}

function getAuthContext(): AuthContext {
  const tokenCandidate = findLibraryTokenCandidate();
  const userIdCandidate = findLibraryUserIdCandidate(tokenCandidate?.token);

  return tokenCandidate
    ? {
        authSource: "storage-token",
        accessToken: tokenCandidate.token,
        userId: userIdCandidate?.userId
      }
    : {
        authSource: "site-cookie",
        userId: userIdCandidate?.userId
      };
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

function getLibraryErrorMessage(body: unknown): string | null {
  if (
    body &&
    typeof body === "object" &&
    "message" in body &&
    typeof body.message === "string"
  ) {
    return body.message;
  }

  if (typeof body === "string" && body.trim()) {
    return body.slice(0, 160);
  }

  return null;
}

function normalizeMyReservations(items: LibraryMyReservationItem[]): MyReservation[] {
  return items
    .filter((item) => item.CANCEL_YN !== "Y")
    .map(normalizeMyReservation)
    .filter((reservation): reservation is MyReservation => Boolean(reservation))
    .sort((a, b) => {
      if (a.date !== b.date) {
        return a.date.localeCompare(b.date);
      }

      if (a.hour !== b.hour) {
        return compareOperatingHours(a.hour, b.hour);
      }

      return a.roomNo - b.roomNo;
    });
}

function normalizeMyReservation(item: LibraryMyReservationItem): MyReservation | null {
  const reservationId = item.RES_ID ?? item.id;

  if (
    typeof reservationId !== "number" ||
    typeof item.ROOM_ID !== "number" ||
    typeof item.RES_HOUR !== "number" ||
    typeof item.RES_YYYYMMDD !== "string"
  ) {
    return null;
  }

  const room = roomById.get(item.ROOM_ID);
  return {
    reservationId,
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

function requireRoom(roomId: number) {
  const room = roomById.get(roomId);

  if (!room) {
    throw new Error(`알 수 없는 호실입니다: ${roomId}`);
  }

  return room;
}

function requireSlot(availability: RoomAvailability, hour: number): ReservationSlot {
  const slot = availability.slots.find((item) => item.hour === hour);

  if (!slot) {
    throw new Error(`조회된 운영시간에 ${hour}시가 없습니다.`);
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

function findTokenCandidateInStorage(
  storage: Storage,
  source: TokenCandidate["source"]
): TokenCandidate | null {
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);

    if (!key) {
      continue;
    }

    const value = storage.getItem(key);
    const token = value ? extractAccessToken(value) : null;

    if (token) {
      return { source, key, token };
    }
  }

  return null;
}

function findUserIdCandidateInStorage(
  storage: Storage,
  source: UserIdCandidate["source"]
): UserIdCandidate | null {
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);

    if (!key) {
      continue;
    }

    const value = storage.getItem(key);
    const userId = value ? extractUserId(key, value) : null;

    if (userId) {
      return { source, key, userId };
    }
  }

  return null;
}

function extractAccessToken(value: string): string | null {
  const trimmed = value.trim();

  if (looksLikeJwt(trimmed)) {
    return trimmed;
  }

  const parsed = tryParseJson(trimmed);
  return parsed ? findTokenInValue(parsed) : null;
}

function extractUserId(key: string, value: string): string | null {
  const trimmed = value.trim();

  if (isUserIdKey(key) && isValidUserId(trimmed)) {
    return trimmed;
  }

  const parsed = tryParseJson(trimmed);
  return parsed ? findUserIdInValue(parsed) : null;
}

function findTokenInValue(value: unknown): string | null {
  if (typeof value === "string") {
    return looksLikeJwt(value) ? value : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const token = findTokenInValue(item);

      if (token) {
        return token;
      }
    }

    return null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (isTokenKey(key) && typeof nestedValue === "string" && looksLikeJwt(nestedValue)) {
      return nestedValue;
    }
  }

  for (const nestedValue of Object.values(value)) {
    const token = findTokenInValue(nestedValue);

    if (token) {
      return token;
    }
  }

  return null;
}

function findUserIdInValue(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const userId = findUserIdInValue(item);

      if (userId) {
        return userId;
      }
    }

    return null;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (isUserIdKey(key)) {
      const normalized = normalizeUserId(nestedValue);

      if (normalized) {
        return normalized;
      }
    }
  }

  for (const nestedValue of Object.values(value)) {
    const userId = findUserIdInValue(nestedValue);

    if (userId) {
      return userId;
    }
  }

  return null;
}

function isTokenKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.includes("accesstoken") || normalized.includes("access_token");
}

function isUserIdKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    normalized === "sub" ||
    normalized === "userid" ||
    normalized === "loginid" ||
    normalized === "memberid" ||
    normalized === "createid" ||
    normalized.endsWith("userid")
  );
}

function normalizeUserId(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const normalized = String(value).trim();
  return isValidUserId(normalized) ? normalized : null;
}

function isValidUserId(value: string): boolean {
  return /^[A-Za-z0-9._@-]{2,80}$/.test(value);
}

function looksLikeJwt(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

function decodeJwtPayload(token: string): unknown | null {
  const payload = token.split(".")[1];

  if (!payload) {
    return null;
  }

  try {
    const base64 = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return tryParseJson(globalThis.atob(padded));
  } catch {
    return null;
  }
}

function tryParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

interface LibraryGetMyReservationResponse {
  status: number;
  message: string;
  data?: LibraryMyReservationItem[];
}

interface LibraryMyReservationItem {
  CREATE_DT?: string;
  CANCEL_RESID?: number | null;
  RES_YYYYMMDD?: string;
  ROOM_ID?: number;
  ADMIN_YN?: string;
  USER_ID?: string;
  CANCEL_YN?: string;
  RES_ID?: number;
  id?: number;
  CREATE_ID?: string;
  REMARK?: string;
  RES_HOUR?: number;
}
