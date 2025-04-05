import express from "express";
import { chromium } from "playwright";
import cors from "cors";
import morgan from "morgan";
import { rateLimit } from "express-rate-limit";
import compression from "compression";

const app = express();

// Middleware de base
app.use(express.json({ limit: '1mb' }));
app.use(compression());
app.use(morgan('[:date[iso]] ":method :url HTTP/:http-version" :status :res[content-length] - :response-time ms'));

// Configuration CORS
app.use(cors({
    origin: [
        'https://rootai.fr',
        'https://www.rootai.fr',
        'https://api.rootai.fr',
        'http://localhost:3000',
        'http://localhost:8080'
    ],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Limiter le nombre de requêtes pour éviter les abus
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 20, // 20 requêtes max par fenêtre
    standardHeaders: true,
    message: { error: "Trop de requêtes, veuillez réessayer plus tard" }
});
app.use(limiter);

// Gestionnaire global des erreurs
app.use((err, req, res, next) => {
    console.error(`[SCRAPER] ❌ Erreur: ${err.message}`);
    res.status(500).json({ error: "Erreur serveur interne" });
});

// Fonction partagée pour extraire le contenu principal
const extractMainContent = async (page) => {
    return await page.evaluate(() => {
        // Fonction pour calculer le score de contenu d'un élément
        const getContentScore = (element) => {
            const text = element.innerText || "";
            if (!text) return 0;

            const wordCount = text.split(/\s+/).length;
            if (wordCount < 20) return 0; // Ignorer les éléments avec peu de texte

            const linkDensity = element.querySelectorAll('a').length / Math.max(wordCount, 1);

            // Pénaliser les éléments avec beaucoup de liens ou peu de contenu
            return wordCount * (1 - linkDensity);
        };

        // Identifier les éléments susceptibles de contenir du contenu principal
        const potentialSelectors = [
            'article', 'main', '.content', '.post', '.article',
            '.entry-content', '.post-content', '#content', '#main',
            '[role="main"]', '.main-content', '.page-content'
        ];

        // Trouver l'élément avec le meilleur score
        let bestElement = document.body;
        let bestScore = getContentScore(document.body);

        // Vérifier les éléments potentiels
        potentialSelectors.forEach(selector => {
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

            for (const parent in parents) {
                if (parents[parent] > maxParagraphs) {
                    maxParagraphs = parents[parent];
                    bestParent = parent;
                }
            }

            if (bestParent && maxParagraphs > 3) {
                bestElement = bestParent;
            }
        }

        // Nettoyer le texte extrait
        const cleanText = text => {
            return text
                .replace(/\s+/g, ' ')
                .replace(/\n\s*\n/g, '\n\n')
                .trim();
        };

        // Extraire les informations
        const title = document.title || "";
        const url = window.location.href;
        const mainContent = cleanText(bestElement.innerText || document.body.innerText);

        return {
            title,
            url,
            content: mainContent,
            fullPageContent: cleanText(document.body.innerText)
        };
    });
};

// Fonction spécifique pour extraire des données météo depuis Météo-France
const extractMeteoFranceData = async (page) => {
    return await page.evaluate(() => {
        // Fonction pour trouver les éléments contenant des informations météo
        const getMeteoData = () => {
            // Sélecteurs spécifiques à Météo-France
            const weatherElements = {
                temperature: document.querySelector('.tm'),
                summary: document.querySelector('.day-summary'),
                forecast: document.querySelector('.forecast-summary'),
                precipitation: document.querySelector('.rain-summary'),
                bulletinComplet: document.querySelector('.bulletin-day-long')
            };

            // Récupération des valeurs
            const data = {
                temperature: weatherElements.temperature ? weatherElements.temperature.innerText.trim() : null,
                summary: weatherElements.summary ? weatherElements.summary.innerText.trim() : null,
                forecast: weatherElements.forecast ? weatherElements.forecast.innerText.trim() : null,
                precipitation: weatherElements.precipitation ? weatherElements.precipitation.innerText.trim() : null,
                bulletin: weatherElements.bulletinComplet ? weatherElements.bulletinComplet.innerText.trim() : null
            };

            return data;
        };

        // Extraire les informations de base
        const title = document.title || "";
        const url = window.location.href;
        const meteoData = getMeteoData();
        
        // Trouver le conteneur principal des informations météo
        const mainContainer = document.querySelector('.container-jour-actuel') || 
                              document.querySelector('.container-previsions') ||
                              document.querySelector('main');
                              
        const mainContent = mainContainer ? mainContainer.innerText : document.body.innerText;
        
        // Nettoyer le texte extrait
        const cleanText = text => {
            return text
                .replace(/\s+/g, ' ')
                .replace(/\n\s*\n/g, '\n\n')
                .trim();
        };

        return {
            title,
            url,
            meteoData,
            content: cleanText(mainContent),
            fullPageContent: cleanText(document.body.innerText)
        };
    });
};

// Vérifier si une requête concerne la météo
const isWeatherQuery = (query) => {
    return /météo|meteo|temps|temperature|climat/i.test(query);
};

// Extraire le nom de la ville depuis une requête météo
const extractCityFromQuery = (query) => {
    // Différents patterns possibles pour capturer le nom de la ville
    const patterns = [
        /météo\s+(?:à|a|au|en)\s+([A-Za-zÀ-ÖØ-öø-ÿ\-]+)/i,  // "météo à Paris"
        /meteo\s+(?:à|a|au|en)\s+([A-Za-zÀ-ÖØ-öø-ÿ\-]+)/i,  // "meteo à Paris"
        /temps\s+(?:à|a|au|en)\s+([A-Za-zÀ-ÖØ-öø-ÿ\-]+)/i,  // "temps à Paris"
        /(?:à|a|au|en)\s+([A-Za-zÀ-ÖØ-öø-ÿ\-]+)(?:\s+météo|\s+meteo)/i, // "à Paris météo"
        /([A-Za-zÀ-ÖØ-öø-ÿ\-]+)(?:\s+météo|\s+meteo)/i      // "Paris météo"
    ];

    for (const pattern of patterns) {
        const match = query.match(pattern);
        if (match && match[1]) {
            return match[1].trim();
        }
    }
    
    return null;
};

// Endpoint pour récupérer un résultat
app.post("/scrape", async (req, res) => {
    const { query } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return res.status(400).json({ error: "Requête de recherche invalide" });
    }

    console.log(`[SCRAPER] 🔍 Requête reçue pour : "${query}"`);

    let browser = null;
    try {
        // Paramètres améliorés pour playwright
        browser = await chromium.launch({
            headless: true,
            args: ['--disable-gpu', '--disable-dev-shm-usage', '--disable-setuid-sandbox', '--no-sandbox']
        });
        const page = await browser.newPage();

        // Configuration avancée de la page
        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36',
            'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
        });

        // Désactiver les images et autres ressources pour accélérer le chargement
        await page.route('**/*.{png,jpg,jpeg,gif,svg,pdf,mp4,webp,css,font}', route => route.abort());

        // GESTION SPÉCIALE POUR LES REQUÊTES MÉTÉO
        if (isWeatherQuery(query)) {
            const city = extractCityFromQuery(query);
            
            if (city) {
                console.log(`[SCRAPER] 🌦️ Requête météo détectée pour la ville: ${city}`);
                
                // Construire l'URL pour Météo-France
                const normalizedCity = city.toLowerCase()
                    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Enlever les accents
                    .replace(/\s+/g, '-'); // Remplacer les espaces par des tirets
                
                const meteoFranceUrl = `https://meteofrance.com/previsions-meteo-france/${normalizedCity}/${normalizedCity}`;
                console.log(`[SCRAPER] 🔗 Navigation directe vers Météo-France: ${meteoFranceUrl}`);

                try {
                    await page.goto(meteoFranceUrl, {
                        timeout: 20000,
                        waitUntil: 'domcontentloaded'
                    });
                    
                    // Vérifier si nous sommes sur une page 404
                    const is404 = await page.evaluate(() => {
                        return window.location.href.includes('/404') || 
                               document.body.innerText.includes('introuvable') ||
                               document.body.innerText.includes('page n\'existe pas');
                    });
                    
                    // Si c'est une 404, utiliser la recherche de Météo-France
                    if (is404) {
                        console.log(`[SCRAPER] ⚠️ Page ville non trouvée, utilisation de la recherche Météo-France`);
                        
                        await page.goto('https://meteofrance.com/', {
                            timeout: 20000,
                            waitUntil: 'domcontentloaded'
                        });
                        
                        // Gérer la bannière de cookies si elle apparaît
                        try {
                            const cookieSelector = '#didomi-notice-agree-button';
                            const hasCookieBanner = await page.$(cookieSelector);
                            if (hasCookieBanner) {
                                await page.click(cookieSelector);
                                await page.waitForTimeout(500);
                            }
                        } catch (e) {
                            console.log('[SCRAPER] ℹ️ Pas de bannière de cookies à gérer');
                        }
                        
                        // Attendre le champ de recherche et saisir la ville
                        try {
                            await page.waitForSelector('#search', { timeout: 5000 });
                            await page.type('#search', city);
                            
                            // Attendre les suggestions et cliquer sur la première
                            await page.waitForSelector('.autocomplete-suggestion', { timeout: 5000 });
                            await page.click('.autocomplete-suggestion');
                            
                            // Attendre que la page de résultats se charge
                            await page.waitForTimeout(2000);
                        } catch (searchError) {
                            console.log(`[SCRAPER] ⚠️ Erreur lors de la recherche sur Météo-France: ${searchError.message}`);
                        }
                    }
                    
                    // Pause pour laisser le DOM se stabiliser
                    console.log(`[SCRAPER] ⏳ Petite pause pour laisser le DOM se stabiliser`);
                    await page.waitForTimeout(2000);
                    
                    // Extraire les données météo spécifiques
                    const content = await extractMeteoFranceData(page);
                    console.log(`[SCRAPER] 📄 Données météo extraites (${content.content.length} caractères)`);
                    
                    return res.json(content);
                } catch (meteoError) {
                    console.error(`[SCRAPER] ⚠️ Erreur avec Météo-France: ${meteoError.message}`);
                    console.log('[SCRAPER] ↩️ Repli sur la recherche standard via Brave Search');
                    // Continuer avec la recherche standard ci-dessous
                }
            }
        }

        // RECHERCHE STANDARD SI CE N'EST PAS UNE REQUÊTE MÉTÉO OU SI LA REQUÊTE MÉTÉO A ÉCHOUÉ
        const searchUrl = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;
        console.log(`[SCRAPER] 🔗 Navigation vers Brave Search : ${searchUrl}`);

        await page.goto(searchUrl, {
            timeout: 20000,
            waitUntil: 'domcontentloaded'
        });

        console.log(`[SCRAPER] ✅ Page Brave Search chargée`);
        const firstLinkSelector = 'a[href^="http"]:not([href*="brave.com"]):not([href*="youtube.com"]):not([href*="facebook.com"])';
        console.log(`[SCRAPER] 🔎 Attente du premier lien utile`);

        try {
            await page.waitForSelector(firstLinkSelector, { timeout: 10000 });
        } catch (error) {
            console.error(`[SCRAPER] ⚠️ Timeout en attendant les liens: ${error.message}`);
            return res.status(404).json({ error: "Aucun résultat de recherche trouvé" });
        }

        const firstLink = await page.getAttribute(firstLinkSelector, "href");
        console.log(`[SCRAPER] 🔗 Premier lien récupéré : ${firstLink}`);

        // Vérifier si le lien est valide
        if (!firstLink || !firstLink.startsWith('http')) {
            throw new Error("Lien invalide récupéré");
        }

        console.log(`[SCRAPER] 🌍 Navigation vers le lien trouvé`);

        // Gestion plus robuste des navigations
        try {
            await page.goto(firstLink, {
                timeout: 30000,
                waitUntil: 'domcontentloaded'
            });
        } catch (error) {
            console.error(`[SCRAPER] ⚠️ Erreur de navigation vers ${firstLink}: ${error.message}`);
            return res.status(404).json({
                error: "Impossible d'accéder à la page cible",
                url: firstLink
            });
        }

        console.log(`[SCRAPER] ⏳ Petite pause pour laisser le DOM se stabiliser`);
        await page.waitForTimeout(2000);

        // Extraction du contenu
        const content = await extractMainContent(page);
        console.log(`[SCRAPER] 📄 Contenu principal identifié et extrait (${content.content.length} caractères)`);
        console.log(`[SCRAPER] 📝 Titre de la page: ${content.title}`);

        res.json(content);
    } catch (error) {
        console.error(`[SCRAPER] ❌ Erreur lors du scraping : ${error.message}`);
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) {
            console.log(`[SCRAPER] 🧹 Fermeture du navigateur...`);
            await browser.close().catch(err => console.error("Erreur fermeture navigateur:", err));
            console.log(`[SCRAPER] ✅ Navigateur fermé proprement`);
        }
    }
});

