/**
 * CitationLint v0.0.5 - Citation Verification by Title Search
 * Uses PDF.js for parsing, CrossRef API for verification
 * Your PDF never leaves your browser!
 */

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// CrossRef API
const CROSSREF_API = 'https://api.crossref.org/works';
const MAILTO = 'citationlint@example.com';

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');
const fileName = document.querySelector('.file-name');
const clearFileBtn = document.getElementById('clear-file');
const verifyBtn = document.getElementById('verify-btn');
const uploadSection = document.getElementById('upload-section');
const progressSection = document.getElementById('progress-section');
const progressText = document.getElementById('progress-text');
const progressBar = document.getElementById('progress-bar');
const progressDetail = document.getElementById('progress-detail');
const resultsSection = document.getElementById('results-section');
const errorSection = document.getElementById('error-section');
const errorMessage = document.getElementById('error-message');
const errorRetry = document.getElementById('error-retry');
const newUploadBtn = document.getElementById('new-upload');
const citationsList = document.getElementById('citations-list');
const filterBtns = document.querySelectorAll('.filter-btn');

// State
let selectedFile = null;
let currentResults = null;
let currentFilter = 'all';

// Initialize
function init() {
    setupDragAndDrop();
    setupFileInput();
    setupButtons();
    setupFilters();
}

// Drag and Drop
function setupDragAndDrop() {
    const browseBtn = document.getElementById('browse-btn');
    
    // Browse button click
    browseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });
    
    // Drop zone click (backup)
    dropZone.addEventListener('click', (e) => {
        if (e.target === dropZone) {
            fileInput.click();
        }
    });
    
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });
    
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].type === 'application/pdf') {
            handleFileSelect(files[0]);
        }
    });
}

// File Input
function setupFileInput() {
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });
}

function handleFileSelect(file) {
    selectedFile = file;
    fileName.textContent = file.name;
    fileInfo.classList.remove('hidden');
    dropZone.classList.add('hidden');
    verifyBtn.disabled = false;
}

// Buttons
function setupButtons() {
    clearFileBtn.addEventListener('click', resetUpload);
    verifyBtn.addEventListener('click', startVerification);
    newUploadBtn.addEventListener('click', resetAll);
    errorRetry.addEventListener('click', resetAll);
}

function resetUpload() {
    selectedFile = null;
    fileInput.value = '';
    fileInfo.classList.add('hidden');
    dropZone.classList.remove('hidden');
    verifyBtn.disabled = true;
}

function resetAll() {
    resetUpload();
    uploadSection.classList.remove('hidden');
    progressSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    errorSection.classList.add('hidden');
    currentResults = null;
    progressBar.style.width = '0%';
}

// Filters
function setupFilters() {
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderResults();
        });
    });
}

// Main Verification Flow
async function startVerification() {
    if (!selectedFile) return;
    
    showProgress();
    
    try {
        // Step 1: Extract text from PDF
        updateProgress('Extracting text from PDF...', 10);
        const text = await extractTextFromPDF(selectedFile);
        
        if (!text.trim()) {
            throw new Error('Could not extract text from PDF. It may be a scanned image.');
        }
        
        // Step 2: Find references section
        updateProgress('Finding references section...', 20);
        const refsSection = findReferencesSection(text);
        console.log('References section:', refsSection.substring(0, 500));
        
        // Step 3: Parse individual citations
        updateProgress('Parsing citations...', 30);
        const citations = parseCitations(refsSection);
        console.log('Found citations:', citations.length);
        
        if (citations.length === 0) {
            throw new Error('Could not parse citations from the references section.');
        }
        
        // Step 4: Verify each citation against CrossRef
        updateProgress(`Verifying ${citations.length} citations...`, 40);
        const results = await verifyCitations(citations);
        
        // Step 5: Show results
        currentResults = results;
        showResults();
        
    } catch (error) {
        console.error('Error:', error);
        showError(error.message);
    }
}

// PDF Text Extraction
async function extractTextFromPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    let fullText = '';
    const numPages = pdf.numPages;
    
    for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + '\n';
        
        const extractProgress = 10 + (10 * (i / numPages));
        updateProgress(`Extracting page ${i}/${numPages}...`, extractProgress);
    }
    
    return fullText;
}

// Find References Section
function findReferencesSection(text) {
    const patterns = [
        /\n\s*References?\s*\n/i,
        /\n\s*Bibliography\s*\n/i,
        /\n\s*REFERENCES?\s*\n/i,
        /\n\s*Works?\s+Cited\s*\n/i,
        /\n\s*Literature\s+Cited\s*\n/i,
    ];
    
    for (const pattern of patterns) {
        const match = text.search(pattern);
        if (match !== -1) {
            console.log('Found references section at position:', match);
            return text.substring(match);
        }
    }
    
    // Fallback: last 30% of document
    console.log('No references header found, using last 30%');
    return text.substring(Math.floor(text.length * 0.7));
}

