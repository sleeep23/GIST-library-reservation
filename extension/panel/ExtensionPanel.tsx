import {
  CalendarDays,
  CalendarCheck,
  ChevronDown,
  ChevronUp,
  List,
  RefreshCw,
  Search,
  Trash2,
  X
} from "lucide-react";
import React from "react";
import {
  areConsecutiveOperatingHours,
  compareOperatingHours,
  DEFAULT_AVAILABILITY_HOURS,
  getOperatingHourSortValue,
  normalizeDisplayHour
} from "../../shared/availability";
import { addDaysYmd, isPastReservationHour, todayYmd } from "../../shared/dateUtils";
import { reservableRooms } from "../../shared/rooms";
import type {
  AvailabilityResponse,
  MyReservation,
  ReservationSlot,
  ReservableRoom,
  SlotStatus
} from "../../shared/types";
import {
  type AuthSource,
  type ExtensionAvailabilityResult,
  type ExtensionMyReservationsResult,
  type ExtensionReservationAction,
  type ReservationQuotaStatus,
  DAILY_RESERVATION_LIMIT_HOURS,
  MONTHLY_RESERVATION_LIMIT_HOURS,
  getExtensionAvailability,
  getExtensionMyReservations,
  getReservationQuotaStatus,
  submitExtensionReservationAction
} from "./extensionApiClient";

interface ExtensionPanelProps {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

type ActiveView = "availability" | "my";
type MyReservationsDisplayMode = "list" | "calendar";

interface HoveredMatrixAxis {
  roomId: number | null;
  hour: number | null;
}

interface MatrixDragSelection {
  roomId: number;
  anchorHour: number;
  currentHour: number;
}

type AvailabilityState =
  | { status: "idle" }
  | { status: "loading"; date: string; roomCount: number }
  | { status: "success"; result: ExtensionAvailabilityResult }
  | { status: "error"; message: string };

type MyReservationsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; result: ExtensionMyReservationsResult }
  | { status: "error"; message: string };

interface ConfirmationState {
  action: ExtensionReservationAction;
  slots: ReservationSlot[];
}

type ActionNotice =
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

type ReservationActionResult = Awaited<
  ReturnType<typeof submitExtensionReservationAction>
>;

interface CalendarReservationGroup {
  key: string;
  date: string;
  roomId: number;
  roomNo: number;
  startHour: number;
  endHour: number;
  reservations: MyReservation[];
}

type CalendarReservationGroupDraft = Omit<CalendarReservationGroup, "key">;

const INITIAL_QUERY = "";

const statusLabels: Record<SlotStatus, string> = {
  available: "예약 가능",
  own: "내 예약",
  occupied: "타인 예약",
  unavailable: "예약 불가"
};

const compactStatusLabels: Record<SlotStatus, string> = {
  available: "가능",
  own: "내",
  occupied: "타인",
  unavailable: "불가"
};

