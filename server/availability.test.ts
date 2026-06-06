import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRoomAvailability } from "../shared/availability";
import type { LibraryGetRoomResponse } from "../shared/availability";
import type { ReservableRoom } from "../shared/types";

const room: ReservableRoom = {
  id: 220,
  roomNo: 220,
  label: "2F Room 220",
  floor: 2,
  group: "Small-sized Carrel",
  capacity: 1
};

const manualRequestOnlyRoom: ReservableRoom = {
  id: 108,
  roomNo: 108,
  label: "1F Room 108",
  floor: 1,
  group: "Mini Theater",
  capacity: 50
};

describe("parseRoomAvailability", () => {
  it("maps own, occupied, and available slots from getRoom", () => {
    const response: LibraryGetRoomResponse = {
      status: 200,
      message: "OK",
      data: {
        normalRoomGroupDates: [{ FROM_TIME: 8, TO_TIME: 23, ROOM_ID: 220 }],
        room: [
          { RES_ID: 759794, RES_HOUR: 13 },
          { RES_ID: 759795, RES_HOUR: 14 }
        ],
        roomOther: [{ RES_HOUR: 20 }, { RES_HOUR: 21 }],
        notAvailableRoomDates: []
      }
    };

    const parsed = parseRoomAvailability({
      room,
      date: "20260609",
      response,
      fetchedAt: "2026-06-05T04:45:58.000Z",
      cached: false
    });

    assert.equal(parsed.slots.find((slot) => slot.hour === 13)?.status, "own");
    assert.equal(parsed.slots.find((slot) => slot.hour === 13)?.reservationId, 759794);
    assert.equal(parsed.slots.find((slot) => slot.hour === 20)?.status, "occupied");
    assert.equal(parsed.slots.find((slot) => slot.hour === 8)?.status, "available");
  });

  it("maps notAvailableRoomDates to unavailable slots", () => {
    const response: LibraryGetRoomResponse = {
      status: 200,
      message: "OK",
      data: {
        normalRoomGroupDates: [{ FROM_TIME: 8, TO_TIME: 10, ROOM_ID: 220 }],
        room: [],
        roomOther: [],
        notAvailableRoomDates: [{ RES_HOUR: 9 }]
      }
    };

    const parsed = parseRoomAvailability({
      room,
      date: "20260609",
      response,
      fetchedAt: "2026-06-05T04:45:58.000Z",
      cached: false
    });

    assert.equal(parsed.slots.find((slot) => slot.hour === 9)?.status, "unavailable");
  });

  it("marks manual-request-only rooms unavailable by default", () => {
    const response: LibraryGetRoomResponse = {
      status: 200,
      message: "OK",
      data: {
        normalRoomGroupDates: [{ FROM_TIME: 8, TO_TIME: 12, ROOM_ID: 108 }],
        room: [],
        roomOther: [{ RES_HOUR: 11 }, { RES_HOUR: 12 }],
        notAvailableRoomDates: [],
        canAvailableRoomDates: []
      }
    };

    const parsed = parseRoomAvailability({
      room: manualRequestOnlyRoom,
      date: "20260609",
      response,
      fetchedAt: "2026-06-05T04:45:58.000Z",
      cached: false
    });

    assert.equal(parsed.slots.find((slot) => slot.hour === 8)?.status, "unavailable");
    assert.equal(parsed.slots.find((slot) => slot.hour === 11)?.status, "occupied");
  });
});
