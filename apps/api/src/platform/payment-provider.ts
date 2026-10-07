/** Future merchant integrations must verify callbacks and credit an order exactly once. */
export interface PaymentProvider {
  readonly enabled: boolean;
  createCheckout(
    userId: string,
    amountMicro: number,
  ): Promise<{ orderId: string; checkoutUrl: string }>;
}
export class UnavailablePaymentProvider implements PaymentProvider {
  readonly enabled = false;
  async createCheckout(): Promise<never> {
    // TODO(payments): implement Alipay or WeChat checkout, signed callback verification and an idempotent credit transaction.
    throw new Error("Online recharge is not available yet.");
  }
}