export function ExtensionPanel({
  expanded,
  onExpandedChange
}: ExtensionPanelProps) {
  const [activeView, setActiveView] = React.useState<ActiveView>("availability");
  const [selectedDate, setSelectedDate] = React.useState(() => todayYmd());
  const [floor, setFloor] = React.useState("all");
  const [group, setGroup] = React.useState("all");
  const [query, setQuery] = React.useState(INITIAL_QUERY);
  const [availabilityState, setAvailabilityState] = React.useState<AvailabilityState>({
    status: "idle"
  });
  const [myReservationsState, setMyReservationsState] =
    React.useState<MyReservationsState>({ status: "idle" });
  const [myReservationsMode, setMyReservationsMode] =
    React.useState<MyReservationsDisplayMode>("list");
  const [confirmation, setConfirmation] = React.useState<ConfirmationState | null>(null);
  const [actionBusy, setActionBusy] = React.useState(false);
  const [actionNotice, setActionNotice] = React.useState<ActionNotice | null>(null);
  const availabilityRequestId = React.useRef(0);
  const lastAvailabilityRef = React.useRef<AvailabilityResponse | null>(null);
  const lastMyReservationsRef = React.useRef<ExtensionMyReservationsResult | null>(null);
  const myReservationsRequestId = React.useRef(0);

  const dateOptions = React.useMemo(() => {
    const start = todayYmd();
    return Array.from({ length: 30 }, (_, index) => addDaysYmd(start, index));
  }, []);

  const floorOptions = React.useMemo(
    () => [...new Set(reservableRooms.map((room) => String(room.floor)))].sort(),
    []
  );
  const groupOptions = React.useMemo(
    () => [...new Set(reservableRooms.map((room) => room.group))].sort(),
    []
  );

  const filteredRooms = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return reservableRooms.filter((room) => {
      const matchesFloor = floor === "all" || String(room.floor) === floor;
      const matchesGroup = group === "all" || room.group === group;
      const matchesQuery =
        !normalizedQuery ||
        String(room.roomNo).includes(normalizedQuery) ||
        room.group.toLowerCase().includes(normalizedQuery);

      return matchesFloor && matchesGroup && matchesQuery;
    });
  }, [floor, group, query]);

  const filteredRoomIdsKey = React.useMemo(
    () => filteredRooms.map((room) => room.id).join(","),
    [filteredRooms]
  );

  const currentAvailability =
    availabilityState.status === "success" &&
    availabilityState.result.availability.date === selectedDate
      ? availabilityState.result.availability
      : null;

  React.useEffect(() => {
    if (currentAvailability) {
      lastAvailabilityRef.current = currentAvailability;
    }
  }, [currentAvailability]);

  const displayedAvailability = React.useMemo(() => {
    if (currentAvailability) {
      return currentAvailability;
    }

    if (availabilityState.status !== "loading") {
      return null;
    }

    const lastAvailability = lastAvailabilityRef.current;

    if (
      lastAvailability &&
      lastAvailability.date === selectedDate &&
      getRoomIdsKey(lastAvailability.rooms) === filteredRoomIdsKey
    ) {
      return lastAvailability;
    }

    return null;
  }, [availabilityState.status, currentAvailability, filteredRoomIdsKey, selectedDate]);

  React.useEffect(() => {
    if (myReservationsState.status === "success") {
      lastMyReservationsRef.current = myReservationsState.result;
    }
  }, [myReservationsState]);

  const displayedMyReservationsState = React.useMemo<MyReservationsState>(() => {
    if (myReservationsState.status === "loading" && lastMyReservationsRef.current) {
      return { status: "success", result: lastMyReservationsRef.current };
    }

    return myReservationsState;
  }, [myReservationsState]);

  const slotByRoomHour = React.useMemo(() => {
    const map = new Map<string, ReservationSlot>();

    for (const roomAvailability of displayedAvailability?.roomAvailability ?? []) {
      for (const slot of roomAvailability.slots) {
        map.set(slotKey(slot.roomId, slot.hour), slot);
      }
    }

    return map;
  }, [displayedAvailability]);

  const quotaStatus = React.useMemo(() => {
    if (displayedMyReservationsState.status !== "success") {
      return null;
    }

    return getReservationQuotaStatus(
      displayedMyReservationsState.result.myReservations.reservations,
      selectedDate
    );
  }, [displayedMyReservationsState, selectedDate]);

  const loadAvailability = React.useCallback(
    async (options: { force?: boolean } = {}) => {
      if (filteredRooms.length === 0) {
        setAvailabilityState({ status: "idle" });
        return;
      }

      const requestId = availabilityRequestId.current + 1;
      availabilityRequestId.current = requestId;
      setAvailabilityState({
        status: "loading",
        date: selectedDate,
        roomCount: filteredRooms.length
      });

      try {
        const result = await getExtensionAvailability(
          selectedDate,
          filteredRooms.map((room) => room.id),
          { force: options.force }
        );

        if (requestId !== availabilityRequestId.current) {
          return;
        }

        setAvailabilityState({ status: "success", result });
      } catch (caught) {
        if (requestId !== availabilityRequestId.current) {
          return;
        }

        setAvailabilityState({
          status: "error",
          message: getErrorMessage(caught)
        });
      }
    },
    [filteredRooms, selectedDate]
  );

  const loadMyReservations = React.useCallback(async () => {
    const requestId = myReservationsRequestId.current + 1;
    myReservationsRequestId.current = requestId;
    setMyReservationsState({ status: "loading" });

    try {
      const startDate = dateOptions[0] ?? todayYmd();
      const endDate = dateOptions[dateOptions.length - 1] ?? addDaysYmd(startDate, 29);
      const result = await getExtensionMyReservations(startDate, endDate);

      if (requestId !== myReservationsRequestId.current) {
        return;
      }

      setMyReservationsState({ status: "success", result });
    } catch (caught) {
      if (requestId !== myReservationsRequestId.current) {
        return;
      }

      setMyReservationsState({
        status: "error",
        message: getErrorMessage(caught)
      });
    }
  }, [dateOptions]);

  React.useEffect(() => {
    if (!expanded || activeView !== "availability") {
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadAvailability();
    }, 140);

    return () => window.clearTimeout(timeout);
  }, [activeView, expanded, filteredRoomIdsKey, loadAvailability, selectedDate]);

  React.useEffect(() => {
    if (!expanded || activeView !== "my") {
      return;
    }

    void loadMyReservations();
  }, [activeView, expanded, loadMyReservations]);

  React.useEffect(() => {
    if (!expanded || myReservationsState.status !== "idle") {
      return;
    }

    void loadMyReservations();
  }, [expanded, loadMyReservations, myReservationsState.status]);

  React.useEffect(() => {
    if (!actionNotice) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setActionNotice(null);
    }, 5000);

    return () => window.clearTimeout(timeout);
  }, [actionNotice]);

  const openReserveSlots = React.useCallback((slots: ReservationSlot[]) => {
    const sortedSlots = [...slots].sort(compareSlots);
    const selectionError = getReserveSelectionError(sortedSlots);

    if (selectionError) {
      setActionNotice({
        kind: "error",
        message: selectionError
      });
      return;
    }

    const targetDate = sortedSlots[0]?.date;

    if (targetDate) {
      const quotaStatus =
        myReservationsState.status === "success"
          ? getReservationQuotaStatus(
              myReservationsState.result.myReservations.reservations,
              targetDate
            )
          : null;

      if (
        quotaStatus &&
        quotaStatus.dailyHours + sortedSlots.length > DAILY_RESERVATION_LIMIT_HOURS
      ) {
        setActionNotice({
          kind: "error",
          message: `하루 최대 ${DAILY_RESERVATION_LIMIT_HOURS}시간까지만 예약할 수 있습니다.`
        });
        return;
      }

      if (
        quotaStatus &&
        quotaStatus.monthlyHours + sortedSlots.length > MONTHLY_RESERVATION_LIMIT_HOURS
      ) {
        setActionNotice({
          kind: "error",
          message: `1달 최대 ${MONTHLY_RESERVATION_LIMIT_HOURS}시간까지만 예약할 수 있습니다.`
        });
        return;
      }
    }

    if (sortedSlots.some((slot) => isPastReservationHour(slot.date, slot.hour))) {
      setActionNotice({
        kind: "error",
        message: "지난 시간대는 예약하거나 취소할 수 없습니다."
      });
      return;
    }

    setActionNotice(null);
    setConfirmation({ action: "reserve", slots: sortedSlots });
  }, [myReservationsState]);

  const openSlotAction = React.useCallback((slot: ReservationSlot) => {
    if (slot.status === "available") {
      openReserveSlots([slot]);
      return;
    }

    if (slot.status === "own" && slot.reservationId) {
      if (isPastReservationHour(slot.date, slot.hour)) {
        setActionNotice({
          kind: "error",
          message: "지난 시간대는 예약하거나 취소할 수 없습니다."
        });
        return;
      }

      setActionNotice(null);
      setConfirmation({ action: "cancel", slots: [slot] });
    }
  }, [openReserveSlots]);

  const openReservationsCancel = React.useCallback((reservations: MyReservation[]) => {
    const firstReservation = reservations[0];

    if (!firstReservation) {
      return;
    }

    if (
      reservations.some((reservation) =>
        isPastReservationHour(reservation.date, reservation.hour)
      )
    ) {
      setActionNotice({
        kind: "error",
        message: "지난 시간대는 예약하거나 취소할 수 없습니다."
      });
      return;
    }

    setActionNotice(null);
    setConfirmation({
      action: "cancel",
      slots: reservations.map(myReservationToSlot).sort(compareSlots)
    });
  }, []);
  const openReservationCancel = React.useCallback(
    (reservation: MyReservation) => {
      openReservationsCancel([reservation]);
    },
    [openReservationsCancel]
  );

  const submitAction = React.useCallback(async () => {
    if (!confirmation) {
      return;
    }

    setActionBusy(true);
    setActionNotice(null);

    try {
      const results = [];

      for (const slot of confirmation.slots) {
        results.push(await submitExtensionReservationAction(confirmation.action, slot));
      }

      setActionNotice(getActionResultNotice(confirmation, results));
      setConfirmation(null);

      if (activeView === "my") {
        await loadMyReservations();
        return;
      }

      await Promise.all([loadAvailability({ force: true }), loadMyReservations()]);
    } catch (caught) {
      setActionNotice({
        kind: "error",
        message: getErrorMessage(caught)
      });

      if (confirmation.slots.length > 1) {
        setConfirmation(null);

        if (activeView === "my") {
          await loadMyReservations();
        } else {
          await Promise.all([loadAvailability({ force: true }), loadMyReservations()]);
        }
      }
    } finally {
      setActionBusy(false);
    }
  }, [activeView, confirmation, loadAvailability, loadMyReservations]);

  if (!expanded) {
    return (
      <button
        className="glra-launcher"
        type="button"
        aria-expanded="false"
        onClick={() => onExpandedChange(true)}
      >
        <span className="glra-launcher-orb" aria-hidden="true">
          <CalendarCheck size={18} />
        </span>
        <span className="glra-launcher-copy">예약 도우미</span>
        <ChevronUp className="glra-launcher-chevron" size={17} aria-hidden="true" />
      </button>
    );
  }

  const authSource =
    availabilityState.status === "success"
      ? availabilityState.result.authSource
      : displayedMyReservationsState.status === "success"
        ? displayedMyReservationsState.result.authSource
        : null;

  return (
    <section className="glra-panel" aria-label="GIST Library 예약 도우미">
      <header className="glra-panel-header">
        <div>
          <h2>예약 도우미</h2>
          <span className="glra-status">{getPanelStatus(authSource)}</span>
        </div>
        <div className="glra-panel-actions">
          <button
            className="glra-icon-button"
            type="button"
            aria-label="새로고침"
            title="새로고침"
            onClick={() => {
              if (activeView === "my") {
                void loadMyReservations();
                return;
              }

              void loadAvailability({ force: true });
            }}
          >
            <RefreshCw size={18} />
          </button>
          <button
            className="glra-icon-button"
            type="button"
            aria-label="접기"
            title="접기"
            onClick={() => onExpandedChange(false)}
          >
            <ChevronDown size={18} />
          </button>
          <button
            className="glra-icon-button"
            type="button"
            aria-label="닫기"
            title="닫기"
            onClick={() => onExpandedChange(false)}
          >
            <X size={18} />
          </button>
        </div>
      </header>
      <div className="glra-panel-body">
        <div className="glra-workspace-bar">
          <nav className="glra-tabs" aria-label="예약 도우미 화면">
            <button
              className={
                activeView === "availability" ? "glra-tab glra-tab-selected" : "glra-tab"
              }
              type="button"
              onClick={() => setActiveView("availability")}
            >
              예약 현황
            </button>
            <button
              className={activeView === "my" ? "glra-tab glra-tab-selected" : "glra-tab"}
              type="button"
              onClick={() => setActiveView("my")}
            >
              내 예약
            </button>
          </nav>
          {activeView === "availability" ? (
            <QuotaSummary quotaStatus={quotaStatus} />
          ) : null}
        </div>

        {activeView === "availability" ? (
          <AvailabilityPanel
            availability={displayedAvailability}
            dateOptions={dateOptions}
            filteredRooms={filteredRooms}
            floor={floor}
            floorOptions={floorOptions}
            group={group}
            groupOptions={groupOptions}
            query={query}
            selectedDate={selectedDate}
            slotByRoomHour={slotByRoomHour}
            state={availabilityState}
            onFloorChange={setFloor}
            onGroupChange={setGroup}
            onQueryChange={setQuery}
            onSelectedDateChange={setSelectedDate}
            onRetry={() => void loadAvailability({ force: true })}
            onSlotClick={openSlotAction}
            onSlotsReserve={openReserveSlots}
          />
        ) : (
          <MyReservationsPanel
            dateOptions={dateOptions}
            loading={myReservationsState.status === "loading"}
            mode={myReservationsMode}
            state={displayedMyReservationsState}
            onCancel={openReservationCancel}
            onModeChange={setMyReservationsMode}
            onRetry={() => void loadMyReservations()}
          />
        )}
      </div>

      {actionNotice ? (
        <ActionToast notice={actionNotice} onDismiss={() => setActionNotice(null)} />
      ) : null}

      {confirmation ? (
        <ConfirmationDialog
          busy={actionBusy}
          confirmation={confirmation}
          onCancel={() => {
            if (!actionBusy) {
              setConfirmation(null);
            }
          }}
          onConfirm={() => void submitAction()}
        />
      ) : null}
    </section>
  );
}

