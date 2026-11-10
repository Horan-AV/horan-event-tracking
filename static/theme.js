/* Pick light or dark before the page draws, so it never flashes the wrong colours. */
(function () {
  var pref = 'system', dflt = 'system';
  try { pref = localStorage.getItem('het-theme') || 'device-default'; dflt = localStorage.getItem('het-theme-default') || 'system'; } catch (e) {}
  if (pref === 'device-default') pref = dflt;
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
