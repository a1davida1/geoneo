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
  const competitorsPanel = document.getElementById('competitorsPanel');
  const competitorsTable = document.getElementById('competitorsTable');
  const competitorsTableBody = document.getElementById('competitorsTableBody');

  const adminPanel = document.getElementById('adminPanel');
  const adminRawData = document.getElementById('adminRawData');
  const copyReportBtn = document.getElementById('copyReportBtn');
  const exportJsonBtn = document.getElementById('exportJsonBtn');
  const exportTextBtn = document.getElementById('exportTextBtn');

  const marketIndustry = document.getElementById('marketIndustry');
  const marketCity = document.getElementById('marketCity');
  const marketState = document.getElementById('marketState');
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
    internalMode: false
  };

  const modeContent = {
    website: {
      heroEyebrow: 'Website Audit',
      heroTitle: 'When people search for what you offer, where does your website rank and what is stopping it from ranking higher?',
      heroLead: 'Use this to audit one specific website, see how it appears in search, understand the reasons behind that position, and get a clear fix path.',
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

  function setMode(mode) {
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

  function packageLabel(value) {
    if (value === 'score_only') return 'Score Only';
    if (value === 'scores_issues') return 'Scores + Issues';
    return 'Full Data + Strategy';
  }

  function issueSeverityTag(severity) {
    const s = String(severity || '').toLowerCase();
    if (s === 'high') return 'HIGH';
    if (s === 'medium') return 'MED';
    return 'LOW';
  }

  function isMarketDashboard(dashboardOrView) {
    return String(dashboardOrView?.queryType || '').toLowerCase() === 'market';
  }

  function panelTitle(panel, text) {
    if (!panel) return;
    const heading = panel.querySelector('h4');
    if (heading) heading.textContent = text;
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
    const cards = [
      ['SEO', scores.seo],
      ['Technical', scores.technical],
      ['AI Visibility', scores.aiVisibility],
      ['Local Presence', scores.localPresence],
      ['Reputation', scores.reputation],
      ['Conversion / UX', scores.conversionUx]
    ];
    summaryScoreCards.innerHTML = cards
      .map(([label, value]) => `<article class="card"><h4>${label}</h4><p class="plan-price">${Number.isFinite(Number(value)) ? Number(value) : 0}/100</p></article>`)
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
        ? safeArray(queryRow.topCompetitors).join(', ')
        : 'No clear competitor domains captured in this run.';
      const engineRows = safeArray(queryRow.engines).map((engineRow) => `<tr>
          <td>${engineRow.engine || '-'}</td>
          <td>${engineRow.rankLabel || '-'}</td>
          <td>${engineRow.resultType || '-'}</td>
          <td>${engineRow.note || '-'}</td>
        </tr>`).join('');
      return `<article class="card">
        <h4>#${Number(queryRow.rank || 0)} ${queryRow.query || 'Query'}</h4>
        <p class="form-note"><strong>Location:</strong> ${queryRow.location || '-'}</p>
        <p class="form-note"><strong>Competitors showing first:</strong> ${competitorText}</p>
        <p>${queryRow.takeaway || ''}</p>
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
    const orderedRows = safeArray(overview.orderedResults);
    const orderedCount = orderedRows.length;
    const pageOneCount = orderedRows.filter((row) => Number(row.page) === 1).length;
    const pageTwoCount = orderedRows.filter((row) => Number(row.page) === 2).length;
    const pageThreeCount = orderedRows.filter((row) => Number(row.page) === 3).length;
    if (marketSearchTitle) {
      marketSearchTitle.textContent = 'Industry and Area Rankings';
    }
    if (marketSearchLead) {
      marketSearchLead.textContent = 'This is a ranked market report. It shows which businesses appear first when someone searches this industry in this area.';
    }
    if (marketSearchSummary) {
      marketSearchSummary.textContent = `Primary query: ${overview.primaryQuery || 'n/a'} | Page 1: ${pageOneCount} | Page 2: ${pageTwoCount} | Page 3: ${pageThreeCount} | Total rows: ${orderedCount} | Source: ${state.dashboard?.sourceNote || 'n/a'}`;
    }
    if (marketSearchStats) {
      const topThree = orderedRows.slice(0, 3);
      const topThreeText = topThree.length
        ? topThree.map((row) => `#${row.rank} ${row.companyName}`).join(' | ')
        : 'No live businesses returned';
      marketSearchStats.innerHTML = [
        ['Page 1', pageOneCount],
        ['Page 2', pageTwoCount],
        ['Page 3', pageThreeCount],
        ['Top 3', topThreeText]
      ].map(([label, value]) => `<article class="card market-stat-card"><h4>${label}</h4><p class="plan-price">${value}</p></article>`).join('');
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
      <h4>${row.label || '-'}</h4>
      <p class="form-note"><strong>What this is:</strong> ${row.matrix || '-'}</p>
      <p class="form-note"><strong>Judged by:</strong> ${row.judgedBy || '-'}</p>
      <p><strong>Your score:</strong> ${Number(row.yourScore || 0)}/100</p>
      <p><strong>Competitor average:</strong> ${row.competitorAverage === null ? 'No comparison available' : `${Number(row.competitorAverage)}/100`}</p>
      <p class="form-note"><strong>Why it matters:</strong> ${row.note || '-'}</p>
    </article>`);
    googleMatrixPanel.hidden = false;
    googleMatrixRows.innerHTML = rows.length
      ? rows.join('')
      : '<article class="card"><p>No Google ranking matrix data is available for this site audit.</p></article>';
  }

  function renderPackageComparison(dashboard) {
    if (!packageComparison) return;
    const views = dashboard.packageViews || {};
    const rows = ['score_only', 'scores_issues', 'full_data'].map((key) => {
      const view = views[key] || {};
      if (isMarketDashboard(dashboard)) {
        const analysis = view.industryAnalysis || {};
        const competitorsCount = safeArray(analysis.competitors).length;
        const difficulty = analysis.difficulty || {};
        const opportunities = analysis.opportunities || {};
        return `<article class="card">
          <h4>${packageLabel(key)}</h4>
          <ul class="audit-list">
            <li>Market Overview: included</li>
            <li>Companies shown: ${competitorsCount}</li>
            <li>Difficulty Score: ${difficulty.score || '-'}/10 (${difficulty.level || 'unknown'})</li>
            <li>Dominance View: ${Number(analysis.dominance?.visibilityControlledByTop3 || 0)}% top-3 control</li>
            <li>AI Citation Candidates: ${safeArray(opportunities.aiCitationPotential?.topCandidates).length}</li>
            <li>Strategy Playbook: ${safeArray(analysis.strategy?.howToBreakIntoTop10).length + safeArray(analysis.strategy?.howToDominateThisMarket).length} steps</li>
          </ul>
        </article>`;
      }
      const issueCount = safeArray(view.issues).length;
      const fixCount = safeArray(view.fixes).length;
      const competitorCount = safeArray(view.competitors).length;
      const issuePreview = issueCount ? `${view.issues[0].title || 'Issue'} (${view.issues[0].category || 'general'})` : 'No issue list in this view';
      const fixPreview = fixCount ? `${view.fixes[0].title || 'Fix'}` : 'No fix roadmap in this view';
      return `<article class="card">
        <h4>${packageLabel(key)}</h4>
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
    packageComparison.innerHTML = rows.join('');
  }

  function renderIssues(view) {
    if (!issuesPanel || !issuesList) return;
    if (isMarketDashboard(state.dashboard)) {
      issuesPanel.hidden = true;
      issuesList.innerHTML = '';
      return;
    }
    panelTitle(issuesPanel, 'What Is Holding This Site Back');
    const issues = safeArray(view.issues);
    if (!issues.length) {
      issuesPanel.hidden = false;
      issuesList.innerHTML = '<li>No issues shown for this package view.</li>';
      return;
    }
    issuesPanel.hidden = false;
    issuesList.innerHTML = issues
      .map((item) => `<li><strong>[${issueSeverityTag(item.severity)}]</strong> ${item.category}: ${item.title} - ${item.description}</li>`)
      .join('');
  }

  function renderFixes(view) {
    if (!fixesPanel || !fixesList) return;
    if (isMarketDashboard(state.dashboard)) {
      fixesPanel.hidden = true;
      fixesList.innerHTML = '';
      return;
    }
    panelTitle(fixesPanel, 'How To Fix It');
    const fixes = safeArray(view.fixes);
    if (!fixes.length) {
      fixesPanel.hidden = true;
      fixesList.innerHTML = '';
      return;
    }
    fixesPanel.hidden = false;
    fixesList.innerHTML = fixes
      .map((item) => `<li><strong>[${String(item.priority || '').toUpperCase()}]</strong> ${item.category}: ${item.title} - ${item.description}</li>`)
      .join('');
  }

  function formatScoreSummary(summary) {
    const s = summary || {};
    return `SEO ${Number(s.seo || 0)} | Authority ${Number(s.authority || 0)} | Local ${Number(s.local || 0)}`;
  }

  function renderCompetitors(view) {
    if (!competitorsPanel || !competitorsTableBody) return;
    const tableHeadRow = competitorsTable ? competitorsTable.querySelector('thead tr') : null;
    if (isMarketDashboard(state.dashboard)) {
      panelTitle(competitorsPanel, 'Businesses Ranking In This Market');
      const orderedResults = safeArray(view.industryAnalysis?.overview?.orderedResults);
      const competitors = safeArray(view.industryAnalysis?.competitors || view.competitors);
      if (tableHeadRow) {
        tableHeadRow.innerHTML = `
          <th>Rank</th>
          <th>Page</th>
          <th>Company Name</th>
          <th>Domain</th>
          <th>Website</th>
          <th>Query</th>
        `;
      }
      if (!orderedResults.length) {
        competitorsPanel.hidden = false;
        competitorsTableBody.innerHTML = '<tr><td colspan="6">No live Google ranking rows were returned for this market.</td></tr>';
        return;
      }
      competitorsPanel.hidden = false;
      competitorsTableBody.innerHTML = orderedResults
        .map((item) => {
          const rank = Number(item.rank || 0);
          const page = Number(item.page || 0);
          const rankLabel = rank <= 3 ? 'Top 3' : (rank <= 10 ? 'Page 1' : (rank <= 20 ? 'Page 2' : 'Page 3'));
          return `<tr>
          <td><strong>#${rank}</strong><br/><span class="form-note">${rankLabel}</span></td>
          <td>${page}</td>
          <td>${item.companyName || '-'}</td>
          <td>${item.domain || '-'}</td>
          <td>${item.website ? `<a href="${item.website}" target="_blank" rel="noreferrer">${item.website}</a>` : '-'}</td>
          <td>${item.query || '-'}</td>
        </tr>`;
        })
        .join('');
      return;
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
        const strengths = safeArray(item.strengths).slice(0, 2).join(', ') || '-';
        const weaknesses = safeArray(item.weaknesses).slice(0, 2).join(', ') || '-';
        const source = item.source || 'n/a';
        const website = item.website ? `<a href="${item.website}" target="_blank" rel="noreferrer">${item.website}</a>` : '-';
        return `<tr>
          <td>${item.name || '-'}</td>
          <td>${website}</td>
          <td>${item.city || '-'}</td>
          <td>${item.category || '-'}</td>
          <td>${item.notes || '-'}</td>
          <td>${strengths}</td>
          <td>${weaknesses}</td>
          <td>${formatScoreSummary(item.scoreSummary)}</td>
          <td>${source}</td>
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

  function renderDashboard() {
    if (!state.dashboard || !dashboardResults) return;
    const view = resolveCurrentView();
    if (!view) return;
    const marketMode = isMarketDashboard(state.dashboard);
    dashboardResults.hidden = false;
    if (dashboardStatus) {
      const modeText = marketMode ? 'Industry and Area Rankings' : 'Website Audit';
      dashboardStatus.textContent = `${modeText} results loaded. Package view: ${packageLabel(state.selectedPackageView)}${state.internalMode ? ' (Internal/Admin override enabled)' : ''}.`;
    }
    if (dataQualityBadge) {
      dataQualityBadge.textContent = `Data Quality: ${state.dashboard.dataQuality || 'unknown'} | Source: ${state.dashboard.sourceNote || 'n/a'}`;
    }
    if (summaryScoreCards) {
      summaryScoreCards.hidden = marketMode;
    }
    if (dashboardControlsCard) {
      dashboardControlsCard.hidden = marketMode;
    }
    if (packageComparisonCard) {
      packageComparisonCard.hidden = marketMode;
    }
    if (issuesPanel) {
      issuesPanel.hidden = marketMode;
    }
    if (fixesPanel) {
      fixesPanel.hidden = marketMode;
    }
    renderSearchPositioning(view);
    renderMarketSearchSummary(view);
    renderGoogleRankingMatrix(view);
    renderScoreCards(view);
    if (!marketMode) {
      renderPackageComparison(state.dashboard);
    }
    renderIssues(view);
    renderFixes(view);
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
    const model = {
      queryType: mode,
      dataQuality: data.dataQuality || 'estimated',
      sourceNote: data.sourceNote || 'legacy response mapped',
      input: {},
      summaryScores,
      issues,
      fixes,
      competitors,
      industryAnalysis
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

  async function runQuery(mode, payload) {
    if (dashboardResults) {
      dashboardResults.hidden = false;
    }
    if (dashboardStatus) {
      dashboardStatus.textContent = 'Loading results...';
    }
    try {
      const params = new URLSearchParams();
      params.set('queryType', mode);
      params.set('packageView', state.selectedPackageView);
      params.set('internalMode', state.internalMode ? '1' : '0');
      if (mode === 'website') {
        const normalizedUrl = normalizeWebsiteInput(payload.url);
        const hasMarketSeed = Boolean(payload.industry || payload.city || payload.state);
        if (!normalizedUrl && hasMarketSeed) {
          params.set('queryType', 'market');
          params.set('industry', String(payload.industry || '').trim());
          if (payload.city) params.set('city', payload.city);
          if (payload.state) params.set('state', payload.state);
        } else if (!normalizedUrl) {
          throw new Error('Enter a website URL, or use Industry and Area Rankings mode.');
        } else {
          params.set('url', normalizedUrl);
          if (payload.industry) params.set('industry', payload.industry);
          if (payload.city) params.set('city', payload.city);
          if (payload.state) params.set('state', payload.state);
        }
      } else {
        if (!payload.industry) {
          throw new Error('Industry is required for Industry and Area Rankings mode.');
        }
        params.set('industry', payload.industry);
        if (payload.city) params.set('city', payload.city);
        if (payload.state) params.set('state', payload.state);
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
      renderDashboard();
      dashboardResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      if (dashboardStatus) {
        dashboardStatus.textContent = `Could not load full results. ${String(error.message || error)} Showing no-data state.`;
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
    }
  }

  if (modeWebsiteBtn) {
    modeWebsiteBtn.addEventListener('click', () => setMode('website'));
  }
  if (modeMarketBtn) {
    modeMarketBtn.addEventListener('click', () => setMode('market'));
  }

  if (websiteForm) {
    websiteForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(websiteForm);
      await runQuery('website', {
        url: String(formData.get('url') || '').trim(),
        industry: String(formData.get('industry') || '').trim(),
        city: String(formData.get('city') || '').trim(),
        state: String(formData.get('state') || '').trim()
      });
    });
  }

  if (marketForm) {
    marketForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await runQuery('market', {
        industry: String(marketIndustry?.value || '').trim(),
        city: String(marketCity?.value || '').trim(),
        state: String(marketState?.value || '').trim()
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
          industry: target,
          city: String(marketCity?.value || '').trim(),
          state: String(marketState?.value || '').trim()
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
          state: ''
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

  setMode('website');
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
})();
