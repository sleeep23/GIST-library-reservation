import express from "express";
import { isYmd } from "../shared/dateUtils";
import { reservableRooms } from "../shared/rooms";
import {
  cancelReservation,
  getAvailability,
  getMyReservations,
  getSession,
  LibraryApiError,
  login,
  logout,
  makeReservation
} from "./libraryClient";

const isProduction = process.env.NODE_ENV === "production";
const isVercel = process.env.VERCEL === "1";
const allowVercelMemorySession =
  process.env.ALLOW_VERCEL_MEMORY_SESSION === "true";
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export function createApiApp(): express.Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "64kb" }));
  app.use(securityHeaders);
  app.use("/api", deploymentSafetyGuard);

  app.get("/api/session", (_request, response) => {
    response.json(getSession());
  });

  app.post("/api/login", loginRateLimit, async (request, response, next) => {
    try {
      const { userId, userPwd } = request.body as {
        userId?: string;
        userPwd?: string;
      };

      if (!userId || !userPwd) {
        throw new LibraryApiError("아이디와 비밀번호를 입력하세요.", 400);
      }

      response.json(await login(userId, userPwd));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/logout", (_request, response) => {
    logout();
    response.json(getSession());
  });

  app.get("/api/rooms", (_request, response) => {
    response.json({ rooms: reservableRooms });
  });

  app.get("/api/availability", async (request, response, next) => {
    try {
      const date = String(request.query.date ?? "");
      const roomIds = parseRoomIds(request.query.roomIds);

      if (!isYmd(date)) {
        throw new LibraryApiError("날짜는 YYYYMMDD 형식이어야 합니다.", 400);
      }

      response.json(await getAvailability(date, roomIds));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/my-reservations", async (_request, response, next) => {
    try {
      response.json(await getMyReservations());
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/reservations", async (request, response, next) => {
    try {
      const { roomId, date, hour } = parseSlotBody(request.body);
      response.json(await makeReservation(roomId, date, hour));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/cancellations", async (request, response, next) => {
    try {
      const { roomId, date, hour, reservationId } = parseSlotBody(request.body);

      if (typeof reservationId !== "number") {
        throw new LibraryApiError("취소에는 reservationId가 필요합니다.", 400);
      }

      response.json(await cancelReservation(roomId, date, hour, reservationId));
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", (_request, response) => {
    response.status(404).json({ message: "알 수 없는 API 경로입니다." });
  });

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction
    ) => {
      if (error instanceof LibraryApiError) {
        response.status(error.status).json({
          message: error.message,
          ...(isProduction ? {} : { details: error.details })
        });
        return;
      }

      console.error(error);
      response.status(500).json({ message: "알 수 없는 오류가 발생했습니다." });
    }
  );

  return app;
}

function securityHeaders(
  request: express.Request,
  response: express.Response,
  next: express.NextFunction
) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  if (isProduction) {
    response.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }

  if (request.path.startsWith("/api")) {
    response.setHeader("Cache-Control", "no-store");
  }

  next();
}

function deploymentSafetyGuard(
  _request: express.Request,
  response: express.Response,
  next: express.NextFunction
) {
  if (isProduction && isVercel && !allowVercelMemorySession) {
    response.status(503).json({
      message:
        "Vercel public deployment is blocked because this build uses in-memory library sessions. Read docs/VERCEL_DEPLOYMENT.md before enabling it."
    });
    return;
  }

  next();
}

function loginRateLimit(
  request: express.Request,
  response: express.Response,
  next: express.NextFunction
) {
  const now = Date.now();
  const key = request.ip || request.get("x-forwarded-for") || "unknown";
  const current = loginAttempts.get(key);

  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 5 * 60_000 });
    next();
    return;
  }

  if (current.count >= 8) {
    response.status(429).json({
      message: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요."
    });
    return;
  }

  current.count += 1;
  next();
}

function parseRoomIds(value: unknown): number[] | undefined {
  if (!value) {
    return undefined;
  }

  const raw = Array.isArray(value) ? value.join(",") : String(value);
  const roomIds = raw
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item));

  return roomIds.length > 0 ? roomIds : undefined;
}

function parseSlotBody(body: unknown): {
  roomId: number;
  date: string;
  hour: number;
  reservationId?: number;
} {
  const input = body as {
    roomId?: unknown;
    date?: unknown;
    hour?: unknown;
    reservationId?: unknown;
  };
  const roomId = Number(input.roomId);
  const hour = Number(input.hour);
  const reservationId =
    input.reservationId === undefined ? undefined : Number(input.reservationId);
  const date = String(input.date ?? "");

  if (!Number.isInteger(roomId) || !Number.isInteger(hour) || !isYmd(date)) {
    throw new LibraryApiError("roomId, date, hour 값이 올바르지 않습니다.", 400);
  }

  return {
    roomId,
    date,
    hour,
    ...(Number.isInteger(reservationId) ? { reservationId } : {})
  };
}
