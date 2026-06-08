import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  clearExtensionAvailabilityCache,
  findLibraryTokenCandidate,
  findLibraryUserIdCandidate,
  getExtensionAvailability,
  getExtensionMyReservations,
  getReservationQuotaStatus,
  submitExtensionReservationAction
} from "./extensionApiClient";
import type { MyReservation } from "../../shared/types";

const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature";
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

beforeEach(() => {
  clearExtensionAvailabilityCache();
  installWindow(storageWith({}), storageWith({}));
});

afterEach(() => {
  clearExtensionAvailabilityCache();
  globalThis.fetch = originalFetch;

  if (originalWindow) {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
    return;
  }

  Reflect.deleteProperty(globalThis, "window");
});

describe("findLibraryTokenCandidate", () => {
  it("finds a plain JWT in local storage", () => {
    const candidate = findLibraryTokenCandidate(
      storageWith({ token: jwt }),
      storageWith({})
    );

    assert.equal(candidate?.source, "localStorage");
    assert.equal(candidate?.key, "token");
    assert.equal(candidate?.token, jwt);
  });

  it("finds nested accessToken values", () => {
    const candidate = findLibraryTokenCandidate(
      storageWith({ auth: JSON.stringify({ data: { accessToken: jwt } }) }),
      storageWith({})
    );

    assert.equal(candidate?.token, jwt);
  });

  it("falls back to session storage", () => {
    const candidate = findLibraryTokenCandidate(
      storageWith({}),
      storageWith({ library: JSON.stringify({ access_token: jwt }) })
    );

    assert.equal(candidate?.source, "sessionStorage");
    assert.equal(candidate?.token, jwt);
  });

  it("ignores non-token storage values", () => {
    const candidate = findLibraryTokenCandidate(
      storageWith({ notice: "hello" }),
      storageWith({ settings: JSON.stringify({ theme: "dark" }) })
    );

    assert.equal(candidate, null);
  });
});

describe("findLibraryUserIdCandidate", () => {
  it("finds a user id from JWT payload", () => {
    const candidate = findLibraryUserIdCandidate(
      jwt,
      storageWith({}),
      storageWith({})
    );

    assert.equal(candidate?.source, "accessToken");
    assert.equal(candidate?.userId, "test");
  });

  it("finds a user id from site storage", () => {
    const candidate = findLibraryUserIdCandidate(
      undefined,
      storageWith({ auth: JSON.stringify({ loginId: "sleep23" }) }),
      storageWith({})
    );

    assert.equal(candidate?.source, "localStorage");
    assert.equal(candidate?.userId, "sleep23");
  });
});

describe("getExtensionAvailability", () => {
  it("combines multiple getRoom responses into one availability response", async () => {
    const requests: Array<{ date: string; roomId: number }> = [];
    globalThis.fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as {
        RES_YYYYMMDD: string;
        ROOM_ID: number;
      };
      requests.push({ date: payload.RES_YYYYMMDD, roomId: payload.ROOM_ID });
      const isNextDayLookup = payload.RES_YYYYMMDD === "20260606";

      return jsonResponse({
        status: 200,
        message: "OK",
        data: {
          normalRoomGroupDates: [
            { FROM_TIME: 8, TO_TIME: 9, ROOM_ID: payload.ROOM_ID }
          ],
          room:
            !isNextDayLookup && payload.ROOM_ID === 220
              ? [{ RES_ID: 1, RES_HOUR: 8 }]
              : [],
          roomOther:
            !isNextDayLookup && payload.ROOM_ID === 221 ? [{ RES_HOUR: 9 }] : [],
          notAvailableRoomDates: [],
          canAvailableRoomDates:
            isNextDayLookup && payload.ROOM_ID === 220
              ? [
                  {
                    FROM_TIME: 0,
                    TO_TIME: 1,
                    RES_DT: "2026-06-05T15:00:00.000+00:00"
                  }
                ]
              : []
        }
      });
    };

    const result = await getExtensionAvailability("20260605", [220, 221]);

    assert.deepEqual(
      requests
        .map((request) => `${request.date}:${request.roomId}`)
        .sort(),
      ["20260605:220", "20260605:221", "20260606:220", "20260606:221"]
    );
    assert.equal(result.authSource, "site-cookie");
    assert.deepEqual(result.availability.hours, [8, 9, 0, 1]);
    assert.deepEqual(
      result.availability.rooms.map((room) => room.id),
      [220, 221]
    );
    assert.equal(
      result.availability.roomAvailability[0]?.slots.find((slot) => slot.hour === 8)
        ?.status,
      "own"
    );
    assert.equal(
      result.availability.roomAvailability[1]?.slots.find((slot) => slot.hour === 9)
        ?.status,
      "occupied"
    );
    assert.equal(
      result.availability.roomAvailability[0]?.slots.find((slot) => slot.hour === 0)
        ?.status,
      "available"
    );
    assert.equal(
      result.availability.roomAvailability[0]?.slots.find((slot) => slot.hour === 0)
        ?.date,
      "20260606"
    );
  });

  it("uses the panel-lifetime availability cache unless force is requested", async () => {
    let requestCount = 0;
    globalThis.fetch = async () => {
      requestCount += 1;
      return jsonResponse({
        status: 200,
        message: "OK",
        data: {
          normalRoomGroupDates: [{ FROM_TIME: 8, TO_TIME: 8, ROOM_ID: 220 }],
          room: [],
          roomOther: [],
          notAvailableRoomDates: []
        }
      });
    };

    await getExtensionAvailability("20260605", [220]);
    await getExtensionAvailability("20260605", [220]);
    await getExtensionAvailability("20260605", [220], { force: true });

    assert.equal(requestCount, 4);
  });

  it("sends a storage token as a bearer token", async () => {
    let authorizationHeader = "";
    installWindow(storageWith({ auth: JSON.stringify({ accessToken: jwt }) }), storageWith({}));
    globalThis.fetch = async (_input, init) => {
      authorizationHeader = String(
        (init?.headers as Record<string, string> | undefined)?.Authorization ?? ""
      );

      return jsonResponse({
        status: 200,
        message: "OK",
        data: {
          normalRoomGroupDates: [{ FROM_TIME: 8, TO_TIME: 8, ROOM_ID: 220 }],
          room: [],
          roomOther: [],
          notAvailableRoomDates: []
        }
      });
    };

    const result = await getExtensionAvailability("20260605", [220]);

    assert.equal(result.authSource, "storage-token");
    assert.equal(authorizationHeader, `Bearer ${jwt}`);
  });
});

