import React from "react";
import { LogOut, RefreshCw } from "lucide-react";
import type {
  AvailabilityResponse,
  MyReservationsResponse,
  ReservationSlot,
  ReservableRoom,
  SessionResponse
} from "../../shared/types";
import { AvailabilityView } from "../components/AvailabilityView";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LoginScreen } from "../components/LoginScreen";
import { MyReservationsPanel } from "../components/MyReservationsPanel";
import {
  type ActiveView,
  type AvailabilityLoadingState,
  type ConfirmationState,
  type MyReservationsView,
  eachDate,
  formatDateRange,
  formatTime,
  getErrorMessage,
  myReservationToSlot,
  slotKey
} from "../lib/reservationUi";
import { localApiClient, type ReservationApiClient } from "./apiClient";

interface LocalAppProps {
  apiClient?: ReservationApiClient;
}

export function LocalApp({ apiClient = localApiClient }: LocalAppProps) {
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
      const currentSession = await apiClient.getSession();
      setSession(currentSession);
      setSelectedDate(currentSession.reservationWindow.start);

      if (currentSession.authenticated) {
        setRooms(await apiClient.getRooms());
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
        apiClient.login(userId, userPwd),
        apiClient.getRooms()
      ]);

      setSession(loginResponse);
      setRooms(roomResponse);
      setSelectedDate(loginResponse.reservationWindow.start);
      setMessage("로그인되었습니다.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setSession(await apiClient.logout());
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
      const nextAvailability = await apiClient.getAvailability(date, roomIds);

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
      const nextReservations = await apiClient.getMyReservations();

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

    try {
      const result = await apiClient.submitReservationAction(action, slot);
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
        <AvailabilityView
          availability={availability}
          availabilityLoading={availabilityLoading}
          dateOptions={dateOptions}
          error={error}
          filteredRooms={filteredRooms}
          floor={floor}
          floorOptions={floorOptions}
          group={group}
          groupOptions={groupOptions}
          loading={loading}
          message={message}
          query={query}
          selectedDate={selectedDate}
          slotByRoomHour={slotByRoomHour}
          onFloorChange={setFloor}
          onGroupChange={setGroup}
          onQueryChange={setQuery}
          onSelectedDateChange={setSelectedDate}
          onSlotClick={openSlot}
        />
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
