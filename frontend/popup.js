(function () {
  'use strict';

  const startBtn = document.getElementById('start');
  const resultEl = document.getElementById('result');

  function showResult(text, type = 'info') {
    resultEl.textContent = text;
    resultEl.hidden = false;
    resultEl.classList.remove('error', 'success');
    if (type === 'error') resultEl.classList.add('error');
    if (type === 'success') resultEl.classList.add('success');
  }

  function hideResult() {
    resultEl.hidden = true;
    resultEl.classList.remove('error', 'success');
  }

  function setLoading(loading) {
    startBtn.disabled = loading;
    startBtn.textContent = loading ? 'Working...' : 'Start';
  }

  startBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab?.url) {
        showResult('No active tab or URL.', 'error');
        return;
      }

      if (!tab.url.includes('youtube.com/shorts')) {
        showResult('Please navigate to a YouTube Shorts page first.', 'error');
        return;
      }

      hideResult();
      setLoading(true);
      showResult('Extracting Shorts URLs...');

      const response = await chrome.tabs.sendMessage(tab.id, { type: 'START' });

      if (response?.ok) {
        const count = response.urlCount || 0;
        showResult(`Done! Found and sent ${count} Shorts URL${count !== 1 ? 's' : ''}.`, 'success');
      } else {
        showResult(response?.error || 'Something went wrong.', 'error');
      }
    } catch (err) {
      // Better error message for "receiving end does not exist"
      if (err.message?.includes('Receiving end does not exist')) {
        showResult('Content script not loaded. Try refreshing the YouTube page.', 'error');
      } else {
        showResult(err.message || 'Something went wrong.', 'error');
      }
    } finally {
      setLoading(false);
    }
  });
})();
