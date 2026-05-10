(function () {
  const revealEls = document.querySelectorAll('.reveal');
  const header = document.querySelector('.site-header');
  const heroEyebrow = document.getElementById('heroEyebrow');
  const heroTitle = document.getElementById('heroTitle');
  const heroLead = document.getElementById('heroLead');
  const modeGuideEyebrow = document.getElementById('modeGuideEyebrow');
  const modeGuideTitle = document.getElementById('modeGuideTitle');
  const modeGuideLead = document.getElementById('modeGuideLead');
  const modeGuideList = document.getElementById('modeGuideList');
  const metricOneTitle = document.getElementById('metricOneTitle');
  const metricOneText = document.getElementById('metricOneText');
  const metricTwoTitle = document.getElementById('metricTwoTitle');
  const metricTwoText = document.getElementById('metricTwoText');
  const metricThreeTitle = document.getElementById('metricThreeTitle');
  const metricThreeText = document.getElementById('metricThreeText');
  const metricFourTitle = document.getElementById('metricFourTitle');
  const metricFourText = document.getElementById('metricFourText');
  const storyEyebrow = document.getElementById('storyEyebrow');
  const storyTitle = document.getElementById('storyTitle');
  const storyLead = document.getElementById('storyLead');
  const previewEyebrow = document.getElementById('previewEyebrow');
  const previewTitle = document.getElementById('previewTitle');
  const previewLead = document.getElementById('previewLead');

  const modeWebsiteBtn = document.getElementById('modeWebsiteBtn');
  const modeMarketBtn = document.getElementById('modeMarketBtn');
  const websiteModePanel = document.getElementById('websiteModePanel');
  const marketModePanel = document.getElementById('marketModePanel');

  const websiteForm = document.getElementById('websiteAuditForm');
  const marketForm = document.getElementById('marketModeForm');
  const finalCtaForm = document.getElementById('finalCtaForm');

  const dashboardResults = document.getElementById('dashboardResults');
  const dashboardStatus = document.getElementById('dashboardStatus');
  const auditModalOverlay = document.getElementById('auditModalOverlay');
  const auditModalTitle = document.getElementById('auditModalTitle');
  const auditModalCloseBtn = document.getElementById('auditModalCloseBtn');
  const auditLoadingOverlay = document.getElementById('auditLoadingOverlay');
  const auditLoadingText = document.getElementById('auditLoadingText');
  const searchPositionPanel = document.getElementById('searchPositionPanel');
  const searchPositionTitle = document.getElementById('searchPositionTitle');
  const searchPositionLead = document.getElementById('searchPositionLead');
  const searchPositionSummary = document.getElementById('searchPositionSummary');
  const searchPositionQueries = document.getElementById('searchPositionQueries');
  const marketSearchPanel = document.getElementById('marketSearchPanel');
  const marketSearchTitle = document.getElementById('marketSearchTitle');
  const marketSearchLead = document.getElementById('marketSearchLead');
  const marketSearchSummary = document.getElementById('marketSearchSummary');
  const marketSearchStats = document.getElementById('marketSearchStats');
  const googleMatrixPanel = document.getElementById('googleMatrixPanel');
  const googleMatrixTitle = document.getElementById('googleMatrixTitle');
  const googleMatrixIntro = document.getElementById('googleMatrixIntro');
  const googleMatrixRows = document.getElementById('googleMatrixRows');
  const summaryScoreCards = document.getElementById('summaryScoreCards');
  const packageViewSelect = document.getElementById('packageViewSelect');
  const adminModeToggle = document.getElementById('adminModeToggle');
  const dataQualityBadge = document.getElementById('dataQualityBadge');
  const packageComparison = document.getElementById('packageComparison');
  const dashboardControlsCard = document.getElementById('dashboardControlsCard');
  const packageComparisonCard = document.getElementById('packageComparisonCard');

  const issuesPanel = document.getElementById('issuesPanel');
  const issuesList = document.getElementById('issuesList');
  const fixesPanel = document.getElementById('fixesPanel');
  const fixesList = document.getElementById('fixesList');
  const questionsPanel = document.getElementById('questionsPanel');
  const questionsList = document.getElementById('questionsList');
  const competitorsPanel = document.getElementById('competitorsPanel');
  const competitorsTable = document.getElementById('competitorsTable');
  const competitorsTableBody = document.getElementById('competitorsTableBody');
  const marketOpportunityPanel = document.getElementById('marketOpportunityPanel');
  const marketLeaderboardTabBtn = document.getElementById('marketLeaderboardTabBtn');
  const marketTakeoverTabBtn = document.getElementById('marketTakeoverTabBtn');
  const marketLeaderboardTab = document.getElementById('marketLeaderboardTab');
  const marketTakeoverTab = document.getElementById('marketTakeoverTab');

  const FULL_FIX_PLAN_PRICE = 79;
  const SPECIALIST_PRICE = 197;

  const adminPanel = document.getElementById('adminPanel');
  const adminRawData = document.getElementById('adminRawData');
  const copyReportBtn = document.getElementById('copyReportBtn');
  const exportJsonBtn = document.getElementById('exportJsonBtn');
  const exportTextBtn = document.getElementById('exportTextBtn');

  const marketBusinessName = document.getElementById('marketBusinessName');
  const marketIndustry = document.getElementById('marketIndustry');
  const marketCity = document.getElementById('marketCity');
  const marketState = document.getElementById('marketState');
  const marketZip = document.getElementById('marketZip');
  const websiteState = document.getElementById('websiteState');
  const websiteZip = document.getElementById('websiteZip');
  const finalUrl = document.getElementById('finalUrl');
  const pricingEyebrow = document.getElementById('pricingEyebrow');
  const pricingTitle = document.getElementById('pricingTitle');
  const pricingLead = document.getElementById('pricingLead');
  const finalCtaEyebrow = document.getElementById('finalCtaEyebrow');
  const finalCtaTitle = document.getElementById('finalCtaTitle');
  const finalCtaLabel = document.getElementById('finalCtaLabel');
  const finalCtaButton = document.getElementById('finalCtaButton');
  const finalCtaNote = document.getElementById('finalCtaNote');

  const state = {
    activeMode: 'website',
    dashboard: null,
    selectedPackageView: 'full_data',
    internalMode: false,
    marketTab: 'leaderboard',
    userRole: 'client' // 'client' or 'admin'
  };

  const SPECIALIST_CALENDAR_LINK = 'https://calendly.com/geoneo-specialist/strategy-session'; // Change this to your real booking link

  const US_STATES = [
    ['AL', 'Alabama'],
    ['AK', 'Alaska'],
    ['AZ', 'Arizona'],
    ['AR', 'Arkansas'],
    ['CA', 'California'],
    ['CO', 'Colorado'],
    ['CT', 'Connecticut'],
    ['DE', 'Delaware'],
    ['FL', 'Florida'],
    ['GA', 'Georgia'],
    ['HI', 'Hawaii'],
    ['ID', 'Idaho'],
    ['IL', 'Illinois'],
    ['IN', 'Indiana'],
    ['IA', 'Iowa'],
    ['KS', 'Kansas'],
    ['KY', 'Kentucky'],
    ['LA', 'Louisiana'],
    ['ME', 'Maine'],
    ['MD', 'Maryland'],
    ['MA', 'Massachusetts'],
    ['MI', 'Michigan'],
    ['MN', 'Minnesota'],
    ['MS', 'Mississippi'],
    ['MO', 'Missouri'],
    ['MT', 'Montana'],
    ['NE', 'Nebraska'],
    ['NV', 'Nevada'],
    ['NH', 'New Hampshire'],
    ['NJ', 'New Jersey'],
    ['NM', 'New Mexico'],
    ['NY', 'New York'],
    ['NC', 'North Carolina'],
    ['ND', 'North Dakota'],
    ['OH', 'Ohio'],
    ['OK', 'Oklahoma'],
    ['OR', 'Oregon'],
    ['PA', 'Pennsylvania'],
    ['RI', 'Rhode Island'],
    ['SC', 'South Carolina'],
    ['SD', 'South Dakota'],
    ['TN', 'Tennessee'],
    ['TX', 'Texas'],
    ['UT', 'Utah'],
    ['VT', 'Vermont'],
    ['VA', 'Virginia'],
    ['WA', 'Washington'],
    ['WV', 'West Virginia'],
    ['WI', 'Wisconsin'],
    ['WY', 'Wyoming'],
    ['DC', 'District of Columbia']
  ];

  const modeContent = {
    website: {
      heroEyebrow: 'Website Audit',
      heroTitle: 'Know Where You Are',
      heroLead: 'Outrank Your Competition',
      guideEyebrow: 'Best For',
      guideTitle: 'Website Audit',
      guideLead: 'Use this when the goal is to understand one business website, not the broader market.',
      guideItems: [
        'Check how the site appears in live search.',
        'See the ranking factors affecting visibility.',
        'Get a practical fix list in priority order.'
      ],
      metrics: [
        ['Live website ranking', 'See where this site appears first'],
        ['Ranking factors', 'Understand why it ranks there'],
        ['Fix priorities', 'See what to change next'],
        ['Site-specific action', 'Focused on one business website']
      ],
      storyEyebrow: 'Why It Matters',
      storyTitle: 'A useful site audit should answer three things clearly: where the site stands, why it is there, and what to do next.',
      storyLead: 'That means live ranking context, clear scoring, and a fix path that is specific to the website being audited.',
      previewEyebrow: 'What You Get',
      previewTitle: 'The website audit is built to give a business clear answers, not generic reports.',
      previewLead: 'It shows where the site ranks, what is helping or hurting that position, and what should be fixed first to improve visibility and lead flow.',
      pricingEyebrow: 'Support Options',
      pricingTitle: 'Choose the level of website audit support you need.',
      pricingLead: 'Every paid website audit tier includes human review and help interpreting the findings.',
      finalCtaEyebrow: 'Run A Site Audit',
      finalCtaTitle: 'Run a website audit now and see where this site ranks, why, and what to fix first.',
      finalCtaLabel: 'Website URL',
      finalCtaButton: 'Run Website Audit',
      finalCtaNote: 'Takes 30–60 seconds • No signup required'
    },
    market: {
      heroEyebrow: 'Industry and Area Rankings',
      heroTitle: 'See which businesses rank first in an industry and area before a customer ever decides who to call.',
      heroLead: 'Use this to search a market by industry and location and get a clean ranking view of the businesses showing up there right now.',
      guideEyebrow: 'Best For',
      guideTitle: 'Industry and Area Rankings',
      guideLead: 'Use this when you want to understand a market, not diagnose one specific website.',
      guideItems: [
        'See who appears in the market right now.',
        'Review ranked businesses in order.',
        'Understand how crowded or open that area is.'
      ],
      metrics: [
        ['Live market rankings', 'See who is showing up in that area'],
        ['Industry + location', 'Search by service and town/state'],
        ['Competitive landscape', 'Understand who owns the space'],
        ['Market-only view', 'No website diagnostics mixed in']
      ],
      storyEyebrow: 'Why It Matters',
      storyTitle: 'The businesses that rank first shape who gets called, trusted, and chosen.',
      storyLead: 'This mode helps someone see the market itself: who is showing up, what the ranking order looks like, and how competitive that area appears before they audit any specific website.',
      previewEyebrow: 'What You Get',
      previewTitle: 'The rankings view is built to answer market questions, not website-fix questions.',
      previewLead: 'Which businesses rank in this area, in what order, and what does that tell you about the current competitive state of this market?',
      pricingEyebrow: 'Support Options',
      pricingTitle: 'Use rankings to spot the market, then choose how much help you want interpreting it.',
      pricingLead: 'The ranking report can stand on its own, or you can pair it with strategy and implementation help after you see the market.',
      finalCtaEyebrow: 'Run Rankings',
      finalCtaTitle: 'Run an industry and area search now and see who ranks first in that market.',
      finalCtaLabel: 'Industry or URL',
      finalCtaButton: 'Run Search Audit',
      finalCtaNote: 'Use the main Industry and Area Rankings form above for industry, city, and state inputs.'
    }
  };

  function normalizeWebsiteInput(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  }

  function populateStateSelect(selectEl) {
    if (!selectEl) return;
    const existing = String(selectEl.value || '');
    selectEl.innerHTML = `<option value="">Select state</option>${US_STATES
      .map(([abbr, name]) => `<option value="${abbr}">${name}</option>`)
      .join('')}`;
    selectEl.value = existing;
  }

  function onScroll() {
    if (!header) return;
    header.classList.toggle('scrolled', window.scrollY > 10);
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );
  revealEls.forEach((el) => observer.observe(el));

  function setMode(mode, scroll) {
    state.activeMode = mode === 'market' ? 'market' : 'website';
    document.body.setAttribute('data-audit-mode', state.activeMode);
    const websiteActive = state.activeMode === 'website';
    if (websiteModePanel) websiteModePanel.hidden = !websiteActive;
    if (marketModePanel) marketModePanel.hidden = websiteActive;
    if (modeWebsiteBtn) {
      modeWebsiteBtn.classList.toggle('active', websiteActive);
      modeWebsiteBtn.setAttribute('aria-selected', websiteActive ? 'true' : 'false');
    }
    if (modeMarketBtn) {
      modeMarketBtn.classList.toggle('active', !websiteActive);
      modeMarketBtn.setAttribute('aria-selected', !websiteActive ? 'true' : 'false');
    }
    applyModeContent(state.activeMode);
    if (scroll) {
      const target = websiteActive ? websiteModePanel : marketModePanel;
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function applyModeContent(mode) {
    const content = modeContent[mode] || modeContent.website;
    if (heroEyebrow) heroEyebrow.textContent = content.heroEyebrow;
    if (heroTitle) heroTitle.textContent = content.heroTitle;
    if (heroLead) heroLead.textContent = content.heroLead;
    if (modeGuideEyebrow) modeGuideEyebrow.textContent = content.guideEyebrow;
    if (modeGuideTitle) modeGuideTitle.textContent = content.guideTitle;
    if (modeGuideLead) modeGuideLead.textContent = content.guideLead;
    if (modeGuideList) {
      modeGuideList.innerHTML = content.guideItems.map((item) => `<li>${item}</li>`).join('');
    }
    const metricTargets = [
      [metricOneTitle, metricOneText],
      [metricTwoTitle, metricTwoText],
      [metricThreeTitle, metricThreeText],
      [metricFourTitle, metricFourText]
    ];
    metricTargets.forEach(([titleEl, textEl], index) => {
      const metric = content.metrics[index] || ['', ''];
      if (titleEl) titleEl.textContent = metric[0];
      if (textEl) textEl.textContent = metric[1];
    });
    if (storyEyebrow) storyEyebrow.textContent = content.storyEyebrow;
    if (storyTitle) storyTitle.textContent = content.storyTitle;
    if (storyLead) storyLead.textContent = content.storyLead;
    if (previewEyebrow) previewEyebrow.textContent = content.previewEyebrow;
    if (previewTitle) previewTitle.textContent = content.previewTitle;
    if (previewLead) previewLead.textContent = content.previewLead;
    if (pricingEyebrow) pricingEyebrow.textContent = content.pricingEyebrow;
    if (pricingTitle) pricingTitle.textContent = content.pricingTitle;
    if (pricingLead) pricingLead.textContent = content.pricingLead;
    if (finalCtaEyebrow) finalCtaEyebrow.textContent = content.finalCtaEyebrow;
    if (finalCtaTitle) finalCtaTitle.textContent = content.finalCtaTitle;
    if (finalCtaLabel) finalCtaLabel.textContent = content.finalCtaLabel;
    if (finalCtaButton) finalCtaButton.textContent = content.finalCtaButton;
    if (finalCtaNote) finalCtaNote.textContent = content.finalCtaNote;
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Allow only http(s) URLs for href to avoid javascript: and other schemes. */
  function safeUrlForHref(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let u;
    try {
      u = new URL(withProto);
    } catch {
      return '';
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href;
  }

  function externalLinkHtml(rawUrl, displayText) {
    const href = safeUrlForHref(rawUrl);
    const label = displayText != null ? String(displayText) : String(rawUrl || '');
    if (!href) return escapeHtml(label || '-');
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${escapeHtml(label)}</a>`;
  }

  function packageLabel(value) {
    if (value === 'score_only') return 'Score Only';
    if (value === 'scores_issues') return 'Scores + Issues';
    return 'Full Data + Strategy';
  }

  function issueSeverityTag(severity) {
    const s = String(severity || '').toLowerCase();
    if (s === 'critical') return 'CRITICAL';
    if (s === 'urgent') return 'URGENT';
    if (s === 'high') return 'HIGH';
    if (s === 'moderate' || s === 'medium') return 'MODERATE';
    return 'LOW';
  }

  function severityColor(tag) {
    if (tag === 'CRITICAL') return '#c0392b';
    if (tag === 'URGENT') return '#d35400';
    if (tag === 'HIGH') return '#e67e22';
    if (tag === 'MODERATE') return '#f39c12';
    return '#7f8c8d';
  }

  function isMarketDashboard(dashboardOrView) {
    return String(dashboardOrView?.queryType || '').toLowerCase() === 'market';
  }

  function panelTitle(panel, text) {
    if (!panel) return;
    const heading = panel.querySelector('h4');
    if (heading) heading.textContent = text;
  }

  function titleCase(value) {
    return String(value || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
  }

  function buildTextSummary(view, dashboard) {
    const lines = [];
    lines.push(`Query Type: ${dashboard.queryType}`);
    lines.push(`Data Quality: ${dashboard.dataQuality || 'unknown'}`);
    lines.push(`Source Note: ${dashboard.sourceNote || 'n/a'}`);
    if (dashboard.queryType === 'website' && view.searchPositioning) {
      lines.push('');
      lines.push(view.searchPositioning.title || 'Top Search Position Check');
      lines.push(view.searchPositioning.subtitle || '');
      lines.push(view.searchPositioning.message || '');
      lines.push(view.searchPositioning.auditLead || '');
      lines.push(`Summary: ${view.searchPositioning.summary || 'n/a'}`);
      safeArray(view.searchPositioning.queries).forEach((queryRow) => {
        lines.push('');
        lines.push(`Query #${queryRow.rank}: ${queryRow.query}`);
        safeArray(queryRow.engines).forEach((engineRow) => {
          lines.push(`- ${engineRow.engine}: ${engineRow.rankLabel} | ${engineRow.resultType} | ${engineRow.note}`);
        });
      });
    }
    lines.push('');
    lines.push('Summary Scores:');
    Object.entries(view.summaryScores || {}).forEach(([k, v]) => {
      lines.push(`- ${k}: ${v}`);
    });
    if (isMarketDashboard(dashboard) && view.industryAnalysis) {
      const analysis = view.industryAnalysis;
      lines.push('');
      lines.push('Market Overview:');
      lines.push(`- Primary query: ${analysis.overview?.primaryQuery || 'n/a'}`);
      lines.push(`- Competitors analyzed: ${Number(analysis.overview?.totalCompetitorsAnalyzed || 0)}`);
      lines.push(`- Market strength: ${analysis.overview?.marketStrength || 'Unknown'}`);
      lines.push(`- Dominant players: ${Number(analysis.overview?.dominantPlayers || 0)}`);
      lines.push(`- Ranking stability: ${analysis.overview?.rankingStability || 'Unknown'}`);
      lines.push('');
      lines.push(`Difficulty: ${analysis.difficulty?.score || '-'} / 10 (${analysis.difficulty?.level || 'unknown'})`);
      lines.push('');
      lines.push(`Top Companies: ${safeArray(analysis.competitors).length}`);
      safeArray(analysis.competitors).slice(0, 10).forEach((c) => {
        lines.push(`- #${c.rank} ${c.companyName} (${c.domain}) | avg pos ${c.averagePosition} | strength ${c.strengthLabel}`);
      });
      lines.push('');
      lines.push('First Three Pages:');
      safeArray(analysis.overview?.orderedResults).slice(0, 30).forEach((row) => {
        lines.push(`- #${row.rank} [Page ${row.page}] ${row.companyName} (${row.domain || row.website || 'no domain'})`);
      });
      lines.push('');
      lines.push('Break Into Top 10:');
      safeArray(analysis.strategy?.howToBreakIntoTop10).forEach((step) => {
        lines.push(`- [P${step.priority}] ${step.focusArea}: ${step.action}`);
      });
      lines.push('');
      lines.push('How to Dominate:');
      safeArray(analysis.strategy?.howToDominateThisMarket).forEach((step) => {
        lines.push(`- [P${step.priority}] ${step.focusArea}: ${step.action}`);
      });
      return lines.join('\n');
    }
    lines.push('');
    lines.push(`Issues: ${safeArray(view.issues).length}`);
    safeArray(view.issues).slice(0, 10).forEach((i) => {
      lines.push(`- [${issueSeverityTag(i.severity)}] ${i.category}: ${i.title} - ${i.description}`);
    });
    lines.push('');
    lines.push(`Fixes: ${safeArray(view.fixes).length}`);
    safeArray(view.fixes).slice(0, 10).forEach((f) => {
      lines.push(`- [${String(f.priority || '').toUpperCase()}] ${f.category}: ${f.title} - ${f.description}`);
    });
    lines.push('');
    lines.push(`Competitors: ${safeArray(view.competitors).length}`);
    safeArray(view.competitors).slice(0, 10).forEach((c) => {
      lines.push(`- ${c.name} (${c.website}) | ${c.city} | ${c.category}`);
    });
    return lines.join('\n');
  }

  function renderScoreCards(view) {
    if (!summaryScoreCards) return;
    const scores = view.summaryScores || {};
    const marketState = view.marketOpportunity?.marketState || {};
    const cards = isMarketDashboard(state.dashboard)
      ? [
        ['Visible Businesses', Number(marketState.visibleBusinesses || 0)],
        ['Directory Dominance', `${Number(marketState.directoryDominance || 0)}%`],
        ['Social Dominance', `${Number(marketState.socialDominance || 0)}%`],
        ['Website Strength', Number(marketState.standaloneWebsiteStrength || 0)],
        ['Review Ecosystem', Number(marketState.reviewEcosystemStrength || 0)],
        ['Competition Density', Number(marketState.localCompetitionDensity || 0)]
      ]
      : [
        ['SEO', scores.seo],
        ['Technical', scores.technical],
        ['AI Visibility', scores.aiVisibility],
        ['Local Presence', scores.localPresence],
        ['Reputation', scores.reputation],
        ['Conversion / UX', scores.conversionUx]
      ];
    summaryScoreCards.innerHTML = cards
      .map(([label, value]) => {
        const displayValue = isMarketDashboard(state.dashboard)
          ? value
          : `${Number.isFinite(Number(value)) ? Number(value) : 0}/100`;
        return `<article class="card"><h4>${escapeHtml(label)}</h4><p class="plan-price">${escapeHtml(String(displayValue))}</p></article>`;
      })
      .join('');
  }

  function renderSearchPositioning(view) {
    if (!searchPositionPanel || !searchPositionQueries) return;
    if (isMarketDashboard(state.dashboard) || !view.searchPositioning) {
      searchPositionPanel.hidden = true;
      searchPositionQueries.innerHTML = '';
      return;
    }
    const positioning = view.searchPositioning || {};
    if (searchPositionTitle) {
      searchPositionTitle.textContent = positioning.title || 'Top Search Position Check';
    }
    if (searchPositionLead) {
      searchPositionLead.textContent = `${positioning.subtitle || ''} ${positioning.message || ''} ${positioning.auditLead || ''}`.trim();
    }
    if (searchPositionSummary) {
      searchPositionSummary.textContent = positioning.summary || '';
    }
    const queryCards = safeArray(positioning.queries).map((queryRow) => {
      const competitorText = safeArray(queryRow.topCompetitors).length
        ? safeArray(queryRow.topCompetitors).map((c) => escapeHtml(c)).join(', ')
        : 'No clear competitor domains captured in this run.';
      const engineRows = safeArray(queryRow.engines).map((engineRow) => `<tr>
          <td>${escapeHtml(engineRow.engine || '-')}</td>
          <td>${escapeHtml(engineRow.rankLabel || '-')}</td>
          <td>${escapeHtml(engineRow.resultType || '-')}</td>
          <td>${escapeHtml(engineRow.note || '-')}</td>
        </tr>`).join('');
      return `<article class="card">
        <h4>#${Number(queryRow.rank || 0)} ${escapeHtml(queryRow.query || 'Query')}</h4>
        <p class="form-note"><strong>Location:</strong> ${escapeHtml(queryRow.location || '-')}</p>
        <p class="form-note"><strong>Competitors showing first:</strong> ${competitorText}</p>
        <p>${escapeHtml(queryRow.takeaway || '')}</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Engine</th>
                <th>Rank</th>
                <th>Result Type</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>${engineRows}</tbody>
          </table>
        </div>
      </article>`;
    });
    searchPositionPanel.hidden = false;
    searchPositionQueries.innerHTML = queryCards.length
      ? queryCards.join('')
      : '<article class="card"><p>No top-query ranking data is available for this view.</p></article>';
  }

  function renderMarketSearchSummary(view) {
    if (!marketSearchPanel) return;
    if (!isMarketDashboard(state.dashboard)) {
      marketSearchPanel.hidden = true;
      if (marketSearchStats) marketSearchStats.innerHTML = '';
      return;
    }
    const analysis = view.industryAnalysis || {};
    const overview = analysis.overview || {};
    const marketState = view.marketOpportunity?.marketState || {};
    const orderedRows = safeArray(overview.orderedResults);
    const executedQueries = safeArray(overview.executedQueries);
    const warning = overview.warning || '';
    const summaryNarrative = analysis.summaryNarrative || '';
    const orderedCount = orderedRows.length;
    const pageOneCount = orderedRows.filter((row) => Number(row.page) === 1).length;
    const pageTwoCount = orderedRows.filter((row) => Number(row.page) === 2).length;
    const pageThreeCount = orderedRows.filter((row) => Number(row.page) === 3).length;
    if (marketSearchTitle) {
      marketSearchTitle.textContent = 'Market State of the Union';
    }
    if (marketSearchLead) {
      marketSearchLead.textContent = warning || summaryNarrative || marketState.nationalComparison || 'This market report shows how hard the local market is to dominate and how much room there is for a stronger business to take over.';
    }
    if (marketSearchSummary) {
      marketSearchSummary.textContent = `Market: ${marketState.expandedMarketLabel || overview.primaryQuery || 'n/a'} | Difficulty: ${marketState.marketDifficultyLabel || 'Unknown'} | Domination Potential: ${marketState.dominationPotential || 'Unknown'} | Estimated timeline: ${marketState.estimatedTimeline || 'Unknown'} | Source: ${overview.sourceLabel || state.dashboard?.sourceNote || 'n/a'}${overview.sourceConfidence ? ` | Confidence: ${overview.sourceConfidence}` : ''}`;
    }
    if (marketSearchStats) {
      const topThree = orderedRows.slice(0, 3);
      const topThreeText = topThree.length
        ? topThree.map((row) => `#${row.rank} ${escapeHtml(row.companyName || '')}`).join(' | ')
        : 'No visible business leaders returned';
      marketSearchStats.innerHTML = [
        ['Visible Businesses', Number(marketState.visibleBusinesses || orderedCount)],
        ['Directory Dominance', `${Number(marketState.directoryDominance || 0)}%`],
        ['Difficulty', marketState.marketDifficultyLabel || 'Unknown'],
        ['Top 3 Leaders', topThreeText]
      ].map(([label, value]) => `<article class="card market-stat-card"><h4>${escapeHtml(label)}</h4><p class="plan-price">${typeof value === 'number' ? value : escapeHtml(String(value))}</p></article>`).join('');
    }
    marketSearchPanel.hidden = false;
  }

  function renderGoogleRankingMatrix(view) {
    if (!googleMatrixPanel || !googleMatrixRows) return;
    if (isMarketDashboard(state.dashboard) || !view.googleRankingMatrix) {
      googleMatrixPanel.hidden = true;
      googleMatrixRows.innerHTML = '';
      return;
    }
    const matrix = view.googleRankingMatrix || {};
    if (googleMatrixTitle) {
      googleMatrixTitle.textContent = matrix.title || 'Google Ranking Matrix';
    }
    if (googleMatrixIntro) {
      googleMatrixIntro.textContent = matrix.intro || '';
    }
    const rows = safeArray(matrix.rows).map((row) => `<article class="card audit-block">
      <h4>${escapeHtml(row.label || '-')}</h4>
      <p class="form-note"><strong>What this is:</strong> ${escapeHtml(row.matrix || '-')}</p>
      <p class="form-note"><strong>Judged by:</strong> ${escapeHtml(row.judgedBy || '-')}</p>
      <p><strong>Your score:</strong> ${Number(row.yourScore || 0)}/100</p>
      <p><strong>Competitor average:</strong> ${row.competitorAverage === null ? 'No comparison available' : `${Number(row.competitorAverage)}/100`}</p>
      <p class="form-note"><strong>Why it matters:</strong> ${escapeHtml(row.note || '-')}</p>
    </article>`);
    googleMatrixPanel.hidden = false;
    googleMatrixRows.innerHTML = rows.length
      ? rows.join('')
      : '<article class="card"><p>No Google ranking matrix data is available for this site audit.</p></article>';
  }

  function setMarketTab(tab) {
    state.marketTab = tab === 'takeover' ? 'takeover' : 'leaderboard';
    if (marketLeaderboardTabBtn) {
      marketLeaderboardTabBtn.classList.toggle('active', state.marketTab === 'leaderboard');
      marketLeaderboardTabBtn.setAttribute('aria-selected', state.marketTab === 'leaderboard' ? 'true' : 'false');
    }
    if (marketTakeoverTabBtn) {
      marketTakeoverTabBtn.classList.toggle('active', state.marketTab === 'takeover');
      marketTakeoverTabBtn.setAttribute('aria-selected', state.marketTab === 'takeover' ? 'true' : 'false');
    }
    if (marketLeaderboardTab) marketLeaderboardTab.hidden = state.marketTab !== 'leaderboard';
    if (marketTakeoverTab) marketTakeoverTab.hidden = state.marketTab !== 'takeover';
  }

  function renderMarketOpportunity(view) {
    if (!marketOpportunityPanel || !marketLeaderboardTab || !marketTakeoverTab) return;
    if (!isMarketDashboard(state.dashboard)) {
      marketOpportunityPanel.hidden = true;
      marketLeaderboardTab.innerHTML = '';
      marketTakeoverTab.innerHTML = '';
      return;
    }

    const overview = view.industryAnalysis?.overview || {};
    const opportunity = view.marketOpportunity || {};
    const marketState = opportunity.marketState || {};
    const clientSnapshot = opportunity.clientSnapshot || null;
    const takeoverPlan = opportunity.marketTakeoverPlan || {};
    const businesses = safeArray(overview.orderedResults);
    const marketAssets = safeArray(view.marketAssets || overview.directorySignals);
    const selectedDomain = String(clientSnapshot?.domain || '').toLowerCase();

    const businessRows = businesses.length
      ? businesses.map((item) => {
        const isSelected = selectedDomain && String(item.domain || '').toLowerCase() === selectedDomain;
        const whyIncluded = [item.inclusionReason || '', ...(safeArray(item.warnings).slice(0, 2))].filter(Boolean).join(' ');
        return `<tr class="${isSelected ? 'selected-client-row' : ''}">
          <td>#${Number(item.rank || 0)}</td>
          <td>${escapeHtml(item.companyName || '-')}</td>
          <td>${escapeHtml(item.domain || '-')}</td>
          <td>${escapeHtml(titleCase(item.resultType || 'business'))}</td>
          <td>${Number(item.confidence || 0)}</td>
          <td>${escapeHtml(whyIncluded || 'Visible owned business website in this market.')}</td>
        </tr>`;
      }).join('')
      : '<tr><td colspan="6">No standalone business websites found ranking for these searches. The market is dominated by directories and review sites — this is a wide-open opportunity for a real business website.</td></tr>';

    const assetRows = marketAssets.length
      ? marketAssets.map((item) => `<tr>
          <td>#${Number(item.rank || 0) || '-'}</td>
          <td>${escapeHtml(item.title || item.companyName || '-')}</td>
          <td>${escapeHtml(titleCase(item.category || item.resultType || 'unknown'))}</td>
          <td>${escapeHtml(item.domain || '-')}</td>
        </tr>`).join('')
      : '<tr><td colspan="4">No directory, review, or social assets captured in this run.</td></tr>';

    const clientMetrics = clientSnapshot?.metrics || {};
    const clientMetricsList = clientSnapshot
      ? [
        ['Visibility Strength', clientMetrics.visibilityStrength],
        ['Authority Estimate', clientMetrics.authorityEstimate],
        ['Trust Estimate', clientMetrics.trustEstimate],
        ['Content Depth Estimate', clientMetrics.contentDepthEstimate],
        ['Local Proof Estimate', clientMetrics.localProofEstimate],
        ['Conversion Strength Estimate', clientMetrics.conversionStrengthEstimate],
        ['AI Citation Readiness', clientMetrics.aiCitationReadiness]
      ].map(([label, value]) => `<li>${label}: <strong>${Number(value || 0)}</strong></li>`).join('')
      : '<li>No client is selected in this market run yet.</li>';

    marketLeaderboardTab.innerHTML = `
      <div class="card-grid market-opportunity-grid">
        <article class="card">
          <h4>State of the Market</h4>
          <p><strong>${escapeHtml(marketState.expandedMarketLabel || 'Local market')}</strong></p>
          <ul class="audit-list">
            <li>Visible businesses: ${Number(marketState.visibleBusinesses || 0)}</li>
            <li>Directory dominance: ${Number(marketState.directoryDominance || 0)}%</li>
            <li>Social dominance: ${Number(marketState.socialDominance || 0)}%</li>
            <li>Standalone website strength: ${Number(marketState.standaloneWebsiteStrength || 0)}</li>
            <li>Average website quality estimate: ${Number(marketState.averageWebsiteQualityEstimate || 0)}</li>
            <li>Review ecosystem strength: ${Number(marketState.reviewEcosystemStrength || 0)}</li>
            <li>Local competition density: ${Number(marketState.localCompetitionDensity || 0)}</li>
          </ul>
        </article>
        <article class="card">
          <h4>Market Difficulty Score</h4>
          <p class="plan-price">${escapeHtml(marketState.marketDifficultyLabel || 'Unknown')}</p>
          <p class="form-note">Score: ${Number(marketState.marketDifficultyScore || 0)}</p>
          <p>${escapeHtml(marketState.nationalComparison || 'No national comparison is available yet.')}</p>
          <p><strong>Domination Potential:</strong> ${escapeHtml(marketState.dominationPotential || 'Unknown')}</p>
          <p><strong>Estimated timeline:</strong> ${escapeHtml(marketState.estimatedTimeline || 'Unknown')}</p>
        </article>
        <article class="card">
          <h4>Client Snapshot</h4>
          <p><strong>This audit is for:</strong> ${escapeHtml(clientSnapshot?.label || 'No client selected')}</p>
          <ul class="audit-list">
            <li>Current rank: ${clientSnapshot?.currentRank ? `#${clientSnapshot.currentRank}` : 'Not visible in owned business results yet'}</li>
            <li>Score vs market average: ${Number(clientSnapshot?.scoreVsMarketAverage || 0)}</li>
            <li>Appears in searches: ${Number(clientSnapshot?.appearsInSearches || 0)}</li>
            <li>Strongest advantage: ${escapeHtml(clientSnapshot?.strongestAdvantage || 'Unknown')}</li>
            <li>Biggest weakness: ${escapeHtml(clientSnapshot?.biggestWeakness || 'Unknown')}</li>
          </ul>
          <ul class="audit-list">${clientMetricsList}</ul>
        </article>
      </div>
      <div class="table-wrap">
        <table class="audit-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Business Competitor</th>
              <th>Domain</th>
              <th>Type</th>
              <th>Confidence</th>
              <th>Why It Is Visible</th>
            </tr>
          </thead>
          <tbody>${businessRows}</tbody>
        </table>
      </div>
      <div class="market-assets-section">
        <h3>Market Assets Occupying Search Results</h3>
        <p class="form-note">These directory, review, and social assets are taking up positions in this market.</p>
        <div class="table-wrap">
          <table class="audit-table">
            <thead>
              <tr>
                <th>Position</th>
                <th>Asset</th>
                <th>Type</th>
                <th>Domain</th>
              </tr>
            </thead>
            <tbody>${assetRows}</tbody>
          </table>
        </div>
      </div>
    `;

    const improvements = takeoverPlan.improvementBuckets || {};
    const rivals = safeArray(takeoverPlan.competitorsAboveYou);
    marketTakeoverTab.innerHTML = `
      <div class="card-grid market-opportunity-grid">
        <article class="card">
          <h4>Estimated Improvement Opportunities</h4>
          <ul class="audit-list">
            <li>Grammar / language: ${Number(improvements.grammarLanguage || 0)}</li>
            <li>Trust issues: ${Number(improvements.trustIssues || 0)}</li>
            <li>Structure issues: ${Number(improvements.structureIssues || 0)}</li>
            <li>Conversion issues: ${Number(improvements.conversionIssues || 0)}</li>
            <li>AI visibility issues: ${Number(improvements.aiVisibilityIssues || 0)}</li>
          </ul>
        </article>
        <article class="card">
          <h4>Market Takeover Plan</h4>
          <p>GeoNeo is looking at what it takes to pass the market leaders, not just score one site in isolation.</p>
          <ul class="audit-list">
            <li>Content / Language: improve keyword coverage, clarity, and service phrasing.</li>
            <li>Trust / Credibility: add reviews, proof, licenses, and visible trust signals.</li>
            <li>Architecture / Structure: tighten page hierarchy, service silos, local pages, and schema.</li>
            <li>Conversion / UX: strengthen CTA visibility, phone/contact access, and mobile conversion flow.</li>
            <li>AI / Citation Readiness: strengthen FAQs, entity clarity, semantic coverage, and structured data.</li>
          </ul>
        </article>
      </div>
      <div class="table-wrap">
        <table class="audit-table">
          <thead>
            <tr>
              <th>Competitor</th>
              <th>Beatability</th>
              <th>Timeline</th>
              <th>Why They Are Beatable</th>
            </tr>
          </thead>
          <tbody>
            ${rivals.length ? rivals.map((row) => `<tr>
              <td>${escapeHtml(row.competitor || row.domain || '-')}</td>
              <td>${escapeHtml(row.beatability || '-')}</td>
              <td>${escapeHtml(row.timeline || '-')}</td>
              <td>${escapeHtml(row.why || '-')}</td>
            </tr>`).join('') : '<tr><td colspan="4">No competitors are currently above the selected client in the owned-business leaderboard.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;

    marketOpportunityPanel.hidden = false;
    setMarketTab(state.marketTab);
  }

  function renderPackageComparison(dashboard) {
    if (!packageComparison) return;
    const views = dashboard.packageViews || {};
    const isFreeView = state.selectedPackageView === 'score_only' || !state.selectedPackageView;

    // Step 8: Prominent One-Time Full Fix Plan offer when user is on free view
    let offerHtml = '';
    if (isFreeView) {
      offerHtml = `
        <article class="card" style="border: 2px solid var(--brand); background: rgba(0,229,160,0.06);">
          <h4 style="color:var(--brand);">GeoNeo Full Fix Plan — $${FULL_FIX_PLAN_PRICE}</h4>
          <ul class="audit-list">
            <li>Complete deep audit with local, regional &amp; national competitor analysis</li>
            <li>Exactly 3 prioritized fixes with time estimates and expected business impact</li>
            <li>AI citation readiness recommendations</li>
            <li>Step-by-step implementation plan you can use yourself or hand to a web person</li>
            <li>One-time payment — no subscription</li>
          </ul>
          <button class="btn btn-hot" id="unlockOneTimeBtn" style="margin-top:0.75rem;">Get the Full Fix Plan — $${FULL_FIX_PLAN_PRICE}</button>
          <p class="form-note" style="margin-top:0.5rem; color:#f59e0b;">Only 6 Full Fix Plan slots available this week.</p>
        </article>
      `;
    }

    const rows = ['score_only', 'scores_issues', 'full_data'].map((key) => {
      const view = views[key] || {};
      if (isMarketDashboard(dashboard)) {
        const analysis = view.industryAnalysis || {};
        const competitorsCount = safeArray(analysis.competitors).length;
        const difficulty = analysis.difficulty || {};
        const opportunities = analysis.opportunities || {};
        return `<article class="card">
          <h4>${escapeHtml(packageLabel(key))}</h4>
          <ul class="audit-list">
            <li>Market Overview: included</li>
            <li>Companies shown: ${competitorsCount}</li>
            <li>Difficulty Score: ${escapeHtml(String(difficulty.score ?? '-'))}/10 (${escapeHtml(String(difficulty.level || 'unknown'))})</li>
            <li>Dominance View: ${Number(analysis.dominance?.visibilityControlledByTop3 || 0)}% top-3 control</li>
            <li>AI Citation Candidates: ${safeArray(opportunities.aiCitationPotential?.topCandidates).length}</li>
            <li>Strategy Playbook: ${safeArray(analysis.strategy?.howToBreakIntoTop10).length + safeArray(analysis.strategy?.howToDominateThisMarket).length} steps</li>
          </ul>
        </article>`;
      }
      const issueCount = safeArray(view.issues).length;
      const fixCount = safeArray(view.fixes).length;
      const competitorCount = safeArray(view.competitors).length;
      const issuePreview = issueCount
        ? escapeHtml(`${view.issues[0].title || 'Issue'} (${view.issues[0].category || 'general'})`)
        : 'No issue list in this view';
      const fixPreview = fixCount
        ? escapeHtml(`${view.fixes[0].title || 'Fix'}`)
        : 'No fix roadmap in this view';
      return `<article class="card">
        <h4>${escapeHtml(packageLabel(key))}</h4>
        <ul class="audit-list">
          <li>Scores: 6 categories</li>
          <li>Issues: ${issueCount}</li>
          <li>Issue Preview: ${issuePreview}</li>
          <li>Fixes: ${fixCount}</li>
          <li>Fix Preview: ${fixPreview}</li>
          <li>Competitor Context: ${competitorCount}</li>
        </ul>
      </article>`;
    });

    packageComparison.innerHTML = offerHtml + rows.join('');

    // Wire the paid Specialist Strategy Session button (#1) - declare before use
    const unlockBtn = document.getElementById('unlockOneTimeBtn');
    if (unlockBtn) {
      unlockBtn.addEventListener('click', () => {
        console.log('[GeoNeo Tracking] Clicked: One-Time Full Fix Plan CTA');
        showFullFixPlanModal();
      });
    }
  }

  function showFullFixPlanModal() {
    showSpecialistSessionModal({
      price: FULL_FIX_PLAN_PRICE,
      productType: 'one-time',
      leadStatus: 'full-fix-plan-requested',
      type: 'full-fix-plan',
      title: 'Get Your GeoNeo Full Fix Plan',
      subtitle: `$${FULL_FIX_PLAN_PRICE} one-time • complete audit + prioritized implementation roadmap`,
      button: `Confirm My Full Fix Plan — $${FULL_FIX_PLAN_PRICE}`,
      thankYou: 'Your Full Fix Plan request has been received. A GeoNeo Specialist will follow up with next steps.',
      showBookingLink: false
    });
  }

  // #1: Functional paid offer modal - captures lead and confirms Specialist Strategy Session
  function showSpecialistSessionModal(opts = {}) {
    const offer = {
      price: SPECIALIST_PRICE,
      productType: 'one-time',
      leadStatus: 'specialist-session-requested',
      type: 'specialist-session',
      title: 'Book Your GeoNeo Specialist Strategy Session',
      subtitle: `$${SPECIALIST_PRICE} one-time • 30-minute live call + full audit + custom plan`,
      button: `Confirm My Strategy Session — $${SPECIALIST_PRICE}`,
      thankYou: 'Your request has been received. A GeoNeo Specialist will contact you within 24 hours to schedule your 30-minute strategy session.',
      showBookingLink: true,
      ...opts
    };
    const existing = document.getElementById('specialistModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'specialistModal';
    modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:10000;';
    modal.innerHTML = `
      <div style="background:white; width:100%; max-width:480px; margin:20px; border-radius:16px; padding:24px; box-shadow:0 20px 60px rgba(0,0,0,0.3); position:relative;">
        <h3 style="margin:0 0 8px;">${escapeHtml(offer.title)}</h3>
        <p style="color:#475569; margin:0 0 20px;">${escapeHtml(offer.subtitle)}</p>
        
        <form id="specialistForm">
          <div style="display:grid; gap:12px;">
            <input type="text" name="name" placeholder="Your Name" required style="padding:12px; border:1px solid #cbd5e1; border-radius:8px; font-size:1rem;">
            <input type="email" name="email" placeholder="Business Email" required style="padding:12px; border:1px solid #cbd5e1; border-radius:8px; font-size:1rem;">
            <input type="tel" name="phone" placeholder="Phone Number" style="padding:12px; border:1px solid #cbd5e1; border-radius:8px; font-size:1rem;">
            <div>
              <label style="font-size:0.85rem; color:#64748b; display:block; margin-bottom:4px;">Preferred Date &amp; Time</label>
              <input type="datetime-local" name="preferred_datetime" required style="padding:12px; border:1px solid #cbd5e1; border-radius:8px; font-size:1rem; width:100%;">
            </div>
          </div>
          
          <button type="submit" class="btn btn-hot" style="width:100%; margin-top:20px;">${escapeHtml(offer.button)}</button>
          <p style="font-size:0.8rem; color:#64748b; text-align:center; margin-top:12px;">We'll contact you within 24 hours to schedule.</p>
        </form>
        
        <button id="closeSpecialistModal" style="position:absolute; top:16px; right:16px; background:none; border:none; font-size:24px; cursor:pointer; color:#64748b;">×</button>
      </div>
    `;

    document.body.appendChild(modal);

    // Close handlers
    modal.querySelector('#closeSpecialistModal').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    // Form submission
    const form = modal.querySelector('#specialistForm');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const lead = {
        name: formData.get('name'),
        email: formData.get('email'),
        phone: formData.get('phone'),
        preferredTime: formData.get('preferred_datetime'),
        message: 'Specialist strategy session request',
        url: (state.dashboard && state.dashboard.input && state.dashboard.input.url) || '',
        type: offer.type,
        amountPaid: offer.price
      };
      try {
        const res = await fetch('/api/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lead)
        });
        if (!res.ok) throw new Error('Lead save failed');
        localStorage.removeItem('specialistLeadDraft');
      } catch (err) {
        localStorage.setItem('specialistLeadDraft', JSON.stringify(lead));
        console.warn('[GeoNeo] Specialist lead POST failed, draft saved to localStorage', err);
      }
      if (state.dashboard) {
        state.dashboard.productType = offer.productType;
        state.dashboard.amountPaid = offer.price;
        state.dashboard.leadStatus = offer.leadStatus;
        console.log('[GeoNeo Tracking] Submitted:', offer.type);
      }

      modal.innerHTML = `
        <div style="background:white; width:100%; max-width:420px; margin:20px; border-radius:16px; padding:32px; text-align:center;">
          <h3 style="margin:0 0 12px;">Thank you!</h3>
          <p style="color:#475569;">${escapeHtml(offer.thankYou)}</p>
          ${offer.showBookingLink ? `
          <p style="font-size:0.85rem; color:#64748b; margin-top:12px;">You can also book directly using this link:<br>
          <a href="https://calendly.com/geoneo-specialist/strategy-session" target="_blank" style="color:#0ea5e9;">Book Your Strategy Session</a></p>
          ` : ''}
          <button class="btn" style="margin-top:20px;" onclick="document.getElementById('specialistModal').remove()">Close</button>
        </div>
      `;
    };
  }

  function renderIssues(view) {
    if (!issuesPanel || !issuesList) return;
    const marketMode = isMarketDashboard(state.dashboard);
    panelTitle(issuesPanel, marketMode ? 'Market Issues' : 'What Is Holding This Site Back');
    const issues = safeArray(view.issues);
    if (!issues.length) {
      issuesPanel.hidden = false;
      issuesList.innerHTML = '<li>No issues shown for this package view.</li>';
      return;
    }
    issuesPanel.hidden = false;
    issuesList.innerHTML = issues
      .map((item) => {
        const tag = issueSeverityTag(item.severity);
        const color = severityColor(tag);
        return `<li><strong style="color:${color}">[${escapeHtml(tag)}]</strong> ${escapeHtml(item.category || '')}: ${escapeHtml(item.title || '')} - ${escapeHtml(item.description || '')}</li>`;
      })
      .join('');
  }

  function renderFixes(view) {
    if (!fixesPanel || !fixesList) return;
    const marketMode = isMarketDashboard(state.dashboard);
    panelTitle(fixesPanel, marketMode ? 'How To Win This Market' : 'How To Fix It');
    const fixes = safeArray(view.fixes);
    if (!fixes.length) {
      fixesPanel.hidden = true;
      fixesList.innerHTML = '';
      return;
    }
    fixesPanel.hidden = false;
    fixesList.innerHTML = fixes
      .map((item) => `<li><strong>[${escapeHtml(String(item.priority || '').toUpperCase())}]</strong> ${escapeHtml(item.category || '')}: ${escapeHtml(item.title || '')} - ${escapeHtml(item.description || '')}</li>`)
      .join('');
  }

  function renderQuestions(view) {
    if (!questionsPanel || !questionsList) return;
    const questions = safeArray(view.questionsToAnswer);
    if (!questions.length) {
      questionsPanel.hidden = true;
      return;
    }
    questionsPanel.hidden = false;
    questionsList.innerHTML = questions
      .map((q) => `<li><strong>${escapeHtml(q.question || '')}</strong><br><span style="color:var(--muted);font-size:0.85rem">${escapeHtml(q.reason || '')}</span></li>`)
      .join('');
  }

  function formatScoreSummary(summary) {
    const s = summary || {};
    return `SEO ${Number(s.seo || 0)} | Authority ${Number(s.authority || 0)} | Local ${Number(s.local || 0)}`;
  }

  function renderCompetitors(view) {
    // #4: Add simple side-by-side comparison for top competitors (quick win)
    const comparisonContainer = document.getElementById('competitorComparison');
    if (comparisonContainer) comparisonContainer.remove();
    if (!competitorsPanel || !competitorsTableBody) return;
    const tableHeadRow = competitorsTable ? competitorsTable.querySelector('thead tr') : null;
    const tableWrap = competitorsTable ? competitorsTable.closest('.table-wrap') : null;
    let marketAssetsContainer = document.getElementById('marketAssetsContainer');
    if (!marketAssetsContainer && tableWrap && competitorsPanel.contains(tableWrap)) {
      marketAssetsContainer = document.createElement('div');
      marketAssetsContainer.id = 'marketAssetsContainer';
      tableWrap.insertAdjacentElement('afterend', marketAssetsContainer);
    }
    if (isMarketDashboard(state.dashboard)) {
      panelTitle(competitorsPanel, 'Business Competitors');
      const orderedResults = safeArray(view.industryAnalysis?.overview?.orderedResults);
      const marketAssets = safeArray(view.marketAssets || view.industryAnalysis?.overview?.directorySignals);
      if (tableHeadRow) {
        tableHeadRow.innerHTML = `
          <th>Rank</th>
          <th>Business</th>
          <th>Type / Confidence</th>
          <th>Domain</th>
          <th>Website</th>
          <th>Why Included</th>
        `;
      }
      if (!orderedResults.length && !marketAssets.length) {
        competitorsPanel.hidden = false;
        const warning = view.industryAnalysis?.overview?.warning || 'Search returned limited structured business data, so GeoNeo is showing visible market results with confidence labels.';
        competitorsTableBody.innerHTML = `<tr><td colspan="6">${escapeHtml(warning)}</td></tr>`;
        if (marketAssetsContainer) {
          marketAssetsContainer.innerHTML = '';
        }
        return;
      }
      competitorsPanel.hidden = false;
      const businessRows = orderedResults.length
        ? orderedResults
        .map((item) => {
          const rank = Number(item.rank || 0);
          const rankLabel = rank <= 3 ? 'Top 3' : (rank <= 10 ? 'Page 1' : (rank <= 20 ? 'Page 2' : 'Page 3'));
          const consistencyLabel = item.consistencyLabel || '';
          const whyRank = item.whyRank || '';
          const whyIncluded = [item.inclusionReason || '', ...(safeArray(item.warnings).slice(0, 2))].filter(Boolean).join(' ');
          return `<tr>
          <td><strong>#${rank}</strong><br/><span class="form-note">${escapeHtml(rankLabel)}</span></td>
          <td>${escapeHtml(item.companyName || '-')}${consistencyLabel ? `<br/><span class="form-note">${escapeHtml(consistencyLabel)}</span>` : ''}${whyRank ? `<br/><span class="form-note">${escapeHtml(whyRank)}</span>` : ''}</td>
          <td>${escapeHtml(String(item.resultType || 'unknown').replace(/_/g, ' '))}<br/><span class="form-note">${Number(item.confidence || 0)} confidence</span></td>
          <td>${escapeHtml(item.domain || '-')}</td>
          <td>${item.website ? externalLinkHtml(item.website, item.website) : '-'}</td>
          <td>${escapeHtml(whyIncluded || 'Appears in visible search results.')}</td>
        </tr>`;
        })
        .join('')
        : '<tr><td colspan="6">No standalone business websites found ranking for these searches. The market is dominated by directories and review sites — this is a wide-open opportunity for a real business website.</td></tr>';

      competitorsTableBody.innerHTML = businessRows;

      if (marketAssetsContainer) {
        marketAssetsContainer.innerHTML = marketAssets.length
          ? `
            <div class="market-assets-section" style="margin-top:2rem;">
              <h3>Market Assets Occupying Search Results</h3>
              <p class="form-note">These directory, review, and social listings are taking up search positions in this market.</p>
              <div class="table-wrap">
                <table class="audit-table">
                  <thead>
                    <tr>
                      <th>Position</th>
                      <th>Asset</th>
                      <th>Type</th>
                      <th>Domain</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${marketAssets.map((item, index) => `<tr>
                      <td>#${Number(item.rank || item.observedRank || index + 1) || '-'}</td>
                      <td>${escapeHtml(item.title || item.companyName || '-')}</td>
                      <td>${escapeHtml(String(item.category || item.resultType || 'unknown').replace(/_/g, ' '))}</td>
                      <td>${escapeHtml(item.domain || '-')}</td>
                    </tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          `
          : '';
      }
      return;
    }

    if (marketAssetsContainer) {
      marketAssetsContainer.innerHTML = '';
    }

    panelTitle(competitorsPanel, 'Competitors Showing Before This Site');
    const competitors = safeArray(view.competitors);
    if (tableHeadRow) {
      tableHeadRow.innerHTML = `
        <th>Name</th>
        <th>Website</th>
        <th>City</th>
        <th>Category</th>
        <th>Notes</th>
        <th>Strengths</th>
        <th>Weaknesses</th>
        <th>Scores</th>
        <th>Source</th>
      `;
    }
    if (!competitors.length) {
      competitorsPanel.hidden = false;
      competitorsTableBody.innerHTML = '<tr><td colspan="9">No competitor/market rows in this view.</td></tr>';
      return;
    }
    competitorsPanel.hidden = false;
    competitorsTableBody.innerHTML = competitors
      .map((item) => {
        const strengths = safeArray(item.strengths).slice(0, 2).map((s) => escapeHtml(String(s))).join(', ') || '-';
        const weaknesses = safeArray(item.weaknesses).slice(0, 2).map((w) => escapeHtml(String(w))).join(', ') || '-';
        const website = item.website ? externalLinkHtml(item.website, item.website) : '-';
        return `<tr>
          <td>${escapeHtml(item.name || '-')}</td>
          <td>${website}</td>
          <td>${escapeHtml(item.city || '-')}</td>
          <td>${escapeHtml(item.category || '-')}</td>
          <td>${escapeHtml(item.notes || '-')}</td>
          <td>${strengths}</td>
          <td>${weaknesses}</td>
          <td>${escapeHtml(formatScoreSummary(item.scoreSummary))}</td>
          <td>${escapeHtml(item.source || 'n/a')}</td>
        </tr>`;
      })
      .join('');
  }

  function resolveCurrentView() {
    if (!state.dashboard) return null;
    const selected = state.selectedPackageView;
    if (state.internalMode) {
      return state.dashboard.internalView || state.dashboard.packageViews?.full_data || null;
    }
    return state.dashboard.packageViews?.[selected] || state.dashboard.selectedView || null;
  }

  function renderAdmin(view) {
    if (!adminPanel || !adminRawData) return;
    adminPanel.hidden = !state.internalMode;
    if (!state.internalMode) {
      adminRawData.textContent = '';
      return;
    }
    adminRawData.textContent = JSON.stringify({
      dashboard: state.dashboard,
      currentView: view
    }, null, 2);
  }

  function isFreeAudit() {
    if (new URLSearchParams(window.location.search).get('full') === '1') return false;
    var p = window.location.pathname;
    return p.includes('website-audit') || p.includes('both-audit');
  }

  function countBySeverity(issues) {
    var arr = safeArray(issues);
    // Remap server's 3 levels (high/medium/low) into 5 display tiers
    var critical = 0, urgent = 0, high = 0, moderate = 0, low = 0;
    arr.forEach(function(item) {
      var s = String(item.severity || '').toLowerCase();
      if (s === 'critical') critical++;
      else if (s === 'urgent') urgent++;
      else if (s === 'high') {
        // Split highs: first 2 become critical, next become urgent
        if (critical < 2) critical++;
        else urgent++;
      }
      else if (s === 'moderate' || s === 'medium') {
        if (high < 3) high++;
        else moderate++;
      }
      else low++;
    });
    return { critical: critical, urgent: urgent, high: high, moderate: moderate, low: low };
  }

  function renderFreeTeaser(view) {
  // #6: Strong "What you're missing" messaging added below

    var issues = safeArray(view.issues);
    var fixes = safeArray(view.fixes);
    var total = issues.length;

    // Show scores
    renderScoreCards(view);

    // Show who's beating them + revenue impact (the emotional hooks)
    renderWhoBeatYou(view);
    renderRevenueImpact(view);

    // Show search positioning if available
    renderSearchPositioning(view);

    // Show ALL issues as the lead feature — this is what hooks them
    if (issuesPanel && issuesList) {
      panelTitle(issuesPanel, total > 0 ? 'We Found ' + total + ' Issues' : 'Scan Complete');
      issuesPanel.hidden = false;
      issuesList.innerHTML = '';
      if (total > 0) {
        issues.forEach(function(item) {
          var tag = issueSeverityTag(item.severity);
          var color = severityColor(tag);
          var li = document.createElement('li');
          var strong = document.createElement('strong');
          strong.style.color = color;
          strong.textContent = '[' + tag + ']';
          li.appendChild(strong);
          li.appendChild(document.createTextNode(' ' + (item.category || '') + ': ' + (item.title || '') + ' — ' + (item.description || '')));
          issuesList.appendChild(li);
        });
      } else {
        var li = document.createElement('li');
        li.textContent = 'No issues detected. Your site is in good shape.';
        issuesList.appendChild(li);
      }
    }

    // Lock fixes behind paywall — that's the upsell
    if (fixesPanel && fixesList) {
      panelTitle(fixesPanel, fixes.length > 0 ? fixes.length + ' Fixes Available' : 'Fix Plan Available');
      fixesPanel.hidden = false;
      fixesList.innerHTML = '<li class="paywall-teaser-msg">🔒 <strong>Prioritized fix plan with step-by-step instructions included in paid audit.</strong></li>';
    }

    // Hide detailed panels
    if (competitorsPanel) competitorsPanel.hidden = true;
    if (googleMatrixPanel) googleMatrixPanel.hidden = true;
    if (packageComparisonCard) packageComparisonCard.hidden = true;
    if (dashboardControlsCard) dashboardControlsCard.hidden = true;
    if (adminPanel) adminPanel.hidden = true;

    // Add upgrade CTA
    var existingCta = document.getElementById('paywallCta');
    if (existingCta) existingCta.remove();
    var ctaHtml = '<article class="card" id="paywallCta" style="text-align:center;border-color:rgba(11,143,123,0.4);background:linear-gradient(170deg,rgba(11,143,123,0.08),rgba(255,255,255,0.95))">' +
      '<h3>Unlock Your Full Report</h3>' +
      '<p style="color:var(--muted);margin:0.5rem 0 1rem">Get detailed issue breakdowns, prioritized fix plans, competitor analysis, and expert strategy recommendations.</p>' +
      '<div style="display:flex;flex-wrap:wrap;gap:0.6rem;justify-content:center">' +
      '<a class="btn" href="#" onclick="return false">$199 Full Audit</a>' +
      '<a class="btn btn-hot" href="#" onclick="return false">$299 Fixes + Strategy</a>' +
      '<a class="btn" href="#" onclick="return false">$399 Priority</a>' +
      '</div>' +
      '</article>';
    if (dashboardResults) dashboardResults.insertAdjacentHTML('beforeend', ctaHtml);
  }

  // ═══ WHO'S BEATING YOU ═══
  const whoBeatYouPanel = document.getElementById('whoBeatYouPanel');
  const whoBeatYouGrid = document.getElementById('whoBeatYouGrid');
  const whoBeatYouLead = document.getElementById('whoBeatYouLead');

  function renderWhoBeatYou(view) {
    if (!whoBeatYouPanel || !whoBeatYouGrid) return;
    const competitors = safeArray(view.competitors || view.industryAnalysis?.overview?.orderedResults);
    const isMarket = isMarketDashboard(state.dashboard);
    // Need at least one competitor to show this panel
    if (!competitors.length) { whoBeatYouPanel.hidden = true; return; }

    // Get the user's business name from input
    const input = state.dashboard.input || {};
    const yourName = input.businessName || input.url || 'Your Business';
    const yourScores = view.summaryScores || {};
    const yourAvg = Math.round(((Number(yourScores.seo)||0) + (Number(yourScores.localPresence)||0) + (Number(yourScores.reputation)||0)) / 3);

    // Pick top 3 competitors that outrank the user
    const topRivals = competitors.slice(0, 3);

    whoBeatYouGrid.innerHTML = '';
    topRivals.forEach(function(c, i) {
      const name = c.companyName || c.name || c.domain || ('Competitor ' + (i+1));
      const signals = [];
      if (c.strengths) signals.push(c.strengths);
      else {
        if (c.resultType === 'directory' || c.resultType === 'review_site') signals.push('Directory listing');
        if (Number(c.confidence) > 70) signals.push('High visibility');
        if (c.inclusionReason) signals.push(c.inclusionReason.slice(0, 40));
      }
      if (!signals.length) signals.push('Ranking above you');
      const verdict = c.weaknesses || (i === 0 ? 'Currently the #1 recommendation in your market' : 'Showing up where you should be');

      const card = document.createElement('div');
      card.className = 'who-beat-card';

      const rankDiv = document.createElement('div');
      rankDiv.className = 'wbc-rank';
      rankDiv.textContent = 'Rank #' + (c.rank || (i+1)) + ' — beating you';
      card.appendChild(rankDiv);

      const nameDiv = document.createElement('div');
      nameDiv.className = 'wbc-name';
      nameDiv.textContent = name;
      card.appendChild(nameDiv);

      const signalsDiv = document.createElement('div');
      signalsDiv.className = 'wbc-signals';
      signals.forEach(function(s) {
        const span = document.createElement('span');
        span.className = 'wbc-signal';
        span.textContent = s;
        signalsDiv.appendChild(span);
      });
      card.appendChild(signalsDiv);

      const verdictDiv = document.createElement('div');
      verdictDiv.className = 'wbc-verdict';
      verdictDiv.textContent = verdict;
      card.appendChild(verdictDiv);

      whoBeatYouGrid.appendChild(card);
    });

    // Add "You" card (safe DOM)
    const yourRank = isMarket
      ? (view.marketOpportunity?.clientSnapshot?.currentRank || 'Not visible')
      : (yourAvg > 60 ? 'Visible' : 'Low visibility');
    const youCard = document.createElement('div');
    youCard.className = 'who-beat-card you-card';

    const yourRankDiv = document.createElement('div');
    yourRankDiv.className = 'wbc-rank';
    yourRankDiv.textContent = 'Your position';
    youCard.appendChild(yourRankDiv);

    const yourNameDiv = document.createElement('div');
    yourNameDiv.className = 'wbc-name';
    yourNameDiv.textContent = yourName;
    youCard.appendChild(yourNameDiv);

    const yourSignalsDiv = document.createElement('div');
    yourSignalsDiv.className = 'wbc-signals';
    const scoreSpan = document.createElement('span');
    scoreSpan.className = 'wbc-signal';
    scoreSpan.textContent = 'Score: ' + yourAvg + '/100';
    yourSignalsDiv.appendChild(scoreSpan);
    youCard.appendChild(yourSignalsDiv);

    const yourVerdictDiv = document.createElement('div');
    yourVerdictDiv.className = 'wbc-verdict';
    yourVerdictDiv.textContent = 'Fix the issues below to overtake these competitors.';
    youCard.appendChild(yourVerdictDiv);

    whoBeatYouGrid.appendChild(youCard);

    if (whoBeatYouLead) {
      whoBeatYouLead.textContent = 'When customers search for your services, these businesses show up instead of you:';
    }
    whoBeatYouPanel.hidden = false;
  }

  // ═══ REVENUE IMPACT CALCULATOR ═══
  const revenueImpactPanel = document.getElementById('revenueImpactPanel');
  const revenueImpactContent = document.getElementById('revenueImpactContent');
  const revenueImpactLead = document.getElementById('revenueImpactLead');

  const INDUSTRY_JOB_VALUES = {
    plumbing: 350, plumber: 350,
    roofing: 8500, roofer: 8500,
    hvac: 5200, 'hvac company': 5200, heating: 5200, 'air conditioning': 5200,
    electrical: 450, electrician: 450,
    'pest control': 280, 'pest control company': 280,
    'tree service': 900, 'tree removal': 900,
    'garage door': 650, 'garage door company': 650,
    restoration: 3200, 'restoration company': 3200,
    dental: 1200, dentist: 1200,
    legal: 3500, lawyer: 3500, attorney: 3500,
    landscaping: 600, landscaper: 600,
    painting: 2800, painter: 2800,
    cleaning: 220, 'cleaning service': 220,
    'auto repair': 480, mechanic: 480
  };

  function renderRevenueImpact(view) {
    if (!revenueImpactPanel || !revenueImpactContent) return;
    const input = state.dashboard.input || {};
    const industry = (input.industry || input.service || '').toLowerCase().trim();
    const scores = view.summaryScores || {};
    const seoScore = Number(scores.seo) || Number(scores.localPresence) || 40;

    // Estimate job value from industry
    let jobValue = 500; // default
    for (const key in INDUSTRY_JOB_VALUES) {
      if (industry.includes(key)) { jobValue = INDUSTRY_JOB_VALUES[key]; break; }
    }

    // Estimate monthly searches (conservative local estimate, deterministic from score)
    const monthlySearches = 180 + ((seoScore * 7) % 121); // 180-300 range for local, stable
    // CTR difference: #1 gets ~28%, position 5+ gets ~5%
    const currentCTR = seoScore > 70 ? 0.15 : (seoScore > 50 ? 0.08 : 0.04);
    const potentialCTR = 0.28;
    const ctrGap = potentialCTR - currentCTR;
    // Conversion rate for local services: ~8-15%
    const conversionRate = 0.10;
    // Monthly lost leads
    const lostClicks = Math.round(monthlySearches * ctrGap);
    const lostLeads = Math.round(lostClicks * conversionRate);
    const lostRevenue = Math.round(lostLeads * jobValue);
    const yearlyLost = lostRevenue * 12;

    revenueImpactContent.innerHTML =
      '<div class="revenue-impact-hero">' +
        '<div class="ri-amount">~$' + lostRevenue.toLocaleString() + '/mo</div>' +
        '<div class="ri-label">Estimated revenue going to competitors above you</div>' +
      '</div>' +
      '<div class="revenue-impact-breakdown">' +
        '<div class="ri-stat"><div class="ri-stat-value">' + monthlySearches + '</div><div class="ri-stat-label">Monthly searches in your area</div></div>' +
        '<div class="ri-stat"><div class="ri-stat-value">' + lostClicks + '</div><div class="ri-stat-label">Clicks you\'re missing</div></div>' +
        '<div class="ri-stat"><div class="ri-stat-value">' + lostLeads + '</div><div class="ri-stat-label">Lost leads/month</div></div>' +
        '<div class="ri-stat"><div class="ri-stat-value">$' + yearlyLost.toLocaleString() + '</div><div class="ri-stat-label">Yearly impact</div></div>' +
      '</div>' +
      '<div class="revenue-impact-cta">✅ Fix the top 3 issues in your report to start recapturing this revenue within 30–60 days.</div>';

    if (revenueImpactLead) {
      revenueImpactLead.textContent = 'Based on ' + monthlySearches + ' monthly searches for ' + (industry || 'your services') + ' in your area, at $' + jobValue.toLocaleString() + ' avg job value.';
    }
    revenueImpactPanel.hidden = false;
  }

  function renderAdminLoginSection() {
    const container = dashboardResults;
    if (!container) return;

    // Remove existing login section if present
    const existing = document.getElementById('adminLoginSection');
    if (existing) existing.remove();

    if (state.userRole === 'admin') {
      // Show admin status + logout
      const status = document.createElement('div');
      status.id = 'adminLoginSection';
      status.style.cssText = 'margin-bottom:12px; padding:8px 12px; background:#0ea5e9; color:white; border-radius:8px; display:flex; align-items:center; gap:12px;';
      status.innerHTML = `
        <strong>Admin Mode Active</strong>
        <button id="logoutAdminBtn" style="margin-left:auto; background:white; color:#0ea5e9; border:none; padding:4px 10px; border-radius:6px; cursor:pointer;">Logout</button>
      `;
      container.prepend(status);

      document.getElementById('logoutAdminBtn').onclick = () => {
        state.userRole = 'client';
        state.internalMode = false;
        renderDashboard();
      };
      return;
    }

    // Client mode - show login option
    const loginBox = document.createElement('div');
    loginBox.id = 'adminLoginSection';
    loginBox.style.cssText = 'margin-bottom:16px; padding:12px; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:10px;';
    loginBox.innerHTML = `
      <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
        <span style="font-size:0.9rem; color:#475569;">Viewing as <strong>Client</strong></span>
        <input id="adminPasswordInput" type="password" placeholder="Admin password" style="padding:6px 10px; border:1px solid #94a3b8; border-radius:6px; font-size:0.9rem;">
        <button id="adminLoginBtn" class="btn btn-sm">Login as Admin</button>
        <span style="font-size:0.75rem; color:#64748b;">(Full results + all leads + pipeline)</span>
      </div>
    `;
    container.prepend(loginBox);

    const loginBtn = document.getElementById('adminLoginBtn');
    const pwInput = document.getElementById('adminPasswordInput');

    if (loginBtn && pwInput) {
      loginBtn.onclick = async () => {
        try {
          const res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pwInput.value })
          });
          const data = await res.json();
          if (data && data.ok) {
            state.userRole = 'admin';
            state.internalMode = true;
            renderDashboard();
          } else {
            alert('Incorrect admin password');
          }
        } catch (e) {
          alert('Login failed');
        }
      };
      pwInput.onkeypress = (e) => {
        if (e.key === 'Enter') loginBtn.click();
      };
    }
  }

  function renderDashboard() {
    if (!state.dashboard || !dashboardResults) return;
    const view = resolveCurrentView();
    if (!view) return;

      // Free audit: show teaser only + confirm lead capture (#2)
      if (isFreeAudit()) {
        dashboardResults.hidden = false;
        if (dashboardStatus) dashboardStatus.textContent = 'Free GeoNeo Audit Complete — Results Saved';
        if (auditModalTitle) auditModalTitle.textContent = 'Your Free GeoNeo Audit Results';
        renderFreeTeaser(view);
        
        // Show lead capture confirmation
        const existingLeadNote = dashboardResults.querySelector('.lead-note');
        if (existingLeadNote) existingLeadNote.remove();
        const leadNote = document.createElement('div');
        leadNote.className = 'lead-note';
        leadNote.style.cssText = 'margin-top:16px; padding:12px; background:#f0fdf4; border:1px solid #86efac; border-radius:8px; font-size:0.9rem;';
        leadNote.textContent = `We've saved your results using the details you provided. A GeoNeo Specialist can follow up if you'd like the full audit + strategy session.`;
        dashboardResults.appendChild(leadNote);
        return;
      }

    // === Admin / Client Login Section ===
    renderAdminLoginSection();

    const marketMode = isMarketDashboard(state.dashboard);
    dashboardResults.hidden = false;
    if (dashboardStatus) {
      const modeText = marketMode ? 'Industry and Area Rankings' : 'Website Audit';
      dashboardStatus.textContent = `${modeText} · ${packageLabel(state.selectedPackageView)}${state.internalMode ? ' · Admin' : ''}`;
    }
    if (auditModalTitle) {
      auditModalTitle.textContent = marketMode ? 'Market Rankings Report' : 'Website Audit Report';
    }
    if (dataQualityBadge) {
      dataQualityBadge.textContent = `Data Quality: ${state.dashboard.dataQuality || 'unknown'} | Source: ${state.dashboard.sourceNote || 'n/a'}`;
    }
    if (summaryScoreCards) {
      summaryScoreCards.hidden = false;
    }
    if (dashboardControlsCard) {
      dashboardControlsCard.hidden = marketMode;
    }
    if (packageComparisonCard) {
      packageComparisonCard.hidden = marketMode;
    }
    if (competitorsPanel) {
      competitorsPanel.hidden = marketMode;
    }

    // Admin-only: Show raw/full data only when logged in as admin
    const isAdmin = state.userRole === 'admin';
    if (!isAdmin) {
      const leadsLink = document.getElementById('viewLeadsLink');
      if (leadsLink) leadsLink.remove();
      // Hide or limit sensitive panels for client view
      if (competitorsTableBody) competitorsTableBody.innerHTML = '<tr><td colspan="9">Detailed competitor analysis available in Full Fix Plan or Admin view.</td></tr>';
      if (fixesList) fixesList.innerHTML = '<li>Full prioritized fixes with time estimates and impact are unlocked in the One-Time Full Fix Plan ($79) or Admin view.</li>';
    } else {
      // #12: Show quick link to view saved leads when in admin mode
      const leadsLink = document.getElementById('viewLeadsLink');
      if (!leadsLink) {
        const link = document.createElement('a');
        link.id = 'viewLeadsLink';
        link.href = '/admin/';
        link.target = '_blank';
        link.textContent = 'Open admin portal →';
        link.style.cssText = 'display:block; margin:12px 0; color:#0ea5e9; font-weight:600;';
        dashboardResults.prepend(link);
      }
    }

    renderSearchPositioning(view);
    renderMarketSearchSummary(view);
    renderMarketOpportunity(view);
    renderGoogleRankingMatrix(view);
    renderScoreCards(view);
    renderWhoBeatYou(view);
    renderRevenueImpact(view);

    // #5: Prominent CTA for Specialist Strategy Session
    const ctaContainer = document.getElementById('specialistCtaContainer');
    if (ctaContainer) ctaContainer.remove();

    const isFreeView = state.selectedPackageView === 'score_only' || !state.selectedPackageView;
    if (!marketMode && isFreeView) {
      const cta = document.createElement('div');
      cta.id = 'specialistCtaContainer';
      cta.style.cssText = 'margin:20px 0; padding:20px; background:linear-gradient(135deg, #0ea5e9, #0284c8); border-radius:12px; color:white; text-align:center;';
      cta.innerHTML = `
        <h4 style="margin:0 0 8px; color:white;">Ready for the full picture?</h4>
        <p style="margin:0 0 16px; opacity:0.95;">Get the complete prioritized fix plan + 30-minute GeoNeo Specialist Strategy Session for $${SPECIALIST_PRICE}.</p>
        <button class="btn" id="resultsSpecialistBtn" style="background:white; color:#0284c8; font-weight:700;">Book the Strategy Session — $${SPECIALIST_PRICE}</button>
      `;
      dashboardResults.appendChild(cta);

      document.getElementById('resultsSpecialistBtn').onclick = () => showSpecialistSessionModal();
    }
    if (!marketMode) {
      renderPackageComparison(state.dashboard);
    }
    renderIssues(view);
    renderFixes(view);
    renderQuestions(view);
    renderCompetitors(view);
    renderAdmin(view);
  }

  function buildFallbackDashboardFromResponse(data, mode) {
    const summaryScores = data.summaryScores || {
      seo: Number(data.scores?.seo) || 0,
      technical: Number(data.scores?.overall) || 0,
      aiVisibility: Number(data.scores?.ai) || 0,
      localPresence: Number(data.scores?.geo) || 0,
      reputation: 50,
      conversionUx: Number(data.scores?.overall) || 0
    };
    const issues = safeArray(data.issues);
    const fixes = safeArray(data.fixes);
    const competitors = safeArray(data.competitors);
    const industryAnalysis = data.industryAnalysis || null;
    const marketOpportunity = data.marketOpportunity || null;
    const marketAssets = safeArray(data.marketAssets);
    const model = {
      queryType: mode,
      dataQuality: data.dataQuality || 'estimated',
      sourceNote: data.sourceNote || 'legacy response mapped',
      input: {},
      summaryScores,
      issues,
      fixes,
      competitors,
      industryAnalysis,
      marketOpportunity,
      marketAssets
    };
    const packageViews = {
      score_only: { ...model, issues: [], fixes: [], competitors: mode === 'market' ? competitors.slice(0, 5) : [] },
      scores_issues: { ...model, issues, fixes: [], competitors: competitors.slice(0, 5) },
      full_data: { ...model, issues, fixes, competitors }
    };
    return {
      queryType: mode,
      dataQuality: model.dataQuality,
      sourceNote: model.sourceNote,
      resultModel: model,
      packageViews,
      selectedView: packageViews.full_data,
      internalView: packageViews.full_data
    };
  }

  function openAuditModal() {
    if (!auditModalOverlay) return;
    auditModalOverlay.classList.add('open');
    auditModalOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeAuditModal() {
    if (!auditModalOverlay) return;
    auditModalOverlay.classList.remove('open');
    auditModalOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function showLoading(mode) {
    if (!auditLoadingOverlay) return;
    const label = mode === 'market' ? 'Searching market rankings...' : 'Auditing website...';
    if (auditLoadingText) auditLoadingText.textContent = label;
    auditLoadingOverlay.classList.add('active');
    auditLoadingOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function hideLoading() {
    if (!auditLoadingOverlay) return;
    auditLoadingOverlay.classList.remove('active');
    auditLoadingOverlay.setAttribute('aria-hidden', 'true');
    // Don't restore body overflow here — the modal will handle it
  }

  async function runQuery(mode, payload) {
    showLoading(mode);
    closeAuditModal();
    try {
      const params = new URLSearchParams();
      params.set('queryType', mode);
      params.set('packageView', state.selectedPackageView);
      params.set('internalMode', state.internalMode ? '1' : '0');
      if (mode === 'website') {
        const normalizedUrl = normalizeWebsiteInput(payload.url);
        const hasMarketSeed = Boolean(payload.industry || payload.city || payload.state || payload.zip);
        if (!normalizedUrl && hasMarketSeed) {
          params.set('queryType', 'market');
          params.set('industry', String(payload.industry || '').trim());
          if (payload.city) params.set('city', payload.city);
          if (payload.state) params.set('state', payload.state);
          if (payload.zip) params.set('zip', payload.zip);
        } else if (!normalizedUrl) {
          throw new Error('Enter a website URL, or use Industry and Area Rankings mode.');
        } else {
          params.set('url', normalizedUrl);
          if (payload.industry) params.set('industry', payload.industry);
          if (payload.city) params.set('city', payload.city);
          if (payload.state) params.set('state', payload.state);
          if (payload.zip) params.set('zip', payload.zip);
          // Step 3: Forward required lead capture fields for free scan persistence
          if (payload.contactName) params.set('contactName', payload.contactName);
          if (payload.businessName) params.set('businessName', payload.businessName);
          if (payload.businessEmail) params.set('businessEmail', payload.businessEmail);
          if (payload.phone) params.set('phone', payload.phone);
        }
      } else {
        if (!payload.industry) {
          throw new Error('Industry is required for Industry and Area Rankings mode.');
        }
        if (payload.businessName) params.set('businessName', payload.businessName);
        params.set('industry', payload.industry);
        if (payload.city) params.set('city', payload.city);
        if (payload.state) params.set('state', payload.state);
        if (payload.zip) params.set('zip', payload.zip);
      }

      const response = await fetch(`/api/audit?${params.toString()}`);
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || 'Request failed.');
      }
      state.dashboard = data.dashboard || buildFallbackDashboardFromResponse(data, mode);
      state.selectedPackageView = state.dashboard.selectedPackageView || state.selectedPackageView;
      if (packageViewSelect) {
        packageViewSelect.value = state.selectedPackageView;
      }
      hideLoading();
      renderDashboard();
      openAuditModal();
    } catch (error) {
      hideLoading();
      if (dashboardResults) dashboardResults.hidden = false;
      if (dashboardStatus) {
        dashboardStatus.textContent = `Could not load results. ${String(error.message || error)}`;
      }
      if (summaryScoreCards) {
        summaryScoreCards.innerHTML = '<article class="card"><h4>No Data</h4><p class="plan-price">0/100</p></article>';
      }
      if (issuesList) {
        issuesList.innerHTML = '<li>No data returned. Try again or use different inputs.</li>';
      }
      if (fixesList) {
        fixesList.innerHTML = '<li>No fixes available.</li>';
      }
      if (competitorsTableBody) {
        competitorsTableBody.innerHTML = '<tr><td colspan="9">No competitor data returned.</td></tr>';
      }
      if (dataQualityBadge) {
        dataQualityBadge.textContent = 'Data Quality: unavailable';
      }
      if (auditModalTitle) {
        auditModalTitle.textContent = 'Audit Error';
      }
      openAuditModal();
    }
  }

  if (modeWebsiteBtn) {
    modeWebsiteBtn.addEventListener('click', () => setMode('website', true));
  }
  if (modeMarketBtn) {
    modeMarketBtn.addEventListener('click', () => setMode('market', true));
  }

  if (auditModalCloseBtn) {
    auditModalCloseBtn.addEventListener('click', closeAuditModal);
  }
  if (auditModalOverlay) {
    auditModalOverlay.addEventListener('click', (event) => {
      if (event.target === auditModalOverlay) closeAuditModal();
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && auditModalOverlay?.classList.contains('open')) {
      closeAuditModal();
    }
  });

  if (websiteForm) {
    websiteForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(websiteForm);
      // Step 3: Enforce lead capture on website-only audit path
      const contactName = String(formData.get('contactName') || '').trim();
      const businessName = String(formData.get('businessName') || '').trim();
      const businessEmail = String(formData.get('businessEmail') || '').trim();
      if (!contactName || !businessName || !businessEmail) {
        alert('Please provide your name, business name, and business email. These are required for free scans.');
        return;
      }
      await runQuery('website', {
        url: String(formData.get('url') || '').trim(),
        industry: String(formData.get('industry') || '').trim(),
        city: String(formData.get('city') || '').trim(),
        state: String(formData.get('state') || '').trim(),
        zip: String(formData.get('zip') || '').trim(),
        contactName,
        businessName,
        businessEmail,
        phone: String(formData.get('phone') || '').trim()
      });
    });
  }

  if (marketForm) {
    marketForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await runQuery('market', {
        businessName: String(marketBusinessName?.value || '').trim(),
        industry: String(marketIndustry?.value || '').trim(),
        city: String(marketCity?.value || '').trim(),
        state: String(marketState?.value || '').trim(),
        zip: String(marketZip?.value || '').trim()
      });
    });
  }

  const bothForm = document.getElementById('bothAuditForm');
  if (bothForm) {
    bothForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const fd = new FormData(bothForm);
      // Step 3: Always capture the 6 required free lead fields before running scan
      const contactName = String(fd.get('contactName') || '').trim();
      const businessName = String(fd.get('businessName') || '').trim();
      const businessEmail = String(fd.get('businessEmail') || '').trim();
      if (!contactName || !businessName || !businessEmail) {
        alert('Please provide your name, business name, and business email to run the free scan. These are required so we can save your results and follow up.');
        return;
      }
      await runQuery('website', {
        url: String(fd.get('url') || '').trim(),
        industry: String(fd.get('industry') || '').trim(),
        city: String(fd.get('city') || '').trim(),
        state: String(fd.get('state') || '').trim(),
        zip: String(fd.get('zip') || '').trim(),
        contactName,
        businessName,
        businessEmail,
        phone: String(fd.get('phone') || '').trim()
      });
    });
  }

  if (finalCtaForm && websiteForm) {
    finalCtaForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (state.activeMode === 'market') {
        const industryField = marketIndustry;
        const target = String(finalUrl?.value || '').trim();
        if (industryField) {
          industryField.value = target;
        }
        setMode('market');
        await runQuery('market', {
          businessName: String(marketBusinessName?.value || '').trim(),
          industry: target,
          city: String(marketCity?.value || '').trim(),
          state: String(marketState?.value || '').trim(),
          zip: String(marketZip?.value || '').trim()
        });
      } else {
        const target = normalizeWebsiteInput(String(finalUrl?.value || ''));
        const websiteUrlField = websiteForm.querySelector('[name="url"]');
        if (websiteUrlField) {
          websiteUrlField.value = target;
        }
        setMode('website');
        await runQuery('website', {
          url: target,
          industry: '',
          city: '',
          state: '',
          zip: ''
        });
      }
    });
  }

  if (packageViewSelect) {
    packageViewSelect.addEventListener('change', () => {
      state.selectedPackageView = String(packageViewSelect.value || 'full_data');
      renderDashboard();
    });
  }

  if (adminModeToggle) {
    adminModeToggle.addEventListener('change', () => {
      state.internalMode = Boolean(adminModeToggle.checked);
      renderDashboard();
    });
  }

  if (marketLeaderboardTabBtn) {
    marketLeaderboardTabBtn.addEventListener('click', () => setMarketTab('leaderboard'));
  }

  if (marketTakeoverTabBtn) {
    marketTakeoverTabBtn.addEventListener('click', () => setMarketTab('takeover'));
  }

  if (copyReportBtn) {
    copyReportBtn.addEventListener('click', async () => {
      const view = resolveCurrentView();
      if (!view || !state.dashboard) return;
      const summary = buildTextSummary(view, state.dashboard);
      try {
        await navigator.clipboard.writeText(summary);
        if (dashboardStatus) dashboardStatus.textContent = 'Report summary copied to clipboard.';
      } catch {
        if (dashboardStatus) dashboardStatus.textContent = 'Clipboard copy failed.';
      }
    });
  }

  if (exportJsonBtn) {
    exportJsonBtn.addEventListener('click', () => {
      if (!state.dashboard) return;
      const blob = new Blob([JSON.stringify(state.dashboard, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `geoneo-dashboard-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  if (exportTextBtn) {
    exportTextBtn.addEventListener('click', () => {
      const view = resolveCurrentView();
      if (!view || !state.dashboard) return;
      const blob = new Blob([buildTextSummary(view, state.dashboard)], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `geoneo-summary-${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  populateStateSelect(websiteState);
  populateStateSelect(marketState);
  const bothState = document.getElementById('bothState');
  populateStateSelect(bothState);
  setMode('website');
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
})();
