import { Search } from "lucide-react";
import type {
  AvailabilityResponse,
  ReservationSlot,
  ReservableRoom,
  SlotStatus
} from "../../shared/types";
import type { AvailabilityLoadingState } from "../lib/reservationUi";
import {
  floorLabels,
  formatDate,
  formatMonthDay,
  formatTime,
  formatWeekday,
  hourLabel,
  placeholderSlot,
  shortGroup,
  slotKey,
  statusLabels
} from "../lib/reservationUi";

interface AvailabilityViewProps {
  availability: AvailabilityResponse | null;
  availabilityLoading: AvailabilityLoadingState | null;
  dateOptions: string[];
  error: string;
  filteredRooms: ReservableRoom[];
  floor: string;
  floorOptions: string[];
  group: string;
  groupOptions: string[];
  loading: boolean;
  message: string;
  query: string;
  selectedDate: string;
  slotByRoomHour: Map<string, ReservationSlot>;
  onFloorChange: (floor: string) => void;
  onGroupChange: (group: string) => void;
  onQueryChange: (query: string) => void;
  onSelectedDateChange: (date: string) => void;
  onSlotClick: (slot: ReservationSlot) => void;
}

export function AvailabilityView({
  availability,
  availabilityLoading,
  dateOptions,
  error,
  filteredRooms,
  floor,
  floorOptions,
  group,
  groupOptions,
  loading,
  message,
  query,
  selectedDate,
  slotByRoomHour,
  onFloorChange,
  onGroupChange,
  onQueryChange,
  onSelectedDateChange,
  onSlotClick
}: AvailabilityViewProps) {
  return (
    <>
      <section className="control-band" aria-label="조회 조건">
        <label className="field">
          <span>날짜</span>
          <select
            value={selectedDate}
            onChange={(event) => onSelectedDateChange(event.target.value)}
          >
            {dateOptions.map((date) => (
              <option key={date} value={date}>
                {formatDate(date)}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>층</span>
          <select value={floor} onChange={(event) => onFloorChange(event.target.value)}>
            <option value="all">{floorLabels.all}</option>
            {floorOptions.map((item) => (
              <option key={item} value={item}>
                {item}F
              </option>
            ))}
          </select>
        </label>

        <label className="field wide">
          <span>그룹</span>
          <select value={group} onChange={(event) => onGroupChange(event.target.value)}>
            <option value="all">전체 그룹</option>
            {groupOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="search-field">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="호실 또는 그룹"
          />
        </label>
      </section>

      <section className="date-strip" aria-label="예약 가능 날짜">
        {dateOptions.map((date) => (
          <button
            className={date === selectedDate ? "date-chip selected" : "date-chip"}
            key={date}
            type="button"
            onClick={() => onSelectedDateChange(date)}
          >
            <span>{formatMonthDay(date)}</span>
            <strong>{formatWeekday(date)}</strong>
          </button>
        ))}
      </section>

      <section className="status-row" aria-live="polite">
        <div className="legend">
          {(Object.keys(statusLabels) as SlotStatus[]).map((status) => (
            <span className="legend-item" key={status}>
              <i className={`status-dot ${status}`} />
              {statusLabels[status]}
            </span>
          ))}
        </div>
        <div className="status-copy">
          {availabilityLoading
            ? `${formatDate(availabilityLoading.date)} 조회 중 · ${availabilityLoading.roomCount}개 호실`
            : `${filteredRooms.length}개 호실`}
          {availability && availability.date === selectedDate
            ? ` · ${formatTime(availability.fetchedAt)} 기준`
            : ""}
        </div>
      </section>

      {error ? <div className="alert error">{error}</div> : null}
      {message ? <div className="alert success">{message}</div> : null}

      <section className="matrix-region" aria-label="일별 예약 현황">
        <DailyMatrix
          availability={availability}
          loadingState={availabilityLoading}
          filteredRooms={filteredRooms}
          loading={loading}
          selectedDate={selectedDate}
          slotByRoomHour={slotByRoomHour}
          onSlotClick={onSlotClick}
        />
      </section>
    </>
  );
}

function DailyMatrix({
  availability,
  loadingState,
  filteredRooms,
  loading,
  selectedDate,
  slotByRoomHour,
  onSlotClick
}: {
  availability: AvailabilityResponse | null;
  loadingState: AvailabilityLoadingState | null;
  filteredRooms: ReservableRoom[];
  loading: boolean;
  selectedDate: string;
  slotByRoomHour: Map<string, ReservationSlot>;
  onSlotClick: (slot: ReservationSlot) => void;
}) {
  const activeAvailability = availability?.date === selectedDate ? availability : null;
  const loadingNewDate = Boolean(loadingState && !activeAvailability);
  const hours = activeAvailability?.hours.length
    ? activeAvailability.hours
    : Array.from({ length: 16 }, (_, index) => index + 8);
  const rooms = activeAvailability?.rooms.length ? activeAvailability.rooms : filteredRooms;
  const activeSlotByRoomHour = activeAvailability
    ? slotByRoomHour
    : new Map<string, ReservationSlot>();

  if (loadingNewDate && loadingState) {
    return (
      <div className="matrix-frame">
        <MatrixSkeleton roomCount={filteredRooms.length} />
        <MatrixLoadingOverlay loadingState={loadingState} />
      </div>
    );
  }

  if (!activeAvailability && !loading) {
    return <div className="empty-state">조회할 날짜를 선택하세요.</div>;
  }

  if (!loading && rooms.length === 0) {
    return <div className="empty-state">조건에 맞는 호실이 없습니다.</div>;
  }

  return (
    <div className="matrix-frame">
      <div className={loadingState ? "table-scroll loading-table" : "table-scroll"}>
        <table className="availability-table">
          <thead>
            <tr>
              <th className="time-header">시간</th>
              {rooms.map((room) => (
                <th key={room.id}>
                  <span className="room-no">{room.roomNo}</span>
                  <span className="room-group">{shortGroup(room)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hours.map((hour) => (
              <tr key={hour}>
                <th className="hour-cell">{hourLabel(hour)}</th>
                {rooms.map((room) => {
                  const slot =
                    activeSlotByRoomHour.get(slotKey(room.id, hour)) ??
                    placeholderSlot(room, selectedDate, hour);
                  const interactive = slot.status === "available" || slot.status === "own";

                  return (
                    <td key={`${room.id}-${hour}`}>
                      <button
                        className={`slot-button ${slot.status}`}
                        type="button"
                        disabled={!interactive || loading}
                        aria-label={`${formatDate(selectedDate)} ${room.roomNo}호 ${hour}시 ${statusLabels[slot.status]}`}
                        onClick={() => onSlotClick(slot)}
                      >
                        {slot.status === "available" ? "예약" : statusLabels[slot.status]}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loadingState ? <MatrixLoadingOverlay loadingState={loadingState} /> : null}
    </div>
  );
}

function MatrixSkeleton({ roomCount }: { roomCount: number }) {
  const columns = Math.max(3, Math.min(roomCount, 8));
  return (
    <div className="matrix-skeleton" aria-hidden="true">
      <div className="skeleton-header">
        {Array.from({ length: columns + 1 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
      {Array.from({ length: 7 }, (_, rowIndex) => (
        <div className="skeleton-row" key={rowIndex}>
          {Array.from({ length: columns + 1 }, (_, colIndex) => (
            <span key={colIndex} />
          ))}
        </div>
      ))}
    </div>
  );
}

function MatrixLoadingOverlay({
  loadingState
}: {
  loadingState: AvailabilityLoadingState;
}) {
  return (
    <div className="matrix-loading" role="status" aria-live="polite">
      <span className="loading-spinner" aria-hidden="true" />
      <strong>{formatDate(loadingState.date)} 조회 중</strong>
      <span>{loadingState.roomCount}개 호실을 불러오고 있습니다.</span>
    </div>
  );
}
