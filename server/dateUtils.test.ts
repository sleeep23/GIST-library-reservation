import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPastReservationHour } from "../shared/dateUtils";

describe("isPastReservationHour", () => {
  const now = new Date("2026-06-05T09:30:00.000Z"); // 2026-06-05 18:30 KST

  it("marks past dates as past", () => {
    assert.equal(isPastReservationHour("20260604", 23, now), true);
  });

  it("marks the current and earlier hours today as past", () => {
    assert.equal(isPastReservationHour("20260605", 17, now), true);
    assert.equal(isPastReservationHour("20260605", 18, now), true);
  });

  it("keeps later hours today and future dates interactive", () => {
    assert.equal(isPastReservationHour("20260605", 19, now), false);
    assert.equal(isPastReservationHour("20260606", 8, now), false);
  });
});
