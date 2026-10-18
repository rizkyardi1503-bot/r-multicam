// Public configuration only. Never put payment server keys or database secrets here.
window.RP_CONFIG = Object.freeze({
  supabaseUrl: 'https://ngotkvqtzqiotztnqwaw.supabase.co',
  supabasePublishableKey: 'sb_publishable_aBJ_h2Gaearwl5nG2Xo75g_j7YAUOxS',
  // false hides every Buy Lifetime / Check payment control; set true when online checkout reopens.
  checkoutOpen: true,
  paymentUrl: '',
  customerPortalUrl: '',
  websiteDownloadPath: '/functions/v1/website-download'
});