describe("submitExtensionReservationAction", () => {
  it("rejects past slots before calling the library API", async () => {
    let mutationRequestCount = 0;
    globalThis.fetch = async (input) => {
      const path = String(input);

      if (path.endsWith("/work/getMyReservation")) {
        return jsonResponse({ status: 200, message: "OK", data: [] });
      }

      mutationRequestCount += 1;
      return jsonResponse({ status: 200, message: "OK" });
    };

    await assert.rejects(
      submitExtensionReservationAction("reserve", {
        roomId: 220,
        roomNo: 220,
        date: "20000101",
        hour: 8,
        status: "available"
      }),
      /지난 시간대/
    );
    assert.equal(mutationRequestCount, 0);
  });

  it("reserves a slot and verifies it with a fresh getRoom lookup", async () => {
    const calls: Array<{ path: string; payload: Record<string, unknown> }> = [];
    installWindow(storageWith({ token: jwt }), storageWith({}));
    globalThis.fetch = async (input, init) => {
      const path = String(input);
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ path, payload });

      if (path.endsWith("/work/getMyReservation")) {
        return jsonResponse({ status: 200, message: "OK", data: [] });
      }

      if (path.endsWith("/work/getRoom")) {
        return jsonResponse({
          status: 200,
          message: "OK",
          data: {
            normalRoomGroupDates: [{ FROM_TIME: 8, TO_TIME: 8, ROOM_ID: 220 }],
            room: [{ RES_ID: 9, RES_HOUR: 8 }],
            roomOther: [],
            notAvailableRoomDates: []
          }
        });
      }

      return jsonResponse({ status: 200, message: "OK" });
    };

    const result = await submitExtensionReservationAction("reserve", {
      roomId: 220,
      roomNo: 220,
      date: "29990101",
      hour: 8,
      status: "available"
    });

    assert.equal(result.response.success, true);
    assert.equal(result.response.slot.status, "own");
    assert.equal(calls[0]?.path.endsWith("/work/getMyReservation"), true);
    assert.equal(calls[1]?.path.endsWith("/work/makeFacilityreservation"), true);
    assert.equal(calls[1]?.payload.CREATE_ID, "test");
    assert.equal(calls[2]?.path.endsWith("/work/getRoom"), true);
  });

  it("reserves next-day midnight slots from the previous day's availability table", async () => {
    const calls: Array<{ path: string; payload: Record<string, unknown> }> = [];
    installWindow(storageWith({ token: jwt }), storageWith({}));
    globalThis.fetch = async (input, init) => {
      const path = String(input);
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ path, payload });

      if (path.endsWith("/work/getMyReservation")) {
        return jsonResponse({ status: 200, message: "OK", data: [] });
      }

      if (path.endsWith("/work/getRoom")) {
        return jsonResponse({
          status: 200,
          message: "OK",
          data: {
            normalRoomGroupDates: [{ FROM_TIME: 8, TO_TIME: 23, ROOM_ID: 228 }],
            room: [{ RES_ID: 9, RES_HOUR: 0 }],
            roomOther: [],
            notAvailableRoomDates: []
          }
        });
      }

      return jsonResponse({ status: 200, message: "OK" });
    };

    const result = await submitExtensionReservationAction("reserve", {
      roomId: 228,
      roomNo: 228,
      date: "29990102",
      displayDate: "29990101",
      hour: 0,
      status: "available"
    });

    assert.equal(result.response.success, true);
    assert.equal(result.response.slot.status, "own");
    assert.equal(calls[1]?.path.endsWith("/work/makeFacilityreservation"), true);
    assert.equal(calls[1]?.payload.RES_YYYYMMDD, "29990102");
    assert.equal(calls[1]?.payload.RES_HOUR, 0);
    assert.equal(calls[2]?.path.endsWith("/work/getRoom"), true);
    assert.equal(calls[2]?.payload.RES_YYYYMMDD, "29990102");
  });

  it("rejects reservations when the daily limit is already reached", async () => {
    let makeRequestCount = 0;
    installWindow(storageWith({ token: jwt }), storageWith({}));
    globalThis.fetch = async (input) => {
      const path = String(input);

      if (path.endsWith("/work/getMyReservation")) {
        return jsonResponse({
          status: 200,
          message: "OK",
          data: makeReservationItems("29990101", 4)
        });
      }

      if (path.endsWith("/work/makeFacilityreservation")) {
        makeRequestCount += 1;
      }

      return jsonResponse({ status: 200, message: "OK" });
    };

    await assert.rejects(
      submitExtensionReservationAction("reserve", {
        roomId: 220,
        roomNo: 220,
        date: "29990101",
        hour: 12,
        status: "available"
      }),
      /하루 최대 4시간/
    );
    assert.equal(makeRequestCount, 0);
  });

  it("prioritizes the quota message when a reserved date has already reached the daily limit", async () => {
    let makeRequestCount = 0;
    installWindow(storageWith({ token: jwt }), storageWith({}));
    globalThis.fetch = async (input) => {
      const path = String(input);

      if (path.endsWith("/work/getMyReservation")) {
        return jsonResponse({
          status: 200,
          message: "OK",
          data: makeReservationItems("20000101", 4)
        });
      }

      if (path.endsWith("/work/makeFacilityreservation")) {
        makeRequestCount += 1;
      }

      return jsonResponse({ status: 200, message: "OK" });
    };

    await assert.rejects(
      submitExtensionReservationAction("reserve", {
        roomId: 220,
        roomNo: 220,
        date: "20000101",
        hour: 8,
        status: "available"
      }),
      /하루 최대 4시간/
    );
    assert.equal(makeRequestCount, 0);
  });

  it("rejects reservations when the monthly limit is already reached", async () => {
    let makeRequestCount = 0;
    installWindow(storageWith({ token: jwt }), storageWith({}));
    globalThis.fetch = async (input) => {
      const path = String(input);

      if (path.endsWith("/work/getMyReservation")) {
        return jsonResponse({
          status: 200,
          message: "OK",
          data: Array.from({ length: 80 }, (_, index) => ({
            RES_ID: index + 1,
            RES_YYYYMMDD: `299901${String(Math.floor(index / 4) + 1).padStart(2, "0")}`,
            ROOM_ID: 220,
            RES_HOUR: 8 + (index % 4),
            CANCEL_YN: "N"
          }))
        });
      }

      if (path.endsWith("/work/makeFacilityreservation")) {
        makeRequestCount += 1;
      }

      return jsonResponse({ status: 200, message: "OK" });
    };

    await assert.rejects(
      submitExtensionReservationAction("reserve", {
        roomId: 220,
        roomNo: 220,
        date: "29990201",
        hour: 8,
        status: "available"
      }),
      /1달 최대 80시간/
    );
    assert.equal(makeRequestCount, 0);
  });

  it("cancels a slot and verifies it with a fresh getRoom lookup", async () => {
    const calls: Array<{ path: string; payload: Record<string, unknown> }> = [];
    globalThis.fetch = async (input, init) => {
      const path = String(input);
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ path, payload });

      if (path.endsWith("/work/getRoom")) {
        return jsonResponse({
          status: 200,
          message: "OK",
          data: {
            normalRoomGroupDates: [{ FROM_TIME: 8, TO_TIME: 8, ROOM_ID: 220 }],
            room: [],
            roomOther: [],
            notAvailableRoomDates: []
          }
        });
      }

      return jsonResponse({ status: 200, message: "OK" });
    };

    const result = await submitExtensionReservationAction("cancel", {
      roomId: 220,
      roomNo: 220,
      date: "29990101",
      hour: 8,
      status: "own",
      reservationId: 9
    });

    assert.equal(result.response.success, true);
    assert.equal(result.response.slot.status, "available");
    assert.equal(calls[0]?.path.endsWith("/work/cancelFacilityreservation"), true);
    assert.equal(calls[0]?.payload.RES_ID, 9);
    assert.equal(calls[1]?.path.endsWith("/work/getRoom"), true);
  });
});

