// Simulated payment gateway. It deliberately mirrors the Razorpay order
// lifecycle (order → payment → signature) and the same HMAC-SHA256
// order_id|payment_id signature scheme, so the server-side verification
// code path is identical between mock and real providers.
//
// Failure injection: `simulate: 'failure'` or a card number ending in 0002
// produces a declined payment — this powers the graceful-failure demo.

import { CONFIG } from '../config.js';
import { uid, hmacSha256hex } from '../util.js';

export function createMockProvider() {
  return {
    name: 'mock',
    label: 'MOCK GATEWAY (Razorpay test-mode compatible)',
    isSimulated: true,

    createOrder(order) {
      return {
        providerOrderId: uid('order_mock'),
        amountPaise: order.totalPaise,
        checkout: null, // client renders the built-in simulated gateway
      };
    },

    async simulateCharge({ amountPaise, simulate, card }) {
      const declined = simulate === 'failure' || /0002$/.test(String(card || ''));
      if (declined) {
        return {
          ok: false,
          error: 'PAYMENT_DECLINED',
          description: 'Bank declined the payment (simulated). No money moved.',
        };
      }
      // Simulate network latency for realism.
      await new Promise((r) => setTimeout(r, 400));
      const providerOrderId = arguments[0].providerOrderId;
      const paymentId = uid('pay_mock');
      return {
        ok: true,
        paymentId,
        signature: hmacSha256hex(CONFIG.mockSecret, `${providerOrderId}|${paymentId}`),
        method: card ? 'card' : 'upi',
      };
    },

    verifyPayment({ providerOrderId, paymentId, signature }) {
      const expected = hmacSha256hex(CONFIG.mockSecret, `${providerOrderId}|${paymentId}`);
      return signature === expected;
    },
  };
}