function AvailabilityPanel({
  availability,
  dateOptions,
  filteredRooms,
  floor,
  floorOptions,
  group,
  groupOptions,
  query,
  selectedDate,
  slotByRoomHour,
  state,
  onFloorChange,
  onGroupChange,
  onQueryChange,
  onSelectedDateChange,
  onRetry,
  onSlotClick,
  onSlotsReserve
}: {
  availability: AvailabilityResponse | null;
  dateOptions: string[];
  filteredRooms: ReservableRoom[];
  floor: string;
  floorOptions: string[];
  group: string;
  groupOptions: string[];
  query: string;
  selectedDate: string;
  slotByRoomHour: Map<string, ReservationSlot>;
  state: AvailabilityState;
  onFloorChange: (floor: string) => void;
  onGroupChange: (group: string) => void;
  onQueryChange: (query: string) => void;
  onSelectedDateChange: (date: string) => void;
  onRetry: () => void;
  onSlotClick: (slot: ReservationSlot) => void;
  onSlotsReserve: (slots: ReservationSlot[]) => void;
}) {
  const counts = availability ? countSlotsByStatus(availability) : null;

  return (
    <section className="glra-availability" aria-label="예약 현황">
      <div className="glra-controls" aria-label="조회 조건">
        <label className="glra-field">
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

        <label className="glra-field">
          <span>층</span>
          <select value={floor} onChange={(event) => onFloorChange(event.target.value)}>
            <option value="all">전체 층</option>
            {floorOptions.map((item) => (
              <option key={item} value={item}>
                {item}F
              </option>
            ))}
          </select>
        </label>

        <label className="glra-field glra-field-wide">
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

        <label className="glra-search-field">
          <span>검색</span>
          <div>
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="호실 또는 그룹"
            />
          </div>
        </label>
      </div>

      <div className="glra-date-strip" aria-label="예약 가능 날짜">
        {dateOptions.map((date) => (
          <button
            className={date === selectedDate ? "glra-date-chip selected" : "glra-date-chip"}
            key={date}
            type="button"
            onClick={() => onSelectedDateChange(date)}
          >
            <span>{formatMonthDay(date)}</span>
            <strong>{formatWeekday(date)}</strong>
          </button>
        ))}
      </div>

      <div className="glra-summary-row" aria-live="polite">
        <div className="glra-legend">
          {(Object.keys(statusLabels) as SlotStatus[]).map((status) => (
            <span className="glra-legend-item" key={status}>
              <i className={`glra-status-dot ${status}`} />
              {statusLabels[status]}
            </span>
          ))}
        </div>
        <div className="glra-summary-meta">
          <span className="glra-drag-hint">예약 가능 칸을 드래그해 연속 예약</span>
          <span className="glra-summary-copy">
            {state.status === "loading"
              ? `${formatDate(state.date)} 조회 중 · ${state.roomCount}개 호실`
              : `${filteredRooms.length}개 호실`}
            {availability ? ` · ${formatTime(availability.fetchedAt)} 기준` : ""}
          </span>
        </div>
      </div>

      {counts ? (
        <div className="glra-slot-counts compact" aria-label="상태별 슬롯 수">
          {(Object.keys(statusLabels) as SlotStatus[]).map((status) => (
            <span className={`glra-slot-count ${status}`} key={status}>
              {statusLabels[status]} {counts[status] ?? 0}
            </span>
          ))}
        </div>
      ) : null}

      <AvailabilityStateView
        availability={availability}
        filteredRooms={filteredRooms}
        selectedDate={selectedDate}
        slotByRoomHour={slotByRoomHour}
        state={state}
        onRetry={onRetry}
        onSlotClick={onSlotClick}
        onSlotsReserve={onSlotsReserve}
      />
    </section>
  );
}

