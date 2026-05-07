/**
 * GeoNeo AI — Glossary tooltip module
 *
 * Purpose: our users are home-service contractors, not marketers. Terms like
 * "map pack", "organic rank", "E-E-A-T", "citation" are jargon to them. This
 * module surfaces plain-English definitions on hover (desktop) or tap (mobile)
 * for any term that appears on the page wrapped in:
 *
 *     <span class="glossary" data-term="map-pack">Map Pack</span>
 *
 * It also auto-wraps bare occurrences of known terms inside elements marked
 * with class `glossary-auto` (useful for dynamic audit output where we don't
 * control every DOM insertion). Auto-wrap is safe: it only matches whole
 * words outside existing anchor/span.glossary/script/style/input elements.
 *
 * No dependencies. Loads via a single <script src="glossary.js" defer>.
 *
 * Accessibility:
 *   - Keyboard focusable (tabindex=0) when wrapped via .glossary class.
 *   - Enter/Space toggles on keyboard.
 *   - Escape closes.
 *   - aria-describedby wires the tooltip contents to the term for AT.
 */
(function () {
  'use strict';

  // --------------------------------------------------------------------
  // 1. Glossary data — edit this to add/change definitions.
  //    Keys are kebab-case slugs used in data-term attributes.
  //    "aliases" lists alternate wordings that auto-wrap will match.
  // --------------------------------------------------------------------
  var GLOSSARY = {
    'map-pack': {
      label: 'Map Pack',
      aliases: ['map pack', 'local pack', 'local 3-pack', '3-pack', 'google 3-pack'],
      short: 'The boxed section at the top of Google with 3 local businesses on a map.',
      long: 'When someone searches for a local service (e.g. "plumber Springfield MO"), Google usually shows a map at the top of the results with 3 businesses listed — including their star rating, hours, phone, and directions. This is called the Map Pack (or Local Pack / 3-Pack). Being in this box is often more valuable than ranking #1 in regular results, because it has direct "Call" and "Directions" buttons and takes up the top of the phone screen.'
    },
    'organic-rank': {
      label: 'Organic Rank',
      aliases: ['organic rank', 'organic ranking', 'organic position', 'organic result'],
      short: 'Where your website appears in the regular (non-paid, non-map) Google results.',
      long: 'Below the ads and below the Map Pack, Google shows a list of website links. Your "organic rank" is where your site appears in that list. Rank #1 is the top link, #2 is the next one down, and so on. Positions 1-3 get most of the clicks; positions 4-10 get some; anything on page 2 (rank 11+) gets almost none.'
    },
    'local-seo': {
      label: 'Local SEO',
      aliases: ['local seo'],
      short: 'Getting found on Google when people search for services in your town.',
      long: 'Local SEO is the set of work that makes your business show up when someone nearby searches for what you do — things like "plumber near me" or "HVAC in Branson". It includes your Google Business Profile, reviews, citations (mentions on directories), your website content, and how consistent your address and phone are across the web.'
    },
    'ai-citation': {
      label: 'AI Citation',
      aliases: ['ai citation', 'ai citations', 'ai mention', 'ai recommendation'],
      short: 'When ChatGPT, Perplexity, or Google AI names your business as an answer.',
      long: 'When someone asks ChatGPT "who\'s the best plumber in Springfield MO?", the AI gives an answer that often includes specific business names. If your business gets named, that\'s an AI citation. Unlike Google rankings where position matters, AI tends to recommend the same 2-5 names and almost nobody else — so being one of those names is everything.'
    },
    'geo': {
      label: 'GEO',
      aliases: ['geo (generative engine optimization)', 'generative engine optimization'],
      short: 'Optimizing your business so AI engines (ChatGPT, Perplexity) recommend you.',
      long: 'GEO stands for Generative Engine Optimization. It\'s like SEO, but for AI chatbots and AI search. Since customers are increasingly asking AI instead of Google, you need your business to show up in those AI answers. GEO is the practice of making that happen — through structured content, authoritative mentions, and clear factual statements AI can extract.'
    },
    'eeat': {
      label: 'E-E-A-T',
      aliases: ['e-e-a-t', 'eeat'],
      short: 'Google\'s quality test: Experience, Expertise, Authoritativeness, Trustworthiness.',
      long: 'E-E-A-T stands for Experience, Expertise, Authoritativeness, and Trustworthiness. Google uses it to judge whether your website should rank — especially for services people spend money on or trust with their home. Proof of real experience (photos of your work), clear credentials (licensed, insured, certified), recognition by others (reviews, press), and honest policies all help your E-E-A-T score.'
    },
    'citation': {
      label: 'Citation',
      aliases: ['nap citation', 'local citation', 'business citation'],
      short: 'A mention of your business name, address, and phone on another website.',
      long: 'In local SEO, a citation is any place online that lists your business\'s name, address, and phone number (NAP) — like Yelp, Angi, BBB, the Chamber of Commerce, or any local directory. Google uses citations to verify you\'re a real business in a real location. Inconsistent citations (different phone numbers in different places) hurt your rankings.'
    },
    'nap': {
      label: 'NAP',
      aliases: ['nap consistency'],
      short: 'Name, Address, Phone — and keeping them identical everywhere online.',
      long: 'NAP stands for Name, Address, Phone. Google checks dozens of directories to see if your business info matches. If one site says "ABC Plumbing, 123 Main St, (417) 555-1234" and another says "ABC Plumbers, Main Street, 417.555.1234", Google isn\'t sure they\'re the same business — and you lose ranking power. "NAP consistency" means fixing every listing to match exactly.'
    },
    'gbp': {
      label: 'Google Business Profile',
      aliases: ['google business profile', 'gbp', 'google my business', 'gmb', 'google listing'],
      short: 'Your free Google listing — the card that shows up with your map pin, reviews, and hours.',
      long: 'Google Business Profile (formerly Google My Business) is the free listing every local business should claim and fill out. It\'s what powers your appearance in the Map Pack, your reviews, your hours, your photos, and your ability to respond to questions. If you haven\'t claimed yours, your competitors are beating you for free.'
    },
    'serp': {
      label: 'SERP',
      aliases: ['serp'],
      short: 'The Google results page — what you see after you hit search.',
      long: 'SERP stands for Search Engine Results Page. It\'s just the page of results Google shows you after a search. It includes ads at the top, sometimes the Map Pack, the organic result links, "People also ask" boxes, and more. When we say "your SERP position", we mean where your business shows up on that page.'
    },
    'backlink': {
      label: 'Backlink',
      aliases: ['backlink', 'backlinks', 'inbound link', 'inbound links'],
      short: 'A link from another website to yours. Google counts these as votes of trust.',
      long: 'A backlink is any hyperlink on someone else\'s website that points to your website. Google treats backlinks like votes — if the local newspaper, the chamber of commerce, or an industry directory links to you, that\'s a sign you\'re legitimate. Quality matters more than quantity: one link from a trusted local site beats fifty links from random spam sites.'
    },
    'ai-overview': {
      label: 'AI Overview',
      aliases: ['ai overview', 'ai overviews', 'google ai overview', 'sge', 'search generative experience'],
      short: 'The AI-written summary Google shows at the top of some searches.',
      long: 'AI Overview is the AI-generated paragraph Google now shows at the top of many searches, above the regular results. It synthesizes information from multiple websites and often cites 2-5 sources. If those sources are your competitors, you\'re invisible to everyone who reads the overview and doesn\'t scroll further.'
    },
    'schema': {
      label: 'Schema Markup',
      aliases: ['schema markup', 'structured data', 'json-ld', 'schema.org'],
      short: 'Hidden code on your website that tells Google and AI exactly what your business is.',
      long: 'Schema markup (or structured data) is a bit of code you put on your website that describes your business in a format search engines understand perfectly — things like "this is a plumber", "we\'re located here", "we serve these cities", "our hours are these". Humans don\'t see it. Google, Bing, and AI assistants read it and use it to decide when to show you.'
    },
    'dwell-time': {
      label: 'Dwell Time',
      aliases: ['dwell time', 'time on site', 'time on page'],
      short: 'How long visitors stay on your site after clicking through from Google.',
      long: 'Dwell time is how long a Google searcher stays on your website before returning to the results. If people click your result and leave in 3 seconds, Google learns your page didn\'t answer the question and drops you. If they stay for 2 minutes and read, Google learns your page is helpful and promotes you. Good content = longer dwell time = better rankings.'
    },
    'bounce-rate': {
      label: 'Bounce Rate',
      aliases: ['bounce rate'],
      short: 'The percentage of visitors who leave without clicking anything on your site.',
      long: 'Bounce rate is the percentage of people who land on your website and leave without clicking to another page or interacting. A high bounce rate (80%+) often means your page didn\'t match what the searcher wanted, loaded too slowly, or looked untrustworthy. For home-service sites, a bounce rate over 70% is a warning sign.'
    },
    'core-web-vitals': {
      label: 'Core Web Vitals',
      aliases: ['core web vitals', 'web vitals', 'page speed'],
      short: 'Google\'s measurements of how fast and smooth your website feels.',
      long: 'Core Web Vitals are three specific measurements Google uses to score how well your site works: how fast the main content loads, how fast it responds to a tap or click, and how much things jump around while loading. If your site fails these on mobile, Google demotes you — and your visitors leave before the page even loads.'
    }
  };

  // --------------------------------------------------------------------
  // 2. Tooltip element (single instance, reused on every hover/focus)
  // --------------------------------------------------------------------
  var tooltipEl = null;
  var currentTarget = null;
  var hideTimer = null;
  var isPinned = false;

  function ensureTooltip() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'glossary-tooltip';
    tooltipEl.setAttribute('role', 'tooltip');
    tooltipEl.setAttribute('aria-hidden', 'true');
    tooltipEl.id = 'glossary-tooltip';
    tooltipEl.innerHTML = [
      '<div class="glossary-tooltip__inner">',
      '  <div class="glossary-tooltip__label" data-role="label"></div>',
      '  <div class="glossary-tooltip__short" data-role="short"></div>',
      '  <div class="glossary-tooltip__long" data-role="long"></div>',
      '  <button type="button" class="glossary-tooltip__close" aria-label="Close">&times;</button>',
      '</div>'
    ].join('');
    document.body.appendChild(tooltipEl);
    tooltipEl.querySelector('.glossary-tooltip__close').addEventListener('click', function (e) {
      e.stopPropagation();
      hideTooltip(true);
    });
    // Clicks inside tooltip keep it pinned
    tooltipEl.addEventListener('mouseenter', function () { clearTimeout(hideTimer); });
    tooltipEl.addEventListener('mouseleave', function () {
      if (!isPinned) hideTimer = setTimeout(function () { hideTooltip(false); }, 200);
    });
    return tooltipEl;
  }

  function showTooltip(target, pin) {
    var slug = target.getAttribute('data-term');
    var entry = GLOSSARY[slug];
    if (!entry) return;
    ensureTooltip();
    currentTarget = target;
    isPinned = !!pin;
    tooltipEl.querySelector('[data-role="label"]').textContent = entry.label || slug;
    tooltipEl.querySelector('[data-role="short"]').textContent = entry.short || '';
    tooltipEl.querySelector('[data-role="long"]').textContent = entry.long || '';
    tooltipEl.setAttribute('aria-hidden', 'false');
    tooltipEl.classList.add('is-visible');
    if (pin) tooltipEl.classList.add('is-pinned'); else tooltipEl.classList.remove('is-pinned');
    target.setAttribute('aria-describedby', 'glossary-tooltip');
    positionTooltip(target);
  }

  function hideTooltip(force) {
    if (!tooltipEl) return;
    if (isPinned && !force) return;
    tooltipEl.classList.remove('is-visible');
    tooltipEl.classList.remove('is-pinned');
    tooltipEl.setAttribute('aria-hidden', 'true');
    if (currentTarget) {
      currentTarget.removeAttribute('aria-describedby');
      currentTarget = null;
    }
    isPinned = false;
  }

  function positionTooltip(target) {
    if (!tooltipEl) return;
    var rect = target.getBoundingClientRect();
    // Render to measure
    tooltipEl.style.visibility = 'hidden';
    tooltipEl.style.left = '0px';
    tooltipEl.style.top = '0px';
    var tipRect = tooltipEl.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var pad = 8;
    var left = rect.left + (rect.width / 2) - (tipRect.width / 2);
    var top = rect.bottom + pad;
    // flip above if overflow bottom
    if (top + tipRect.height > vh - pad) {
      top = rect.top - tipRect.height - pad;
    }
    // clamp horizontally
    if (left < pad) left = pad;
    if (left + tipRect.width > vw - pad) left = vw - tipRect.width - pad;
    tooltipEl.style.left = Math.round(left + window.scrollX) + 'px';
    tooltipEl.style.top = Math.round(top + window.scrollY) + 'px';
    tooltipEl.style.visibility = 'visible';
  }

  // --------------------------------------------------------------------
  // 3. Event wiring
  // --------------------------------------------------------------------
  function onPointerOver(e) {
    var target = e.target.closest('.glossary[data-term]');
    if (!target) return;
    clearTimeout(hideTimer);
    showTooltip(target, false);
  }

  function onPointerOut(e) {
    var target = e.target.closest('.glossary[data-term]');
    if (!target) return;
    if (isPinned) return;
    hideTimer = setTimeout(function () { hideTooltip(false); }, 200);
  }

  function onClick(e) {
    var target = e.target.closest('.glossary[data-term]');
    if (target) {
      e.preventDefault();
      e.stopPropagation();
      if (isPinned && currentTarget === target) {
        hideTooltip(true);
      } else {
        showTooltip(target, true);
      }
      return;
    }
    // Click outside: close pinned
    if (isPinned && tooltipEl && !tooltipEl.contains(e.target)) {
      hideTooltip(true);
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape' && (isPinned || (tooltipEl && tooltipEl.classList.contains('is-visible')))) {
      hideTooltip(true);
      return;
    }
    var target = e.target;
    if (target && target.classList && target.classList.contains('glossary') && target.hasAttribute('data-term')) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (isPinned && currentTarget === target) {
          hideTooltip(true);
        } else {
          showTooltip(target, true);
        }
      }
    }
  }

  // --------------------------------------------------------------------
  // 4. Auto-wrap known terms in opted-in containers
  // --------------------------------------------------------------------
  function buildAutoWrapIndex() {
    var entries = [];
    Object.keys(GLOSSARY).forEach(function (slug) {
      var entry = GLOSSARY[slug];
      var aliases = (entry.aliases || []).concat([entry.label]).filter(Boolean);
      aliases.forEach(function (phrase) {
        entries.push({ slug: slug, phrase: phrase, lower: phrase.toLowerCase() });
      });
    });
    // Longer phrases first so "google business profile" wins over "google".
    entries.sort(function (a, b) { return b.phrase.length - a.phrase.length; });
    return entries;
  }

  var AUTOWRAP_INDEX = null;
  var SKIP_TAGS = { A: 1, BUTTON: 1, SCRIPT: 1, STYLE: 1, INPUT: 1, TEXTAREA: 1, CODE: 1, PRE: 1, LABEL: 1, SELECT: 1 };

  function autoWrapTextNode(textNode) {
    if (!AUTOWRAP_INDEX) AUTOWRAP_INDEX = buildAutoWrapIndex();
    var text = textNode.nodeValue;
    if (!text || text.length < 3) return;
    // Build a regex that matches any known alias, word-bounded, case-insensitive.
    // Rebuilding each call would be expensive; build once.
    if (!autoWrapTextNode._re) {
      var union = AUTOWRAP_INDEX.map(function (e) {
        return e.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('|');
      autoWrapTextNode._re = new RegExp('\\b(' + union + ')\\b', 'i');
    }
    var re = autoWrapTextNode._re;
    var match = text.match(re);
    if (!match) return;
    var before = text.slice(0, match.index);
    var hit = match[0];
    var after = text.slice(match.index + hit.length);
    // find slug
    var hitLower = hit.toLowerCase();
    var found = AUTOWRAP_INDEX.find(function (e) { return e.lower === hitLower; });
    if (!found) return;
    var span = document.createElement('span');
    span.className = 'glossary';
    span.setAttribute('data-term', found.slug);
    span.setAttribute('tabindex', '0');
    span.textContent = hit;
    var parent = textNode.parentNode;
    if (before) parent.insertBefore(document.createTextNode(before), textNode);
    parent.insertBefore(span, textNode);
    textNode.nodeValue = after;
    // Recurse on the remainder so multiple terms in one text node all wrap.
    if (after && after.length) autoWrapTextNode(textNode);
  }

  function autoWrapContainer(root) {
    if (!root) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentNode;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.classList && parent.classList.contains('glossary')) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS[parent.tagName]) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    var n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(autoWrapTextNode);
  }

  function runAutoWrap() {
    document.querySelectorAll('.glossary-auto').forEach(autoWrapContainer);
    // Also ensure any .glossary span already in the DOM is focusable.
    document.querySelectorAll('.glossary[data-term]').forEach(function (el) {
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    });
  }

  // Observe dynamically added audit output so new content also gets wrapped.
  function startMutationWatcher() {
    if (!window.MutationObserver) return;
    var obs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          if (node.classList && node.classList.contains('glossary-auto')) {
            autoWrapContainer(node);
          } else if (node.querySelectorAll) {
            node.querySelectorAll('.glossary-auto').forEach(autoWrapContainer);
            // If the node itself is inside a .glossary-auto, wrap it.
            if (node.closest && node.closest('.glossary-auto')) {
              autoWrapContainer(node);
            }
          }
        });
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // --------------------------------------------------------------------
  // 5. Init
  // --------------------------------------------------------------------
  function init() {
    document.addEventListener('pointerover', onPointerOver, true);
    document.addEventListener('pointerout', onPointerOut, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeydown, true);
    window.addEventListener('scroll', function () {
      if (currentTarget) positionTooltip(currentTarget);
    }, { passive: true });
    window.addEventListener('resize', function () {
      if (currentTarget) positionTooltip(currentTarget);
    });
    runAutoWrap();
    startMutationWatcher();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for tests / programmatic use.
  window.GeoNeoGlossary = {
    GLOSSARY: GLOSSARY,
    runAutoWrap: runAutoWrap,
    hideTooltip: hideTooltip
  };
})();
