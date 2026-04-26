const nodemailer = require('nodemailer');
const logger = require('./logger');

let transporter = null;
let isRealEmail = false;
let senderEmail = '"GestureAuth Security" <security@gestureauth.local>';

const googlePassword = process.env.APP_PASSWORD || process.env.GOOGLE_EMAIL_PASSWORD;

// Setup transporter based on environment variables
if (process.env.BREVO_API_KEY) {
  transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.BREVO_EMAIL, // Must be provided in .env
      pass: process.env.BREVO_API_KEY,
    },
  });
  isRealEmail = true;
  senderEmail = process.env.BREVO_EMAIL ? `GestureAuth Security <${process.env.BREVO_EMAIL}>` : senderEmail;
  logger.info(`Brevo SMTP config applied`);
} else if (process.env.GOOGLE_EMAIL && googlePassword) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GOOGLE_EMAIL,
      pass: googlePassword.replace(/\s+/g, ''), // Strip spaces from the app password
    },
  });
  isRealEmail = true;
  senderEmail = `GestureAuth Security <${process.env.GOOGLE_EMAIL}>`;
  logger.info(`Gmail SMTP config applied for: ${process.env.GOOGLE_EMAIL}`);
} else {
  // Dynamically generate a free test SMTP account using Ethereal Email
  nodemailer.createTestAccount().then((account) => {
    transporter = nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: {
        user: account.user,
        pass: account.pass,
      },
    });
    logger.info(`Test SMTP Account created successfully: ${account.user}`);
  }).catch(err => {
    logger.error('Failed to create test SMTP account', err);
  });
}

const sendEmergencyOTP = async (email, otpCode) => {
  if (!transporter) {
    logger.error('Nodemailer transporter not initialized yet');
    return false;
  }

  try {
    const info = await transporter.sendMail({
      from: senderEmail,
      to: email,
      subject: 'Email Verification OTP',
      text: `Your email verification code is: ${otpCode}. It expires in 5 minutes.`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
          <h2 style="color: #4f46e5;">Email Verification</h2>
          <p>Please use this code to verify your email address and complete registration.</p>
          <div style="margin: 20px 0; padding: 15px; background: #f3f4f6; font-size: 24px; font-weight: bold; letter-spacing: 5px;">
            ${otpCode}
          </div>
          <p style="color: #6b7280; font-size: 12px;">This code expires in 5 minutes. Do not share it.</p>
        </div>
      `,
    });

    if (!isRealEmail) {
      // Ethereal provides a preview URL to click and read the fake email in the browser
      const previewUrl = nodemailer.getTestMessageUrl(info);
      logger.info(`OTP Email sent to ${email}`);
      logger.info(`READ EMAIL HERE: => ${previewUrl} <=`);
      return previewUrl;
    } else {
      logger.info(`OTP Email sent to ${email}`);
      return null; // No debug URL for real emails
    }
  } catch (err) {
    logger.error('Failed to send OTP Email', err);
    return false;
  }
};

module.exports = { sendEmergencyOTP };
