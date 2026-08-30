// Provider selection: real Razorpay test-mode when keys are present,
// otherwise the built-in mock gateway that mirrors the same lifecycle.

import { CONFIG } from '../config.js';
import { createMockProvider } from './mock.js';
import { createRazorpayProvider } from './razorpay.js';

export function createProvider() {
  if (CONFIG.provider === 'razorpay') return createRazorpayProvider();
  return createMockProvider();
}
