import React from "react";
import type { MyReservation } from "../../shared/types";
import type { MyReservationsView } from "../lib/reservationUi";
import {
  formatCreatedAt,
  formatDate,
  formatMonthDay,
  formatWeekday,
  hourLabel,
  parseYmd
} from "../lib/reservationUi";

interface MyReservationsPanelProps {
  reservations: MyReservation[];
  view: MyReservationsView;
  onViewChange: (view: MyReservationsView) => void;
  dates: string[];
  loading: boolean;
  onCancel: (reservation: MyReservation) => void;
}

export function MyReservationsPanel({
  reservations,
  view,
  onViewChange,
  dates,
  loading,
  onCancel
}: MyReservationsPanelProps) {
  if (loading && reservations.length === 0) {
    return (
      <section className="my-reservations-panel">
        <div className="list-loading" role="status" aria-live="polite">
          <span className="loading-spinner" aria-hidden="true" />
          <strong>내 예약을 불러오는 중</strong>
        </div>
      </section>
    );
  }

  const viewTabs = (
    <div className="sub-view-tabs" aria-label="내 예약 보기 선택">
      <button
        className={view === "list" ? "sub-view-tab selected" : "sub-view-tab"}
        type="button"
        onClick={() => onViewChange("list")}
      >
        목록
      </button>
      <button
        className={view === "calendar" ? "sub-view-tab selected" : "sub-view-tab"}
        type="button"
        onClick={() => onViewChange("calendar")}
      >
        달력
      </button>
    </div>
  );

  if (!loading && reservations.length === 0) {
    return (
      <section className="my-reservations-panel">
        {viewTabs}
        <div className="empty-state">예약된 시간이 없습니다.</div>
      </section>
    );
  }

  return (
    <section className="my-reservations-panel" aria-label="내 예약 목록">
      {viewTabs}
      {view === "calendar" ? (
        <MyReservationCalendar
          dates={dates}
          reservations={reservations}
          onCancel={onCancel}
        />
      ) : (
        <div className="reservation-list">
          {reservations.map((reservation) => (
            <article className="reservation-row" key={reservation.reservationId}>
              <div className="reservation-date">
                <strong>{formatMonthDay(reservation.date)}</strong>
                <span>{formatWeekday(reservation.date)}</span>
              </div>
              <div className="reservation-main">
                <h3>
                  {reservation.roomNo}호 · {hourLabel(reservation.hour)}
                </h3>
                <p>
                  {reservation.floor ? `${reservation.floor}F · ` : ""}
                  {reservation.group}
                </p>
              </div>
              <div className="reservation-meta">
                <span>{formatDate(reservation.date)}</span>
                {reservation.createdAt ? (
                  <span>{formatCreatedAt(reservation.createdAt)} 예약</span>
                ) : null}
              </div>
              <button
                className="secondary-button danger-button"
                type="button"
                onClick={() => onCancel(reservation)}
              >
                취소
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function MyReservationCalendar({
  dates,
  reservations,
  onCancel
}: {
  dates: string[];
  reservations: MyReservation[];
  onCancel: (reservation: MyReservation) => void;
}) {
  const reservationsByDate = React.useMemo(() => {
    const map = new Map<string, MyReservation[]>();
    for (const reservation of reservations) {
      const items = map.get(reservation.date) ?? [];
      items.push(reservation);
      map.set(reservation.date, items);
    }

    for (const items of map.values()) {
      items.sort((a, b) => a.hour - b.hour || a.roomNo - b.roomNo);
    }

    return map;
  }, [reservations]);
  const leadingDays = dates[0] ? parseYmd(dates[0]).getUTCDay() : 0;

  return (
    <div className="my-calendar">
      <div className="my-calendar-weekdays" aria-hidden="true">
        {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="my-calendar-grid">
        {Array.from({ length: leadingDays }, (_, index) => (
          <div className="my-calendar-cell empty" key={`empty-${index}`} />
        ))}
        {dates.map((date) => {
          const dailyReservations = reservationsByDate.get(date) ?? [];
          return (
            <article
              className={
                dailyReservations.length > 0
                  ? "my-calendar-cell has-reservation"
                  : "my-calendar-cell"
              }
              key={date}
            >
              <div className="calendar-day-heading">
                <strong>{Number(date.slice(6, 8))}</strong>
                <span>{formatWeekday(date)}</span>
              </div>
              <div className="calendar-events">
                {dailyReservations.map((reservation) => (
                  <button
                    className="calendar-event"
                    key={reservation.reservationId}
                    type="button"
                    onClick={() => onCancel(reservation)}
                    title={`${formatDate(reservation.date)} ${hourLabel(reservation.hour)} ${reservation.roomNo}호 취소`}
                  >
                    <strong>{hourLabel(reservation.hour)}</strong>
                    <span>{reservation.roomNo}호</span>
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
