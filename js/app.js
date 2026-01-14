/**
 * AoE2 Matchup Guide - Main Application
 * @description Interactive civ picker and opponent matchup viewer
 */

(function() {
    'use strict';

    // ==========================================================================
    // State
    // ==========================================================================

    /** @type {Object|null} */
    let currentCivData = null;

    /** @type {string[]} */
    const availableCivs = ['britons']; // Add more as data files are created

    // ==========================================================================
    // DOM Elements
    // ==========================================================================

    const elements = {
        civSelect: document.getElementById('your-civ-select'),
        civInfo: document.getElementById('your-civ-info'),
        civName: document.getElementById('your-civ-name'),
        strongUnits: document.getElementById('your-strong-units'),
        opponentSection: document.getElementById('opponent-section'),
        opponentSearch: document.getElementById('opponent-search'),
        opponentsGrid: document.getElementById('opponents-grid'),
        modal: document.getElementById('opponent-modal'),
        modalCivName: document.getElementById('modal-civ-name'),
        modalStrengths: document.getElementById('modal-strengths'),
        modalWeaknesses: document.getElementById('modal-weaknesses'),
        modalCounterUnits: document.getElementById('modal-counter-units'),
        modalClose: document.querySelector('.modal-close'),
        modalOverlay: document.querySelector('.modal-overlay')
    };

    // ==========================================================================
    // Data Loading
    // ==========================================================================

    /**
     * Load civilization data from JSON file
     * @param {string} civName - Civilization name (lowercase)
     * @returns {Promise<Object>}
     */
    async function loadCivData(civName) {
        const response = await fetch(`data/${civName}.json`);
        if (!response.ok) {
            throw new Error(`Failed to load ${civName} data`);
        }
        return response.json();
    }

    /**
     * Populate the civilization dropdown with available civs
     */
    function populateCivDropdown() {
        const civNames = {
            'britons': 'Britons'
            // Add more mappings as data files are created
        };

        availableCivs.forEach(civ => {
            const option = document.createElement('option');
            option.value = civ;
            option.textContent = civNames[civ] || civ.charAt(0).toUpperCase() + civ.slice(1);
            elements.civSelect.appendChild(option);
        });
    }

    // ==========================================================================
    // UI Rendering
    // ==========================================================================

    /**
     * Display information about the selected civilization
     * @param {Object} data - Civilization data
     */
    function displayYourCivInfo(data) {
        elements.civName.textContent = data.name;
        
        elements.strongUnits.innerHTML = data.mainStrongUnits
            .map(unit => `<span class="unit-tag">${unit}</span>`)
            .join('');
        
        elements.civInfo.classList.remove('hidden');
    }

    /**
     * Render opponent cards grid
     * @param {Object[]} civilizations - Array of opponent civ matchup data
     */
    function renderOpponentCards(civilizations) {
        elements.opponentsGrid.innerHTML = civilizations
            .map((civ, index) => `
                <article class="opponent-card" data-index="${index}" tabindex="0" role="button" aria-label="View ${civ.name} matchup details">
                    <h3>${civ.name}</h3>
                    <p class="preview-text">${civ.mainWeaknesses}</p>
                    <span class="view-details">View counter strategies</span>
                </article>
            `)
            .join('');
        
        elements.opponentSection.classList.remove('hidden');
        
        // Add click handlers to cards
        document.querySelectorAll('.opponent-card').forEach(card => {
            card.addEventListener('click', handleCardClick);
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleCardClick(e);
                }
            });
        });
    }

    /**
     * Display opponent details in modal
     * @param {Object} civ - Civilization matchup data
     */
    function displayOpponentDetails(civ) {
        elements.modalCivName.textContent = `vs ${civ.name}`;
        elements.modalStrengths.textContent = civ.strengths;
        elements.modalWeaknesses.textContent = civ.mainWeaknesses;
        
        elements.modalCounterUnits.innerHTML = civ.mainCounterUnits
            .map(unit => `
                <div class="counter-unit">
                    <div class="counter-unit-header">
                        <span class="counter-unit-icon">🎯</span>
                        <span class="counter-unit-name">${unit.name}</span>
                    </div>
                    <p class="counter-unit-defense">${unit.defense}</p>
                </div>
            `)
            .join('');
        
        openModal();
    }

    // ==========================================================================
    // Modal Controls
    // ==========================================================================

    function openModal() {
        elements.modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        elements.modalClose.focus();
    }

    function closeModal() {
        elements.modal.classList.add('hidden');
        document.body.style.overflow = '';
    }

    // ==========================================================================
    // Event Handlers
    // ==========================================================================

    /**
     * Handle civilization selection change
     * @param {Event} e - Change event
     */
    async function handleCivChange(e) {
        const civName = e.target.value;
        
        if (!civName) {
            elements.civInfo.classList.add('hidden');
            elements.opponentSection.classList.add('hidden');
            elements.opponentsGrid.innerHTML = '';
            currentCivData = null;
            return;
        }
        
        try {
            currentCivData = await loadCivData(civName);
            displayYourCivInfo(currentCivData);
            renderOpponentCards(currentCivData.civilizations);
            elements.opponentSearch.value = '';
        } catch (error) {
            console.error('Failed to load civilization data:', error);
            alert('Failed to load civilization data. Please try again.');
        }
    }

    /**
     * Handle opponent card click
     * @param {Event} e - Click event
     */
    function handleCardClick(e) {
        const card = e.currentTarget;
        const index = parseInt(card.dataset.index, 10);
        
        if (currentCivData && currentCivData.civilizations[index]) {
            displayOpponentDetails(currentCivData.civilizations[index]);
        }
    }

    /**
     * Handle search input
     * @param {Event} e - Input event
     */
    function handleSearch(e) {
        const query = e.target.value.toLowerCase().trim();
        
        document.querySelectorAll('.opponent-card').forEach(card => {
            const civName = card.querySelector('h3').textContent.toLowerCase();
            const isMatch = civName.includes(query);
            card.classList.toggle('hidden', !isMatch);
        });
    }

    /**
     * Handle keyboard navigation
     * @param {KeyboardEvent} e - Keyboard event
     */
    function handleKeydown(e) {
        if (e.key === 'Escape' && !elements.modal.classList.contains('hidden')) {
            closeModal();
        }
    }

    // ==========================================================================
    // Initialization
    // ==========================================================================

    function init() {
        // Populate dropdown
        populateCivDropdown();
        
        // Event listeners
        elements.civSelect.addEventListener('change', handleCivChange);
        elements.opponentSearch.addEventListener('input', handleSearch);
        elements.modalClose.addEventListener('click', closeModal);
        elements.modalOverlay.addEventListener('click', closeModal);
        document.addEventListener('keydown', handleKeydown);
        
        // Auto-select Britons for demo
        elements.civSelect.value = 'britons';
        handleCivChange({ target: elements.civSelect });
    }

    // Start the app when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