// Endpoint pour récupérer plusieurs résultats - optimisé
app.post("/scrape-multiple", async (req, res) => {
    const { query, numResults = 3 } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return res.status(400).json({ error: "Requête de recherche invalide" });
    }

    // Limiter le nombre de résultats pour des raisons de performance
    const maxResults = Math.min(numResults, 5);

    console.log(`[SCRAPER] 🔍 Requête multiple reçue pour : "${query}" (${maxResults} résultats max)`);

    let browser = null;
    try {
        browser = await chromium.launch({
            headless: true,
            args: ['--disable-gpu', '--disable-dev-shm-usage', '--disable-setuid-sandbox', '--no-sandbox']
        });

        const page = await browser.newPage();
        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36'
        });

        // Désactiver les ressources non essentielles
        await page.route('**/*.{png,jpg,jpeg,gif,svg,pdf,mp4,webp,css,font}', route => route.abort());

        const searchUrl = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;
        console.log(`[SCRAPER] 🔗 Navigation vers Brave Search : ${searchUrl}`);

        await page.goto(searchUrl, {
            timeout: 20000,
            waitUntil: 'domcontentloaded'
        });

        console.log(`[SCRAPER] ✅ Page Brave Search chargée`);
        const linkSelector = 'a[href^="http"]:not([href*="brave.com"]):not([href*="youtube.com"]):not([href*="facebook.com"])';

        // Attendre que les liens apparaissent
        try {
            await page.waitForSelector(linkSelector, { timeout: 10000 });
        } catch (error) {
            console.error(`[SCRAPER] ⚠️ Timeout en attendant les liens: ${error.message}`);
            return res.status(404).json({ error: "Aucun résultat de recherche trouvé" });
        }

        // Récupérer les liens uniques
        const links = await page.evaluate((selector, max) => {
            const elements = document.querySelectorAll(selector);
            const uniqueUrls = new Set();

            for (const el of elements) {
                const href = el.getAttribute('href');
                if (href && !href.includes('youtube.com') && !href.includes('facebook.com')) {
                    uniqueUrls.add(href);
                    if (uniqueUrls.size >= max) break;
                }
            }

            return Array.from(uniqueUrls);
        }, linkSelector, maxResults);

        console.log(`[SCRAPER] 🔗 ${links.length} liens récupérés`);

        if (links.length === 0) {
            return res.status(404).json({ error: "Aucun lien utile trouvé" });
        }

        // Visiter chaque lien et extraire le contenu
        const results = [];
        const errors = [];

        for (let i = 0; i < links.length; i++) {
            try {
                console.log(`[SCRAPER] 🌍 Navigation vers le lien ${i + 1}/${links.length}: ${links[i]}`);

                // Navigation avec timeout et gestion d'erreur
                try {
                    await page.goto(links[i], {
                        timeout: 20000,
                        waitUntil: 'domcontentloaded'
                    });
                } catch (navError) {
                    console.error(`[SCRAPER] ⚠️ Erreur navigation: ${navError.message}`);
                    errors.push({ url: links[i], error: navError.message });
                    continue; // Passer au lien suivant
                }

                await page.waitForTimeout(1500); // Pause réduite

                // Extraction de contenu
                const content = await extractMainContent(page);

                // Tronquer les contenus trop longs
                const truncatedContent = content.content.length > 5000
                    ? content.content.substring(0, 5000) + "..."
                    : content.content;

                results.push({
                    title: content.title,
                    url: links[i],
                    content: truncatedContent
                });

                console.log(`[SCRAPER] ✅ Contenu extrait du lien ${i + 1}: ${content.title} (${truncatedContent.length} caractères)`);
            } catch (error) {
                console.error(`[SCRAPER] ⚠️ Erreur sur le lien ${i + 1}: ${error.message}`);
                errors.push({ url: links[i], error: error.message });
            }
        }

        res.json({
            results,
            errors: errors.length > 0 ? errors : undefined,
            stats: {
                requested: numResults,
                found: links.length,
                successful: results.length
            }
        });
    } catch (error) {
        console.error(`[SCRAPER] ❌ Erreur globale : ${error.message}`);
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) {
            console.log(`[SCRAPER] 🧹 Fermeture du navigateur...`);
            await browser.close().catch(err => console.error("Erreur fermeture navigateur:", err));
            console.log(`[SCRAPER] ✅ Navigateur fermé proprement`);
        }
    }
});

// Endpoint de santé
app.get("/health", (req, res) => {
    res.json({ status: "ok", service: "root-web-scraper" });
});

const port = process.env.PORT || 5123;
app.listen(port, () => {
    console.log(`✅ WebScraper amélioré en ligne sur port ${port}`);
});