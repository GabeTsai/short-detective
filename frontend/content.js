(function () {
  'use strict';

  // Content script: runs in the context of web pages.
  // Use to detect short links on the page or interact with the DOM.

  function init() {
    // TODO: scan page for short-link patterns, add indicators, etc.
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
