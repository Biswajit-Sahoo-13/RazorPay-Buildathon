// Real Razorpay adapter (test mode). Activates automatically when
// RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET are set. Uses the Orders API for
// order creation and verifies the Checkout.js callback signature
// (HMAC-SHA256 of `order_id|payment_id` with the key secret) exactly like
// Razorpay's official docs prescribe. There is deliberately no
// simulateCharge here: with real keys the payment must happen inside
// Razorpay Checkout on the client, and the server only ever verifies.

import { CONFIG } from '../config.js';
import { hmacSha256hex } from '../util.js';

const API = 'https://api.razorpay.com/v1';

function authHeader() {
  const token = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  return `Basic ${token}`;
}

export function createRazorpayProvider() {
  return {
    name: 'razorpay',
    label: 'RAZORPAY TEST MODE',
    isSimulated: false,

    async createOrder(order) {
      const res = await fetch(`${API}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
        body: JSON.stringify({
          amount: order.totalPaise, // paise, integer — Razorpay-native
          currency: 'INR',
          receipt: order.orderId,
          notes: { merchant: CONFIG.merchant.name, channel: 'agentic-storefront' },
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Razorpay Orders API ${res.status}: ${body}`);
      }
      const data = await res.json();
      return {
        providerOrderId: data.id, // order_xxx
        amountPaise: data.amount,
        checkout: {
          key: process.env.RAZORPAY_KEY_ID,
          order_id: data.id,
          amount: data.amount,
          currency: data.currency,
          name: CONFIG.merchant.name,
          description: 'MasalaMart — agentic checkout',
        },
      };
    },

    verifyPayment({ providerOrderId, paymentId, signature }) {
      const expected = hmacSha256hex(process.env.RAZORPAY_KEY_SECRET, `${providerOrderId}|${paymentId}`);
      return signature === expected;
    },
  };
}
