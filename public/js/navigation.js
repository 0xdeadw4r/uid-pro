// Initialize navigation based on user account type
async function initializeNavigation() {
    try {
        // Check sessionStorage first to avoid repeated API calls
        let user = null;
        const cachedUser = sessionStorage.getItem('navUser');
        
        if (cachedUser) {
            user = JSON.parse(cachedUser);
        } else {
            const response = await fetch('/api/user', { credentials: 'include' });
            if (!response.ok) return;
            user = await response.json();
            // Cache for 5 minutes
            sessionStorage.setItem('navUser', JSON.stringify(user));
            setTimeout(() => sessionStorage.removeItem('navUser'), 5 * 60 * 1000);
        }
        
        if (!user) return;
        
        const packagesLink = document.getElementById('packagesLink');
        const aimkillLink = document.getElementById('aimkillLink');
        const adminLink = document.getElementById('adminLink');

        // Hide all optional links first
        if (packagesLink) packagesLink.classList.add('nav-hidden');
        if (aimkillLink) aimkillLink.classList.add('nav-hidden');
        if (adminLink) adminLink.classList.add('nav-hidden');

        // Show links based on account type
        if (user.accountType === 'AIMKILL') {
            if (aimkillLink) aimkillLink.classList.remove('nav-hidden');
        } else {
            if (packagesLink) packagesLink.classList.remove('nav-hidden');
        }

        // Show admin link for admins, super admins, and owners
        if (user.isAdmin || user.isSuperAdmin || user.isOwner) {
            if (adminLink) adminLink.classList.remove('nav-hidden');
        }
    } catch (error) {
        console.error('Failed to load navigation:', error);
    }
}

// Navigation active state
document.addEventListener('DOMContentLoaded', () => {
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

        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                toggle.classList.remove('active');
                navLinks.classList.remove('active');
            });
        });
    }
});

// Fast page transition - instant visual feedback
document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (link && link.getAttribute('href') && !link.getAttribute('href').startsWith('#')) {
        const href = link.getAttribute('href');
        if (!href.startsWith('http') && !href.startsWith('javascript')) {
            link.style.opacity = '0.6';
        }
    }
});
