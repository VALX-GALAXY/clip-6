// VA Clipper AI - Frontend Controller

// Pre-configured default backend URL
const RENDER_BACKEND = 'https://clip6-backend.onrender.com';

// Use local origin if testing locally, otherwise default to clip6-backend.onrender.com
const DEFAULT_BACKEND = (window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1'))
  ? window.location.origin
  : RENDER_BACKEND;

let BACKEND_URL = localStorage.getItem('clipper_backend_url') || DEFAULT_BACKEND;
let currentJobId = null;
let pollInterval = null;

// DOM Elements
const clipForm = document.getElementById('clipForm');
const videoUrlInput = document.getElementById('videoUrl');
const pasteBtn = document.getElementById('pasteBtn');
const submitBtn = document.getElementById('submitBtn');
const clipsCountInput = document.getElementById('clipsCount');
const minDurationInput = document.getElementById('minDuration');
const maxDurationInput = document.getElementById('maxDuration');
const whisperModelSelect = document.getElementById('whisperModel');

// Progress Elements
const progressSection = document.getElementById('progressSection');
const progressTitle = document.getElementById('progressTitle');
const progressSubtitle = document.getElementById('progressSubtitle');
const progressPercent = document.getElementById('progressPercent');
const progressBar = document.getElementById('progressBar');
const errorBanner = document.getElementById('errorBanner');
const errorMessage = document.getElementById('errorMessage');
const dismissErrorBtn = document.getElementById('dismissErrorBtn');

// Pipeline Steps
const stepIngest = document.getElementById('step-ingest');
const stepTranscribe = document.getElementById('step-transcribe');
const stepDetect = document.getElementById('step-detect');
const stepRender = document.getElementById('step-render');

// Results Elements
const resultsSection = document.getElementById('resultsSection');
const resultsCount = document.getElementById('resultsCount');
const clipsGrid = document.getElementById('clipsGrid');
const downloadAllBtn = document.getElementById('downloadAllBtn');

// Modal Elements
const configBtn = document.getElementById('configBtn');
const settingsModal = document.getElementById('settingsModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const backendUrlInput = document.getElementById('backendUrlInput');
const testApiBtn = document.getElementById('testApiBtn');
const apiTestResult = document.getElementById('apiTestResult');
const saveBackendBtn = document.getElementById('saveBackendBtn');
const resetBackendBtn = document.getElementById('resetBackendBtn');
const backendLabel = document.getElementById('backendLabel');
const apiStatusDot = document.getElementById('apiStatusDot');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  updateBackendDisplay();
  checkBackendHealth();
  setupEventListeners();
});

function updateBackendDisplay() {
  try {
    const urlObj = new URL(BACKEND_URL);
    if (urlObj.hostname.includes('render.com')) {
      backendLabel.textContent = 'clip6-backend (Render)';
    } else {
      backendLabel.textContent = urlObj.host;
    }
  } catch (e) {
    backendLabel.textContent = 'VA Cloud Engine';
  }
}

