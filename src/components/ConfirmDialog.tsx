import { X } from "lucide-react";
import type { ConfirmationState } from "../lib/reservationUi";
import { formatDate, hourLabel } from "../lib/reservationUi";

interface ConfirmDialogProps {
  confirmation: ConfirmationState;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  confirmation,
  busy,
  onCancel,
  onConfirm
}: ConfirmDialogProps) {
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