describe("getReservationQuotaStatus", () => {
  it("reports daily and monthly availability", () => {
    const quota = getReservationQuotaStatus(
      makeReservationItems("29990101", 3).map(normalizeTestReservation),
      "29990101"
    );

    assert.equal(quota.canReserve, true);
    assert.equal(quota.dailyHours, 3);
    assert.equal(quota.dailyRemainingHours, 1);
    assert.equal(quota.monthlyHours, 3);
    assert.equal(quota.monthlyRemainingHours, 77);
  });

  it("blocks at four reservations on the selected date", () => {
    const quota = getReservationQuotaStatus(
      makeReservationItems("29990101", 4).map(normalizeTestReservation),
      "29990101"
    );

    assert.equal(quota.canReserve, false);
    assert.match(quota.reason ?? "", /하루 최대 4시간/);
  });
});

describe("getExtensionMyReservations", () => {
  it("normalizes active reservations and filters cancelled rows", async () => {
    let requestPayload: { START_DT?: string; END_DT?: string; ROOM_ID?: number } = {};
    globalThis.fetch = async (_input, init) => {
      requestPayload = JSON.parse(String(init?.body)) as typeof requestPayload;

      return jsonResponse({
        status: 200,
        message: "OK",
        data: [
          {
            RES_ID: 2,
            RES_YYYYMMDD: "20260606",
            ROOM_ID: 221,
            RES_HOUR: 9,
            CANCEL_YN: "N",
            CREATE_DT: "2026-06-05T08:00:00.000+00:00",
            REMARK: "study"
          },
          {
            RES_ID: 1,
            RES_YYYYMMDD: "20260605",
            ROOM_ID: 220,
            RES_HOUR: 8,
            CANCEL_YN: "N"
          },
          {
            RES_ID: 3,
            RES_YYYYMMDD: "20260605",
            ROOM_ID: 222,
            RES_HOUR: 10,
            CANCEL_YN: "Y"
          }
        ]
      });
    };

    const result = await getExtensionMyReservations("20260605", "20260704");

    assert.deepEqual(requestPayload, {
      START_DT: "20260605",
      END_DT: "20260704",
      ROOM_ID: 108
    });
    assert.equal(result.authSource, "site-cookie");
    assert.deepEqual(
      result.myReservations.reservations.map((reservation) => reservation.reservationId),
      [1, 2]
    );
    assert.equal(result.myReservations.reservations[0]?.roomNo, 220);
    assert.equal(result.myReservations.reservations[1]?.remark, "study");
  });
});

