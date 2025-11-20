// Theme management system
(function () {
    'use strict';

    // Get theme from localStorage or default to light
    function getStoredTheme() {
        return localStorage.getItem('theme') || 'light';
    }

    // Set theme
    function setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        updateThemeIcon(theme);
    }

    // Update theme toggle icon
    function updateThemeIcon(theme) {
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
            themeToggle.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
        }
    }

    // Toggle theme
    window.toggleTheme = function () {
        const currentTheme = getStoredTheme();
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        setTheme(newTheme);
    };

    // Initialize theme on page load
    function initTheme() {
        const storedTheme = getStoredTheme();
        setTheme(storedTheme);
    }

    // Run on DOM content loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTheme);
    } else {
        initTheme();
    }
})();