async function checkBackendHealth() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${BACKEND_URL}/api/health`, { method: 'GET', signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      apiStatusDot.className = 'status-dot connected';
      apiStatusDot.title = 'Connected to VA Cloud Engine';
    } else {
      apiStatusDot.className = 'status-dot sleeping';
      apiStatusDot.title = 'Backend is starting up...';
    }
  } catch (err) {
    // If Render is sleeping or cold-starting, indicate standby
    apiStatusDot.className = 'status-dot standby';
    apiStatusDot.title = 'VA Backend Ready (Will wake on request)';
  }
}

function setupEventListeners() {
  // Pill selector for clip count
  document.querySelectorAll('#clipsSelector .pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#clipsSelector .pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      clipsCountInput.value = btn.dataset.val;
    });
  });

  // Paste from clipboard
  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        videoUrlInput.value = text.trim();
        videoUrlInput.focus();
      }
    } catch (err) {
      console.warn('Clipboard access blocked:', err);
    }
  });

  // Form submission
  clipForm.addEventListener('submit', handleFormSubmit);

  // Error banner dismiss
  dismissErrorBtn.addEventListener('click', () => {
    errorBanner.classList.add('hidden');
  });

  // Modal open/close
  configBtn.addEventListener('click', () => {
    backendUrlInput.value = BACKEND_URL;
    apiTestResult.textContent = '';
    settingsModal.classList.remove('hidden');
  });

  closeModalBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.classList.add('hidden');
  });

  // Test backend connection in modal
  testApiBtn.addEventListener('click', async () => {
    apiTestResult.textContent = 'Testing connection...';
    apiTestResult.className = 'test-result';
    const targetUrl = backendUrlInput.value.trim().replace(/\/$/, '') || RENDER_BACKEND;
    try {
      const res = await fetch(`${targetUrl}/api/health`);
      if (res.ok) {
        const data = await res.json();
        apiTestResult.textContent = `Connected! (AI Key: ${data.api_key_configured ? 'Active' : 'Missing'})`;
        apiTestResult.className = 'test-result success';
      } else {
        apiTestResult.textContent = `Error: HTTP ${res.status}`;
        apiTestResult.className = 'test-result error';
      }
    } catch (err) {
      apiTestResult.textContent = 'Standby or waking up. Check URL & network.';
      apiTestResult.className = 'test-result warning';
    }
  });

  // Reset to default Render backend
  if (resetBackendBtn) {
    resetBackendBtn.addEventListener('click', () => {
      backendUrlInput.value = RENDER_BACKEND;
      BACKEND_URL = RENDER_BACKEND;
      localStorage.setItem('clipper_backend_url', BACKEND_URL);
      updateBackendDisplay();
      checkBackendHealth();
      apiTestResult.textContent = 'Reset to clip6-backend.onrender.com';
      apiTestResult.className = 'test-result success';
    });
  }

  // Save backend URL
  saveBackendBtn.addEventListener('click', () => {
    let newUrl = backendUrlInput.value.trim().replace(/\/$/, '');
    if (!newUrl) newUrl = RENDER_BACKEND;
    BACKEND_URL = newUrl;
    localStorage.setItem('clipper_backend_url', BACKEND_URL);
    updateBackendDisplay();
    checkBackendHealth();
    settingsModal.classList.add('hidden');
  });

  // Download all
  downloadAllBtn.addEventListener('click', downloadAllClips);
}

// --- Submit & Process Pipeline ---
async function handleFormSubmit(e) {
  e.preventDefault();
  const url = videoUrlInput.value.trim();
  if (!url) return;

  hideError();
  resultsSection.classList.add('hidden');
  progressSection.classList.remove('hidden');
  submitBtn.disabled = true;

  updateProgressUI(5, 'Connecting to VA Clipper Cloud...', 'Starting pipeline...');
  resetStepBadges();

  const payload = {
    url: url,
    clips_count: parseInt(clipsCountInput.value, 10),
    min_duration: parseInt(minDurationInput.value, 10),
    max_duration: parseInt(maxDurationInput.value, 10),
    whisper_model: whisperModelSelect.value
  };

  try {
    const res = await fetch(`${BACKEND_URL}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `Server returned error (HTTP ${res.status})`);
    }

    const data = await res.json();
    currentJobId = data.job_id;
    startPolling(currentJobId);

  } catch (err) {
    showError(err.message || 'Cannot reach VA Backend. If Render just woke up, wait 30 seconds and retry.');
    progressSection.classList.add('hidden');
    submitBtn.disabled = false;
  }
}

