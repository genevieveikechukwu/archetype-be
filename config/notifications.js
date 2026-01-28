const nodemailer = require('nodemailer');
const twilio = require('twilio');

// Email configuration
const emailTransporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: process.env.EMAIL_PORT || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// SMS configuration (Twilio)
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

// Send email notification
async function sendEmail(to, subject, html) {
  try {
    const info = await emailTransporter.sendMail({
      from: `"${process.env.APP_NAME || 'ArchetypeOS'}" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html
    });
    console.log('Email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Email error:', error);
    return { success: false, error: error.message };
  }
}

// Send SMS notification
async function sendSMS(to, message) {
  if (!twilioClient) {
    console.log('SMS not configured. Would send:', message);
    return { success: false, error: 'SMS not configured' };
  }

  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to
    });
    console.log('SMS sent:', result.sid);
    return { success: true, sid: result.sid };
  } catch (error) {
    console.error('SMS error:', error);
    return { success: false, error: error.message };
  }
}

// Send candidate status notification
async function notifyCandidateStatus(user, status, testScore = null) {
  const statusMessages = {
    passed: {
      subject: '🎉 Congratulations! You Passed the Assessment',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #10b981;">Congratulations, ${user.full_name}!</h1>
          <p>Great news! You have successfully passed the assessment with a score of <strong>${testScore}%</strong>.</p>
          <p>Our team will review your application and contact you with next steps within 2-3 business days.</p>
          <div style="background: #f0fdf4; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #059669; margin-top: 0;">What's Next?</h3>
            <ul>
              <li>Our hiring team will review your performance</li>
              <li>You'll receive an email about next steps</li>
              <li>Keep an eye on your inbox for updates</li>
            </ul>
          </div>
          <p style="color: #6b7280; font-size: 14px;">Best regards,<br>${process.env.APP_NAME || 'ArchetypeOS'} Team</p>
        </div>
      `,
      sms: `Congratulations ${user.full_name}! You passed the assessment with ${testScore}%. Our team will contact you soon with next steps.`
    },
    failed: {
      subject: 'Assessment Results - Next Steps',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #ef4444;">Assessment Results</h1>
          <p>Thank you for completing the assessment, ${user.full_name}.</p>
          <p>Your score: <strong>${testScore}%</strong></p>
          <p>Unfortunately, this score did not meet the passing threshold for this position.</p>
          <div style="background: #fef2f2; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p>We appreciate your interest and effort. We encourage you to:</p>
            <ul>
              <li>Continue developing your skills</li>
              <li>Consider reapplying in the future</li>
              <li>Check our career page for other opportunities</li>
            </ul>
          </div>
          <p style="color: #6b7280; font-size: 14px;">Best regards,<br>${process.env.APP_NAME || 'ArchetypeOS'} Team</p>
        </div>
      `,
      sms: `Thank you for completing the assessment. Your score: ${testScore}%. While you didn't pass this time, we encourage you to keep developing your skills.`
    },
    pending: {
      subject: 'Assessment Submitted - Under Review',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #3b82f6;">Assessment Submitted Successfully</h1>
          <p>Thank you, ${user.full_name}!</p>
          <p>We have received your assessment submission and it is currently being reviewed by our team.</p>
          <div style="background: #eff6ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #2563eb; margin-top: 0;">What Happens Next?</h3>
            <ul>
              <li>Your responses are being carefully reviewed</li>
              <li>You'll receive results within 2-3 business days</li>
              <li>We'll notify you via email and SMS</li>
            </ul>
          </div>
          <p style="color: #6b7280; font-size: 14px;">Best regards,<br>${process.env.APP_NAME || 'ArchetypeOS'} Team</p>
        </div>
      `,
      sms: `Assessment submitted! Your responses are under review. You'll receive results within 2-3 business days. Thank you!`
    },
    accepted: {
      subject: '🎊 Welcome to the Team!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #10b981;">Welcome Aboard, ${user.full_name}!</h1>
          <p>Congratulations! We're thrilled to inform you that you've been accepted to join our team.</p>
          <p>Your account has been activated and you now have full access to the learning platform.</p>
          <div style="background: #f0fdf4; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #059669; margin-top: 0;">Getting Started</h3>
            <ul>
              <li>Log in to your account at your convenience</li>
              <li>Complete your profile setup</li>
              <li>Start exploring your personalized learning path</li>
              <li>Meet your assigned supervisor</li>
            </ul>
          </div>
          <p><a href="${process.env.APP_URL || 'http://localhost:5173'}/login" style="display: inline-block; background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Access Your Account</a></p>
          <p style="color: #6b7280; font-size: 14px;">Best regards,<br>${process.env.APP_NAME || 'ArchetypeOS'} Team</p>
        </div>
      `,
      sms: `Welcome to the team, ${user.full_name}! Your account is now active. Log in to start your learning journey!`
    }
  };

  const notification = statusMessages[status];
  if (!notification) return;

  // Send email
  await sendEmail(user.email, notification.subject, notification.html);

  // Send SMS if phone number is available
  if (user.phone_number) {
    await sendSMS(user.phone_number, notification.sms);
  }
}

module.exports = {
  sendEmail,
  sendSMS,
  notifyCandidateStatus
};