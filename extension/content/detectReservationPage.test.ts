import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldShowReservationAssistant } from "./detectReservationPage";

describe("shouldShowReservationAssistant", () => {
  it("rejects non-library pages", () => {
    assert.equal(
      shouldShowReservationAssistant(
        documentWithText("시설 예약"),
        "https://example.com/reservation"
      ),
      false
    );
  });

  it("accepts library reservation URL hints", () => {
    assert.equal(
      shouldShowReservationAssistant(
        documentWithText(""),
        "https://library.gist.ac.kr/facility/reservation"
      ),
      true
    );
  });

  it("accepts the official hash-route reservation URL", () => {
    assert.equal(
      shouldShowReservationAssistant(
        documentWithText(""),
        "https://library.gist.ac.kr/#/facilityReservation"
      ),
      true
    );
  });

  it("accepts library reservation page text hints", () => {
    assert.equal(
      shouldShowReservationAssistant(
        documentWithText("오늘의 시설 예약 현황"),
        "https://library.gist.ac.kr/"
      ),
      true
    );
  });

  it("rejects library pages without reservation hints", () => {
    assert.equal(
      shouldShowReservationAssistant(
        documentWithText("도서관 공지사항"),
        "https://library.gist.ac.kr/"
      ),
      false
    );
  });
});

function documentWithText(innerText: string): Document {
  return {
    body: {
      innerText
    }
  } as unknown as Document;
}
