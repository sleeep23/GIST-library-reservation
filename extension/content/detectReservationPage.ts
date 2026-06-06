const reservationUrlHints = [
  "reservation",
  "facility",
  "room",
  "work",
  "study"
];

const reservationTextHints = [
  "시설예약",
  "시설 예약",
  "예약현황",
  "예약 현황",
  "예약 가능",
  "나의 예약",
  "내 예약",
  "Group Study",
  "Carrel"
];

export function shouldShowReservationAssistant(
  documentRef: Document = document,
  url: string = window.location.href
): boolean {
  if (!isLibraryPage(url)) {
    return false;
  }

  return hasReservationUrlHint(url) || hasReservationPageText(documentRef);
}

function isLibraryPage(url: string): boolean {
  try {
    return new URL(url).hostname === "library.gist.ac.kr";
  } catch {
    return false;
  }
}

function hasReservationUrlHint(url: string): boolean {
  const normalizedUrl = url.toLowerCase();
  return reservationUrlHints.some((hint) => normalizedUrl.includes(hint));
}

function hasReservationPageText(documentRef: Document): boolean {
  const bodyText = documentRef.body?.innerText ?? "";
  return reservationTextHints.some((hint) => bodyText.includes(hint));
}
