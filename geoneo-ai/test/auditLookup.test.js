const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

function bust(relPath) {
  delete require.cache[require.resolve(relPath)];
}

test('getLatestAuditForDomain matches subdomain query to apex audit', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geoneo-audit-lookup-'));
  const filePath = path.join(dir, 'audits.json');
  const createdAt = new Date().toISOString();
  try {
    await fs.writeFile(
      filePath,
      JSON.stringify([
        {
          createdAt,
          website: 'https://www.example-audit-test.com',
          finalUrl: 'https://www.example-audit-test.com/'
        }
      ]),
      'utf8'
    );

    bust('../services/auditLookup');
    const { getLatestAuditForDomain } = require('../services/auditLookup');

    const byBlog = await getLatestAuditForDomain('https://blog.example-audit-test.com/path', { filePath });
    assert.ok(byBlog);
    assert.equal(byBlog.website, 'https://www.example-audit-test.com');

    const missing = await getLatestAuditForDomain('other-site.net', { filePath });
    assert.equal(missing, null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
