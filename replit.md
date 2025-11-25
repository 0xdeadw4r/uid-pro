# Dominus Corps Manager

## Overview

Dominus Corps Manager is a full-stack web application for managing UID (User ID) licenses and user accounts. The system provides a dashboard for users to purchase, create, and manage UIDs with different durations, track credits, and view invoices. It includes multi-tier admin functionality, Discord OAuth integration for authentication, payment processing via NOWPayments, and license key generation through GenzAuth and KeyAuth APIs.

The application serves three distinct user types:
- **UID_MANAGER accounts**: Traditional UID bypass management
- **AIMKILL accounts**: User account creation system with username/password (usernames must start with "DC")
- **RESELLER accounts**: Authorized resellers who can create client accounts for assigned products using credits

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Application Stack
- **Backend Framework**: Node.js with Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: 
  - Local username/password authentication with bcrypt
  - Discord OAuth 2.0 via Passport.js (with guilds.join scope for member restoration)
  - Two-factor authentication (2FA) using Speakeasy and QR codes
- **Session Management**: Express-session with MongoDB session store (connect-mongo)
- **Templating**: Server-side rendering with static HTML files

### Authentication Architecture
The system implements a dual authentication strategy:

1. **Local Authentication**: Username/password stored in MongoDB with bcrypt hashing. JSON file-based whitelist system controls user registration eligibility.

2. **Discord OAuth**: Integrated for social login and Discord server member restoration. Stores access tokens and refresh tokens with expiration tracking to enable automatic re-addition of users to Discord servers.

3. **2FA System**: Optional TOTP-based two-factor authentication using Speakeasy, with QR code generation via the qrcode library. Recovery codes stored securely for account recovery.

4. **Network Fingerprinting**: Custom middleware generates device fingerprints using IP address and user-agent to detect suspicious login attempts from new devices.

### Role-Based Access Control
Multi-tier admin system with granular permissions:
- **Owner**: Full system access, cannot be demoted
- **Super Admin**: Can manage all users and perform critical operations
- **Admin**: Standard administrative privileges
- **Limited Admin**: Restricted admin access with specific operation limits
- **Regular User**: Standard user capabilities

Access control enforced through middleware checking `isAdmin`, `isSuperAdmin`, `isOwner`, and `isLimitedAdmin` flags.

### Credit System
Users purchase credits to create UIDs and Aimkill keys/accounts. The system tracks:
- Credit balance per user
- Credit consumption on UID and Aimkill creation
- Credit purchases via crypto payments
- Admin can manually adjust credits with audit logging

### Package Management System
Fully customizable package configuration stored in MongoDB:
- **UID Packages**: Admins can configure display names, durations (hours), credit costs, and prices
- **Aimkill Packages**: Admins can configure display names, durations (days), credit costs, and prices
- **Admin Panel Integration**: Dedicated "Packages" tab with subtabs for UID and Aimkill management
- **Real-time Updates**: Package changes apply immediately without server restart
- **Database Storage**: All package configurations stored in PackageConfig MongoDB collection
- **Default Packages**: System initializes with sensible defaults on first run

### Guest Pass System
Free guest accounts have limited one-time access:
- **Requirements**: Must verify with Discord OAuth before using pass
- **Customizable Duration**: Admins can configure maximum allowed duration (1, 3, 7, 15, or 30 days)
- **Dynamic Package Filtering**: Guests only see packages up to the admin-configured max duration
- **One-Time Use**: Once guest pass is used, account is locked from creating more items
- **Expiration Tracking**: Guest pass expiration date is recorded when used
- **Admin Control**: 
  - Enable/disable guest free UID creation
  - Enable/disable guest free Aimkill creation
  - Set maximum duration for guest passes (1day to 30days)
- Applies to both UID creation and Aimkill key/account creation endpoints

