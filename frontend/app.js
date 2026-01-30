/**
 * CitationLint Frontend
 * Handles PDF upload, API communication, and results display
 */

// Configuration
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8000'
    : '/api';  // Adjust based on your deployment

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
    dropZone.addEventListener('click', () => fileInput.click());
    
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
        if (files.length > 0) {
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

// Handle File Selection
function handleFileSelect(file) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
        showError('Please select a PDF file');
        return;
    }
    
    selectedFile = file;
    fileName.textContent = file.name;
    fileInfo.classList.remove('hidden');
    verifyBtn.disabled = false;
}

// Clear File
function clearFile() {
    selectedFile = null;
    fileInput.value = '';
    fileInfo.classList.add('hidden');
    verifyBtn.disabled = true;
}

// Setup Buttons
function setupButtons() {
    clearFileBtn.addEventListener('click', clearFile);
    verifyBtn.addEventListener('click', uploadAndVerify);
    newUploadBtn.addEventListener('click', resetToUpload);
    errorRetry.addEventListener('click', resetToUpload);
}

// Setup Filters
function setupFilters() {
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderCitations(currentResults);
        });
    });
}

// Upload and Verify
async function uploadAndVerify() {
    if (!selectedFile) return;
    
    showSection('progress');
    progressText.textContent = 'Uploading PDF...';
    
    const formData = new FormData();
    formData.append('file', selectedFile);
    
    try {
        progressText.textContent = 'Analyzing citations (this may take a minute)...';
        
        const response = await fetch(`${API_BASE}/verify`, {
            method: 'POST',
            body: formData,
        });
        
        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
            throw new Error(error.detail || `HTTP ${response.status}`);
        }
        
        const results = await response.json();
        
        if (results.extraction_error) {
            throw new Error(results.extraction_error);
        }
        
        currentResults = results;
        displayResults(results);
        
    } catch (error) {
        console.error('Verification failed:', error);
        showError(error.message || 'Failed to verify citations');
    }
}

// Display Results
function displayResults(results) {
    // Update summary
    document.getElementById('total-citations').textContent = results.total_citations;
    document.getElementById('dois-found').textContent = results.dois_found;
    document.getElementById('verified-count').textContent = results.verified_valid;
    document.getElementById('unverified-count').textContent = results.verified_invalid;
    
    // Reset filter to 'all'
    currentFilter = 'all';
    filterBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === 'all');
    });
    
    // Render citations
    renderCitations(results);
    
    showSection('results');
}

// Render Citations
function renderCitations(results) {
    if (!results || !results.results) {
        citationsList.innerHTML = '<p>No citations found</p>';
        return;
    }
    
    const filtered = results.results.filter(citation => {
        switch (currentFilter) {
            case 'verified':
                return citation.valid === true;
            case 'unverified':
                return citation.valid === false && citation.doi;
            case 'no-doi':
                return !citation.doi;
            default:
                return true;
        }
    });
    
    if (filtered.length === 0) {
        citationsList.innerHTML = `<p class="no-results">No citations match this filter</p>`;
        return;
    }
    
    citationsList.innerHTML = filtered.map(citation => {
        const status = getStatus(citation);
        return `
            <div class="citation-item ${status.class}">
                <div class="citation-header">
                    <span class="citation-number">#${citation.citation_number || '?'}</span>
                    <span class="citation-status">${status.icon}</span>
                </div>
                ${citation.title ? `<div class="citation-title">${escapeHtml(citation.title)}</div>` : ''}
                ${citation.authors || citation.year || citation.journal ? `
                    <div class="citation-meta">
                        ${citation.authors ? escapeHtml(formatAuthors(citation.authors)) : ''}
                        ${citation.year ? ` (${citation.year})` : ''}
                        ${citation.journal ? ` — ${escapeHtml(citation.journal)}` : ''}
                    </div>
                ` : ''}
                ${citation.doi ? `
                    <div class="citation-doi">
                        DOI: <a href="https://doi.org/${encodeURIComponent(citation.doi)}" target="_blank">${escapeHtml(citation.doi)}</a>
                    </div>
                ` : ''}
                ${citation.error ? `<div class="citation-error">Error: ${escapeHtml(citation.error)}</div>` : ''}
                ${!citation.doi && citation.note ? `<div class="citation-error">${escapeHtml(citation.note)}</div>` : ''}
                ${citation.citation_text ? `<div class="citation-text">${escapeHtml(citation.citation_text)}</div>` : ''}
            </div>
        `;
    }).join('');
}

// Get Status Info
function getStatus(citation) {
    if (citation.valid === true) {
        return { class: 'verified', icon: '✓' };
    } else if (citation.valid === false && citation.doi) {
        return { class: 'unverified', icon: '✗' };
    } else if (!citation.doi) {
        return { class: 'no-doi', icon: '?' };
    }
    return { class: '', icon: '—' };
}

// Format Authors
function formatAuthors(authors) {
    if (!authors || authors.length === 0) return '';
    if (authors.length === 1) return authors[0];
    if (authors.length === 2) return authors.join(' & ');
    return `${authors[0]} et al.`;
}

// Escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Show Section
function showSection(section) {
    uploadSection.classList.add('hidden');
    progressSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    errorSection.classList.add('hidden');
    
    switch (section) {
        case 'upload':
            uploadSection.classList.remove('hidden');
            break;
        case 'progress':
            progressSection.classList.remove('hidden');
            break;
        case 'results':
            resultsSection.classList.remove('hidden');
            break;
        case 'error':
            errorSection.classList.remove('hidden');
            break;
    }
}

// Show Error
function showError(message) {
    errorMessage.textContent = message;
    showSection('error');
}

// Reset to Upload
function resetToUpload() {
    clearFile();
    currentResults = null;
    showSection('upload');
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