function AvailabilityStateView({
  availability,
  filteredRooms,
  selectedDate,
  slotByRoomHour,
  state,
  onRetry,
  onSlotClick,
  onSlotsReserve
}: {
  availability: AvailabilityResponse | null;
  filteredRooms: ReservableRoom[];
  selectedDate: string;
  slotByRoomHour: Map<string, ReservationSlot>;
  state: AvailabilityState;
  onRetry: () => void;
  onSlotClick: (slot: ReservationSlot) => void;
  onSlotsReserve: (slots: ReservationSlot[]) => void;
}) {
  if (filteredRooms.length === 0) {
    return <div className="glra-empty-state">조건에 맞는 호실 없음</div>;
  }

  if (state.status === "error") {
    return (
      <div className="glra-probe-card glra-probe-error" role="status" aria-live="polite">
        <div>
          <strong>예약 현황 조회 실패</strong>
          <span>{state.message}</span>
        </div>
        <button className="glra-secondary-button" type="button" onClick={onRetry}>
          <RefreshCw size={15} />
          다시 시도
        </button>
      </div>
    );
  }

  if (!availability) {
    const roomCount = state.status === "loading" ? state.roomCount : filteredRooms.length;
    const message =
      state.status === "loading"
        ? `${roomCount}개 호실 예약 현황 조회 중`
        : `${roomCount}개 호실 예약 현황 준비 중`;

    return <AvailabilityLoadingFrame message={message} roomCount={roomCount} />;
  }

  return (
    <AvailabilityMatrix
      availability={availability}
      loading={state.status === "loading"}
      selectedDate={selectedDate}
      slotByRoomHour={slotByRoomHour}
      onSlotClick={onSlotClick}
      onSlotsReserve={onSlotsReserve}
    />
  );
}

function QuotaSummary({ quotaStatus }: { quotaStatus: ReservationQuotaStatus | null }) {
  if (!quotaStatus) {
    return (
      <div className="glra-quota-row">
        <span>하루 최대 {DAILY_RESERVATION_LIMIT_HOURS}시간</span>
        <span>1달 최대 {MONTHLY_RESERVATION_LIMIT_HOURS}시간</span>
      </div>
    );
  }

  return (
    <div className={quotaStatus.canReserve ? "glra-quota-row" : "glra-quota-row blocked"}>
      <span>
        선택일 {quotaStatus.dailyHours}/{DAILY_RESERVATION_LIMIT_HOURS}시간
      </span>
      <span>
        30일 {quotaStatus.monthlyHours}/{MONTHLY_RESERVATION_LIMIT_HOURS}시간
      </span>
      {!quotaStatus.canReserve && quotaStatus.reason ? (
        <strong>{quotaStatus.reason}</strong>
      ) : null}
    </div>
  );
}

