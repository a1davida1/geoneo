/**
 * AI Citation Fixer Service
 * Analyzes a page against AI model responses and generates specific,
 * plain-English fixes for local businesses to get cited by AI.
 */

const https = require('https');
const http = require('http');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';

// Generate industry-relevant queries a customer would want to be cited for
function generateTargetQueries(industry, city, state, businessName) {
  const location = [city, state].filter(Boolean).join(', ');
  const queries = [];

  if (location) {
    queries.push(`best ${industry} in ${location}`);
    queries.push(`who is the best ${industry} near ${location}`);
    queries.push(`top rated ${industry} ${location} recommendations`);
  }
  if (businessName && location) {
    queries.push(`is ${businessName} good for ${industry} in ${location}`);
  }
  queries.push(`how to choose a ${industry} in ${location || 'my area'}`);

  return queries.slice(0, 5);
}

// Fetch a page's content for analysis
async function fetchPageContent(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const req = client.get(parsedUrl.href, { timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPageContent(res.headers.location, timeoutMs).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

// Strip HTML to get text content + structure info
function parsePageStructure(html) {
  const structure = {
    title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '',
    h1s: (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) || []).map(h => h.replace(/<[^>]+>/g, '').trim()),
    h2s: (html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi) || []).map(h => h.replace(/<[^>]+>/g, '').trim()),
    hasSchema: /application\/ld\+json/i.test(html),
    hasFaqSchema: /FAQPage/i.test(html),
    hasLocalBusinessSchema: /LocalBusiness|ProfessionalService/i.test(html),
    hasBlockquotes: /<blockquote/i.test(html),
    statCount: (html.match(/\d+(\.\d+)?%|\$[\d,]+|\d+\+?\s*(years?|customers?|projects?|reviews?)/gi) || []).length,
    wordCount: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').length,
    hasPhone: /(\(\d{3}\)\s*\d{3}[-.]?\d{4}|\d{3}[-.]?\d{3}[-.]?\d{4})/.test(html),
    hasAddress: /<address/i.test(html) || /\d+\s+\w+\s+(st|street|ave|avenue|blvd|rd|road|dr|drive)/i.test(html),
    firstParagraph: (html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').match(/<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1]?.replace(/<[^>]+>/g, '').trim().slice(0, 200) || '',
    textContent: html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000)
  };
  return structure;
}

// Query an AI model and extract which sources it cites
async function queryAIModel(query) {
  const results = { citations: [], response: '', model: '' };

  // Try Perplexity first (97% citation rate)
  if (PERPLEXITY_API_KEY) {
    try {
      const perplexityResult = await callPerplexity(query);
      results.citations = perplexityResult.citations || [];
      results.response = perplexityResult.response || '';
      results.model = 'perplexity';
      return results;
    } catch (e) { /* fall through */ }
  }

  // Fallback to OpenAI with browsing
  if (OPENAI_API_KEY) {
    try {
      const openaiResult = await callOpenAI(query);
      results.citations = openaiResult.citations || [];
      results.response = openaiResult.response || '';
      results.model = 'openai';
      return results;
    } catch (e) { /* fall through */ }
  }

  return results;
}

function callPerplexity(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'sonar',
      messages: [{ role: 'user', content: query }]
    });
    const req = https.request({
      hostname: 'api.perplexity.ai',
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({
            response: parsed.choices?.[0]?.message?.content || '',
            citations: parsed.citations || []
          });
        } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function callOpenAI(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Answer the question and cite specific websites/sources you reference. Format citations as URLs.' },
        { role: 'user', content: query }
      ]
    });
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.message?.content || '';
          const urls = content.match(/https?:\/\/[^\s)"\]]+/g) || [];
          resolve({ response: content, citations: urls });
        } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Score page against citation factors and generate fixes
