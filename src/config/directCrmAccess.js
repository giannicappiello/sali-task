// These channels require their own effective server-side module grant.
// Screen grants can refine access inside a channel, not enable another channel.
export const INDEPENDENT_DIRECT_MODULES = Object.freeze([
  "crm_brand_direct", "crm_b2b", "crm_online",
]);

export const ONLINE_CHANNEL_MODULES = Object.freeze([
  "crm_online_ecommerce", "crm_online_mailing", "crm_online_amazon", "crm_online_adv",
]);

export function requiresDirectModuleGrant(moduleCode) {
  return INDEPENDENT_DIRECT_MODULES.includes(moduleCode) || ONLINE_CHANNEL_MODULES.includes(moduleCode);
}