// Parse individual citations from references section
function parseCitations(text) {
    const citations = [];
    
    // Try different citation patterns
    
    // Pattern 1: Numbered citations [1], [2], etc.
    let matches = text.split(/\[\d+\]\s*/);
    if (matches.length > 2) {
        console.log('Using bracketed number pattern');
        for (let i = 1; i < matches.length; i++) {
            const citation = cleanCitation(matches[i]);
            if (citation) citations.push({ raw: citation, index: i });
        }
        if (citations.length > 0) return citations;
    }
    
    // Pattern 2: Numbered with dot: 1. 2. 3.
    matches = text.split(/\n\s*\d+\.\s+/);
    if (matches.length > 2) {
        console.log('Using dot number pattern');
        for (let i = 1; i < matches.length; i++) {
            const citation = cleanCitation(matches[i]);
            if (citation) citations.push({ raw: citation, index: i });
        }
        if (citations.length > 0) return citations;
    }
    
    // Pattern 3: Author-year style (split by apparent new references)
    // Look for patterns like: Newline followed by Author names and year
    const authorYearPattern = /\n(?=[A-Z][a-z]+,?\s+[A-Z]\.?.*?\(\d{4}\))/g;
    matches = text.split(authorYearPattern);
    if (matches.length > 2) {
        console.log('Using author-year pattern');
        for (let i = 1; i < matches.length; i++) {
            const citation = cleanCitation(matches[i]);
            if (citation) citations.push({ raw: citation, index: i });
        }
        if (citations.length > 0) return citations;
    }
    
    // Fallback: split by double newlines or periods followed by newlines
    matches = text.split(/\.\s*\n\s*\n|\n\s*\n/);
    console.log('Using paragraph split fallback');
    for (let i = 0; i < matches.length; i++) {
        const citation = cleanCitation(matches[i]);
        if (citation && citation.length > 30) {  // Likely a real citation
            citations.push({ raw: citation, index: i + 1 });
        }
    }
    
    return citations;
}

function cleanCitation(text) {
    if (!text) return null;
    // Clean up whitespace, limit length
    let cleaned = text.replace(/\s+/g, ' ').trim();
    // Take first ~500 chars (one citation shouldn't be longer)
    if (cleaned.length > 500) {
        cleaned = cleaned.substring(0, 500);
    }
    return cleaned.length > 10 ? cleaned : null;
}

// Extract likely title from citation text
function extractTitle(citationText) {
    // Common patterns for titles in citations:
    
    // Pattern 1: Text in quotes "Title here"
    let match = citationText.match(/"([^"]{10,200})"/);
    if (match) return match[1];
    
    // Pattern 2: Text in italics markers or after year: (2020). Title here.
    match = citationText.match(/\(\d{4}\)\.\s*([^.]{10,200})\./);
    if (match) return match[1];
    
    // Pattern 3: After year with comma: (2020), Title here,
    match = citationText.match(/\(\d{4}\),?\s*([^,]{10,200}),/);
    if (match) return match[1];
    
    // Pattern 4: After authors (Name, I., Name, J.) Title here.
    match = citationText.match(/(?:[A-Z][a-z]+,\s*[A-Z]\.?,?\s*(?:&|and)?\s*)+([A-Z][^.]{10,200})\./);
    if (match) return match[1];
    
    // Fallback: take a chunk from the middle (skip author names at start)
    const words = citationText.split(/\s+/);
    if (words.length > 5) {
        // Skip first few words (likely authors) and take next chunk
        const titleWords = words.slice(3, 15).join(' ');
        if (titleWords.length > 15) return titleWords;
    }
    
    return null;
}

// Verify citations against CrossRef by title search
async function verifyCitations(citations) {
    const results = [];
    const total = citations.length;
    
    for (let i = 0; i < citations.length; i++) {
        const citation = citations[i];
        const title = extractTitle(citation.raw);
        
        let result;
        if (title) {
            result = await searchCrossRef(title, citation.raw, citation.index);
        } else {
            result = {
                index: citation.index,
                raw: citation.raw,
                valid: null,
                error: 'Could not extract title from citation'
            };
        }
        
        results.push(result);
        
        // Update progress
        const progress = 40 + (55 * ((i + 1) / total));
        updateProgress(`Verified ${i + 1}/${total} citations...`, progress);
        progressDetail.textContent = title ? `Searching: "${title.substring(0, 50)}..."` : 'Parsing citation...';
        
        // Rate limiting
        await sleep(250);
    }
    
    return results;
}

