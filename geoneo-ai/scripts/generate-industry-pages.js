#!/usr/bin/env node
/**
 * Generates industry-specific landing pages under /ozarks/<slug>.html
 *
 * These are vertical-specific "faces" of the GeoNeo AI site as described in
 * docs/POSITIONING.md. They all share the same scan tool, same pricing, and
 * same navigation — only the hero, example problem, and testimonial change.
 *
 * Run:
 *   node scripts/generate-industry-pages.js
 *
 * The script is idempotent: re-running overwrites the generated files.
 * If you want to hand-edit a specific page, delete this script's entry
 * for that industry and manage that file by hand.
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'ozarks');

const INDUSTRIES = [
  {
    slug: 'plumbers',
    name: 'plumbers',
    titleCase: 'Plumbers',
    // The single-word token that appears in the rotating hero on index.html
    rotatingWord: 'plumber',
    heroHook: 'Your next customer is asking ChatGPT "who\'s the best plumber near me?"',
    painExample: 'When a pipe bursts at 2am, homeowners don\'t flip through the yellow pages — they ask Siri, Google, or ChatGPT "who\'s the best emergency plumber near me?" If your site doesn\'t answer that question the way AI expects, the call goes to the plumber two towns over.',
    sampleQueries: [
      'emergency plumber Springfield MO',
      'water heater repair near me',
      'drain cleaning Branson MO',
      'best plumber in Ozark MO'
    ],
    industryPainPoints: [
      'You\'re paying Angi or HomeAdvisor $40-$80 per shared lead that 4 other plumbers also bought.',
      'Your SEO "package" from a marketing company shows charts every month but your phone isn\'t ringing more.',
      'You\'ve never seen what ChatGPT or Google AI actually says when someone searches for a plumber in your town.'
    ]
  },
  {
    slug: 'hvac',
    name: 'HVAC contractors',
    titleCase: 'HVAC Contractors',
    rotatingWord: 'HVAC company',
    heroHook: 'Your next customer is asking ChatGPT "who\'s the best HVAC company near me?"',
    painExample: 'During a 100-degree July week, homeowners are typing "AC not cooling help" into Google and asking ChatGPT for recommendations — not calling the first number they see. If you\'re not showing up in AI answers for your town, your competitor\'s install team is booked and yours isn\'t.',
    sampleQueries: [
      'ac repair Springfield MO',
      'emergency hvac Branson',
      'furnace repair near me',
      'hvac installation cost Ozarks'
    ],
    industryPainPoints: [
      'Seasonal demand swings destroy you — slow spring/fall, overwhelmed summer — and you have no visibility into why leads dry up.',
      'Your Google reviews are decent but you have no idea if ChatGPT or Perplexity ever mentions you.',
      'You\'re spending on Google Ads with zero transparency on whether organic/AI could pick up the same calls for free.'
    ]
  },
  {
    slug: 'roofers',
    name: 'roofers',
    titleCase: 'Roofers',
    rotatingWord: 'roofer',
    heroHook: 'After the next hailstorm, whose number will ChatGPT hand homeowners — yours or a competitor 30 miles away?',
    painExample: 'When hail hits SW Missouri, there are about 48 hours before every homeowner within 20 miles is searching "roof damage inspection" on Google and asking AI for recommendations. If you\'re not one of the three roofers AI names, a storm-chaser from Texas books the job before you finish loading your truck.',
    sampleQueries: [
      'roof repair after hail Branson MO',
      'best roofing contractor Springfield',
      'roof inspection near me',
      'emergency roofing Ozark MO'
    ],
    industryPainPoints: [
      'Storm-chasers from out of state show up after every hailstorm and steal jobs from local roofers who\'ve been here for 20 years.',
      'Your reviews are on Facebook and Google but no one has ever told you how AI assistants pick which roofer to recommend.',
      'You\'ve paid an SEO company thousands and have no idea whether your name appears when a homeowner asks ChatGPT "should I replace or repair my roof?"'
    ]
  },
  {
    slug: 'electricians',
    name: 'electricians',
    titleCase: 'Electricians',
    rotatingWord: 'electrician',
    heroHook: 'Your next customer is asking ChatGPT "who\'s the best electrician near me?"',
    painExample: 'Panel upgrades, EV charger installs, generator hookups — these are high-ticket jobs where the homeowner researches online before they call. They ask ChatGPT "do I need a licensed electrician for a 200-amp panel?" and whichever electrician\'s name comes up in that answer is the one getting the $4,000 job.',
    sampleQueries: [
      'emergency electrician Branson MO',
      'panel upgrade cost Springfield',
      'EV charger installation Ozarks',
      'best electrician near me'
    ],
    industryPainPoints: [
      'Insurance and code work requires licensed electricians but homeowners don\'t know how to tell a licensed pro from a handyman online.',
      'You haven\'t updated your website in years and Google/AI has no reason to recommend you over newer competitors with active content.',
      'Panel-upgrade and EV-charger work is booming but those leads are going to whoever shows up in AI answers, not whoever\'s the best electrician.'
    ]
  },
  {
    slug: 'pest-control',
    name: 'pest control companies',
    titleCase: 'Pest Control Companies',
    rotatingWord: 'pest control company',
    heroHook: 'Your next customer is asking ChatGPT "who\'s the best pest control company near me?"',
    painExample: 'Termite damage, mice in the attic, wasp nests — homeowners don\'t call the first number in the phone book anymore. They search "how much does termite treatment cost in Missouri" and the pest control company AI names is the one they call. If it\'s not you, it\'s the franchise that spends $20K/mo on SEO.',
    sampleQueries: [
      'termite treatment Springfield MO',
      'pest control Branson',
      'exterminator near me',
      'mouse infestation help Ozarks'
    ],
    industryPainPoints: [
      'National pest-control franchises outspend local operators on marketing 100-to-1, and they dominate both Google and AI answers by default.',
      'Your contracts are recurring revenue gold but you can only grow as fast as new leads come in — and lead flow is a black box.',
      'You\'ve never seen a report that shows which queries AI assistants name you in, so you can\'t tell what\'s working.'
    ]
  },
  {
    slug: 'tree-service',
    name: 'tree service companies',
    titleCase: 'Tree Service Companies',
    rotatingWord: 'tree service',
    heroHook: 'Your next customer is asking ChatGPT "who\'s the best tree service near me?"',
    painExample: 'An ice storm drops a 60-foot oak on someone\'s roof. Within an hour the homeowner is asking ChatGPT "emergency tree removal near me" and calling insurance. Whoever AI names gets the $3,500 removal. If it\'s not you, your chainsaw sits idle while your competitor\'s phone explodes.',
    sampleQueries: [
      'emergency tree removal Branson MO',
      'tree trimming Springfield',
      'stump grinding near me',
      'storm damage cleanup Ozarks'
    ],
    industryPainPoints: [
      'Emergency jobs from storms and ice are the highest-margin work you do, but only the top-ranked names in Google and AI get those calls.',
      'Unlicensed handymen with a chainsaw compete on price and the only way homeowners tell you apart is if a website or AI mentions your insurance and crew.',
      'Your busy seasons are short — when they hit, you need to be the first name AI recommends or you miss the window entirely.'
    ]
  },
  {
    slug: 'garage-door',
    name: 'garage door companies',
    titleCase: 'Garage Door Companies',
    rotatingWord: 'garage door company',
    heroHook: 'Your next customer is asking ChatGPT "who\'s the best garage door company near me?"',
    painExample: 'A broken spring at 7am on a workday is an emergency — the car is trapped inside. The homeowner asks Google or ChatGPT "garage door repair near me same day" and whichever company AI puts first gets the call. Ten minutes later, the job is booked with someone else.',
    sampleQueries: [
      'garage door repair Springfield MO',
      'garage door opener install',
      'broken spring replacement Branson',
      'same day garage door service Ozarks'
    ],
    industryPainPoints: [
      'National chains (Overhead Door, Garage Door Pros) dominate Google Ads and most AI answers default to whoever has the most citations, not the best service.',
      'Emergency calls (broken springs, stuck doors) are your highest-margin jobs but you compete against franchises with 24/7 call centers.',
      'Your installation quality and warranty are better than the chains but no one knows because your website doesn\'t say it in a way AI can extract.'
    ]
  },
  {
    slug: 'restoration',
    name: 'restoration companies',
    titleCase: 'Restoration Companies',
    rotatingWord: 'restoration company',
    heroHook: 'After the next flood or fire, whose number will ChatGPT give homeowners — yours or the franchise chain?',
    painExample: 'Water damage restoration is a $5,000-$50,000 job per event. A pipe bursts, a basement floods, someone Googles "water damage restoration near me" while they\'re still on hold with insurance. The restoration company AI names is the one the insurance adjuster approves. If it\'s not you, a SERVPRO van pulls in the driveway first.',
    sampleQueries: [
      'water damage restoration Springfield MO',
      'fire damage cleanup Branson',
      'mold remediation near me',
      'flood restoration Ozarks insurance'
    ],
    industryPainPoints: [
      'National franchises (SERVPRO, ServiceMaster, Rainbow International) have locked in both insurance referral networks and AI search answers.',
      'You do better work than the franchises but most homeowners never hear your name because their insurance app and Google both default to the chain.',
      'Mitigation jobs are 24/7 and high-value — missing the first 2 hours after an event costs you the whole job.'
    ]
  }
];

const TEMPLATE = ({ slug, name, titleCase, heroHook, painExample, sampleQueries, industryPainPoints }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GeoNeo AI for ${titleCase} in the Ozarks | AI-Search Visibility Scan</title>
  <meta name="description" content="Free AI-search visibility scan for ${name} in Springfield MO, Branson MO, Ozark, Nixa, Fayetteville AR, and the wider Ozarks. See what Google, Google Maps, and ChatGPT say about your business plus the 3 fixes to make this week." />
  <meta name="robots" content="index, follow" />
  <meta property="og:title" content="GeoNeo AI for Ozarks ${titleCase}" />
  <meta property="og:description" content="${heroHook.replace(/"/g, '&quot;')}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://geoneo.ai/ozarks/${slug}.html" />
  <meta property="og:image" content="https://geoneo.ai/og-image.png" />
  <link rel="canonical" href="https://geoneo.ai/ozarks/${slug}.html" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../styles.css" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>G</text></svg>" />
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Service",
      "name": "AI-Search Visibility for Ozarks ${titleCase}",
      "provider": {
        "@type": "Organization",
        "name": "GeoNeo AI",
        "url": "https://geoneo.ai",
        "address": { "@type": "PostalAddress", "addressLocality": "Branson", "addressRegion": "MO", "postalCode": "65616", "addressCountry": "US" }
      },
      "areaServed": [
        { "@type": "Place", "name": "Springfield, MO" },
        { "@type": "Place", "name": "Branson, MO" },
        { "@type": "Place", "name": "Ozark, MO" },
        { "@type": "Place", "name": "Nixa, MO" },
        { "@type": "Place", "name": "Joplin, MO" },
        { "@type": "Place", "name": "Fayetteville, AR" },
        { "@type": "Place", "name": "Rogers, AR" },
        { "@type": "Place", "name": "Bentonville, AR" }
      ],
      "serviceType": "Local SEO and AI Search Visibility Audit",
      "audience": { "@type": "BusinessAudience", "audienceType": "${titleCase}" }
    }
  </script>
  <style>
    .vertical-hero {
      padding: clamp(3rem, 8vw, 5rem) 0 clamp(2rem, 6vw, 4rem);
      text-align: center;
    }
    .vertical-hero h1 {
      font-size: clamp(2rem, 5vw, 3.2rem);
      margin: 0 0 1rem;
      line-height: 1.15;
      max-width: 22ch;
      margin-left: auto;
      margin-right: auto;
    }
    .vertical-hero .hero-sub {
      color: var(--muted);
      font-size: clamp(1rem, 2vw, 1.15rem);
      max-width: 560px;
      margin: 0 auto 2rem;
    }
    .scan-box {
      width: 100%;
      max-width: 560px;
      margin: 0 auto;
    }
    .scan-input-wrap {
      display: flex;
      border-radius: 16px;
      border: 2px solid var(--line);
      background: var(--surface);
      overflow: hidden;
      transition: border-color 0.3s ease, box-shadow 0.3s ease;
    }
    .scan-input-wrap:focus-within {
      border-color: var(--brand);
      box-shadow: 0 0 0 4px rgba(0, 229, 160, 0.1), 0 8px 32px rgba(0, 0, 0, 0.3);
    }
    .scan-input-wrap input {
      flex: 1;
      border: none;
      background: transparent;
      color: var(--ink);
      font-size: 1.05rem;
      padding: 1rem 1.3rem;
      outline: none;
      font-family: inherit;
    }
    .scan-input-wrap input::placeholder { color: var(--muted); }
    .scan-input-wrap button {
      border: none;
      background: linear-gradient(135deg, var(--brand), var(--brand-strong));
      color: #0a0f1a;
      font-weight: 700;
      font-size: 0.95rem;
      padding: 1rem 1.6rem;
      cursor: pointer;
      font-family: inherit;
      white-space: nowrap;
      transition: filter 0.2s ease;
    }
    .scan-input-wrap button:hover { filter: brightness(1.1); }
    .pain-section {
      padding: clamp(3rem, 6vw, 5rem) 0;
      border-top: 1px solid var(--line);
    }
    .pain-section h2 {
      font-size: clamp(1.5rem, 3vw, 2.2rem);
      margin: 0 0 1.5rem;
      max-width: 26ch;
    }
    .pain-card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: clamp(1.5rem, 3vw, 2rem);
      margin: 0 0 1rem;
      color: var(--ink);
    }
    .pain-points {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 0.9rem;
    }
    .pain-points li {
      padding-left: 2rem;
      position: relative;
      color: var(--muted);
    }
    .pain-points li::before {
      content: "×";
      position: absolute;
      left: 0;
      top: -4px;
      color: var(--accent);
      font-size: 1.6rem;
      font-weight: 700;
    }
    .sample-queries {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 0.75rem;
      padding: 0;
      margin: 1.5rem 0 0;
      list-style: none;
    }
    .sample-queries li {
      background: rgba(0, 229, 160, 0.06);
      border: 1px solid rgba(0, 229, 160, 0.25);
      color: var(--ink);
      padding: 0.75rem 1rem;
      border-radius: 10px;
      font-size: 0.95rem;
    }
    .cta-section {
      padding: clamp(3rem, 6vw, 5rem) 0;
      text-align: center;
      border-top: 1px solid var(--line);
    }
    .cta-section h2 {
      font-size: clamp(1.6rem, 3vw, 2.4rem);
      max-width: 20ch;
      margin: 0 auto 1rem;
    }
    .cta-section p {
      color: var(--muted);
      max-width: 520px;
      margin: 0 auto 2rem;
    }
  </style>
</head>
<body>
  <header class="site-header">
    <a href="../index.html" class="brand">
      <span class="brand-mark" aria-hidden="true">G</span>
      <span class="brand-text">GeoNeo AI</span>
    </a>
    <nav>
      <a href="../index.html">Home</a>
      <a href="../index.html#proof">Results</a>
      <a href="../pitch-deck.html">For Investors</a>
    </nav>
  </header>

  <main>
    <section class="vertical-hero container">
      <h1>${heroHook}</h1>
      <p class="hero-sub">Will it say your name — or your competitor's?<br/>
        Free 60-second scan for Ozarks ${name}. See your Google, Maps, and ChatGPT visibility — and the 3 fixes to make this week.</p>

      <div class="scan-box">
        <form class="scan-input-wrap" action="../both-audit.html" method="get">
          <input type="text" name="url" placeholder="Your website or business name..." autocomplete="off" required aria-label="Your website or business name" />
          <button type="submit">Scan My Business</button>
        </form>
        <p class="scan-trust" style="text-align:center;color:var(--muted);margin-top:0.75rem;font-size:0.85rem;">Free instant scan&nbsp;&nbsp;•&nbsp;&nbsp;No signup required&nbsp;&nbsp;•&nbsp;&nbsp;Results in 60 seconds</p>
      </div>
    </section>

    <section class="pain-section container">
      <h2>Why most Ozarks ${name} are invisible in AI search</h2>
      <div class="pain-card">
        <p style="margin:0;font-size:1.05rem;line-height:1.65;">${painExample}</p>
      </div>

      <h3 style="margin-top:2.5rem;margin-bottom:0.5rem;">Queries your customers are actually running right now:</h3>
      <ul class="sample-queries">
        ${sampleQueries.map((q) => `<li>${q}</li>`).join('\n        ')}
      </ul>
    </section>

    <section class="pain-section container">
      <h2>What's costing you jobs right now</h2>
      <ul class="pain-points">
        ${industryPainPoints.map((p) => `<li>${p}</li>`).join('\n        ')}
      </ul>
    </section>

    <section class="cta-section container">
      <h2>Find out where you rank — in 60 seconds, free.</h2>
      <p>Enter your business name or website. We'll show you exactly what Google, Google Maps, and ChatGPT say about you — plus the 3 changes to make this week to get more of the calls AI is currently sending to your competitors.</p>
      <form class="scan-input-wrap" action="../both-audit.html" method="get" style="max-width:560px;margin:0 auto;">
        <input type="text" name="url" placeholder="Your website or business name..." autocomplete="off" required />
        <button type="submit">Run Free Scan</button>
      </form>
    </section>
  </main>

  <footer class="site-footer">
    <div class="footer-row container">
      <div class="footer-brand">
        <span class="brand-mark" aria-hidden="true">G</span>
        <strong>GeoNeo AI</strong>
        <p>AI-search visibility for Ozarks home-service contractors.</p>
      </div>
      <div class="footer-links">
        <strong>Industries</strong>
        <a href="plumbers.html">Plumbers</a>
        <a href="hvac.html">HVAC</a>
        <a href="roofers.html">Roofers</a>
        <a href="electricians.html">Electricians</a>
        <a href="pest-control.html">Pest Control</a>
        <a href="tree-service.html">Tree Service</a>
        <a href="garage-door.html">Garage Door</a>
        <a href="restoration.html">Restoration</a>
      </div>
      <div class="footer-links">
        <strong>Contact</strong>
        <p>Branson, MO 65616</p>
        <p><a href="mailto:hello@geoneo.ai">hello@geoneo.ai</a></p>
      </div>
    </div>
    <div class="footer-bottom">
      <p>&copy; 2026 GeoNeo AI. All rights reserved.</p>
    </div>
  </footer>
</body>
</html>
`;

function main() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }
  INDUSTRIES.forEach((industry) => {
    const html = TEMPLATE(industry);
    const outPath = path.join(OUT_DIR, `${industry.slug}.html`);
    fs.writeFileSync(outPath, html, 'utf8');
    console.log(`wrote ${outPath}`);
  });
  console.log(`\nGenerated ${INDUSTRIES.length} pages.`);
}

if (require.main === module) {
  main();
}

module.exports = { INDUSTRIES, TEMPLATE };
