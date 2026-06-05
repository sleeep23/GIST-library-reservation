import React from "react";
import ReactDOM from "react-dom/client";
import { CalendarDays, LogOut, RefreshCw, Search, X } from "lucide-react";
import type {
  AvailabilityResponse,
  MyReservation,
  MyReservationsResponse,
  ReservationActionResponse,
  ReservationSlot,
  ReservableRoom,
  SessionResponse,
  SlotStatus
} from "../shared/types";
import "./styles.css";

interface ConfirmationState {
  action: "reserve" | "cancel";
  slot: ReservationSlot;
}

interface ApiErrorShape {
  message?: string;
}

interface AvailabilityLoadingState {
  date: string;
  roomCount: number;
}

type ActiveView = "availability" | "my";
type MyReservationsView = "list" | "calendar";

const statusLabels: Record<SlotStatus, string> = {
  available: "예약 가능",
  own: "내 예약",
  occupied: "타인 예약",
  unavailable: "예약 불가"
};

const floorLabels: Record<string, string> = {
  all: "전체 층"
};

function App() {
  const [session, setSession] = React.useState<SessionResponse | null>(null);
  const [rooms, setRooms] = React.useState<ReservableRoom[]>([]);
  const [selectedDate, setSelectedDate] = React.useState("");
  const [activeView, setActiveView] = React.useState<ActiveView>("availability");
  const [myReservationsView, setMyReservationsView] =
    React.useState<MyReservationsView>("list");
  const [floor, setFloor] = React.useState("all");
  const [group, setGroup] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [availability, setAvailability] = React.useState<AvailabilityResponse | null>(null);
  const [myReservations, setMyReservations] =
    React.useState<MyReservationsResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [availabilityLoading, setAvailabilityLoading] =
    React.useState<AvailabilityLoadingState | null>(null);
  const [myReservationsLoading, setMyReservationsLoading] = React.useState(false);
  const [actionBusy, setActionBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [confirmation, setConfirmation] = React.useState<ConfirmationState | null>(null);
  const availabilityRequestId = React.useRef(0);
  const myReservationsRequestId = React.useRef(0);

  React.useEffect(() => {
    void loadInitialState();
  }, []);

  const filteredRooms = React.useMemo(() => {
    const normalizedQuery = query.trim();
    return rooms.filter((room) => {
      const matchesFloor = floor === "all" || String(room.floor) === floor;
      const matchesGroup = group === "all" || room.group === group;
      const matchesQuery =
        !normalizedQuery ||
        String(room.roomNo).includes(normalizedQuery) ||
        room.group.toLowerCase().includes(normalizedQuery.toLowerCase());

      return matchesFloor && matchesGroup && matchesQuery;
    });
  }, [floor, group, query, rooms]);

  const dateOptions = React.useMemo(() => {
    if (!session) {
      return [];
    }

    return eachDate(session.reservationWindow.start, session.reservationWindow.end);
  }, [session]);

  const floorOptions = React.useMemo(
    () => [...new Set(rooms.map((room) => String(room.floor)))].sort(),
    [rooms]
  );
  const groupOptions = React.useMemo(
    () => [...new Set(rooms.map((room) => room.group))].sort(),
    [rooms]
  );

  const slotByRoomHour = React.useMemo(() => {
    const map = new Map<string, ReservationSlot>();
    for (const roomAvailability of availability?.roomAvailability ?? []) {
      for (const slot of roomAvailability.slots) {
        map.set(slotKey(slot.roomId, slot.hour), slot);
      }
    }
    return map;
  }, [availability]);

  React.useEffect(() => {
    if (
      activeView !== "availability" ||
      !session?.authenticated ||
      !selectedDate ||
      filteredRooms.length === 0
    ) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadAvailability(selectedDate, filteredRooms.map((room) => room.id));
    }, 120);

    return () => window.clearTimeout(timeout);
  }, [activeView, filteredRooms, selectedDate, session?.authenticated]);

  React.useEffect(() => {
    if (activeView !== "my" || !session?.authenticated) {
      return;
    }

    void loadMyReservations();
  }, [activeView, session?.authenticated]);

  async function loadInitialState() {
    try {
      const currentSession = await fetchJson<SessionResponse>("/api/session");
      setSession(currentSession);
      setSelectedDate(currentSession.reservationWindow.start);

      if (currentSession.authenticated) {
        const roomResponse = await fetchJson<{ rooms: ReservableRoom[] }>("/api/rooms");
        setRooms(roomResponse.rooms);
      }
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleLogin(userId: string, userPwd: string) {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const [loginResponse, roomResponse] = await Promise.all([
        fetchJson<SessionResponse>("/api/login", {
          method: "POST",
          body: JSON.stringify({ userId, userPwd })
        }),
        fetchJson<{ rooms: ReservableRoom[] }>("/api/rooms")
      ]);

      setSession(loginResponse);
      setRooms(roomResponse.rooms);
      setSelectedDate(loginResponse.reservationWindow.start);
      setMessage("로그인되었습니다.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await fetchJson<SessionResponse>("/api/logout", { method: "POST" });
    setSession(await fetchJson<SessionResponse>("/api/session"));
    setRooms([]);
    setAvailability(null);
    setMyReservations(null);
    setActiveView("availability");
    setMessage("");
    setError("");
  }

  async function loadAvailability(date: string, roomIds: number[]) {
    const requestId = availabilityRequestId.current + 1;
    availabilityRequestId.current = requestId;
    setLoading(true);
    setAvailabilityLoading({ date, roomCount: roomIds.length });
    setError("");
    setAvailability((current) => (current?.date === date ? current : null));

    try {
      const params = new URLSearchParams({
        date,
        roomIds: roomIds.join(",")
      });
      const nextAvailability = await fetchJson<AvailabilityResponse>(
        `/api/availability?${params}`
      );

      if (requestId !== availabilityRequestId.current) {
        return;
      }

      setAvailability(nextAvailability);
    } catch (caught) {
      if (requestId !== availabilityRequestId.current) {
        return;
      }

      setError(getErrorMessage(caught));
      setAvailability(null);
    } finally {
      if (requestId === availabilityRequestId.current) {
        setLoading(false);
        setAvailabilityLoading(null);
      }
    }
  }

  async function loadMyReservations() {
    const requestId = myReservationsRequestId.current + 1;
    myReservationsRequestId.current = requestId;
    setMyReservationsLoading(true);
    setError("");

    try {
      const nextReservations = await fetchJson<MyReservationsResponse>(
        "/api/my-reservations"
      );

      if (requestId !== myReservationsRequestId.current) {
        return;
      }

      setMyReservations(nextReservations);
    } catch (caught) {
      if (requestId !== myReservationsRequestId.current) {
        return;
      }

      setError(getErrorMessage(caught));
      setMyReservations(null);
    } finally {
      if (requestId === myReservationsRequestId.current) {
        setMyReservationsLoading(false);
      }
    }
  }

  async function submitAction() {
    if (!confirmation) {
      return;
    }

    setActionBusy(true);
    setError("");
    setMessage("");

    const { action, slot } = confirmation;
    const endpoint = action === "reserve" ? "/api/reservations" : "/api/cancellations";
    const payload = {
      roomId: slot.roomId,
      date: slot.date,
      hour: slot.hour,
      ...(slot.reservationId ? { reservationId: slot.reservationId } : {})
    };

    try {
      const result = await fetchJson<ReservationActionResponse>(endpoint, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      setMessage(result.message);
      setConfirmation(null);

      if (activeView === "my") {
        await loadMyReservations();
      } else {
        await loadAvailability(selectedDate, filteredRooms.map((room) => room.id));
      }
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setActionBusy(false);
    }
  }

  function openSlot(slot: ReservationSlot) {
    if (slot.status === "available") {
      setConfirmation({ action: "reserve", slot });
      return;
    }

    if (slot.status === "own" && slot.reservationId) {
      setConfirmation({ action: "cancel", slot });
    }
  }

  if (!session?.authenticated) {
    return (
      <LoginScreen
        loading={loading}
        error={error}
        reservationWindow={session?.reservationWindow}
        onLogin={handleLogin}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>GIST Library 예약 도우미</h1>
          <p>{formatDateRange(session.reservationWindow.start, session.reservationWindow.end)}</p>
        </div>
        <div className="topbar-actions">
          <button
            className="icon-button"
            type="button"
            aria-label="새로고침"
            title="새로고침"
            onClick={() => {
              if (activeView === "my") {
                void loadMyReservations();
                return;
              }

              void loadAvailability(selectedDate, filteredRooms.map((room) => room.id));
            }}
          >
            <RefreshCw size={18} />
          </button>
          <span className="account-label">{session.userId}</span>
          <button className="secondary-button" type="button" onClick={handleLogout}>
            <LogOut size={16} />
            로그아웃
          </button>
        </div>
      </header>

      <nav className="view-tabs" aria-label="화면 선택">
        <button
          className={activeView === "availability" ? "view-tab selected" : "view-tab"}
          type="button"
          onClick={() => setActiveView("availability")}
        >
          예약 현황
        </button>
        <button
          className={activeView === "my" ? "view-tab selected" : "view-tab"}
          type="button"
          onClick={() => setActiveView("my")}
        >
          내 예약
        </button>
      </nav>

      {activeView === "availability" ? (
        <>
          <section className="control-band" aria-label="조회 조건">
        <label className="field">
          <span>날짜</span>
          <select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}>
            {dateOptions.map((date) => (
              <option key={date} value={date}>
                {formatDate(date)}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>층</span>
          <select value={floor} onChange={(event) => setFloor(event.target.value)}>
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
          <select value={group} onChange={(event) => setGroup(event.target.value)}>
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
            onChange={(event) => setQuery(event.target.value)}
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
            onClick={() => setSelectedDate(date)}
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
          onSlotClick={openSlot}
        />
      </section>
        </>
      ) : (
        <>
          <section className="status-row my-status" aria-live="polite">
            <div>
              <h2>내 예약</h2>
              <p>{formatDateRange(session.reservationWindow.start, session.reservationWindow.end)}</p>
            </div>
            <div className="status-copy">
              {myReservationsLoading
                ? "내 예약 조회 중"
                : `${myReservations?.reservations.length ?? 0}건`}
              {myReservations ? ` · ${formatTime(myReservations.fetchedAt)} 기준` : ""}
            </div>
          </section>

          {error ? <div className="alert error">{error}</div> : null}
          {message ? <div className="alert success">{message}</div> : null}

          <MyReservationsPanel
            reservations={myReservations?.reservations ?? []}
            view={myReservationsView}
            onViewChange={setMyReservationsView}
            dates={dateOptions}
            loading={myReservationsLoading}
            onCancel={(reservation) =>
              setConfirmation({
                action: "cancel",
                slot: myReservationToSlot(reservation)
              })
            }
          />
        </>
      )}

      {confirmation ? (
        <ConfirmDialog
          confirmation={confirmation}
          busy={actionBusy}
          onCancel={() => setConfirmation(null)}
          onConfirm={submitAction}
        />
      ) : null}
    </main>
  );
}

function LoginScreen({
  loading,
  error,
  reservationWindow,
  onLogin
}: {
  loading: boolean;
  error: string;
  reservationWindow?: SessionResponse["reservationWindow"];
  onLogin: (userId: string, userPwd: string) => Promise<void>;
}) {
  const [userId, setUserId] = React.useState("");
  const [userPwd, setUserPwd] = React.useState("");

  return (
    <main className="login-shell">
      <form
        className="login-panel"
        onSubmit={(event) => {
          event.preventDefault();
          void onLogin(userId, userPwd);
        }}
      >
        <div className="brand-row">
          <CalendarDays size={28} />
          <div>
            <h1>GIST Library 예약 도우미</h1>
            <p>{reservationWindow ? formatDateRange(reservationWindow.start, reservationWindow.end) : ""}</p>
          </div>
        </div>

        <label className="login-field">
          <span>아이디</span>
          <input
            autoComplete="username"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            required
          />
        </label>

        <label className="login-field">
          <span>비밀번호</span>
          <input
            autoComplete="current-password"
            type="password"
            value={userPwd}
            onChange={(event) => setUserPwd(event.target.value)}
            required
          />
        </label>

        {error ? <div className="alert error">{error}</div> : null}

        <button className="primary-button" type="submit" disabled={loading}>
          {loading ? "로그인 중" : "로그인"}
        </button>
      </form>
    </main>
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
    : Array.from({ length: 16 }, (_, i) => i + 8);
  const rooms = activeAvailability?.rooms.length ? activeAvailability.rooms : filteredRooms;
  const activeSlotByRoomHour = activeAvailability ? slotByRoomHour : new Map<string, ReservationSlot>();

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

function MyReservationsPanel({
  reservations,
  view,
  onViewChange,
  dates,
  loading,
  onCancel
}: {
  reservations: MyReservation[];
  view: MyReservationsView;
  onViewChange: (view: MyReservationsView) => void;
  dates: string[];
  loading: boolean;
  onCancel: (reservation: MyReservation) => void;
}) {
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

function ConfirmDialog({
  confirmation,
  busy,
  onCancel,
  onConfirm
}: {
  confirmation: ConfirmationState;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const roomNo = confirmation.slot.roomNo;
  const actionText = confirmation.action === "reserve" ? "예약" : "취소";

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <button className="modal-close" type="button" aria-label="닫기" onClick={onCancel}>
          <X size={18} />
        </button>
        <h2 id="confirm-title">{actionText} 확인</h2>
        <p>
          {formatDate(confirmation.slot.date)} {hourLabel(confirmation.slot.hour)}, {roomNo}호
        </p>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>
            닫기
          </button>
          <button className="primary-button" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? "처리 중" : actionText}
          </button>
        </div>
      </section>
    </div>
  );
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const body = (await response.json().catch(() => ({}))) as ApiErrorShape;

  if (!response.ok) {
    throw new Error(body.message ?? "요청이 실패했습니다.");
  }

  return body as T;
}

function eachDate(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = parseYmd(start);
  const last = parseYmd(end);

  while (cursor <= last) {
    dates.push(formatYmd(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function parseYmd(value: string): Date {
  return new Date(
    Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)))
  );
}

function formatYmd(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(
    date.getUTCDate()
  ).padStart(2, "0")}`;
}

function formatDate(value: string): string {
  return `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}`;
}

function formatMonthDay(value: string): string {
  return `${Number(value.slice(4, 6))}/${Number(value.slice(6, 8))}`;
}

function formatWeekday(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    weekday: "short",
    timeZone: "Asia/Seoul"
  }).format(parseYmd(value));
}

function formatDateRange(start: string, end: string): string {
  return `${formatDate(start)} - ${formatDate(end)}`;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function slotKey(roomId: number, hour: number): string {
  return `${roomId}:${hour}`;
}

function placeholderSlot(room: ReservableRoom, date: string, hour: number): ReservationSlot {
  return {
    roomId: room.id,
    roomNo: room.roomNo,
    date,
    hour,
    status: "unavailable"
  };
}

function myReservationToSlot(reservation: MyReservation): ReservationSlot {
  return {
    roomId: reservation.roomId,
    roomNo: reservation.roomNo,
    date: reservation.date,
    hour: reservation.hour,
    status: "own",
    reservationId: reservation.reservationId
  };
}

function shortGroup(room: ReservableRoom): string {
  if (room.group.includes("Carrel")) {
    return room.group.replace("-sized", "");
  }

  if (room.group.includes("Group Study")) {
    return room.capacity ? `${room.capacity}인` : "그룹";
  }

  return room.group;
}

function formatCreatedAt(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul"
  }).format(new Date(value));
}

function getErrorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : "요청 중 오류가 발생했습니다.";
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
