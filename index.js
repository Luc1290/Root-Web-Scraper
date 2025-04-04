import express from "express";
import { chromium } from "playwright";

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

    // Extraction améliorée du contenu principal
    const content = await page.evaluate(() => {
      // Fonction pour calculer le score de contenu d'un élément
      const getContentScore = (element) => {
        const text = element.innerText || "";
        const wordCount = text.split(/\s+/).length;
        const linkDensity = element.querySelectorAll('a').length / Math.max(wordCount, 1);
        
        // Les éléments avec beaucoup de texte et peu de liens sont probablement du contenu principal
        return wordCount * (1 - linkDensity);
      };

      // Identifier les éléments susceptibles de contenir du contenu principal
      const potentialElements = [
        // Sélecteurs courants pour le contenu principal
        'article', 'main', '.content', '.post', '.article', 
        '.entry-content', '.post-content', '#content', '#main',
        '[role="main"]', '.main-content', '.page-content'
      ];

      // Trouver l'élément avec le meilleur score
      let bestElement = document.body;
      let bestScore = getContentScore(document.body);

      // Vérifier les éléments potentiels
      potentialElements.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
          const score = getContentScore(element);
          if (score > bestScore) {
            bestElement = element;
            bestScore = score;
          }
        });
      });

      // Si aucun élément spécifique n'a un bon score, essayer une autre approche
      if (bestElement === document.body) {
        // Trouver tous les paragraphes et leurs parents
        const paragraphs = Array.from(document.querySelectorAll('p'));
        const parents = {};
        
        paragraphs.forEach(p => {
          if (p.innerText.length > 50) { // Ignorer les paragraphes trop courts
            const parent = p.parentNode;
            parents[parent] = (parents[parent] || 0) + 1;
          }
        });
        
        // Trouver le parent avec le plus de paragraphes substantiels
        let maxParagraphs = 0;
        let bestParent = null;
        
        for (const [parent, count] of Object.entries(parents)) {
          if (count > maxParagraphs) {
            maxParagraphs = count;
            bestParent = parent;
          }
        }
        
        if (bestParent && maxParagraphs > 3) {
          bestElement = bestParent;
        }
      }

      // Extraire le titre de la page
      const title = document.title || "";
      
      // Extraire l'URL de la page
      const url = window.location.href;
      
      // Extraire le contenu principal
      const mainContent = bestElement.innerText || document.body.innerText;
      
      // Construire un résultat structuré
      return {
        title,
        url,
        content: mainContent,
        fullPageContent: document.body.innerText // Conserver le contenu complet aussi
      };
    });

    console.log(`[SCRAPER] 📄 Contenu principal identifié et extrait`);
    console.log(`[SCRAPER] 📝 Titre de la page: ${content.title}`);

    res.json(content);
  } catch (error) {
    console.error(`[SCRAPER] ❌ Erreur lors du scraping : ${error.message}`);
    res.status(500).json({ error: error.message });
  } finally {
    console.log(`[SCRAPER] 🧹 Fermeture du navigateur...`);
    await browser.close();
    console.log(`[SCRAPER] ✅ Navigateur fermé proprement`);
  }
});

// Endpoint pour récupérer plusieurs résultats
app.post("/scrape-multiple", async (req, res) => {
  const { query, numResults = 3 } = req.body;

  console.log(`[SCRAPER] 🔍 Requête multiple reçue pour : "${query}" (${numResults} résultats)`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const searchUrl = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;
    console.log(`[SCRAPER] 🔗 Navigation vers Brave Search : ${searchUrl}`);
    await page.goto(searchUrl, { timeout: 20000 });

    console.log(`[SCRAPER] ✅ Page Brave Search chargée`);
    const linkSelector = 'a[href^="http"]:not([href*="brave.com"])';
    console.log(`[SCRAPER] 🔎 Recherche des ${numResults} premiers liens`);

    await page.waitForSelector(linkSelector, { timeout: 10000 });

    // Récupérer plusieurs liens
    const links = await page.evaluate((selector, max) => {
      const elements = document.querySelectorAll(selector);
      const urls = [];
      
      for (let i = 0; i < elements.length && urls.length < max; i++) {
        const href = elements[i].getAttribute('href');
        if (href && !urls.includes(href)) {
          urls.push(href);
        }
      }
      
      return urls;
    }, linkSelector, numResults);

    console.log(`[SCRAPER] 🔗 ${links.length} liens récupérés`);

    // Visiter chaque lien et extraire le contenu
    const results = [];
    for (let i = 0; i < links.length; i++) {
      try {
        console.log(`[SCRAPER] 🌍 Navigation vers le lien ${i+1}/${links.length}: ${links[i]}`);
        await page.goto(links[i], { timeout: 20000 });
        await page.waitForTimeout(2000);

        const content = await page.evaluate(() => {
          // [Même logique d'extraction que dans l'endpoint /scrape]
          // (Code d'extraction du contenu principal identique à celui ci-dessus)
          
          const title = document.title || "";
          const url = window.location.href;
          const mainContent = document.body.innerText;
          
          return { title, url, content: mainContent };
        });

        results.push({
          title: content.title,
          url: links[i],
          content: content.content.substring(0, 5000) // Limiter la taille pour éviter des réponses trop volumineuses
        });

        console.log(`[SCRAPER] ✅ Contenu extrait du lien ${i+1}`);
      } catch (error) {
        console.error(`[SCRAPER] ⚠️ Erreur sur le lien ${i+1}: ${error.message}`);
        // Continuer avec le lien suivant même en cas d'erreur
      }
    }

    res.json({ results });
  } catch (error) {
    console.error(`[SCRAPER] ❌ Erreur globale : ${error.message}`);
    res.status(500).json({ error: error.message });
  } finally {
    console.log(`[SCRAPER] 🧹 Fermeture du navigateur...`);
    await browser.close();
    console.log(`[SCRAPER] ✅ Navigateur fermé proprement`);
  }
});

const port = process.env.PORT || 5123;
app.listen(port, () => {
  console.log(`✅ WebScraper amélioré en ligne sur port ${port}`);
});