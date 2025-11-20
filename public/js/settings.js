// Tab switching
function switchTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });

    // Remove active from all buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Show selected tab
    document.getElementById(`${tabName}-tab`).classList.add('active');
    event.target.classList.add('active');
}

// Toggle API key visibility
function toggleApiKeyVisibility() {
    const input = document.getElementById('apiKey');
    const btn = event.target;

    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = 'Hide';
    } else {
        input.type = 'password';
        btn.textContent = 'Show';
    }
}

// Load user data and check if admin
async function loadUserSettings() {
    try {
        const user = await fetchUser();
        if (!user) return;

        // Update account info
        document.getElementById('accountUsername').textContent = user.username;
        document.getElementById('accountType').textContent = user.isAdmin ? 'Administrator' : 'User';
        document.getElementById('accountCredits').textContent = user.credits || 0;

        // Show admin link for all admin types
        if (user.isAdmin || user.isOwner || user.isSuperAdmin) {
            document.getElementById('adminLink').style.display = 'block';
        }

        // Show API config tab only for main super admin (username: admin)
        if (user.username === 'admin') {
            document.getElementById('apiConfigTab').style.display = 'block';
            loadApiConfig();
        }

        // Load activity and login history
        loadActivity();
        loadLoginHistory();
    } catch (error) {
        console.error('Error loading user settings:', error);
    }
}

// Load activity log
async function loadActivity() {
    try {
        const response = await fetch('/api/activity');
        const activities = await response.json();

        const container = document.getElementById('activityList');

        if (activities.length === 0) {
            container.innerHTML = '<div class="empty-state">No recent activity</div>';
            return;
        }

        container.innerHTML = activities.map(activity => `
            <div class="activity-item">
                <div>
                    <span class="activity-type ${activity.type}">${activity.type.toUpperCase().replace('-', ' ')}</span>
                    <span style="margin-left: 0.5rem;">${activity.description}</span>
                </div>
                <span class="activity-time">${new Date(activity.timestamp).toLocaleString()}</span>
            </div>
        `).join('');
    } catch (error) {
        document.getElementById('activityList').innerHTML = '<div class="empty-state">Failed to load activity</div>';
    }
}

// Load login history
async function loadLoginHistory() {
    try {
        const response = await fetch('/api/login-history');
        const logins = await response.json();

        const container = document.getElementById('loginHistoryList');

        if (logins.length === 0) {
            container.innerHTML = '<div class="empty-state">No login history</div>';
            return;
        }

        container.innerHTML = logins.map(login => `
            <div class="activity-item">
                <div>
                    <span>${login.success ? '✓ Successful' : '✗ Failed'} login</span>
                    ${login.ip ? `<span style="margin-left: 1rem; color: #666;">IP: ${login.ip}</span>` : ''}
                </div>
                <span class="activity-time">${new Date(login.timestamp).toLocaleString()}</span>
            </div>
        `).join('');
    } catch (error) {
        document.getElementById('loginHistoryList').innerHTML = '<div class="empty-state">Failed to load login history</div>';
    }
}

// Load API configuration
async function loadApiConfig() {
    try {
        const response = await fetch('/api/admin/api-config');
        const config = await response.json();

        document.getElementById('currentBaseUrl').value = config.baseUrl || '';
        document.getElementById('currentApiKey').value = '••••••••••••••••';
        document.getElementById('baseUrl').value = config.baseUrl || '';
    } catch (error) {
        console.error('Error loading API config:', error);
    }
}

// Save API configuration
document.getElementById('apiConfigForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const baseUrl = document.getElementById('baseUrl').value.trim();
    const apiKey = document.getElementById('apiKey').value.trim();
    const btn = document.getElementById('saveApiBtn');

    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const response = await fetch('/api/admin/api-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseUrl, apiKey })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('apiConfigMessage', 'API configuration updated successfully', 'success');
            loadApiConfig();
            document.getElementById('apiKey').value = '';
        } else {
            showMessage('apiConfigMessage', data.error || 'Failed to update configuration', 'error');
        }
    } catch (error) {
        showMessage('apiConfigMessage', 'Connection error. Please try again.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Configuration';
    }
});

// Change password
document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const btn = document.getElementById('changePasswordBtn');

    if (newPassword !== confirmPassword) {
        showMessage('passwordMessage', 'New passwords do not match', 'error');
        return;
    }

    if (newPassword.length < 6) {
        showMessage('passwordMessage', 'Password must be at least 6 characters', 'error');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Changing...';

    try {
        const response = await fetch('/api/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword, newPassword })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('passwordMessage', 'Password changed successfully', 'success');
            document.getElementById('changePasswordForm').reset();
        } else {
            showMessage('passwordMessage', data.error || 'Failed to change password', 'error');
        }
    } catch (error) {
        showMessage('passwordMessage', 'Connection error. Please try again.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Change Password';
    }
});

function showMessage(elementId, text, type) {
    const element = document.getElementById(elementId);
    element.textContent = text;
    element.className = type;
    element.style.display = 'block';
    setTimeout(() => {
        element.style.display = 'none';
    }, 5000);
}

// Initialize
loadUserSettings();
