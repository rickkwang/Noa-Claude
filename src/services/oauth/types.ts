// @ts-nocheck
export type SubscriptionType = 'max' | 'pro' | 'team' | 'enterprise'

export type RateLimitTier = string

export type BillingType = string

export type OAuthTokenAccount = {
  uuid: string
  emailAddress?: string
  organizationUuid?: string
}

export type OAuthTokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  scopes: string[]
  subscriptionType: SubscriptionType | null
  rateLimitTier: RateLimitTier | null
  profile?: OAuthProfileResponse
  tokenAccount?: OAuthTokenAccount
}

export type OAuthTokenExchangeResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
  scope: string
  account?: {
    uuid: string
    email_address?: string
  }
  organization?: {
    uuid?: string
  }
}

export type OAuthProfileResponse = {
  account?: {
    uuid?: string
    email?: string
    display_name?: string
    created_at?: string
  }
  organization?: {
    uuid?: string
    organization_type?: string
    organization_role?: string
    workspace_role?: string
    organization_name?: string
    rate_limit_tier?: RateLimitTier | null
    has_extra_usage_enabled?: boolean | null
    billing_type?: BillingType | null
    subscription_created_at?: string
  }
}

export type UserRolesResponse = {
  organization_role?: string
  workspace_role?: string
  organization_name?: string
}

export type ReferralCampaign = 'claude_code_guest_pass'

export type ReferrerRewardInfo = {
  currency: string
  amount_minor_units: number
}

export type ReferralRedemption = {
  [key: string]: unknown
}

export type ReferralCodeDetails = {
  campaign?: ReferralCampaign
  referral_link?: string
}

export type ReferralEligibilityResponse = {
  eligible: boolean
  referral_code_details?: ReferralCodeDetails
  referrer_reward?: ReferrerRewardInfo | null
  remaining_passes?: number | null
  [key: string]: unknown
}

export type ReferralRedemptionsResponse = {
  redemptions?: ReferralRedemption[]
  limit?: number
  [key: string]: unknown
}
