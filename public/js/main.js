// Fetch user info
async function fetchUser() {
    try {
        // Check if this is a client dashboard page
        if (window.location.pathname === '/client/dashboard' || window.location.pathname.startsWith('/client/')) {
            return; // Client dashboard has its own data loading
        }

        const response = await fetch('/api/user', {
            credentials: 'include'
        });

        if (response.ok) {
            const user = await response.json();

            const usernameDisplay = document.getElementById('usernameDisplay');
            if (usernameDisplay) {
                usernameDisplay.textContent = user.username;
            }

            const creditsDisplay = document.getElementById('creditsDisplay');
            if (creditsDisplay) {
                creditsDisplay.textContent = user.credits || 0;
            }

            // Update all credit displays on the page
            const creditElements = document.querySelectorAll('#credits, #creditCount, #aimkillCredits');
            creditElements.forEach(el => {
                if (el) el.textContent = user.credits || 0;
            });

            // Show admin-only elements for Admin, Super Admin, and Owner
            if (user.isAdmin || user.isSuperAdmin || user.isOwner) {
                document.querySelectorAll('.admin-only').forEach(el => {
                    el.style.display = 'block';
                });
            }

            return user;
        } else {
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('Failed to load user info:', error);
        window.location.href = '/login';
    }
}

// Logout function
async function logout() {
    try {
        await fetch('/api/logout', {
            method: 'POST',
            credentials: 'include'
        });
        window.location.href = '/login';
    } catch (error) {
        console.error('Logout error:', error);
        window.location.href = '/login';
    }
}

// Login Handler with 2FA support
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const token = document.getElementById('twoFactorCode')?.value || null;
    const errorDiv = document.getElementById('loginError') || document.getElementById('error');

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password, token }),
            credentials: 'include'
        });

        const data = await response.json();

        if (data.requires2FA) {
            const twoFAField = document.getElementById('2faField');
            if (twoFAField) {
                twoFAField.style.display = 'block';
                document.getElementById('twoFactorCode').focus();
            }
            if (errorDiv) {
                errorDiv.textContent = data.message;
                errorDiv.className = 'message success';
                errorDiv.style.display = 'block';
            }
            return;
        }

        if (response.ok && data.success) {
            window.location.href = '/dashboard';
        } else {
            if (errorDiv) {
                errorDiv.textContent = data.error || 'Login failed';
                errorDiv.className = 'message error';
                errorDiv.style.display = 'block';
            }
        }
    } catch (error) {
        console.error('Login error:', error);
        if (errorDiv) {
            errorDiv.textContent = 'Connection error. Please try again.';
            errorDiv.className = 'message error';
            errorDiv.style.display = 'block';
        }
    }
});

// Register Handler
document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const errorDiv = document.getElementById('registerError');

    if (password !== confirmPassword) {
        errorDiv.textContent = 'Passwords do not match';
        errorDiv.style.display = 'block';
        return;
    }

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password }),
            credentials: 'include'
        });

        const data = await response.json();

        if (response.ok && data.success) {
            alert('Registration successful! Please login.');
            window.location.href = '/login';
        } else {
            errorDiv.textContent = data.error || 'Registration failed';
            errorDiv.style.display = 'block';
        }
    } catch (error) {
        console.error('Registration error:', error);
        errorDiv.textContent = 'Connection error. Please try again.';
        errorDiv.style.display = 'block';
    }
});

// Load User Info on page load (skip for client portal pages)
if (window.location.pathname !== '/login' && 
    window.location.pathname !== '/register' && 
    !window.location.pathname.startsWith('/client/')) {
    document.addEventListener('DOMContentLoaded', fetchUser);
}
