const ymdFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
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
