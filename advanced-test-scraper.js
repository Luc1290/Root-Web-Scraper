// advanced-test-scraper.js
import fetch from 'node-fetch';
import { writeFileSync } from 'fs';

async function analyzeScrapedContent(query) {
  try {
    console.log(`Envoi de la requête pour: "${query}"`);
    
    const response = await fetch('http://localhost:5123/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
    
    if (!response.ok) {
      throw new Error(`Erreur HTTP: ${response.status}`);
    }
    
    const data = await response.json();
    const content = data.content;
    
    // Enregistrer le contenu complet
    writeFileSync('contenu_complet.txt', content, 'utf8');
    console.log('\nContenu complet enregistré dans "contenu_complet.txt"');
    
    // Analyser le contenu
    console.log('\n📊 ANALYSE DU CONTENU 📊');
    console.log('===============================');
    
    // 1. Statistiques de base
    const characterCount = content.length;
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    const lineCount = content.split('\n').length;
    const paragraphCount = content.split(/\n\s*\n/).length;
    
    console.log('📏 STATISTIQUES:');
    console.log(`- Caractères: ${characterCount}`);
    console.log(`- Mots: ${wordCount}`);
    console.log(`- Lignes: ${lineCount}`);
    console.log(`- Paragraphes: ${paragraphCount}`);
    
    // 2. Mots les plus fréquents (hors mots vides)
    const stopWords = ['le', 'la', 'les', 'un', 'une', 'des', 'et', 'à', 'de', 'du', 'en', 'est', 'pour', 'dans', 'sur', 'au', 'qui', 'que', 'par', 'il', 'elle', 'ils', 'elles', 'ce', 'cette', 'ces', 'son', 'sa', 'ses', 'avec'];
    
    const words = content.toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.includes(word));
    
    const wordFrequency = {};
    words.forEach(word => {
      wordFrequency[word] = (wordFrequency[word] || 0) + 1;
    });
    
    const topWords = Object.entries(wordFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    console.log('\n🔤 TOP 10 MOTS FRÉQUENTS:');
    topWords.forEach(([word, count], index) => {
      console.log(`${index + 1}. "${word}" - ${count} occurrences`);
    });
    
    // 3. Extraire des sections potentiellement importantes
    console.log('\n🔍 EXTRAITS IMPORTANTS:');
    
    // Trouver des phrases contenant les mots-clés fréquents
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
    const keywordSentences = sentences.filter(sentence => {
      return topWords.some(([word]) => 
        sentence.toLowerCase().includes(word)
      );
    });
    
    // Afficher quelques phrases importantes
    const importantSentences = keywordSentences.slice(0, 5);
    importantSentences.forEach((sentence, index) => {
      console.log(`- ${sentence.trim()}`);
      if (index < importantSentences.length - 1) console.log();
    });
    
    // 4. Détection d'entités (simplifiée)
    // Dates
    const dateRegex = /\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2} (janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) \d{2,4})\b/gi;
    const dates = content.match(dateRegex) || [];
    
    // Noms propres potentiels (mots commençant par une majuscule après un espace)
    const properNamesRegex = /\s([A-Z][a-zàáâäæçèéêëìíîïñòóôöùúûüÿ]{2,})/g;
    const properNamesMatches = [...content.matchAll(properNamesRegex)];
    const properNames = [...new Set(properNamesMatches.map(match => match[1]))];
    
    console.log('\n👥 ENTITÉS DÉTECTÉES:');
    if (dates.length > 0) {
      console.log('Dates:');
      [...new Set(dates)].slice(0, 5).forEach(date => console.log(`- ${date}`));
    }
    
    if (properNames.length > 0) {
      console.log('\nNoms propres potentiels:');
      properNames.slice(0, 10).forEach(name => console.log(`- ${name}`));
    }
    
    // 5. Aperçu structuré du contenu
    console.log('\n📄 APERÇU STRUCTURÉ:');
    
    // Trouver les titres potentiels (lignes courtes en majuscules ou avec peu de mots)
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    const potentialTitles = lines.filter(line => {
      const trimmed = line.trim();
      return (
        trimmed.length < 60 && 
        (trimmed === trimmed.toUpperCase() || 
         trimmed.split(/\s+/).length < 8)
      );
    });
    
    // Afficher quelques titres potentiels suivis de courts extraits
    const titlesToShow = potentialTitles.slice(0, 5);
    titlesToShow.forEach(title => {
      console.log(`\n### ${title.trim()} ###`);
      const titleIndex = lines.indexOf(title);
      if (titleIndex !== -1 && titleIndex < lines.length - 1) {
        const excerpt = lines.slice(titleIndex + 1, titleIndex + 3)
          .join('\n')
          .trim()
          .substring(0, 200);
        console.log(excerpt + (excerpt.length >= 200 ? '...' : ''));
      }
    });
    
  } catch (error) {
    console.error('Erreur:', error.message);
  }
}

// Utilisez votre propre terme de recherche ici
const searchQuery = process.argv[2] || 'actualités france';
analyzeScrapedContent(searchQuery);