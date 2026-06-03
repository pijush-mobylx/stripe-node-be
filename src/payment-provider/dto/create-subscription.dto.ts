export interface CreateSubscriptionDto {
  userId: string;
  providerCustomerId: string;
  providerPlanId: string;
  providerPmId: string;
  trialDays?: number;
}

export interface SubscriptionResult {
  providerSubId: string;
  providerCustomerId: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface RenewalResult {
  providerSubId: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}