function AvailabilityMatrix({
  availability,
  loading,
  selectedDate,
  slotByRoomHour,
  onSlotClick,
  onSlotsReserve
}: {
  availability: AvailabilityResponse;
  loading: boolean;
  selectedDate: string;
  slotByRoomHour: Map<string, ReservationSlot>;
  onSlotClick: (slot: ReservationSlot) => void;
  onSlotsReserve: (slots: ReservationSlot[]) => void;
}) {
  const [hoveredAxis, setHoveredAxis] = React.useState<HoveredMatrixAxis | null>(null);
  const [dragSelection, setDragSelection] = React.useState<MatrixDragSelection | null>(
    null
  );
  const dragClickSuppressedRef = React.useRef(false);
  const hours = availability.hours.length
    ? availability.hours
    : DEFAULT_AVAILABILITY_HOURS;
  const dragSelectionSlots = React.useMemo(
    () =>
      dragSelection
        ? getMatrixSelectionSlots(
            dragSelection,
            availability,
            selectedDate,
            slotByRoomHour
          )
        : [],
    [availability, dragSelection, selectedDate, slotByRoomHour]
  );
  const dragSelectedSlotKeys = React.useMemo(
    () => new Set(dragSelectionSlots.map((slot) => slotKey(slot.roomId, slot.hour))),
    [dragSelectionSlots]
  );
  const dragInvalidSlotKeys = React.useMemo(
    () =>
      new Set(
        dragSelectionSlots
          .filter((slot) => slot.status !== "available")
          .map((slot) => slotKey(slot.roomId, slot.hour))
      ),
    [dragSelectionSlots]
  );

  const completeDragSelection = React.useCallback(() => {
    if (!dragSelection) {
      return;
    }

    const selectedSlots = getMatrixSelectionSlots(
      dragSelection,
      availability,
      selectedDate,
      slotByRoomHour
    );
    dragClickSuppressedRef.current = true;
    setDragSelection(null);
    onSlotsReserve(selectedSlots);

    window.setTimeout(() => {
      dragClickSuppressedRef.current = false;
    }, 0);
  }, [availability, dragSelection, onSlotsReserve, selectedDate, slotByRoomHour]);

  const handleSlotPointerDown = React.useCallback(
    (event: React.PointerEvent, slot: ReservationSlot) => {
      if (
        loading ||
        slot.status !== "available" ||
        (event.pointerType === "mouse" && event.button !== 0)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      dragClickSuppressedRef.current = true;
      setHoveredAxis({ roomId: slot.roomId, hour: slot.hour });
      setDragSelection({
        roomId: slot.roomId,
        anchorHour: slot.hour,
        currentHour: slot.hour
      });
    },
    [loading]
  );

  const handleSlotPointerEnter = React.useCallback((slot: ReservationSlot) => {
    setHoveredAxis({ roomId: slot.roomId, hour: slot.hour });
    setDragSelection((current) => {
      if (!current || current.roomId !== slot.roomId) {
        return current;
      }

      return {
        ...current,
        currentHour: slot.hour
      };
    });
  }, []);

  const handleSlotPointerUp = React.useCallback(
    (event: React.PointerEvent) => {
      if (!dragSelection) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      completeDragSelection();
    },
    [completeDragSelection, dragSelection]
  );

  return (
    <div
      className={
        loading
          ? "glra-table-frame loading"
          : dragSelection
            ? "glra-table-frame selecting"
            : "glra-table-frame"
      }
      onMouseLeave={() => {
        if (dragSelection) {
          dragClickSuppressedRef.current = false;
          setDragSelection(null);
          return;
        }

        setHoveredAxis(null);
      }}
      onPointerCancel={() => {
        dragClickSuppressedRef.current = false;
        setDragSelection(null);
      }}
    >
      <table className="glra-availability-table">
        <thead>
          <tr>
            <th
              className={
                hoveredAxis ? "glra-time-header matrix-hover" : "glra-time-header"
              }
            >
              시간
            </th>
            {availability.rooms.map((room) => (
              <th
                className={
                  hoveredAxis?.roomId === room.id
                    ? "glra-room-header column-hover"
                    : "glra-room-header"
                }
                key={room.id}
                onMouseEnter={() => setHoveredAxis({ roomId: room.id, hour: null })}
              >
                <span className="glra-room-no">{room.roomNo}</span>
                <span className="glra-room-group">{shortGroup(room)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hours.map((hour) => (
            <tr key={hour}>
              <th
                className={
                  hoveredAxis?.hour === hour
                    ? "glra-hour-cell row-hover"
                    : "glra-hour-cell"
                }
                onMouseEnter={() => setHoveredAxis({ roomId: null, hour })}
              >
                {hourLabel(hour)}
              </th>
              {availability.rooms.map((room) => {
                const slot =
                  slotByRoomHour.get(slotKey(room.id, hour)) ??
                  placeholderSlot(room, selectedDate, hour);
                const interactive =
                  slot.status === "available" ||
                  (slot.status === "own" && Boolean(slot.reservationId));
                const label = getSlotCellLabel(slot);

                return (
                  <td
                    className={getMatrixCellClassName(slot.status, {
                      active:
                        hoveredAxis?.roomId === room.id && hoveredAxis?.hour === hour,
                      column: hoveredAxis?.roomId === room.id,
                      invalidSelection: dragInvalidSlotKeys.has(slotKey(room.id, hour)),
                      row: hoveredAxis?.hour === hour,
                      selected: dragSelectedSlotKeys.has(slotKey(room.id, hour))
                    })}
                    key={`${room.id}-${hour}`}
                    title={`${formatDate(selectedDate)} ${room.roomNo}호 ${hourLabel(hour)} ${statusLabels[slot.status]}`}
                    aria-label={`${formatDate(selectedDate)} ${room.roomNo}호 ${hourLabel(hour)} ${statusLabels[slot.status]}`}
                    onMouseEnter={() => setHoveredAxis({ roomId: room.id, hour })}
                    onPointerDown={(event) => handleSlotPointerDown(event, slot)}
                    onPointerEnter={() => handleSlotPointerEnter(slot)}
                    onPointerUp={handleSlotPointerUp}
                  >
                    {interactive ? (
                      <button
                        className="glra-slot-action"
                        type="button"
                        disabled={loading}
                        onFocus={() => setHoveredAxis({ roomId: room.id, hour })}
                        onBlur={() => setHoveredAxis(null)}
                        onClick={(event) => {
                          if (dragClickSuppressedRef.current) {
                            event.preventDefault();
                            event.stopPropagation();
                            dragClickSuppressedRef.current = false;
                            return;
                          }

                          onSlotClick(slot);
                        }}
                      >
                        {label}
                      </button>
                    ) : (
                      <span>{label}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="glra-table-bottom-spacer" aria-hidden="true" />
      {loading ? <LoadingOverlay message="예약 현황 업데이트 중" /> : null}
    </div>
  );
}

function AvailabilityLoadingFrame({
  message,
  roomCount
}: {
  message: string;
  roomCount: number;
}) {
  const columnCount = Math.min(Math.max(roomCount, 6), 10);
  const skeletonCells = Array.from({ length: 8 * (columnCount + 1) }, (_, index) => index);
  const skeletonGridStyle = {
    "--glra-skeleton-columns": columnCount
  } as React.CSSProperties;

  return (
    <div className="glra-table-frame glra-table-skeleton-frame" role="status" aria-live="polite">
      <div className="glra-table-skeleton-grid" style={skeletonGridStyle} aria-hidden="true">
        {skeletonCells.map((item) => (
          <span className="glra-skeleton-cell" key={item} />
        ))}
      </div>
      <LoadingOverlay message={message} />
    </div>
  );
}

function LoadingOverlay({ message }: { message: string }) {
  return (
    <div className="glra-loading-overlay">
      <div className="glra-loading-card">
        <span className="glra-spinner" aria-hidden="true" />
        <strong>{message}</strong>
      </div>
    </div>
  );
}

function MyReservationsPanel({
  dateOptions,
  loading,
  mode,
  state,
  onCancel,
  onModeChange,
  onRetry
}: {
  dateOptions: string[];
  loading: boolean;
  mode: MyReservationsDisplayMode;
  state: MyReservationsState;
  onCancel: (reservation: MyReservation) => void;
  onModeChange: (mode: MyReservationsDisplayMode) => void;
  onRetry: () => void;
}) {
  if (state.status === "error") {
    return (
      <div className="glra-probe-card glra-probe-error" role="status" aria-live="polite">
        <div>
          <strong>내 예약 조회 실패</strong>
          <span>{state.message}</span>
        </div>
        <button className="glra-secondary-button" type="button" onClick={onRetry}>
          <RefreshCw size={15} />
          다시 시도
        </button>
      </div>
    );
  }

  if (state.status === "idle" || state.status === "loading") {
    return <MyReservationsLoadingFrame />;
  }

  const reservations = state.result.myReservations.reservations;
  const viewTabs = (
    <div className="glra-sub-tabs" aria-label="내 예약 보기 선택">
      <button
        className={mode === "list" ? "glra-sub-tab selected" : "glra-sub-tab"}
        type="button"
        aria-pressed={mode === "list"}
        onClick={() => onModeChange("list")}
      >
        <List size={14} />
        <span>목록</span>
      </button>
      <button
        className={mode === "calendar" ? "glra-sub-tab selected" : "glra-sub-tab"}
        type="button"
        aria-pressed={mode === "calendar"}
        onClick={() => onModeChange("calendar")}
      >
        <CalendarDays size={14} />
        <span>달력</span>
      </button>
    </div>
  );

  const summary = (
    <div className="glra-my-summary">
      <strong>{reservations.length}건</strong>
      <span>{formatTime(state.result.myReservations.fetchedAt)} 기준</span>
    </div>
  );
  const panelClassName = loading ? "glra-my-panel loading" : "glra-my-panel";

  if (reservations.length === 0) {
    return (
      <section className={panelClassName} aria-label="내 예약" aria-busy={loading}>
        <div className="glra-my-toolbar">
          {viewTabs}
          {summary}
        </div>
        <div className="glra-empty-state">예약된 시간이 없습니다.</div>
        {loading ? <LoadingOverlay message="내 예약 업데이트 중" /> : null}
      </section>
    );
  }

  return (
    <section className={panelClassName} aria-label="내 예약" aria-busy={loading}>
      <div className="glra-my-toolbar">
        {viewTabs}
        {summary}
      </div>
      {mode === "calendar" ? (
        <MyReservationsCalendar
          dateOptions={dateOptions}
          reservations={reservations}
          onCancel={onCancel}
        />
      ) : (
        <div className="glra-reservation-list">
          {reservations.map((reservation) => (
            <ReservationRow
              reservation={reservation}
              key={reservation.reservationId}
              onCancel={onCancel}
            />
          ))}
        </div>
      )}
      {loading ? <LoadingOverlay message="내 예약 업데이트 중" /> : null}
    </section>
  );
}

function ReservationRow({
  reservation,
  onCancel
}: {
  reservation: MyReservation;
  onCancel: (reservation: MyReservation) => void;
}) {
  return (
    <article className="glra-reservation-row">
      <div className="glra-reservation-date">
        <strong>{formatMonthDay(reservation.date)}</strong>
        <span>{formatWeekday(reservation.date)}</span>
      </div>
      <div className="glra-reservation-main">
        <h3>
          {reservation.roomNo}호 · {hourLabel(reservation.hour)}
        </h3>
        <p>
          {reservation.floor ? `${reservation.floor}F · ` : ""}
          {reservation.group}
        </p>
      </div>
      <div className="glra-reservation-meta">
        <span>{formatDate(reservation.date)}</span>
        {reservation.createdAt ? (
          <span>{formatCreatedAt(reservation.createdAt)} 예약</span>
        ) : null}
      </div>
      <button
        className="glra-row-action danger"
        type="button"
        onClick={() => onCancel(reservation)}
      >
        <Trash2 size={15} />
        취소
      </button>
    </article>
  );
}

function MyReservationsLoadingFrame() {
  return (
    <section className="glra-my-panel" aria-label="내 예약 조회 중">
      <div className="glra-my-toolbar">
        <div className="glra-sub-tabs glra-skeleton-tabs" aria-hidden="true">
          <span className="glra-skeleton-pill" />
          <span className="glra-skeleton-pill" />
        </div>
        <div className="glra-my-summary glra-skeleton-summary" aria-hidden="true">
          <span className="glra-skeleton-copy" />
          <span className="glra-skeleton-copy short" />
        </div>
      </div>
      <div className="glra-reservation-list glra-reservation-list-loading" role="status" aria-live="polite">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="glra-reservation-row glra-reservation-row-skeleton" key={index}>
            <span className="glra-skeleton-date" />
            <span className="glra-skeleton-line wide" />
            <span className="glra-skeleton-line" />
            <span className="glra-skeleton-button" />
          </div>
        ))}
        <LoadingOverlay message="내 예약 조회 중" />
      </div>
    </section>
  );
}

function MyReservationsCalendar({
  dateOptions,
  reservations,
  onCancel
}: {
  dateOptions: string[];
  reservations: MyReservation[];
  onCancel: (reservation: MyReservation) => void;
}) {
  const reservationGroupsByDate = React.useMemo(
    () => groupCalendarReservations(reservations),
    [reservations]
  );
  const today = todayYmd();
  const tomorrow = addDaysYmd(today, 1);
  const leadingDays = dateOptions[0] ? parseYmd(dateOptions[0]).getUTCDay() : 0;

  return (
    <div className="glra-my-calendar" aria-label="내 예약 달력">
      <div className="glra-my-calendar-weekdays" aria-hidden="true">
        {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="glra-my-calendar-grid">
        {Array.from({ length: leadingDays }, (_, index) => (
          <div className="glra-my-calendar-cell empty" key={`empty-${index}`} />
        ))}
        {dateOptions.map((date) => {
          const dailyGroups = reservationGroupsByDate.get(date) ?? [];
          const dateAccent = getCalendarDateAccent(date, today, tomorrow);

          return (
            <article
              className={getCalendarCellClassName(date, dailyGroups.length, today, tomorrow)}
              key={date}
            >
              <div className="glra-calendar-day">
                <div>
                  <strong>{Number(date.slice(6, 8))}</strong>
                  {dateAccent ? (
                    <em className="glra-calendar-date-accent">{dateAccent}</em>
                  ) : null}
                </div>
                <span>{formatWeekday(date)}</span>
              </div>
              <div className="glra-calendar-events">
                {dailyGroups.map((group) => (
                  <div
                    className="glra-calendar-event"
                    key={group.key}
                    role="group"
                    aria-label={`${formatDate(group.date)} ${group.roomNo}호 ${formatHourRange(group.startHour, group.endHour)}`}
                  >
                    <div className="glra-calendar-event-head">
                      <strong>{group.roomNo}호</strong>
                      <span>
                        {formatHourRange(group.startHour, group.endHour)}
                        {group.reservations.length > 1
                          ? ` · ${group.reservations.length}시간`
                          : ""}
                      </span>
                    </div>
                    <div className="glra-calendar-time-segments">
                      {group.reservations.map((reservation) => (
                        <button
                          className="glra-calendar-time-segment"
                          key={reservation.reservationId}
                          type="button"
                          title={`${formatDate(reservation.date)} ${reservation.roomNo}호 ${hourLabel(reservation.hour)} 취소`}
                          onClick={() => onCancel(reservation)}
                        >
                          {hourLabel(reservation.hour)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function groupCalendarReservations(reservations: MyReservation[]) {
  const groupsByDate = new Map<string, CalendarReservationGroup[]>();
  const sortedReservations = [...reservations].sort(compareReservationsForCalendar);
  let currentGroup: CalendarReservationGroupDraft | null = null;

  const pushCurrentGroup = () => {
    if (!currentGroup) {
      return;
    }

    const group: CalendarReservationGroup = {
      ...currentGroup,
      key: `${currentGroup.date}:${currentGroup.roomId}:${currentGroup.startHour}:${currentGroup.endHour}`
    };
    const groups = groupsByDate.get(group.date) ?? [];
    groups.push(group);
    groupsByDate.set(group.date, groups);
    currentGroup = null;
  };

  for (const reservation of sortedReservations) {
    const previousReservation =
      currentGroup?.reservations[currentGroup.reservations.length - 1] ?? null;

    if (
      currentGroup &&
      previousReservation &&
      currentGroup.date === reservation.date &&
      currentGroup.roomId === reservation.roomId &&
      areConsecutiveOperatingHours(previousReservation.hour, reservation.hour)
    ) {
      currentGroup.endHour = reservation.hour + 1;
      currentGroup.reservations.push(reservation);
      continue;
    }

    pushCurrentGroup();
    currentGroup = {
      date: reservation.date,
      roomId: reservation.roomId,
      roomNo: reservation.roomNo,
      startHour: reservation.hour,
      endHour: reservation.hour + 1,
      reservations: [reservation]
    };
  }

  pushCurrentGroup();

  for (const groups of groupsByDate.values()) {
    groups.sort(
      (a, b) =>
        a.startHour - b.startHour || a.roomNo - b.roomNo || a.endHour - b.endHour
    );
  }

  return groupsByDate;
}

function getCalendarCellClassName(
  date: string,
  groupCount: number,
  today: string,
  tomorrow: string
) {
  const classNames = ["glra-my-calendar-cell"];

  if (groupCount > 0) {
    classNames.push("has-reservation");
  }

  if (date === today) {
    classNames.push("today");
  } else if (date === tomorrow) {
    classNames.push("tomorrow");
  }

  return classNames.join(" ");
}

function getCalendarDateAccent(date: string, today: string, tomorrow: string) {
  if (date === today) {
    return "오늘";
  }

  if (date === tomorrow) {
    return "내일";
  }

  return "";
}

function compareReservationsForCalendar(a: MyReservation, b: MyReservation) {
  if (a.date !== b.date) {
    return a.date.localeCompare(b.date);
  }

  return (
    a.roomId - b.roomId ||
    compareOperatingHours(a.hour, b.hour) ||
    a.roomNo - b.roomNo
  );
}

function compareSlots(a: ReservationSlot, b: ReservationSlot) {
  if (a.date !== b.date) {
    return a.date.localeCompare(b.date);
  }

  return (
    a.roomId - b.roomId ||
    compareOperatingHours(a.hour, b.hour) ||
    a.roomNo - b.roomNo
  );
}

function getActionResultNotice(
  confirmation: ConfirmationState,
  results: ReservationActionResult[]
): ActionNotice {
  const failedResult = results.find((result) => !result.response.success);

  if (failedResult) {
    return {
      kind: "error",
      message: failedResult.response.message
    };
  }

  const firstResult = results[0];

  if (confirmation.slots.length === 1 && firstResult) {
    return {
      kind: firstResult.response.success ? "success" : "error",
      message: firstResult.response.message
    };
  }

  const successMessage =
    confirmation.action === "reserve"
      ? `${formatConfirmationTarget(confirmation)} 예약이 확인되었습니다.`
      : `${formatConfirmationTarget(confirmation)} 예약 취소가 확인되었습니다.`;

  return {
    kind: "success",
    message: successMessage
  };
}

function formatConfirmationTarget(confirmation: ConfirmationState) {
  const sortedSlots = [...confirmation.slots].sort(compareSlots);
  const firstSlot = sortedSlots[0];

  if (!firstSlot) {
    return "";
  }

  const sameRoomAndDate = sortedSlots.every(
    (slot) => slot.date === firstSlot.date && slot.roomId === firstSlot.roomId
  );

  if (!sameRoomAndDate) {
    return `${sortedSlots.length}건`;
  }

  const startHour = sortedSlots[0]?.hour ?? firstSlot.hour;
  const endHour = (sortedSlots[sortedSlots.length - 1]?.hour ?? firstSlot.hour) + 1;
  const duration = endHour - startHour;
  const durationText = duration > 1 ? ` (${duration}시간)` : "";

  return `${formatDate(firstSlot.date)} ${firstSlot.roomNo}호 ${formatHourRange(
    startHour,
    endHour
  )}${durationText}`;
}

function ConfirmationDialog({
  busy,
  confirmation,
  onCancel,
  onConfirm
}: {
  busy: boolean;
  confirmation: ConfirmationState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const actionText = confirmation.action === "reserve" ? "예약" : "취소";
  const targetText = formatConfirmationTarget(confirmation);

  return (
    <div className="glra-modal-backdrop" role="presentation">
      <section
        className="glra-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="glra-confirm-title"
      >
        <button
          className="glra-modal-close"
          type="button"
          aria-label="닫기"
          disabled={busy}
          onClick={onCancel}
        >
          <X size={18} />
        </button>
        <h2 id="glra-confirm-title">{actionText} 확인</h2>
        <p>{targetText}</p>
        <div className="glra-modal-actions">
          <button
            className="glra-secondary-button"
            type="button"
            disabled={busy}
            onClick={onCancel}
          >
            닫기
          </button>
          <button
            className="glra-primary-button"
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "처리 중" : actionText}
          </button>
        </div>
      </section>
    </div>
  );
}

function ActionToast({
  notice,
  onDismiss
}: {
  notice: ActionNotice;
  onDismiss: () => void;
}) {
  return (
    <div className="glra-toast-region" aria-live="polite" aria-atomic="true">
      <div className={`glra-toast ${notice.kind}`} role="status">
        <span>{notice.message}</span>
        <button
          className="glra-toast-close"
          type="button"
          aria-label="알림 닫기"
          onClick={onDismiss}
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

function countSlotsByStatus(availability: AvailabilityResponse) {
  const counts: Partial<Record<SlotStatus, number>> = {};

  for (const roomAvailability of availability.roomAvailability) {
    for (const slot of roomAvailability.slots) {
      counts[slot.status] = (counts[slot.status] ?? 0) + 1;
    }
  }

  return counts;
}

function getPanelStatus(authSource: AuthSource | null): string {
  if (authSource === "storage-token") {
    return "사이트 저장 토큰 사용";
  }

  if (authSource === "site-cookie") {
    return "사이트 쿠키 사용";
  }

  return "예약 페이지 연결됨";
}

function placeholderSlot(
  room: ReservableRoom,
  date: string,
  hour: number
): ReservationSlot {
  return {
    roomId: room.id,
    roomNo: room.roomNo,
    date,
    hour,
    status: "unavailable"
  };
}

function getSlotCellLabel(slot: ReservationSlot): string {
  if (slot.status === "available") {
    return "예약";
  }

  if (slot.status === "own" && slot.reservationId) {
    return "취소";
  }

  return compactStatusLabels[slot.status];
}

function getReserveSelectionError(slots: ReservationSlot[]) {
  const firstSlot = slots[0];

  if (!firstSlot) {
    return "예약할 시간을 선택해주세요.";
  }

  if (slots.some((slot) => slot.status !== "available")) {
    return "연속 예약은 예약 가능한 시간만 선택할 수 있습니다.";
  }

  if (
    slots.some(
      (slot) => slot.date !== firstSlot.date || slot.roomId !== firstSlot.roomId
    )
  ) {
    return "연속 예약은 같은 호실 안에서만 선택할 수 있습니다.";
  }

  const sortedSlots = [...slots].sort(compareSlots);

  for (let index = 1; index < sortedSlots.length; index += 1) {
    const previousSlot = sortedSlots[index - 1];
    const currentSlot = sortedSlots[index];

    if (
      !previousSlot ||
      !currentSlot ||
      !areConsecutiveOperatingHours(previousSlot.hour, currentSlot.hour)
    ) {
      return "연속된 시간대만 한 번에 예약할 수 있습니다.";
    }
  }

  return "";
}

function getMatrixSelectionSlots(
  selection: MatrixDragSelection,
  availability: AvailabilityResponse,
  selectedDate: string,
  slotByRoomHour: Map<string, ReservationSlot>
) {
  const room = availability.rooms.find((item) => item.id === selection.roomId);

  if (!room) {
    return [];
  }

  const orderedHours = availability.hours.length
    ? availability.hours
    : DEFAULT_AVAILABILITY_HOURS;
  const anchorIndex = orderedHours.findIndex(
    (hour) => hour === selection.anchorHour
  );
  const currentIndex = orderedHours.findIndex(
    (hour) => hour === selection.currentHour
  );

  if (anchorIndex < 0 || currentIndex < 0) {
    return [];
  }

  const startIndex = Math.min(anchorIndex, currentIndex);
  const endIndex = Math.max(anchorIndex, currentIndex);
  const selectedHours = orderedHours.slice(startIndex, endIndex + 1);
  const slots: ReservationSlot[] = [];

  for (const hour of selectedHours) {
    slots.push(
      slotByRoomHour.get(slotKey(room.id, hour)) ?? placeholderSlot(room, selectedDate, hour)
    );
  }

  return slots;
}

function getMatrixCellClassName(
  status: SlotStatus,
  state: {
    active: boolean;
    column: boolean;
    invalidSelection: boolean;
    row: boolean;
    selected: boolean;
  }
) {
  const classNames = ["glra-slot-cell", status];

  if (state.row) {
    classNames.push("row-hover");
  }

  if (state.column) {
    classNames.push("column-hover");
  }

  if (state.active) {
    classNames.push("active-hover");
  }

  if (state.selected) {
    classNames.push("drag-selected");
  }

  if (state.invalidSelection) {
    classNames.push("drag-invalid");
  }

  return classNames.join(" ");
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

function slotKey(roomId: number, hour: number): string {
  return `${roomId}:${hour}`;
}

function getRoomIdsKey(rooms: ReservableRoom[]) {
  return rooms.map((room) => room.id).join(",");
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

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
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

function hourLabel(hour: number): string {
  return `${String(normalizeDisplayHour(hour)).padStart(2, "0")}:00`;
}

function formatHourRange(startHour: number, endHour: number): string {
  const startSortValue = getOperatingHourSortValue(startHour);
  const normalizedEndHour = normalizeDisplayHour(endHour);
  const endSortValue =
    normalizedEndHour < normalizeDisplayHour(startHour)
      ? normalizedEndHour + 24
      : getOperatingHourSortValue(normalizedEndHour);

  if (endSortValue <= startSortValue + 1) {
    return hourLabel(startHour);
  }

  return `${hourLabel(startHour)}-${hourLabel(endHour)}`;
}

function parseYmd(value: string): Date {
  return new Date(
    Date.UTC(
      Number(value.slice(0, 4)),
      Number(value.slice(4, 6)) - 1,
      Number(value.slice(6, 8))
    )
  );
}

function getErrorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : "예약 현황 조회 중 오류가 발생했습니다.";
}
