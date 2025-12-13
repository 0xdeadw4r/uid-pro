// Initialize navigation based on user account type
async function initializeNavigation() {
    try {
        const response = await fetch('/api/user', { credentials: 'include' });
        if (response.ok) {
            const user = await response.json();
            
            const packagesLink = document.getElementById('packagesLink');
            const aimkillLink = document.getElementById('aimkillLink');
            const adminLink = document.getElementById('adminLink');

            // Hide all optional links first
            if (packagesLink) packagesLink.classList.add('nav-hidden');
            if (aimkillLink) aimkillLink.classList.add('nav-hidden');
            if (adminLink) adminLink.classList.add('nav-hidden');

            // Show links based on account type
            if (user.accountType === 'AIMKILL') {
                // Aimkill users see only aimkill packages
                if (aimkillLink) aimkillLink.classList.remove('nav-hidden');
            } else {
                // UID Manager users see packages
                if (packagesLink) packagesLink.classList.remove('nav-hidden');
            }

            // Show admin link for admins, super admins, and owners
            if (user.isAdmin || user.isSuperAdmin || user.isOwner) {
                if (adminLink) adminLink.classList.remove('nav-hidden');
            }
        }
    } catch (error) {
        console.error('Failed to load navigation:', error);
    }
}

// Navigation active state
document.addEventListener('DOMContentLoaded', () => {
    // Initialize navigation visibility
    initializeNavigation();

    const currentPath = window.location.pathname;
    document.querySelectorAll('.nav-links a').forEach(link => {
        const href = link.getAttribute('href');
        if (href === currentPath || (currentPath === '/' && href === '/dashboard')) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });

    // Mobile menu toggle
    const toggle = document.querySelector('.mobile-menu-toggle');
    const navLinks = document.querySelector('.nav-links');

    if (toggle) {
        toggle.addEventListener('click', () => {
            toggle.classList.toggle('active');
            navLinks.classList.toggle('active');
        });

        // Close menu on link click
        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                toggle.classList.remove('active');
                navLinks.classList.remove('active');
            });
        });
    }
});

// Show page loader on navigation
document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (link && link.getAttribute('href') && !link.getAttribute('href').startsWith('#')) {
        const href = link.getAttribute('href');
        if (!href.startsWith('http') && !href.startsWith('javascript')) {
            const loader = document.createElement('div');
            loader.className = 'page-loader active';
            document.body.appendChild(loader);

            setTimeout(() => {
                loader.remove();
            }, 2000);
        }
    }
});

// Hide loader when page loads
window.addEventListener('load', () => {
    const loader = document.querySelector('.page-loader');
    if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => loader.remove(), 300);
    }
});
