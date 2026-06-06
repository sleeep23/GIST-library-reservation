const ymdFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const kstDateHourFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23"
});

export function todayYmd(): string {
  return ymdFormatter.format(new Date()).replaceAll("-", "");
}

export function addDaysYmd(yyyymmdd: string, days: number): string {
  const date = parseYmd(yyyymmdd);
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtcYmd(date);
}

export function monthStartYmd(yyyymmdd: string): string {
  const year = Number(yyyymmdd.slice(0, 4));
  const monthIndex = Number(yyyymmdd.slice(4, 6)) - 1;
  return formatUtcYmd(new Date(Date.UTC(year, monthIndex, 1)));
}

export function nextMonthStartYmd(yyyymmdd: string): string {
  const year = Number(yyyymmdd.slice(0, 4));
  const monthIndex = Number(yyyymmdd.slice(4, 6)) - 1;
  return formatUtcYmd(new Date(Date.UTC(year, monthIndex + 1, 1)));
}

export function isYmd(value: string): boolean {
  return /^\d{8}$/.test(value);
}

export function isPastReservationHour(
  yyyymmdd: string,
  hour: number,
  now: Date = new Date()
): boolean {
  const current = getKstDateHour(now);

  if (yyyymmdd < current.ymd) {
    return true;
  }

  if (yyyymmdd > current.ymd) {
    return false;
  }

  return hour <= current.hour;
}

function getKstDateHour(date: Date): { ymd: string; hour: number } {
  const parts = Object.fromEntries(
    kstDateHourFormatter
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );

  return {
    ymd: `${parts.year}${parts.month}${parts.day}`,
    hour: Number(parts.hour)
  };
}

function parseYmd(yyyymmdd: string): Date {
  const year = Number(yyyymmdd.slice(0, 4));
  const monthIndex = Number(yyyymmdd.slice(4, 6)) - 1;
  const day = Number(yyyymmdd.slice(6, 8));
  return new Date(Date.UTC(year, monthIndex, day));
}

function formatUtcYmd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}${month}${day}`;
}
