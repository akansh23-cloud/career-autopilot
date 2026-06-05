// Razorpay checkout client. The key SECRET never touches the frontend — we only
// receive the public key_id from the backend and the order it created.

import { api } from './api.js';
import { setPlan } from './plan.js';

let scriptPromise = null;
export function loadRazorpay() {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
  return scriptPromise;
}

export class PaymentError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

/* Full flow: create order on backend → open checkout → verify on backend → update plan.
   Calls onState('creating'|'opening'|'verifying') for UI. Resolves with the new plan. */
export async function startCheckout(planId, { user, onState } = {}) {
  onState?.('creating');
  let order;
  try {
    order = await api.post('/api/payments/create-order', { planId });
  } catch (e) {
    if (e.status === 503 || e.data?.error === 'gateway_not_configured') {
      throw new PaymentError('Payment gateway is not configured. Add Razorpay environment variables.', 'gateway_not_configured');
    }
    throw new PaymentError(e.message || 'Could not start payment.', 'create_failed');
  }
  if (!order?.ok || !order.keyId || !order.order) {
    if (order?.error === 'gateway_not_configured') throw new PaymentError('Payment gateway is not configured. Add Razorpay environment variables.', 'gateway_not_configured');
    throw new PaymentError(order?.message || 'Could not create order.', 'create_failed');
  }

  const ok = await loadRazorpay();
  if (!ok) throw new PaymentError('Could not load the Razorpay checkout script. Check your connection.', 'script_failed');

  onState?.('opening');
  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key: order.keyId,
      order_id: order.order.id,
      amount: order.order.amount,
      currency: order.order.currency || 'INR',
      name: 'Career Autopilot',
      description: `${planId === 'premium' ? 'Premium' : 'Pro'} plan`,
      prefill: { name: user?.name || '', email: user?.email || '' },
      theme: { color: '#7C5CFF' },
      modal: { ondismiss: () => reject(new PaymentError('Payment cancelled.', 'dismissed')) },
      handler: async (resp) => {
        try {
          onState?.('verifying');
          const v = await api.post('/api/payments/verify', {
            planId,
            razorpay_order_id: resp.razorpay_order_id,
            razorpay_payment_id: resp.razorpay_payment_id,
            razorpay_signature: resp.razorpay_signature,
          });
          if (!v?.ok) throw new PaymentError(v?.message || 'Verification failed.', 'verify_failed');
          const plan = setPlan({ planId: v.planId, status: 'active', source: 'razorpay', paymentId: v.paymentId, orderId: v.orderId, expiresAt: v.expiresAt });
          resolve(plan);
        } catch (err) { reject(err instanceof PaymentError ? err : new PaymentError(err.message || 'Verification failed.', 'verify_failed')); }
      },
    });
    rzp.on('payment.failed', (r) => reject(new PaymentError(r?.error?.description || 'Payment failed.', 'payment_failed')));
    rzp.open();
  });
}