// Search CrossRef by title
async function searchCrossRef(title, rawCitation, index) {
    try {
        const query = encodeURIComponent(title);
        const url = `${CROSSREF_API}?query.title=${query}&rows=1&mailto=${MAILTO}`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
            return {
                index,
                raw: rawCitation,
                searchedTitle: title,
                valid: null,
                error: `HTTP ${response.status}`
            };
        }
        
        const data = await response.json();
        const items = data.message?.items || [];
        
        if (items.length === 0) {
            return {
                index,
                raw: rawCitation,
                searchedTitle: title,
                valid: false,
                error: 'No matching publication found in CrossRef'
            };
        }
        
        const work = items[0];
        const foundTitle = work.title?.[0] || '';
        
        // Check if titles are similar enough (fuzzy match)
        const similarity = calculateSimilarity(title.toLowerCase(), foundTitle.toLowerCase());
        
        if (similarity < 0.4) {
            return {
                index,
                raw: rawCitation,
                searchedTitle: title,
                valid: false,
                error: `Best match "${foundTitle.substring(0, 50)}..." doesn't match (${Math.round(similarity * 100)}% similar)`
            };
        }
        
        // Found a match!
        const authors = work.author || [];
        const authorStr = authors.length > 0 
            ? authors.slice(0, 3).map(a => a.family || a.name || 'Unknown').join(', ') + (authors.length > 3 ? ' et al.' : '')
            : 'Unknown';
        
        const year = work.published?.['date-parts']?.[0]?.[0] || 
                     work.created?.['date-parts']?.[0]?.[0] || 
                     'Unknown';
        
        return {
            index,
            raw: rawCitation,
            searchedTitle: title,
            valid: true,
            title: foundTitle,
            authors: authorStr,
            year: String(year),
            doi: work.DOI,
            journal: work['container-title']?.[0] || work.publisher || 'Unknown',
            similarity: Math.round(similarity * 100)
        };
        
    } catch (error) {
        return {
            index,
            raw: rawCitation,
            searchedTitle: title,
            valid: null,
            error: error.message || 'Network error'
        };
    }
}

// Simple string similarity (Jaccard on words)
function calculateSimilarity(str1, str2) {
    const words1 = new Set(str1.split(/\s+/).filter(w => w.length > 2));
    const words2 = new Set(str2.split(/\s+/).filter(w => w.length > 2));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
}

// UI Updates
function showProgress() {
    uploadSection.classList.add('hidden');
    progressSection.classList.remove('hidden');
    resultsSection.classList.add('hidden');
    errorSection.classList.add('hidden');
}

function updateProgress(text, percent) {
    progressText.textContent = text;
    progressBar.style.width = `${percent}%`;
}

function showResults() {
    progressSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');
    
    const valid = currentResults.filter(r => r.valid === true).length;
    const invalid = currentResults.filter(r => r.valid === false).length;
    const errors = currentResults.filter(r => r.valid === null).length;
    
    document.getElementById('stat-total').textContent = currentResults.length;
    document.getElementById('stat-valid').textContent = valid;
    document.getElementById('stat-invalid').textContent = invalid;
    document.getElementById('stat-errors').textContent = errors;
    
    renderResults();
}

function renderResults() {
    let filtered = currentResults;
    
    if (currentFilter === 'valid') {
        filtered = currentResults.filter(r => r.valid === true);
    } else if (currentFilter === 'invalid') {
        filtered = currentResults.filter(r => r.valid === false);
    } else if (currentFilter === 'error') {
        filtered = currentResults.filter(r => r.valid === null);
    }
    
    citationsList.innerHTML = filtered.map(r => renderCitation(r)).join('');
}

function renderCitation(result) {
    const statusClass = result.valid === true ? 'valid' : 
                       result.valid === false ? 'invalid' : 'error';
    const statusIcon = result.valid === true ? '✓' : 
                      result.valid === false ? '✗' : '?';
    const statusText = result.valid === true ? 'Verified' : 
                      result.valid === false ? 'Not Found' : 'Error';
    
    let details = '';
    if (result.valid === true) {
        details = `
            <div class="citation-details">
                <div class="citation-title">${escapeHtml(result.title)}</div>
                <div class="citation-meta">
                    ${escapeHtml(result.authors)} (${result.year}) · ${escapeHtml(result.journal)}
                </div>
                <div class="citation-doi">
                    DOI: <a href="https://doi.org/${encodeURIComponent(result.doi)}" target="_blank">${escapeHtml(result.doi)}</a>
                    <span class="similarity">(${result.similarity}% match)</span>
                </div>
            </div>
        `;
    } else if (result.valid === false) {
        details = `
            <div class="citation-details">
                <div class="citation-error">${escapeHtml(result.error)}</div>
                <div class="citation-searched">Searched for: "${escapeHtml(result.searchedTitle || 'N/A')}"</div>
            </div>
        `;
    } else {
        details = `
            <div class="citation-details">
                <div class="citation-error">${escapeHtml(result.error)}</div>
            </div>
        `;
    }
    
    return `
        <div class="citation-item ${statusClass}">
            <div class="citation-header">
                <div class="citation-status">
                    <span class="status-icon">${statusIcon}</span>
                    <span class="status-text">${statusText}</span>
                </div>
                <span class="citation-index">#${result.index}</span>
            </div>
            <div class="citation-raw">${escapeHtml(result.raw.substring(0, 200))}${result.raw.length > 200 ? '...' : ''}</div>
            ${details}
        </div>
    `;
}

function showError(message) {
    progressSection.classList.add('hidden');
    errorSection.classList.remove('hidden');
    errorMessage.textContent = message;
}

// Utilities
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Start
init();
