import express from 'express';
import { chromium } from 'playwright';

const app = express();
app.use(express.json());

app.post('/scrape', async (req, res) => {
  const { query } = req.body;

  console.log(`[SCRAPER] 🔍 Requête reçue pour : "${query}"`);

  if (!query) return res.status(400).json({ error: 'Missing query' });

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();

  try {
    await page.goto(`https://search.brave.com/search?q=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Nouveau sélecteur Brave Search
    const selector = 'a.result-title';
    await page.waitForSelector(selector, { timeout: 10000 });

    const href = await page.getAttribute(selector, 'href');
    if (!href) throw new Error('Aucun lien trouvé');

    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1000);

    const content = await page.evaluate(() => document.body.innerText);
    await browser.close();

    res.json({
      url: href,
      content: content.slice(0, 10000)
    });
  } catch (err) {
    await browser.close();
    console.error(`[SCRAPER] ❌ Erreur lors du scraping : ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 5123;
app.listen(port, () => {
  console.log(`✅ WebScraper en ligne sur port ${port}`);
});
