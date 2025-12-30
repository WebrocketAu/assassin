// ClickSend SMS integration
import 'dotenv/config';

const CLICKSEND_API_URL = 'https://rest.clicksend.com/v3/sms/send';

const username = process.env.CLICKSEND_USERNAME;
const apiKey = process.env.CLICKSEND_API_KEY;
const fromNumber = process.env.CLICKSEND_FROM; // Optional - let ClickSend use default if not set
const appUrl = process.env.APP_URL; // Base URL for player links in SMS messages

let enabled = false;
let authHeader = null;

if (username && apiKey) {
  authHeader = 'Basic ' + Buffer.from(`${username}:${apiKey}`).toString('base64');
  enabled = true;
  console.log('ClickSend SMS enabled');
  console.log(`  Username: ${username}`);
  console.log(`  From: ${fromNumber || '(using ClickSend default)'}`);
  console.log(`  APP_URL: ${appUrl || '(not set - links will be omitted from messages)'}`);
} else {
  console.log('ClickSend credentials not found - SMS disabled (messages will be logged only)');
  console.log('  Set CLICKSEND_USERNAME and CLICKSEND_API_KEY environment variables to enable SMS');
}

function normalizePhone(phone) {
  // Strip all non-digits
  let cleaned = phone.replace(/\D/g, '');

  // Handle Australian numbers
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    // Australian mobile: 0412345678 -> +61412345678
    cleaned = '61' + cleaned.slice(1);
  } else if (cleaned.length === 9 && !cleaned.startsWith('0')) {
    // Already stripped leading 0: 412345678 -> +61412345678
    cleaned = '61' + cleaned;
  } else if (cleaned.length === 10 && !cleaned.startsWith('61')) {
    // US number: 1234567890 -> +11234567890
    cleaned = '1' + cleaned;
  }

  return '+' + cleaned;
}

async function sendSMS(to, body) {
  const phone = normalizePhone(to);
  console.log(`\n[SMS] Sending to ${phone}:`);
  console.log(`  Body: ${body}`);

  if (!enabled) {
    console.log('  Status: SKIPPED (SMS not enabled)');
    return true; // Return true for logging mode
  }

  try {
    const messagePayload = {
      source: 'assassin-game',
      body: body,
      to: phone
    };

    // Only include 'from' if explicitly configured
    if (fromNumber) {
      messagePayload.from = fromNumber;
    }

    const requestBody = {
      messages: [messagePayload]
    };

    console.log('  Request payload:', JSON.stringify(requestBody, null, 2));

    const response = await fetch(CLICKSEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const result = await response.json();
    console.log('  Response status:', response.status);
    console.log('  Response body:', JSON.stringify(result, null, 2));

    if (!response.ok) {
      console.error('  [ERROR] ClickSend HTTP error:', response.status);
      return false;
    }

    if (result.response_code === 'SUCCESS') {
      // Check individual message status
      const msgStatus = result.data?.messages?.[0]?.status;
      console.log(`  Message status: ${msgStatus}`);
      if (msgStatus === 'SUCCESS') {
        console.log('  [OK] SMS sent successfully');
        return true;
      } else {
        console.error(`  [WARNING] Message queued but status: ${msgStatus}`);
        return true; // Still return true as it's queued
      }
    } else {
      console.error('  [ERROR] ClickSend error:', result.response_code, result.response_msg);
      return false;
    }
  } catch (error) {
    console.error('  [ERROR] SMS error:', error.message);
    return false;
  }
}

// Send a simple test SMS
export async function sendTestSMS(to, message) {
  return sendSMS(to, message || 'Test message from Assassin Game');
}

export async function sendGameStartMessage(player, target, task) {
  let body = `The game is on! Your target is: ${target.name}. Task: ${task || 'Tag them!'}`;
  
  if (appUrl) {
    const link = `${appUrl}/play/${player.token}`;
    body += `\n\nYour player link: ${link}`;
  }
  
  return sendSMS(player.phone, body);
}

export async function sendNewTargetMessage(player, newTarget, task) {
  const taskPart = task ? ` Task: ${task}` : '';
  let body = `Kill confirmed! Your new target is: ${newTarget.name}.${taskPart}`;
  
  if (appUrl) {
    const link = `${appUrl}/play/${player.token}`;
    body += `\n\nYour player link: ${link}`;
  }
  
  return sendSMS(player.phone, body);
}

export async function sendEliminatedMessage(player, killerName) {
  const body = `You've been eliminated by ${killerName}! Better luck next time!`;
  return sendSMS(player.phone, body);
}

export async function sendWinnerMessage(player) {
  const body = `Congratulations! You are the last assassin standing! You won the game!`;
  return sendSMS(player.phone, body);
}

export async function sendKillRequestNotification(victim, killerName) {
  let body;
  
  if (appUrl) {
    const link = `${appUrl}/play/${victim.token}`;
    body = `${killerName} claims they got you! Confirm if true: ${link}`;
  } else {
    body = `${killerName} claims they got you! Open your player page to confirm.`;
  }
  
  return sendSMS(victim.phone, body);
}

export async function sendGameOverMessage(player, winnerName) {
  const body = `Game over! ${winnerName} won the Assassin game. Thanks for playing!`;
  return sendSMS(player.phone, body);
}
