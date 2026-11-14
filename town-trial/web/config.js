// Where the frontend finds the Town Trial backend (Modal).
// "" = demo mode: the in-browser simulator and scripted research loop.
// Set to the Modal web endpoint once it is deployed, e.g.
//   window.TOWN_TRIAL_API = "https://<workspace>--town-trial-api-web.modal.run";
// A ?api=<url> query parameter overrides this (handy for testing a Vercel preview).
window.TOWN_TRIAL_API = new URLSearchParams(location.search).get("api") || "";
