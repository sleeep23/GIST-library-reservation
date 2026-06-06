import React from "react";
import { CalendarDays } from "lucide-react";
import type { SessionResponse } from "../../shared/types";
import { formatDateRange } from "../lib/reservationUi";

interface LoginScreenProps {
  loading: boolean;
  error: string;
  reservationWindow?: SessionResponse["reservationWindow"];
  onLogin: (userId: string, userPwd: string) => Promise<void>;
}

export function LoginScreen({
  loading,
  error,
  reservationWindow,
  onLogin
}: LoginScreenProps) {
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
            <p>
              {reservationWindow
                ? formatDateRange(reservationWindow.start, reservationWindow.end)
                : ""}
            </p>
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
