import { useEffect, useRef } from 'react';
import { ReceiptText, X } from 'lucide-react';

export default function ReceiptDialog({ receipt, onClose }) {
  const preRef = useRef(null);
  useEffect(() => {
    if (preRef.current) preRef.current.textContent = JSON.stringify(receipt, null, 2);
  }, [receipt]);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3><ReceiptText /> Receipt <span className="oid">{receipt.orderId}</span></h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={13} /> Close</button>
        </div>
        <pre ref={preRef} className="receipt-pre" />
      </div>
    </div>
  );
}
