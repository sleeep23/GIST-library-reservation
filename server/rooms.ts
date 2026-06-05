import type { ReservableRoom } from "../shared/types";

const makeRooms = (
  roomNos: number[],
  floor: number,
  group: string,
  capacity: number | null
): ReservableRoom[] =>
  roomNos.map((roomNo) => ({
    id: roomNo,
    roomNo,
    label: `${floor}F Room ${roomNo}`,
    floor,
    group,
    capacity
  }));

export const reservableRooms: ReservableRoom[] = [
  ...makeRooms([108], 1, "Mini Theater", 50),
  ...makeRooms([110], 1, "Exhibition Hall", null),
  ...makeRooms([202, 203, 204], 2, "Group Study Room", 8),
  ...makeRooms([205, 206, 207, 208, 209, 210], 2, "Group Study Room", 5),
  ...makeRooms(
    [
      219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232,
      233, 234, 235, 236
    ],
    2,
    "Small-sized Carrel",
    1
  ),
  ...makeRooms([237, 238, 239, 240], 2, "Medium-sized Carrel", 1),
  ...makeRooms([302, 303, 304, 305, 306, 307], 3, "Group Study Room", 10),
  ...makeRooms([310], 3, "Lecture Room", 30),
  ...makeRooms([406, 407, 408, 409], 4, "Multi Media Room", null)
];

export const roomById = new Map(reservableRooms.map((room) => [room.id, room]));
