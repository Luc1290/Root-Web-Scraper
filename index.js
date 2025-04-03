import express from 'express';
import { chromium } from 'playwright';

const app = express();
app.use(express.json());

app.post('/scrape', async (req, res) => {
  const { query } = req.body;
  console.log(`[SCRAPER] 🔍 Requête reçue pour : "${query}"`);

  if (!query) {
    console.log('[SCRAPER] ⚠️ Query manquante dans le body');
    return res.status(400).json({ error: 'Missing query' });
  }

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();

  try {
    const searchUrl = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;
    console.log(`[SCRAPER] 🔗 Navigation vers Brave Search : ${searchUrl}`);

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    console.log('[SCRAPER] ✅ Page Brave Search chargée');

    const linkSelector = 'a[href^="http"]:not([href*="brave.com"])';
    console.log(`[SCRAPER] 🔎 Attente du premier lien utile via le sélecteur : "${linkSelector}"`);
    await page.waitForSelector(linkSelector, { timeout: 10000 });

    const href = await page.getAttribute(linkSelector, 'href');
    console.log(`[SCRAPER] 🔗 Premier lien récupéré : ${href}`);

    if (!href) throw new Error('Aucun lien pertinent trouvé');

    console.log(`[SCRAPER] 🌍 Navigation vers le lien trouvé`);
    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 20000 });

    await page.waitForTimeout(1500);
    console.log(`[SCRAPER] ⏳ Petite pause pour laisser le DOM respirer`);

    const content = await page.evaluate(() => {
      return document.body?.innerText || 'Contenu vide';
    });

    console.log(`[SCRAPER] 📄 Contenu récupéré (${content.length} caractères)`);

    res.json({
      url: href,
      content: content.slice(0, 10000),
    });
  } catch (err) {
    console.error(`[SCRAPER] ❌ Erreur détectée : ${err.message}`);
    console.error(`[SCRAPER] 📛 Stack trace : ${err.stack}`);
    res.status(500).json({ error: err.message });
  } finally {
    console.log('[SCRAPER] 🧹 Fermeture du navigateur...');
    await browser.close();
    console.log('[SCRAPER] ✅ Navigateur fermé proprement');
  }
});

const port = process.env.PORT || 5123;
app.listen(port, () => {
  console.log(`✅ WebScraper en ligne sur port ${port}`);
});
