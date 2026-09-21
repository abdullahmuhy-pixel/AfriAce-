// afriace-launcher.js
// Drop this on the public site next to a button with id="launch-portal-btn"
// and an empty container with id="country-modal-container".
// It shows live countries as selectable, coming-soon countries as disabled previews,
// and on selection sets the theme + routes to that country's student portal login.

import {
  AFRIACE_COUNTRIES,
  getLiveCountries,
  getComingSoonCountries,
  setStoredCountry
} from './afriace-config.js';

export function initializePortalSwitcher() {
  const launchBtn = document.querySelector('#launch-portal-btn');
  const modalContainer = document.querySelector('#country-modal-container');
  if (!launchBtn || !modalContainer) {
    console.warn('[AfriAce] Launcher: missing #launch-portal-btn or #country-modal-container');
    return;
  }

  launchBtn.addEventListener('click', () => {
    const live = getLiveCountries();
    const comingSoon = getComingSoonCountries();

    modalContainer.innerHTML = `
      <div class="afriace-modal-backdrop" data-role="backdrop">
        <div class="afriace-modal-card">
          <h2>Select Your Country Portal</h2>
          <p>AfriAce serves students across Africa. Choose your country to continue — more countries launching soon.</p>
          <div class="afriace-country-grid">
            ${live.map(c => `
              <button class="afriace-country-card" data-code="${c.code}" type="button">
                <span class="flag">${c.flag}</span>
                <span class="c-name">${c.name}</span>
                <span class="badge">${c.badge}</span>
              </button>
            `).join('')}
            ${comingSoon.map(c => `
              <button class="afriace-country-card coming-soon" data-code="${c.code}" type="button" disabled title="Coming soon">
                <span class="flag">${c.flag}</span>
                <span class="c-name">${c.name}</span>
                <span class="badge">Coming soon</span>
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    modalContainer.querySelectorAll('.afriace-country-card:not(.coming-soon)').forEach(btn => {
      btn.addEventListener('click', (e) => {
        selectCountryPortal(e.currentTarget.dataset.code);
      });
    });

    // Click outside the card to close
    modalContainer.querySelector('[data-role="backdrop"]').addEventListener('click', (e) => {
      if (e.target.dataset.role === 'backdrop') modalContainer.innerHTML = '';
    });
  });
}

export function selectCountryPortal(code) {
  const country = AFRIACE_COUNTRIES[code];
  if (!country || country.status !== 'live') return;

  setStoredCountry(code);

  // Portals are flat files (student-portal.html, teacher.html, etc.) — country
  // travels as a query param + localStorage, read by each portal on load.
  window.location.href = `/student-portal.html?country=${code.toLowerCase()}`;
}

// Apply a previously chosen country's theme immediately on any page load,
// so returning visitors don't see the fallback palette flash.
(function applyStoredThemeOnLoad() {
  const stored = localStorage.getItem('afriace_country');
  if (stored && AFRIACE_COUNTRIES[stored]) {
    document.documentElement.setAttribute('data-country', stored);
  }
})();
