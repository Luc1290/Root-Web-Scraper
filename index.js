const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json());

app.post("/scrape", async (req, res) => {
  const { query } = req.body;

  console.log(`[SCRAPER] 🔍 Requête reçue pour : "${query}"`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const searchUrl = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;
    console.log(`[SCRAPER] 🔗 Navigation vers Brave Search : ${searchUrl}`);
    await page.goto(searchUrl, { timeout: 20000 });

    console.log(`[SCRAPER] ✅ Page Brave Search chargée`);
    const firstLinkSelector = 'a[href^="http"]:not([href*="brave.com"])';
    console.log(`[SCRAPER] 🔎 Attente du premier lien utile via le sélecteur : "${firstLinkSelector}"`);

    await page.waitForSelector(firstLinkSelector, { timeout: 10000 });

    const firstLink = await page.getAttribute(firstLinkSelector, "href");
    console.log(`[SCRAPER] 🔗 Premier lien récupéré : ${firstLink}`);

    console.log(`[SCRAPER] 🌍 Navigation vers le lien trouvé`);
    await page.goto(firstLink, { timeout: 20000 });

    console.log(`[SCRAPER] ⏳ Petite pause pour laisser le DOM respirer`);
    await page.waitForTimeout(2000);

    const textContent = await page.evaluate(() => document.body.innerText);
    console.log(`[SCRAPER] 📄 Contenu récupéré (${textContent.length} caractères)`);

    res.json({ content: textContent });
  } catch (error) {
    console.error(`[SCRAPER] ❌ Erreur lors du scraping : ${error.message}`);
    res.status(500).json({ error: error.message });
  } finally {
    console.log(`[SCRAPER] 🧹 Fermeture du navigateur...`);
    await browser.close();
    console.log(`[SCRAPER] ✅ Navigateur fermé proprement`);
  }
});

const PORT = process.env.PORT || 5123;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ WebScraper en ligne sur port ${PORT}`);
});