// --- Polling Job Status ---
function startPolling(jobId) {
  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/jobs/${jobId}`);
      if (!res.ok) throw new Error('Failed to fetch job status');

      const job = await res.json();
      updateProgressUI(job.progress, job.step, job.status);
      updateStepBadges(job.progress);

      if (job.status === 'completed') {
        clearInterval(pollInterval);
        submitBtn.disabled = false;
        setTimeout(() => {
          progressSection.classList.add('hidden');
          renderResults(job.clips);
        }, 800);
      } else if (job.status === 'failed') {
        clearInterval(pollInterval);
        submitBtn.disabled = false;
        showError(job.error || 'Video clipping failed.');
        progressSection.classList.add('hidden');
      }

    } catch (err) {
      console.warn('Poll error:', err);
    }
  }, 2000);
}

function updateProgressUI(pct, stepMsg, status) {
  progressPercent.textContent = `${pct}%`;
  progressBar.style.width = `${pct}%`;
  progressSubtitle.textContent = stepMsg || 'Processing...';

  if (pct < 30) {
    progressTitle.textContent = '1/4 Ingesting & Downloading Source Stream...';
  } else if (pct < 60) {
    progressTitle.textContent = '2/4 High-Speed Audio Transcription...';
  } else if (pct < 80) {
    progressTitle.textContent = '3/4 AI Hook & Virality Scoring...';
  } else if (pct < 100) {
    progressTitle.textContent = '4/4 Rendering Parallel 9:16 Vertical Cuts...';
  } else {
    progressTitle.textContent = '✨ VA Clipper Ready! Clips Generated';
  }
}

function resetStepBadges() {
  [stepIngest, stepTranscribe, stepDetect, stepRender].forEach(s => {
    s.className = 'step-badge';
  });
  stepIngest.classList.add('active');
}

function updateStepBadges(pct) {
  if (pct >= 25) {
    stepIngest.className = 'step-badge done';
    stepTranscribe.className = 'step-badge active';
  }
  if (pct >= 60) {
    stepTranscribe.className = 'step-badge done';
    stepDetect.className = 'step-badge active';
  }
  if (pct >= 80) {
    stepDetect.className = 'step-badge done';
    stepRender.className = 'step-badge active';
  }
  if (pct >= 100) {
    stepRender.className = 'step-badge done';
  }
}

// --- Render Results ---
function renderResults(clips) {
  clipsGrid.innerHTML = '';
  if (!clips || clips.length === 0) {
    showError('No clips were generated for this video.');
    return;
  }

  resultsCount.textContent = `Generated ${clips.length} viral 9:16 vertical cuts with synchronized karaoke subtitles`;

  clips.forEach(clip => {
    const card = document.createElement('div');
    card.className = 'clip-card';

    const videoSrc = `${BACKEND_URL}${clip.download_url}`;

    card.innerHTML = `
      <div class="video-container">
        <span class="score-badge">🔥 ${clip.score}% Virality</span>
        <span class="duration-badge">${clip.duration}s</span>
        <video controls playsinline preload="metadata">
          <source src="${videoSrc}" type="video/mp4">
          Your browser does not support video playback.
        </video>
      </div>
      <div class="clip-details">
        <div class="clip-badges-row">
          <span class="audio-badge">🔊 High-Quality Audio</span>
          <span class="format-badge">9:16 Vertical</span>
        </div>
        <h4 class="clip-title">${escapeHtml(clip.title)}</h4>
        <p class="clip-hook">"${escapeHtml(clip.hook || 'High retention viral moment')}"</p>
        <div class="clip-actions">
          <a href="${videoSrc}" download="${clip.filename}" class="btn-download" target="_blank">
            <span>⬇️ Download MP4</span>
          </a>
          <button type="button" class="btn-copy-hook" title="Copy Hook Quote">📋</button>
        </div>
      </div>
    `;

    const videoEl = card.querySelector('video');
    if (videoEl) {
      videoEl.volume = 1.0;
      videoEl.addEventListener('play', () => {
        videoEl.muted = false;
        videoEl.volume = 1.0;
      });
    }

    const copyBtn = card.querySelector('.btn-copy-hook');
    if (copyBtn && clip.hook) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(clip.hook);
          copyBtn.textContent = '✅';
          setTimeout(() => { copyBtn.textContent = '📋'; }, 1500);
        } catch (e) {}
      });
    }

    clipsGrid.appendChild(card);
  });

  resultsSection.classList.remove('hidden');
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function downloadAllClips() {
  const downloadLinks = document.querySelectorAll('.btn-download');
  downloadLinks.forEach((link, idx) => {
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = link.href;
      a.download = link.getAttribute('download') || `clip-${idx + 1}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }, idx * 600);
  });
}

function showError(msg) {
  errorMessage.textContent = msg;
  errorBanner.classList.remove('hidden');
}

function hideError() {
  errorBanner.classList.add('hidden');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[m]);
}
