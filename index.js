import express from 'express';
import { chromium } from 'playwright';

const app = express();
app.use(express.json());

app.post('/scrape', async (req, res) => {
  const { query } = req.body;

  if (!query) {
    console.error('[SCRAPER] ❌ Requête sans query reçue');
    return res.status(400).json({ error: 'Missing query' });
  }

  console.log(`[SCRAPER] 🔍 Requête reçue pour : "${query}"`);

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();

  try {
    await page.goto(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`);
    await page.waitForTimeout(1500);

    const selector = 'a.result__a';
    await page.waitForSelector(selector);
    const href = await page.getAttribute(selector, 'href');

    if (!href) throw new Error('Aucun lien trouvé sur DuckDuckGo');

    await page.goto(href, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const content = await page.evaluate(() => document.body.innerText);
    await browser.close();

    res.json({
      url: href,
      content: content.slice(0, 10000)
    });
  } catch (err) {
    console.error('[SCRAPER] ❌ Erreur lors du scraping :', err.message);
    await browser.close();
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 5123;
app.listen(port, () => {
  console.log(`✅ WebScraper en ligne sur port ${port}`);
});
