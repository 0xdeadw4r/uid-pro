// Simplified email service - won't break app if nodemailer fails
let nodemailer;
let transporter;

try {
    nodemailer = require('nodemailer');

    // Create transporter only if nodemailer loaded successfully
    transporter = nodemailer.createTransporter({
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: process.env.EMAIL_PORT || 587,
        secure: false,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
} catch (error) {
    console.log('⚠️ Nodemailer not available. Email features disabled.');
    transporter = null;
}

// Email templates
const templates = {
    uidCreated: (username, uid, packageName, expiresAt) => ({
        subject: '✅ UID Created Successfully',
        html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1a1a1a; padding: 20px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0;">UID Manager</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2 style="color: #1a1a1a;">UID Created Successfully!</h2>
          <p>Hi <strong>${username}</strong>,</p>
          <p>Your UID has been created successfully.</p>
          
          <div style="background: #ffffff; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 10px; border-bottom: 1px solid #e0e0e0;"><strong>UID:</strong></td>
                <td style="padding: 10px; border-bottom: 1px solid #e0e0e0;"><code style="background: #f5f5f5; padding: 4px 8px; border-radius: 4px;">${uid}</code></td>
              </tr>
              <tr>
                <td style="padding: 10px; border-bottom: 1px solid #e0e0e0;"><strong>Package:</strong></td>
                <td style="padding: 10px; border-bottom: 1px solid #e0e0e0;">${packageName}</td>
              </tr>
              <tr>
                <td style="padding: 10px;"><strong>Expires:</strong></td>
                <td style="padding: 10px;">${new Date(expiresAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
              </tr>
            </table>
          </div>

          <p style="color: #666; font-size: 14px;">Thank you for using UID Manager!</p>
        </div>
        <div style="background: #1a1a1a; padding: 15px; text-align: center; color: #ffffff; font-size: 12px;">
          <p style="margin: 0;">© 2025 UID Manager - EliteBlaze Development</p>
        </div>
      </div>
    `
    }),

    uidExpiring: (username, uid, hoursLeft) => ({
        subject: '⚠️ UID Expiring Soon',
        html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #ffc107; padding: 20px; text-align: center;">
          <h1 style="color: #000; margin: 0;">⚠️ UID Expiring Soon</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <p>Hi <strong>${username}</strong>,</p>
          <p>Your UID will expire in <strong>${hoursLeft} hours</strong>!</p>
          
          <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
            <p style="margin: 0;"><strong>UID:</strong> <code style="background: #f5f5f5; padding: 4px 8px; border-radius: 4px;">${uid}</code></p>
          </div>

          <p>Consider extending your UID to keep it active.</p>
        </div>
        <div style="background: #1a1a1a; padding: 15px; text-align: center; color: #ffffff; font-size: 12px;">
          <p style="margin: 0;">© 2025 UID Manager</p>
        </div>
      </div>
    `
    }),

    creditsAdded: (username, amount, newBalance) => ({
        subject: '💳 Credits Added to Your Account',
        html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #28a745; padding: 20px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0;">💳 Credits Added</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <p>Hi <strong>${username}</strong>,</p>
          <p><strong>${amount} credits</strong> have been added to your account!</p>
          
          <div style="background: #d4edda; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745; text-align: center;">
            <p style="margin: 0; font-size: 14px; color: #155724;">New Balance</p>
            <p style="margin: 10px 0 0 0; font-size: 32px; font-weight: bold; color: #155724;">${newBalance} Credits</p>
          </div>

          <p>You can now create new UIDs!</p>
        </div>
        <div style="background: #1a1a1a; padding: 15px; text-align: center; color: #ffffff; font-size: 12px;">
          <p style="margin: 0;">© 2025 UID Manager</p>
        </div>
      </div>
    `
    }),

    invoiceGenerated: (username, invoiceNumber, amount) => ({
        subject: `📄 Invoice ${invoiceNumber} Generated`,
        html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #17a2b8; padding: 20px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0;">📄 Invoice Generated</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <p>Hi <strong>${username}</strong>,</p>
          <p>Your invoice has been generated.</p>
          
          <div style="background: #ffffff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #17a2b8;">
            <p style="margin: 0 0 10px 0;"><strong>Invoice Number:</strong> <code style="background: #f5f5f5; padding: 4px 8px; border-radius: 4px;">${invoiceNumber}</code></p>
            <p style="margin: 0;"><strong>Amount:</strong> INR ${amount}</p>
          </div>

          <p>You can download your invoice from the Invoices page.</p>
        </div>
        <div style="background: #1a1a1a; padding: 15px; text-align: center; color: #ffffff; font-size: 12px;">
          <p style="margin: 0;">© 2025 UID Manager</p>
        </div>
      </div>
    `
    })
};

// Send email function with safety checks
async function sendEmail(to, templateName, data) {
    try {
        // Check if transporter is available
        if (!transporter) {
            console.log('⚠️ Email service not available. Skipping email.');
            return { success: false, message: 'Email service not configured' };
        }

        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            console.log('⚠️ Email credentials not configured. Skipping email.');
            return { success: false, message: 'Email credentials missing' };
        }

        const template = templates[templateName](data.username, ...Object.values(data).slice(1));

        const mailOptions = {
            from: process.env.EMAIL_FROM || 'UID Manager <noreply@uidmanager.com>',
            to: to,
            subject: template.subject,
            html: template.html
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Email sent:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('❌ Email error:', error.message);
        return { success: false, error: error.message };
    }
}

module.exports = {
    sendEmail,
    templates
};
