(function () {
  const NEO_CLUB_SESSION_KEY = 'geoneo_neo_club_session_v1';
  const statusEl = document.getElementById('neoClubStatus');
  const headlineEl = document.getElementById('neoClubHeadline');
  const supportEl = document.getElementById('neoClubSupport');
  const lockedPreviewEl = document.getElementById('neoLockedPreview');
  const benefitsEl = document.getElementById('neoClubBenefits');
  const weeklyStrategyListEl = document.getElementById('weeklyStrategyList');
  const topicTabsEl = document.getElementById('topicTabs');
  const topicGuidesEl = document.getElementById('topicGuides');
  const podcastListEl = document.getElementById('podcastList');
  const knowledgeBaseListEl = document.getElementById('knowledgeBaseList');
  const contentWrapEl = document.getElementById('neoClubContentWrap');
  const upgradeTopEl = document.getElementById('neoClubUpgradeTop');
  const upgradeMainEl = document.getElementById('neoClubUpgradeMain');

  function normalizePackageLevel(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'gold' || normalized === 'admin' || normalized === 'silver') {
      return normalized;
    }
    return 'free';
  }

  function loadNeoClubSession() {
    if (!window.sessionStorage) {
      return null;
    }
    try {
      const raw = window.sessionStorage.getItem(NEO_CLUB_SESSION_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      return {
        auditId: String(parsed.auditId || ''),
        packageLevel: normalizePackageLevel(parsed.packageLevel)
      };
    } catch {
      return null;
    }
  }

  function clearNode(node) {
    if (!node) {
      return;
    }
    node.innerHTML = '';
  }

  function appendListItems(container, items) {
    const ul = document.createElement('ul');
    ul.className = 'audit-list';
    (items || []).forEach((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      ul.appendChild(li);
    });
    container.appendChild(ul);
  }

  function createCard(title, summary, actions) {
    const card = document.createElement('article');
    card.className = 'card neo-content-card';

    const heading = document.createElement('h3');
    heading.textContent = title || 'Untitled';
    card.appendChild(heading);

    const p = document.createElement('p');
    p.className = 'form-note';
    p.textContent = summary || 'No summary available.';
    card.appendChild(p);

    if (Array.isArray(actions) && actions.length) {
      appendListItems(card, actions);
    }

    return card;
  }

  function renderWeeklyStrategies(items) {
    clearNode(weeklyStrategyListEl);
    (items || []).forEach((item) => {
      weeklyStrategyListEl.appendChild(createCard(item.title, item.summary, item.actionablePoints));
    });
  }

  function renderTopicGuides(topics, activeId) {
    clearNode(topicGuidesEl);
    const selected = (topics || []).find((topic) => topic.id === activeId) || (topics || [])[0];
    if (!selected) {
      return;
    }
    (selected.guides || []).forEach((guide) => {
      topicGuidesEl.appendChild(createCard(guide.title, guide.summary, guide.actions));
    });
  }

  function renderTopicTabs(topics) {
    clearNode(topicTabsEl);
    if (!Array.isArray(topics) || !topics.length) {
      return;
    }

    let activeId = topics[0].id;
    const buttons = [];

    topics.forEach((topic) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'neo-topic-tab';
      button.textContent = topic.category;
      if (topic.id === activeId) {
        button.classList.add('active');
      }

      button.addEventListener('click', () => {
        activeId = topic.id;
        buttons.forEach((btn) => btn.classList.remove('active'));
        button.classList.add('active');
        renderTopicGuides(topics, activeId);
      });

      buttons.push(button);
      topicTabsEl.appendChild(button);
    });

    renderTopicGuides(topics, activeId);
  }

  function renderPodcast(items) {
    clearNode(podcastListEl);
    (items || []).forEach((episode) => {
      const card = document.createElement('article');
      card.className = 'card neo-content-card';

      const h3 = document.createElement('h3');
      h3.textContent = episode.title || 'Episode';
      card.appendChild(h3);

      const meta = document.createElement('p');
      meta.className = 'form-note';
      meta.textContent = `${episode.description || ''}${episode.duration ? ` (${episode.duration})` : ''}`.trim();
      card.appendChild(meta);

      if (episode.audioUrl) {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.preload = 'none';
        audio.src = episode.audioUrl;
        card.appendChild(audio);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'neo-audio-placeholder';
        placeholder.textContent = 'Private audio player will appear here.';
        card.appendChild(placeholder);
      }

      podcastListEl.appendChild(card);
    });
  }

  function renderKnowledgeBase(items) {
    clearNode(knowledgeBaseListEl);
    (items || []).forEach((article) => {
      const title = `[${article.category || 'General'}] ${article.title || 'Article'}`;
      knowledgeBaseListEl.appendChild(createCard(title, article.summary, []));
    });
  }

  function renderBenefits(items) {
    clearNode(benefitsEl);
    (items || []).forEach((benefit) => {
      const li = document.createElement('li');
      li.textContent = benefit;
      benefitsEl.appendChild(li);
    });
  }

  function setLockedState(isLocked) {
    if (contentWrapEl) {
      contentWrapEl.classList.toggle('is-locked', isLocked);
    }
    if (lockedPreviewEl) {
      lockedPreviewEl.hidden = !isLocked;
    }
    if (upgradeTopEl) {
      upgradeTopEl.hidden = !isLocked;
    }
  }

  async function loadNeoClub() {
    const params = new URLSearchParams(window.location.search);
    const stored = loadNeoClubSession();
    const auditId = String(params.get('auditId') || (stored && stored.auditId) || '');
    const packageLevel = normalizePackageLevel(params.get('package') || (stored && stored.packageLevel) || 'free');

    const query = auditId
      ? `auditId=${encodeURIComponent(auditId)}`
      : `package=${encodeURIComponent(packageLevel)}`;

    const response = await fetch(`/api/neo-club?${query}`);
    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data.error || 'Unable to load Neo Club data.');
    }

    if (headlineEl && data.messaging) {
      headlineEl.textContent = `${data.messaging.headline}.`;
    }
    if (supportEl && data.messaging) {
      supportEl.textContent = `${data.messaging.secondary}. ${data.messaging.tertiary}.`;
    }

    const member = data.membership && data.membership.isMember;
    if (statusEl) {
      statusEl.textContent = member
        ? `Member Access: ${data.clubName} unlocked (${data.membership.packageLevel})`
        : `Preview Access: ${data.membership.requiredPackage} required`;
      statusEl.classList.toggle('member', Boolean(member));
      statusEl.classList.toggle('locked', !member);
    }

    if (data.lockedPreview) {
      renderBenefits(data.lockedPreview.benefits);
      if (upgradeTopEl) {
        upgradeTopEl.textContent = data.lockedPreview.ctaLabel || 'Upgrade to Gold ($199)';
        upgradeTopEl.href = data.lockedPreview.ctaHref || '/#purchase';
      }
      if (upgradeMainEl) {
        upgradeMainEl.textContent = data.lockedPreview.ctaLabel || 'Upgrade to Gold ($199)';
        upgradeMainEl.href = data.lockedPreview.ctaHref || '/#purchase';
      }
    }

    const club = data.neoClub || {};
    renderWeeklyStrategies(club.weeklyStrategies || []);
    renderTopicTabs(club.expertTopics || []);
    renderPodcast(club.podcastEpisodes || []);
    renderKnowledgeBase(club.knowledgeBase || []);
    setLockedState(!member);
  }

  async function init() {
    try {
      await loadNeoClub();
    } catch (error) {
      setLockedState(true);
      if (statusEl) {
        statusEl.textContent = `Neo Club unavailable: ${error && error.message ? error.message : 'Please try again.'}`;
        statusEl.classList.add('locked');
      }
    }
  }

  init();
})();