### Guest Video Management
Admins can configure a setup video that appears for all guests:
- **Admin Configuration**: Set video URL in Settings → Guest Configuration tab
- **Video URL Persistence**: URL is preserved across other settings updates (won't be erased when changing other guest settings)
- **YouTube Support**: Automatically converts YouTube watch URLs (`youtube.com/watch?v=`) and short URLs (`youtu.be/`) to embed format
- **External Videos**: Supports any embeddable video link (YouTube, Vimeo, etc.)
- **Guest Display**: Video appears in guest dashboard Setup tab
- **Database Storage**: Video URL stored in admin user document (`guestVideoUrl` field in User model)
- **API Endpoints**: 
  - GET `/api/guest-settings` returns the configured video URL
  - POST `/api/admin/guest-settings` saves the video URL with automatic YouTube conversion

### UID Management
UIDs are time-bound licenses with:
- Automatic expiration tracking
- Status updates (active/expired)
- Email reminders before expiration
- Discord notifications on creation/deletion
- Associated with creating user for audit trail

### Payment Integration
**NOWPayments API** for cryptocurrency payments:
- Supports USDT (TRC20) as primary payment currency
- Webhook-based payment verification
- Automatic credit allocation on successful payment
- Order tracking with unique invoice numbers

### Aimkill User Account System
**GenzAuth API Integration** for user account management:
- Username/password account creation
- Usernames must start with "DC" prefix (enforced on frontend and backend)
- Dual-database architecture: Accounts created in both GenzAuth API and local MongoDB
- Transaction-like behavior: If API creation fails, MongoDB creation is prevented
- Credit-based system: Users spend credits to create accounts
- Supports multiple duration packages (1 day, 3 days, 7 days, 15 days, 30 days, lifetime)

**Account Creation Flow**:
1. User selects duration package on `/aimkill-packages` page
2. Enters desired username (must start with "DC") and password
3. System validates credentials and checks credit balance
4. Creates account in GenzAuth API first
5. If API creation succeeds, creates account in local MongoDB
6. Deducts credits from user's balance
7. Logs activity for audit trail

### Reseller System
**Reseller Account Management** for authorized partners:
- **Credit-Based System**: Resellers use credits to create client accounts
- **Product Assignment**: Admins assign specific products to each reseller
- **GenzAuth API Key**: Each reseller can have their own GenzAuth seller key for product-specific API access
- **Client Creation**: Resellers create client accounts with username/password for their assigned products
- **Credit Deduction**: Credits are automatically deducted when resellers create clients
- **Admin Control**: Full CRUD operations in Admin Panel → Resellers tab
- **Tracking**: Total clients created per reseller, login history, and usage statistics

**Reseller Portal** (`/reseller/portal`):
- Separate authentication system from main users
- Create client accounts for assigned products
- View all created clients
- Check credit balance and usage statistics
- Product/package selection based on assignments

**Admin Management Features**:
- Create resellers with initial credits and product assignments
- Edit reseller credits, GenzAuth keys, and assigned products
- View reseller statistics (total clients created, last login)
- Enable/disable reseller accounts
- Delete resellers (with confirmation)

**Reseller Model** (`models/Reseller.js`):
- Username and bcrypt-hashed password
- Email (optional)
- Credit balance
- GenzAuth seller key (optional, per-reseller)
- Assigned products array (product keys)
- Total clients created counter
- Active/inactive status
- Created by and timestamps

### License Key Generation
**KeyAuth (LicenseAuth)**: Secondary service for legacy license keys
- Custom key mask format: `DOM-*****-*****`
- Expiry-based license creation
- Branded N1X/Dominus keys

### Data Models

**User Model** (`models/User.js`):
- Basic credentials and email
- Multi-tier admin flags and account type
- Discord OAuth tokens and metadata
- 2FA secrets and recovery codes
- Network fingerprints for device tracking
- Credit balance and invoice references
- Guest pass expiration for temporary access

**UID Model** (`models/UID.js`):
- Unique identifier and duration
- Creator tracking
- Expiration date with automatic status updates
- Reminder system to notify before expiry

**Invoice Model** (`models/Invoice.js`):
- Auto-generated invoice numbers
- Multiple invoice types (credit purchase, UID creation, refund)
- Billing address capture
- Tax calculation support
- Payment method and status tracking

**Activity Model** (`models/Activity.js`):
- User action logging
- Automatic cleanup (keeps last 100 activities)
- Timestamp-based audit trail

**LoginHistory Model** (`models/LoginHistory.js`):
- Success/failure tracking
- IP address logging
- Security monitoring capabilities

**Reseller Model** (`models/Reseller.js`):
- Username and password credentials (bcrypt hashed)
- Email address (optional)
- Credit balance for creating clients
- GenzAuth seller key (optional, per-reseller)
- Assigned products array (product keys)
- Total clients created tracking
- Active/inactive status flag
- Creator tracking and timestamps
- Last login timestamp

### Discord Integration

**Member Restoration Service** (`services/discordRestore.js`):
- Uses saved Discord OAuth tokens to re-add users to servers
- Token refresh mechanism when expired
- Batch restoration capabilities
- Statistics tracking for restoration operations

**Notification Service** (`services/discordService.js`):
- Webhook-based notifications to Discord channels
- Formatted embeds for login events, UID operations, and admin actions
- Color-coded messages for different event types
- Timezone-aware timestamps (Asia/Kolkata)

### Email Service
Simplified email service using Nodemailer with graceful degradation:
- UID creation confirmations
- Expiration reminders
- Notification templates with HTML formatting
- Falls back silently if email configuration unavailable

### PDF Generation
Invoice generation using PDFKit:
- Professional invoice layout
- Company branding
- Itemized billing
- Tax calculations
- Downloadable PDF format

### Security Features
1. **Network Fingerprinting**: Stable device identification using IP normalization and user-agent
2. **Session Security**: Secure cookies with MongoDB-backed sessions
3. **Password Hashing**: Bcrypt with configurable salt rounds
4. **CSRF Protection**: Implicit through session validation
5. **Admin Action Logging**: Comprehensive audit trail for all administrative operations

### File-Based Storage
Legacy JSON file system for backward compatibility:
- `bot/data/users.json`: User credentials
- `bot/data/whitelist.json`: Registration whitelist
- `bot/data/credits.json`: Credit balances
- `bot/data/uids.json`: UID records
- `bot/data/activity.json`: Activity logs
- `bot/data/login-history.json`: Login attempts

Migration system converts JSON data to MongoDB on startup.

## External Dependencies

### Third-Party Services
- **MongoDB**: Primary database (connection via MONGODB_URI environment variable)
- **Discord API**: OAuth authentication and bot integration for member restoration
- **NOWPayments API**: Cryptocurrency payment processing
- **GenzAuth API**: License key generation service (`https://genzauth-tl0c.onrender.com/api/seller`)
- **KeyAuth/LicenseAuth**: Alternative license service (`https://licenseauth.online/api/seller/`)

### NPM Packages
- **express**: Web framework
- **mongoose**: MongoDB ODM
- **passport** + **passport-discord**: OAuth authentication
- **bcrypt**: Password hashing
- **express-session** + **connect-mongo**: Session management
- **speakeasy**: 2FA TOTP generation
- **qrcode**: QR code generation for 2FA setup
- **pdfkit**: PDF invoice generation
- **nodemailer**: Email notifications
- **axios**: HTTP client for API requests
- **moment**: Date/time manipulation
- **body-parser**: Request parsing
- **dotenv**: Environment configuration

### Environment Configuration
Required environment variables:
- `MONGODB_URI`: MongoDB connection string
- `SESSION_SECRET`: Express session encryption key
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_CALLBACK_URL`: OAuth credentials
- `DISCORD_WEBHOOK_URL`: Notification webhook
- `DISCORD_BOT_TOKEN`: Bot token for member restoration
- `NOWPAYMENTS_API_KEY`: Payment processor key
- `GENZAUTH_SELLER_KEY`: GenzAuth API key
- `LICENSEAUTH_SELLER_KEY`: KeyAuth API key
- `EMAIL_HOST`, `EMAIL_USER`, `EMAIL_PASS`: SMTP credentials
- `PORT`: Server port (default 5000)

### Deployment
- Configured for Vercel serverless deployment via `vercel.json`
- Health check endpoint at `/health` for monitoring
- Trust proxy enabled for accurate IP detection behind reverse proxies