function generateFixes(pageStructure, citationResults, { url, industry, city, state, businessName }) {
  const fixes = [];
  const location = [city, state].filter(Boolean).join(', ');

  // 1. Answer-first structure
  if (!pageStructure.h2s.some(h => h.includes('?'))) {
    fixes.push({
      priority: 1,
      category: 'Content Structure',
      issue: 'No question-based headings',
      fix: `Add H2 headings as questions your customers ask. Example: "What makes ${businessName || 'us'} the best ${industry} in ${location}?"`,
      impact: '+30-40% citation rate'
    });
  }

  // 2. Statistics
  if (pageStructure.statCount < 3) {
    fixes.push({
      priority: 1,
      category: 'Statistics',
      issue: `Only ${pageStructure.statCount} statistics found on page`,
      fix: `Add 3-5 specific stats with sources. Examples: "${Math.floor(Math.random() * 500) + 500}+ projects completed since ${2020 + Math.floor(Math.random() * 3)}", "98% customer satisfaction rate (based on ${Math.floor(Math.random() * 200) + 50} reviews)", "Serving ${location} for ${Math.floor(Math.random() * 10) + 5}+ years"`,
      impact: '+41% AI visibility — the #1 factor'
    });
  }

  // 3. Expert quotes / testimonials with attribution
  if (!pageStructure.hasBlockquotes) {
    fixes.push({
      priority: 2,
      category: 'Expert Quotes',
      issue: 'No attributed quotes or testimonials found',
      fix: `Add 2-3 customer testimonials using <blockquote> tags with the customer's full name and context. Example: <blockquote>"${businessName || 'They'} did an incredible job on our ${industry} project — finished ahead of schedule." — John Smith, ${location} homeowner</blockquote>`,
      impact: '+28-41% AI visibility'
    });
  }

  // 4. FAQ Schema
  if (!pageStructure.hasFaqSchema) {
    fixes.push({
      priority: 2,
      category: 'Schema Markup',
      issue: 'No FAQ schema detected',
      fix: `Add FAQPage schema with 3-5 questions your customers actually ask. Start with: "How much does ${industry} cost in ${location}?", "What should I look for in a ${industry}?", "How long does ${industry} take?"`,
      impact: '2.6x citation boost for FAQ content'
    });
  }

  // 5. LocalBusiness schema
  if (!pageStructure.hasLocalBusinessSchema) {
    fixes.push({
      priority: 2,
      category: 'Schema Markup',
      issue: 'No LocalBusiness/ProfessionalService schema',
      fix: `Add LocalBusiness JSON-LD schema with your name, address, phone, hours, service area, and sameAs links to your Google Business Profile, Facebook, and Yelp.`,
      impact: '+30-60% AI parsing accuracy'
    });
  }

  // 6. Direct answer in first paragraph
  if (pageStructure.firstParagraph && !pageStructure.firstParagraph.toLowerCase().includes(industry?.toLowerCase() || '___')) {
    fixes.push({
      priority: 1,
      category: 'Content Structure',
      issue: 'First paragraph doesn\'t directly answer what you do + where',
      fix: `Start your page with a direct statement: "${businessName || 'We'} is ${location ? location + '\'s' : 'a'} top-rated ${industry} with [X] years of experience and [X]+ completed projects." AI models pull from the first 40-60 words.`,
      impact: 'Critical — AI extracts from the first paragraph'
    });
  }

  // 7. Citation results analysis
  const cited = citationResults.filter(r => r.citations.length > 0);
  const customerDomain = extractDomain(url);
  const isCited = cited.some(r => r.citations.some(c => c.includes(customerDomain)));

  if (!isCited && cited.length > 0) {
    const competitorDomains = [...new Set(cited.flatMap(r => r.citations).map(extractDomain).filter(d => d && d !== customerDomain))].slice(0, 3);
    if (competitorDomains.length > 0) {
      fixes.push({
        priority: 1,
        category: 'AI Citation Gap',
        issue: `AI models cite ${competitorDomains.join(', ')} instead of you`,
        fix: `These competitors are getting cited because their content directly answers the query in a structured, quotable format. Study their pages and ensure your content answers the same questions more specifically with local proof.`,
        impact: 'Direct — you\'re invisible to AI right now'
      });
    }
  }

  // 8. Content length
  if (pageStructure.wordCount < 800) {
    fixes.push({
      priority: 3,
      category: 'Content Depth',
      issue: `Page has ~${pageStructure.wordCount} words — too thin for AI citation`,
      fix: `Expand to 1,200-1,500 words minimum. Add sections covering: your process, service area, pricing transparency, credentials/certifications, and a comparison with alternatives.`,
      impact: 'Thin pages rarely get cited'
    });
  }

  // 9. NAP consistency
  if (!pageStructure.hasPhone || !pageStructure.hasAddress) {
    fixes.push({
      priority: 3,
      category: 'Local Signals',
      issue: 'Missing visible phone number or street address',
      fix: 'Add your full business name, address, and phone number (NAP) in the page footer and contact section. AI models cross-reference this with Google Business Profile.',
      impact: 'Required for local AI citations'
    });
  }

  // Sort by priority
  fixes.sort((a, b) => a.priority - b.priority);

  return {
    totalFixes: fixes.length,
    citationStatus: isCited ? 'cited' : 'not_cited',
    queriesTested: citationResults.length,
    queriesCited: cited.length,
    fixes
  };
}

function extractDomain(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '');
  } catch { return ''; }
}

/**
 * Main entry point: run the citation fixer analysis
 */
async function runCitationFixer({ url, industry, city, state, businessName }) {
  // 1. Fetch and parse the customer's page
  let pageStructure;
  try {
    const html = await fetchPageContent(url);
    pageStructure = parsePageStructure(html);
  } catch (e) {
    pageStructure = parsePageStructure('');
  }

  // 2. Generate and run target queries
  const queries = generateTargetQueries(industry, city, state, businessName);
  const citationResults = [];

  for (const query of queries) {
    try {
      const result = await queryAIModel(query);
      citationResults.push({ query, ...result });
    } catch (e) {
      citationResults.push({ query, citations: [], response: '', model: 'failed' });
    }
  }

  // 3. Generate fixes
  const analysis = generateFixes(pageStructure, citationResults, { url, industry, city, state, businessName });

  return {
    url,
    industry,
    location: [city, state].filter(Boolean).join(', '),
    businessName,
    pageStructure: {
      title: pageStructure.title,
      h1s: pageStructure.h1s,
      h2s: pageStructure.h2s,
      wordCount: pageStructure.wordCount,
      hasSchema: pageStructure.hasSchema,
      hasFaqSchema: pageStructure.hasFaqSchema,
      statCount: pageStructure.statCount
    },
    citationResults: citationResults.map(r => ({
      query: r.query,
      model: r.model,
      citedUrls: r.citations.slice(0, 10),
      customerCited: r.citations.some(c => c.includes(extractDomain(url)))
    })),
    ...analysis
  };
}

module.exports = { runCitationFixer, generateTargetQueries, generateFixes, parsePageStructure };
