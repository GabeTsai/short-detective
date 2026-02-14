(function () {
  'use strict';

  const analyzeBtn = document.getElementById('analyze');
  const resultEl = document.getElementById('result');

  function showResult(text, isError = false) {
    resultEl.textContent = text;
    resultEl.hidden = false;
    resultEl.classList.toggle('error', isError);
  }

  function hideResult() {
    resultEl.hidden = true;
    resultEl.classList.remove('error');
  }

  analyzeBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) {
        showResult('No active tab or URL.', true);
        return;
      }
      hideResult();
      // TODO: call backend or local logic to analyze tab.url
      showResult(`URL: ${tab.url}`);
    } catch (err) {
      showResult(err.message || 'Something went wrong.', true);
    }
  });
})();