function storageWith(values: Record<string, string>): Storage {
  const entries = Object.entries(values);

  return {
    get length() {
      return entries.length;
    },
    key(index: number) {
      return entries[index]?.[0] ?? null;
    },
    getItem(key: string) {
      return values[key] ?? null;
    },
    clear() {
      entries.length = 0;
    },
    removeItem(key: string) {
      delete values[key];
    },
    setItem(key: string, value: string) {
      values[key] = value;
    }
  } as Storage;
}

function installWindow(localStorageRef: Storage, sessionStorageRef: Storage): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      localStorage: localStorageRef,
      sessionStorage: sessionStorageRef,
      setTimeout: globalThis.setTimeout.bind(globalThis)
    }
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200
  });
}

function makeReservationItems(date: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    RES_ID: index + 1,
    RES_YYYYMMDD: date,
    ROOM_ID: 220,
    RES_HOUR: 8 + index,
    CANCEL_YN: "N"
  }));
}

function normalizeTestReservation(item: ReturnType<typeof makeReservationItems>[number]): MyReservation {
  return {
    reservationId: item.RES_ID,
    roomId: item.ROOM_ID,
    roomNo: item.ROOM_ID,
    roomLabel: `Room ${item.ROOM_ID}`,
    floor: 2,
    group: "Small-sized Carrel",
    date: item.RES_YYYYMMDD,
    hour: item.RES_HOUR,
    remark: ""
  };
}
